/* TMS PDC Warehouse — Supabase cloud adapter.
   Saat Supabase dikonfigurasi, data cloud adalah source of truth bersama.
   LocalStorage/IndexedDB dipakai sebagai cache dan draft/offline recovery, bukan
   sebagai sumber kebenaran yang boleh menghidupkan kembali record cloud yang dihapus. */
(function(){
  const configured=typeof SUPABASE_URL!=='undefined'&&SUPABASE_URL&&typeof SUPABASE_ANON_KEY!=='undefined'&&SUPABASE_ANON_KEY;
  let client=null, channel=null, timer=null, applying=false; const PENDING_KEY='tms-pdc-pending-observations'; const CLOUD_PENDING_KEY='tms-pdc-pending-cloud-snapshot';
  async function sdk(){
    if(window.supabase)return window.supabase;
    await new Promise((ok,bad)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';s.onload=ok;s.onerror=bad;document.head.appendChild(s)});
    return window.supabase;
  }
  async function getClient(){
    if(!configured)return null;
    if(client)return client;
    if(window.__tmsSupabaseClient){client=window.__tmsSupabaseClient;window.tmsSupabaseClient=client;return client}
    if(!window.__tmsSupabaseClientPromise){
      window.__tmsSupabaseClientPromise=sdk().then(sb=>{
        const existing=window.tmsSupabaseClient||window.__tmsSupabaseClient;
        const instance=existing||sb.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
        window.__tmsSupabaseClient=instance;
        window.tmsSupabaseClient=instance;
        return instance;
      });
    }
    client=await window.__tmsSupabaseClientPromise;
    window.tmsSupabaseClient=client;
    return client;
  }
  function n(v){return v==null?null:+v}

  async function ensureAuthSession(){
    if(!configured)return null;
    const mw=window.tmsAuthMiddleware;
    if(mw&&typeof mw.requireSession==='function') return mw.requireSession();
    const sb=await getClient();
    if(!sb)return null;
    for(let attempt=0;attempt<4;attempt++){
      const {data,error}=await sb.auth.getSession();
      if(error)throw error;
      if(data?.session?.user)return data.session;
      await new Promise(r=>setTimeout(r,150*(attempt+1)));
    }
    throw new Error('Sesi Supabase belum siap. Silakan login ulang.');
  }

  async function loadState(){
    const authState=await ensureAuthSession();
    const sb=await getClient(); if(!sb)return null;
    if(configured&&!authState?.session&&!authState?.user){
      throw new Error('Sesi Supabase belum siap. Silakan login ulang.');
    }
    const [ops,masters,obs,rfs,st]=await Promise.all([
      sb.from('operators').select('*').order('name'),
      sb.from('master_elements').select('*').order('created_at', {ascending:true}).order('id', {ascending:true}),
      sb.from('observations').select('*').order('created_at'),
      sb.from('rating_factors').select('*'),
      sb.from('study_settings').select('*').eq('id',1).maybeSingle()
    ]);
    for(const r of [ops,masters,obs,rfs,st])if(r.error)throw r.error;
    const opById=new Map((ops.data||[]).map(x=>[x.id,x]));
    const operators=(ops.data||[]).map(x=>x.name);
    const operatorDepartments=Object.fromEntries((ops.data||[]).map(x=>[x.name,x.activity||'']));
    const ratings={},westinghouse={};
    (rfs.data||[]).forEach(r=>{const op=opById.get(r.operator_id);if(!op)return;ratings[op.name]=n(r.rating_factor)||1;westinghouse[op.name]={skill:n(r.skill_value)||0,effort:n(r.effort_value)||0,condition:n(r.condition_value)||0,consistency:n(r.consistency_value)||0};});
    const settings={allowance:n(st.data?.allowance_percent??10)/100,confidence:95,minInitialN:+(st.data?.n_min_observations??5),operators,operatorDepartments,ratings,westinghouse};
    const master=(masters.data||[]).map(x=>({id:x.id,process:x.process,activity:x.activity,element:x.element_name,classification:x.classification,waste:x.lean_waste,method:x.work_method,equipment:x.equipment,frequency:n(x.frequency_per_day)||0,notes:x.notes||''}));
    const observations=(obs.data||[]).map(x=>({id:x.id,observationSessionId:x.observation_session_id||x.observation_cycle_id||`LEGACY-${x.id}`,observationCycleId:x.observation_cycle_id||x.observation_session_id||`LEGACY-${x.id}`,date:(x.observed_at||'').slice(0,10),study:x.study||'',operator:opById.get(x.operator_id)?.name||x.operator_name||'',process:x.process,activity:x.activity,element:x.element_name,size:x.size_category,start:n(x.start_time),end:n(x.end_time),time:n(x.observed_time)||0,classification:x.classification,waste:x.lean_waste,method:x.work_method,equipment:x.equipment,note:x.notes||'',createdAt:Date.parse(x.created_at||Date.now())}));
    return {observations,settings,master};
  }
  let queuedState=null, queuedResolvers=[];
  let statusCb=null;
  function setStatus(s){try{statusCb&&statusCb(s)}catch(e){}}
  function migrateLegacyPending(){try{const raw=localStorage.getItem(PENDING_KEY);if(!raw)return;const value=JSON.parse(raw);if(value&&typeof value==='object'&&!Array.isArray(value)&&value.state){localStorage.setItem(CLOUD_PENDING_KEY,raw);localStorage.removeItem(PENDING_KEY)}}catch(e){console.warn('Could not migrate legacy pending cloud snapshot:',e)}}
  migrateLegacyPending();
  function persistPending(state){try{localStorage.setItem(CLOUD_PENDING_KEY,JSON.stringify({state,savedAt:Date.now()}))}catch(e){console.warn('Could not persist pending cloud snapshot:',e)}}
  function readPending(){try{const raw=localStorage.getItem(CLOUD_PENDING_KEY);return raw?JSON.parse(raw):null}catch(e){return null}}
  function clearPending(){try{localStorage.removeItem(CLOUD_PENDING_KEY)}catch(e){}}
  function hasPending(){return !!readPending()}
  let flushing=false;
  async function flushPending(){
    if(flushing||!configured)return false;
    const pending=readPending();
    if(!pending)return true;
    if(typeof navigator!=='undefined'&&navigator.onLine===false)return false;
    flushing=true; setStatus('retrying');
    try{
      await write(pending.state);
      clearPending();
      setStatus('synced');
      return true;
    }catch(err){
      console.warn('Cloud retry still failing:',err);
      setStatus('pending');
      return false;
    }finally{flushing=false}
  }
  if(typeof window!=='undefined'){
    window.addEventListener('online',()=>{flushPending()});
  }
  async function saveSnapshot(state){
    if(!configured||applying)return false;
    queuedState=state;
    return await new Promise(resolve=>{
      queuedResolvers.push(resolve);
      clearTimeout(timer);
      timer=setTimeout(async()=>{
        const snapshot=queuedState; queuedState=null;
        const resolvers=queuedResolvers.splice(0);
        // Persist BEFORE attempting the write. If the tab closes or the network
        // drops mid-request, the next reload (or the "online" event) can still
        // find and retry this exact snapshot instead of losing it silently.
        persistPending(snapshot);
        try{
          await write(snapshot);
          clearPending();
          setStatus('synced');
          resolvers.forEach(resolve=>resolve(true));
        }catch(err){
          console.error('Cloud sync failed',err);
          setStatus('pending');
          resolvers.forEach(resolve=>resolve(false));
        }
      },150);
    });
  }
  async function write(state){
    const authState=await ensureAuthSession();
    const currentRole=window.tmsAuth?.getRole?.()||authState?.profile?.role||null;
    if(!['admin','analyst'].includes(currentRole)) return;
    const sb=await getClient(); if(!sb)return;
    if(configured&&!authState?.session&&!authState?.user)throw new Error('Sesi Supabase belum siap. Silakan login ulang.');
    const names=[...new Set((state.settings.operators||[]).map(x=>String(x).trim()).filter(Boolean))];
    const opRows=names.map(name=>({name,activity:state.settings.operatorDepartments?.[name]||null}));
    if(opRows.length){const {error}=await sb.from('operators').upsert(opRows,{onConflict:'name'});if(error)throw error;}
    const {data:ops,error:oe}=await sb.from('operators').select('id,name');if(oe)throw oe;
    const opId=Object.fromEntries((ops||[]).map(x=>[x.name,x.id]));
    const masters=(state.master||[]).map(m=>{const row={process:m.process,activity:m.activity,element_name:m.element,classification:m.classification||null,lean_waste:m.waste||null,work_method:normalizeMasterMethod(m.method)||null,equipment:m.equipment||null,frequency_per_day:n(m.frequency)||0,notes:m.notes||null};if(m.id)row.id=m.id;else row.id=(typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')?crypto.randomUUID():('m-'+Date.now()+'-'+Math.random().toString(16).slice(2));return row;});
    if(masters.length){const {error}=await sb.from('master_elements').upsert(masters,{onConflict:'process,activity,element_name'});if(error)throw error;}
    const ratings=names.map(name=>{const w=state.settings.westinghouse?.[name]||{};return {operator_id:opId[name],skill_value:n(w.skill)||0,effort_value:n(w.effort)||0,condition_value:n(w.condition)||0,consistency_value:n(w.consistency)||0};}).filter(x=>x.operator_id);
    if(ratings.length){const {error}=await sb.from('rating_factors').upsert(ratings,{onConflict:'operator_id'});if(error)throw error;}
    const setRow={id:1,n_min_observations:+state.settings.minInitialN||5,allowance_percent:(+state.settings.allowance||0)*100,updated_at:new Date().toISOString()};
    if(currentRole==='admin'){const {error}=await sb.from('study_settings').upsert(setRow);if(error)throw error;}
    const obs=(state.observations||[]).map(o=>({id:o.id,observation_no:null,observation_session_id:o.observationSessionId||o.observationCycleId||`LEGACY-${o.id}`,observation_cycle_id:o.observationCycleId||o.observationSessionId||`LEGACY-${o.id}`,observed_at:o.date?`${o.date}T00:00:00Z`:new Date(o.createdAt||Date.now()).toISOString(),study:o.study||null,process:o.process||null,activity:o.activity||null,element_name:o.element||null,operator_id:opId[o.operator]||null,operator_name:o.operator||null,size_category:o.size||null,start_time:n(o.start),end_time:n(o.end),observed_time:n(o.time)||0,classification:o.classification||null,lean_waste:o.waste||null,work_method:o.method||null,equipment:o.equipment||null,notes:o.note||null,created_at:new Date(o.createdAt||Date.now()).toISOString()}));
    if(obs.length){const {error}=await sb.from('observations').upsert(obs,{onConflict:'id'});if(error)throw error;}
  }
  let refreshTimer=null,refreshQueuedEvent=null;
  async function subscribe(cb){
    const sb=await getClient(); if(!sb)return;
    if(channel){
      const status=channel.state;
      if(status==='joined'||status==='joining'||status==='joining'||status==='leaving')return;
      try{await sb.removeChannel(channel)}catch(e){}
      channel=null;
    }
    const tables=['observations','operators','master_elements','rating_factors','study_settings','tskk_studies','tskk_items'];
    channel=sb.channel('tms-realtime');
    tables.forEach(table=>channel.on('postgres_changes',{event:'*',schema:'public',table},payload=>refresh(payload)));
    channel.subscribe(status=>{
      if(status==='SUBSCRIBED')setStatus('synced');
      if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){
        setStatus('pending');
        setTimeout(()=>{if(channel&&['CHANNEL_ERROR','TIMED_OUT'].includes(channel.state))subscribe(cb).catch(()=>{})},1500);
      }
    });
    async function refresh(payload){
      refreshQueuedEvent=payload||refreshQueuedEvent;
      clearTimeout(refreshTimer);
      refreshTimer=setTimeout(async()=>{
        const event=refreshQueuedEvent;refreshQueuedEvent=null;
        if(applying)return;
        applying=true;
        try{const data=await loadState();await cb(data,event)}
        catch(err){console.warn('Realtime refresh failed:',err);setStatus('pending')}
        finally{setTimeout(()=>applying=false,150)}
      },80);
    }
  }
  if(typeof window!=='undefined'){
    window.addEventListener('online',()=>{flushPending();if(channel&&['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(channel.state)){subscribe(window.__tmsRealtimeCallback||(()=>{})).catch(()=>{})}});
    window.addEventListener('pageshow',()=>{if(channel&&['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(channel.state)&&window.__tmsRealtimeCallback)subscribe(window.__tmsRealtimeCallback).catch(()=>{})});
  }
  async function deleteObservation(id){
    await ensureAuthSession();
    if((window.tmsAuth?.getRole?.()||'')!=='admin')throw new Error('Delete observasi hanya diizinkan untuk Admin.');
    const sb=await getClient(); if(!sb)throw new Error('Supabase belum terhubung.');
    const {error}=await sb.from('observations').delete().eq('id',id); if(error)throw error;
  }
  async function deleteOperator(name){
    await ensureAuthSession();
    if((window.tmsAuth?.getRole?.()||'')!=='admin')throw new Error('Hapus PIC hanya diizinkan untuk Admin.');
    const sb=await getClient(); if(!sb)throw new Error('Supabase belum terhubung.');
    const {error}=await sb.from('operators').delete().eq('name',name); if(error)throw error;
  }
  async function deleteMaster(id){
    await ensureAuthSession();
    if((window.tmsAuth?.getRole?.()||'')!=='admin')throw new Error('Hapus master hanya diizinkan untuk Admin.');
    const sb=await getClient(); if(!sb)throw new Error('Supabase belum terhubung.');
    if(!id)throw new Error('ID master tidak tersedia. Muat ulang data cloud terlebih dahulu.');
    const {error}=await sb.from('master_elements').delete().eq('id',id); if(error)throw error;
  }
  window.tmsCloud={enabled:!!configured,loadState,saveSnapshot,subscribe(cb){window.__tmsRealtimeCallback=cb;return subscribe(cb)},deleteObservation,deleteOperator,deleteMaster,
    hasPending,flushPending,
    onStatus(cb){statusCb=cb}
  };
  // If the app was closed while an update was still unsynced, try again as
  // soon as this module loads (covers "closed the tab offline, reopened
  // later already connected" — the "online" event alone would never fire
  // in that case because connectivity was already there before load).
  if(configured&&hasPending()){
    setTimeout(()=>{flushPending()},1200);
  }
})();

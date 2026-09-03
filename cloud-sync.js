/* TMS PDC Warehouse — Supabase cloud adapter.
   Local-first tetap aktif. Jika SUPABASE_URL dan SUPABASE_ANON_KEY diisi,
   Supabase menjadi sumber data bersama dan perubahan dipantau secara realtime. */
(function(){
  const configured=typeof SUPABASE_URL!=='undefined'&&SUPABASE_URL&&typeof SUPABASE_ANON_KEY!=='undefined'&&SUPABASE_ANON_KEY;
  let client=null, channel=null, timer=null, applying=false;
  async function sdk(){
    if(window.supabase)return window.supabase;
    await new Promise((ok,bad)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';s.onload=ok;s.onerror=bad;document.head.appendChild(s)});
    return window.supabase;
  }
  async function getClient(){if(!configured)return null;if(client)return client;const sb=await sdk();client=window.tmsSupabaseClient||sb.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);window.tmsSupabaseClient=client;return client}
  function n(v){return v==null?null:+v}
  async function loadState(){
    const sb=await getClient(); if(!sb)return null;
    // Cloud dimulai setelah autentikasi siap. Jangan jadikan sesi kosong sebagai error koneksi,
    // karena sesi Supabase dapat dipulihkan dari storage secara asynchronous.
    const {error:sessionError}=await sb.auth.getSession();
    if(sessionError) throw sessionError;
    const [ops,masters,obs,rfs,st]=await Promise.all([
      sb.from('operators').select('*').order('name'),
      sb.from('master_elements').select('*').order('process').order('activity').order('element_name'),
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
    const observations=(obs.data||[]).map(x=>({id:x.id,date:(x.observed_at||'').slice(0,10),study:x.study||'',operator:opById.get(x.operator_id)?.name||x.operator_name||'',process:x.process,activity:x.activity,element:x.element_name,size:x.size_category,start:n(x.start_time),end:n(x.end_time),time:n(x.observed_time)||0,classification:x.classification,waste:x.lean_waste,method:x.work_method,equipment:x.equipment,note:x.notes||'',createdAt:Date.parse(x.created_at||Date.now())}));
    return {observations,settings,master};
  }
  async function saveSnapshot(state){
    if(!configured||applying)return;
    clearTimeout(timer);timer=setTimeout(()=>write(state).catch(err=>console.error('Cloud sync failed',err)),250);
  }
  async function write(state){
    const sb=await getClient(); if(!sb)return;
    const names=[...new Set((state.settings.operators||[]).map(x=>String(x).trim()).filter(Boolean))];
    const opRows=names.map(name=>({name,activity:state.settings.operatorDepartments?.[name]||null}));
    if(opRows.length){const {error}=await sb.from('operators').upsert(opRows,{onConflict:'name'});if(error)throw error;}
    const {data:ops,error:oe}=await sb.from('operators').select('id,name');if(oe)throw oe;
    const opId=Object.fromEntries((ops||[]).map(x=>[x.name,x.id]));
    const masters=(state.master||[]).map(m=>({process:m.process,activity:m.activity,element_name:m.element,classification:m.classification||null,lean_waste:m.waste||null,work_method:m.method||null,equipment:m.equipment||null,frequency_per_day:n(m.frequency)||0,notes:m.notes||null}));
    if(masters.length){const {error}=await sb.from('master_elements').upsert(masters,{onConflict:'process,activity,element_name'});if(error)throw error;}
    const ratings=names.map(name=>{const w=state.settings.westinghouse?.[name]||{};return {operator_id:opId[name],skill_value:n(w.skill)||0,effort_value:n(w.effort)||0,condition_value:n(w.condition)||0,consistency_value:n(w.consistency)||0};}).filter(x=>x.operator_id);
    if(ratings.length){const {error}=await sb.from('rating_factors').upsert(ratings,{onConflict:'operator_id'});if(error)throw error;}
    const setRow={id:1,n_min_observations:+state.settings.minInitialN||5,allowance_percent:(+state.settings.allowance||0)*100,updated_at:new Date().toISOString()};
    {const {error}=await sb.from('study_settings').upsert(setRow);if(error)throw error;}
    const obs=(state.observations||[]).map(o=>({id:o.id,observation_no:null,observed_at:o.date?`${o.date}T00:00:00Z`:new Date(o.createdAt||Date.now()).toISOString(),study:o.study||null,process:o.process||null,activity:o.activity||null,element_name:o.element||null,operator_id:opId[o.operator]||null,operator_name:o.operator||null,size_category:o.size||null,start_time:n(o.start),end_time:n(o.end),observed_time:n(o.time)||0,classification:o.classification||null,lean_waste:o.waste||null,work_method:o.method||null,equipment:o.equipment||null,notes:o.note||null,created_at:new Date(o.createdAt||Date.now()).toISOString()}));
    if(obs.length){const {error}=await sb.from('observations').upsert(obs,{onConflict:'id'});if(error)throw error;}
  }
  async function subscribe(cb){
    const sb=await getClient(); if(!sb||channel)return;
    channel=sb.channel('tms-realtime').on('postgres_changes',{event:'*',schema:'public',table:'observations'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'operators'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'master_elements'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'rating_factors'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'study_settings'},refresh).subscribe();
    async function refresh(){if(applying)return;applying=true;try{const data=await loadState();cb(data)}finally{setTimeout(()=>applying=false,500)}}
  }
  window.tmsCloud={enabled:!!configured,loadState,saveSnapshot,subscribe};
})();

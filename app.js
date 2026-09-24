/* ==========================================================================
   01. Local storage, offline cache & data continuity
   ========================================================================== */
const KEY='tmwa-pdc-v2-data'; const SETTINGS_KEY='tmwa-pdc-v2-settings'; const MASTER_KEY='tmwa-pdc-v2-master';
const IDB_NAME='tmwa-pdc-warehouse'; const IDB_STORE='kv'; const PENDING_KEY='tmwa-pdc-pending-observations';
function safeRead(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch(err){console.warn('Local storage read failed:',key,err);return fallback}}
function safeWrite(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch(err){console.warn('Local storage write failed:',key,err);return false}}
function legacyStorageKey(suffix){return ['t','m','s'].join('')+'-'+suffix}
const LEGACY_KEYS={
  data:legacyStorageKey('pdc-v2-data'),settings:legacyStorageKey('pdc-v2-settings'),master:legacyStorageKey('pdc-v2-master'),
  drafts:legacyStorageKey('pdc-v2-drafts'),videoDraft:legacyStorageKey('pdc-v2-draft-observation-video'),pending:legacyStorageKey('pdc-pending-observations'),
  tskk:'tmwa-pdc-tskk-studies',session:['t','m','s'].join('')+'_pdc_session'
};
async function migrateLegacyLocalData(){
  const report={migrated:[],skipped:[],failed:[]};
  const copyLocal=(from,to,validator)=>{
    try{
      if(localStorage.getItem(to)!=null){report.skipped.push(to);return}
      const raw=localStorage.getItem(from); if(raw==null)return;
      const value=JSON.parse(raw); if(validator&&!validator(value))return;
      localStorage.setItem(to,raw); report.migrated.push(to);
    }catch(e){report.failed.push(to);console.warn('Local migration failed:',to,e)}
  };
  copyLocal(LEGACY_KEYS.data,KEY,v=>Array.isArray(v));
  copyLocal(LEGACY_KEYS.settings,SETTINGS_KEY,v=>v&&typeof v==='object'&&!Array.isArray(v));
  copyLocal(LEGACY_KEYS.master,MASTER_KEY,v=>Array.isArray(v));
  copyLocal(LEGACY_KEYS.drafts,DRAFT_KEY,v=>v&&typeof v==='object'&&!Array.isArray(v));
  copyLocal(LEGACY_KEYS.videoDraft,OBS_VIDEO_DRAFT_KEY,()=>true);
  copyLocal(LEGACY_KEYS.pending,PENDING_KEY,v=>Array.isArray(v));
  copyLocal(LEGACY_KEYS.session,'tmwa_pdc_session',v=>v&&typeof v==='object');
  try{
    const oldDb=await new Promise((resolve,reject)=>{
      if(!('indexedDB' in window))return resolve(null);
      const req=indexedDB.open(['t','m','s'].join('')+'-pdc-warehouse',1);
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>resolve(null);
      req.onupgradeneeded=()=>{try{req.transaction.abort()}catch(e){}}
    });
    if(oldDb){
      const names=[KEY,SETTINGS_KEY,MASTER_KEY,DRAFT_KEY];
      for(const key of names){
        const targetExists=await idbGet(key).catch(()=>null); if(targetExists!=null)continue;
        const legacyKey=key===KEY?LEGACY_KEYS.data:key===SETTINGS_KEY?LEGACY_KEYS.settings:key===MASTER_KEY?LEGACY_KEYS.master:key===DRAFT_KEY?LEGACY_KEYS.drafts:null;
        if(!legacyKey)continue;
        const value=await new Promise(resolve=>{try{const tx=oldDb.transaction('kv','readonly');const req=tx.objectStore('kv').get(legacyKey);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>resolve(null)}catch(e){resolve(null)}});
        if(value!=null){await idbSet(key,value).catch(()=>{});report.migrated.push('indexedDB:'+key)}
      }
      try{oldDb.close()}catch(e){}
    }
  }catch(e){console.warn('IndexedDB migration skipped:',e)}
  if(report.migrated.length) console.info('Data lokal lama berhasil dimigrasikan ke TMWA:',report.migrated);
  return report;
}
const DRAFT_KEY='tmwa-pdc-v2-drafts'; const OBS_VIDEO_DRAFT_KEY='tmwa-pdc-v2-draft-observation-video';
function readDrafts(){const value=safeRead(DRAFT_KEY,{});return value&&typeof value==='object'&&!Array.isArray(value)?value:{}}
let drafts=readDrafts();
const draftTimers={};
function persistDrafts(){safeWrite(DRAFT_KEY,drafts)}
function saveDraft(scope,value){if(!scope)return;drafts[scope]=value;persistDrafts()}
function scheduleDraft(scope,capture){clearTimeout(draftTimers[scope]);draftTimers[scope]=setTimeout(()=>{try{const value=capture();if(value)saveDraft(scope,value)}catch(e){console.warn('Draft save failed:',scope,e)}},120)}
function clearDraft(scope){if(!scope)return;delete drafts[scope];persistDrafts()}
function getDraft(scope){return drafts[scope]||null}
let activeDraftCapture=null;
function registerDraftCapture(fn){activeDraftCapture=typeof fn==='function'?fn:null}
function captureActiveDraft(){try{activeDraftCapture&&activeDraftCapture()}catch(e){console.warn('Active draft capture failed:',e)}}
function idbOpen(){return new Promise((resolve,reject)=>{try{if(!('indexedDB' in window))return reject(new Error('IndexedDB tidak tersedia'));const req=indexedDB.open(IDB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(IDB_STORE))req.result.createObjectStore(IDB_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB gagal dibuka'))}catch(e){reject(e)}})}
async function idbGet(key){const db=await idbOpen();return await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,'readonly'),st=tx.objectStore(IDB_STORE),req=st.get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('IndexedDB read gagal'));tx.oncomplete=()=>db.close();tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction gagal'))})}
async function idbSet(key,value){const db=await idbOpen();return await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,'readwrite'),st=tx.objectStore(IDB_STORE);st.put(value,key);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{const e=tx.error||new Error('IndexedDB write gagal');db.close();reject(e)}})}
function pendingIds(){const value=safeRead(PENDING_KEY,[]);return new Set(Array.isArray(value)?value:[])}
function rememberPending(ids){const set=pendingIds();ids.forEach(id=>set.add(id));safeWrite(PENDING_KEY,[...set])}
function forgetPending(ids){const set=pendingIds();ids.forEach(id=>set.delete(id));safeWrite(PENDING_KEY,[...set])}
async function hydrateLocalData(){
  await migrateLegacyLocalData();
  let localObs=safeRead(KEY,[]), localSettings=safeRead(SETTINGS_KEY,{}), localMaster=safeRead(MASTER_KEY,null);
  try{const [io,is,im]=await Promise.all([idbGet(KEY),idbGet(SETTINGS_KEY),idbGet(MASTER_KEY)]);
    if((!Array.isArray(localObs)||!localObs.length)&&Array.isArray(io)) localObs=io;
    if((!localSettings||!Object.keys(localSettings).length)&&is&&typeof is==='object') localSettings=is;
    if((!Array.isArray(localMaster)||!localMaster.length)&&Array.isArray(im)) localMaster=im;
  }catch(e){console.warn('IndexedDB hydration skipped:',e)}
  if(Array.isArray(localObs)) observations=localObs;
  if(localSettings&&typeof localSettings==='object') settings={...settings,...localSettings};
  if(Array.isArray(localMaster)&&localMaster.length) safeWrite(MASTER_KEY,localMaster);
}
function mergeObservations(remote,local){
  // Supabase is authoritative for synced observations. Local cache may only
  // contribute records that are explicitly pending a cloud write right now.
  // Therefore a row missing from the remote snapshot is treated as deleted;
  // stale localStorage/IndexedDB rows are never resurrected.
  const pending=pendingIds();
  const map=new Map((remote||[]).map(o=>[o.id,o]));
  for(const o of (local||[])){
    if(pending.has(o.id)&&!map.has(o.id)) map.set(o.id,o);
  }
  return [...map.values()].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
/* ==========================================================================
   02. Core study data & classifications
   ========================================================================== */
const WASTE_TYPES=['Defects','Overproduction','Waiting','Non-Utilized Talent','Transportation','Inventory','Motion','Extra Processing'];
const CLASSIFICATIONS=['Direct Value-Added','Non-Value-Added','Indirect','Loss'];
function masterData(){const v=safeRead(MASTER_KEY,null);const rows=Array.isArray(v)&&v.length?v:MASTER_DATA;return rows.map(x=>{const f=x.frequencyBySize||{};return {...x,method:normalizeMasterMethod(x.method),equipment:x.equipment||'-',frequencyBySize:{Small:(f.Small==null||f.Small==='')?null:+f.Small,Medium:(f.Medium==null||f.Medium==='')?null:+f.Medium,Big:(f.Big==null||f.Big==='')?null:+f.Big}}});}
function saveMaster(rows){if(!ensureWrite())return false;safeWrite(MASTER_KEY,rows);idbSet(MASTER_KEY,rows).catch(e=>console.warn('Master IndexedDB save failed:',e));return true;}
function normalizeMasterMethod(method){
  const v=String(method||'').trim().toLowerCase();
  if(v==='alat bantu'||v==='alat-bantu'||v==='mesin'||v==='auto'||v==='auto / machine'||v==='auto/machine') return 'Auto / Machine';
  if(v==='walking'||v==='walk'||v==='walk / walking') return 'Walking';
  return 'Manual';
}
function masterMethodOptions(){return ['Manual','Walking','Auto / Machine']}
function tskkTypeFromMaster(element){
  const m=normalizeMasterMethod(getMaster(element)?.method);
  if(m==='Auto / Machine') return 'auto';
  if(m==='Walking') return 'walk';
  return 'manual';
}
function getMaster(element){return masterData().find(x=>x.element===element);}
let observations=safeRead(KEY,[]);
// Observation-session linkage is internal metadata for source tracking and data continuity.
observations=observations.map(o=>({...o,observationSessionId:o.observationSessionId||o.observationCycleId||`LEGACY-${o.id}`}));
let settings=safeRead(SETTINGS_KEY,{});
const DEFAULT_OPERATORS=(typeof OPERATORS!=='undefined'&&OPERATORS.length?OPERATORS:['Operator 1']);
function zPresetForConfidenceLocal(confidence){const c=Number(confidence);if(Math.abs(c-90)<0.01)return 1.645;if(Math.abs(c-95)<0.01)return 1.96;if(Math.abs(c-99)<0.01)return 2.576;return null;}
settings.allowance ??= 0.1;
settings.confidence ??= 95;
settings.zValue ??= 1.96;
settings.precision ??= 0.05;
settings.minInitialN ??= 5;
function normalizeValidationSettings(){
  const preset=zPresetForConfidenceLocal(settings.confidence);
  if(preset!=null) settings.zValue=preset;
  settings.minInitialN=Math.max(2,Math.round(Number(settings.minInitialN)||5));
  settings.precision=Math.max(0.001,Number(settings.precision)||0.05);
  settings.allowance=Math.min(0.9,Math.max(0,Number(settings.allowance)||0));
}
normalizeValidationSettings();
settings.operators ??= [...DEFAULT_OPERATORS];
// Rating Factor is scoped to PIC + Activity. `operatorDepartments` is retained
// only for data continuity and is not used in the current methodology.
settings.operatorDepartments ??= {};
settings.ratings ??= {};
settings.westinghouse??={};
settings.ratingByActivity??={};
function defaultWestinghouseLocal(){return {skill:0,effort:0,condition:0,consistency:0};}
function ratingEqual(a,b){return ['skill','effort','condition','consistency'].every(k=>Math.abs((+a?.[k]||0)-(+b?.[k]||0))<1e-12);}
// Compatibility bridge for older PIC + Element rating records. A rating is
// carried forward only when all elements in the same Activity share the same
// Westinghouse components; conflicts remain unconfigured instead of guessing.
(function migrateLegacyRatingModel(){
  if(settings.ratingByActivity && Object.keys(settings.ratingByActivity).length)return;
  const legacy=settings.ratingByElement;
  if(!legacy || typeof legacy!=='object')return;
  const migrated={};
  const conflicts=[];
  settings.operators.forEach(pic=>{
    const byElement=legacy[pic]||{};
    const groups={};
    masterData().forEach(m=>{
      const w=byElement[m.element];
      if(!w)return;
      (groups[m.activity]??=[]).push(w);
    });
    Object.entries(groups).forEach(([activity,list])=>{
      if(!list.length)return;
      const base=list[0];
      if(list.every(w=>ratingEqual(w,base))){
        migrated[pic]??={};
        migrated[pic][activity]={skill:+base.skill||0,effort:+base.effort||0,condition:+base.condition||0,consistency:+base.consistency||0};
      }else{
        conflicts.push(`${pic} + ${activity}`);
      }
    });
  });
  settings.ratingByActivity=migrated;
  settings.ratingMigrationConflicts=conflicts;
})();
function ratingDraftFor(operator,activity){
  const by=settings.ratingByActivity?.[operator]?.[activity];
  return by||null;
}
function ratingFactorFor(operator,activity){
  const w=ratingDraftFor(operator,activity);
  if(!w)return null;
  const rf=westinghouseFactor({skill:Number(w.skill)||0,effort:Number(w.effort)||0,condition:Number(w.condition)||0,consistency:Number(w.consistency)||0});
  return Number.isFinite(rf)&&rf>0?rf:null;
}
// Preserve the rating used at the time each observation was saved.
// When a snapshot is missing, recover it only from the current PIC + Activity
// rating; otherwise keep the row unrated rather than assuming RF = 1.00.
function backfillRatingSnapshots(){
  let changed=false;
  observations=observations.map(o=>{
    if(Number.isFinite(+o.ratingFactorSnapshot)&&+o.ratingFactorSnapshot>0)return o;
    const rf=ratingFactorFor(o?.operator,o?.activity);
    if(!Number.isFinite(rf)||rf<=0)return o;
    changed=true;
    return {...o,ratingFactorSnapshot:rf};
  });
  return changed;
}
backfillRatingSnapshots();
const initialHistoryState=(history.state&&typeof history.state==='object')?history.state:null;
let state={view:['dashboard','observe','data','master','tskk','validation','rating','standard','waste','users'].includes(initialHistoryState?.appView)?initialHistoryState.appView:'dashboard',videoUrl:null,start:null,end:null,manualTime:null,observationMethod:'video',observationSessionId:null,videoFileName:'',tskkEditor:initialHistoryState?.appView==='tskk'&&initialHistoryState?.tskkEditor===true,tskkDraftId:initialHistoryState?.tskkId||null};
let tskkHistoryGuard=false;
let tskkRenderSeq=0;
const $=s=>document.querySelector(s), $$=(s,root=document)=>[...root.querySelectorAll(s)];
let toastTimer=null;
function showToast(message,type='info',duration=3600){
  const text=String(message??'').trim();
  if(!text)return;
  let host=$('#toastHost');
  if(!host){
    host=document.createElement('div');
    host.id='toastHost';
    host.className='toast-host';
    host.setAttribute('aria-live','polite');
    host.setAttribute('aria-atomic','true');
    document.body.appendChild(host);
  }
  const tone=['success','error','warning','info'].includes(type)?type:'info';
  const icon={success:'✓',error:'!',warning:'!',info:'i'}[tone];
  host.querySelectorAll('.ut-toast').forEach(el=>el.remove());
  const toast=document.createElement('div');
  toast.className=`ut-toast ut-toast-${tone}`;
  toast.style.setProperty('--toast-duration',`${Math.max(1800,Number(duration)||3600)}ms`);
  toast.setAttribute('role',tone==='error'?'alert':'status');
  toast.innerHTML=`<span class="ut-toast-icon" aria-hidden="true">${icon}</span><div class="ut-toast-body"><b>${tone==='success'?'Berhasil':tone==='error'?'Gagal':tone==='warning'?'Perhatian':'Informasi'}</b><span>${esc(text)}</span></div><button class="ut-toast-close" type="button" aria-label="Tutup notifikasi">×</button><i class="ut-toast-progress" aria-hidden="true"></i>`;
  host.appendChild(toast);
  requestAnimationFrame(()=>toast.classList.add('is-visible'));
  const close=()=>{clearTimeout(toastTimer);toast.classList.remove('is-visible');setTimeout(()=>toast.remove(),220)};
  toast.querySelector('.ut-toast-close').onclick=close;
  clearTimeout(toastTimer);
  toastTimer=setTimeout(close,Math.max(1800,Number(duration)||3600));
}

function createUTDialog({title,message,mode='confirm',value='',placeholder='',confirmText='Simpan',danger=false,optsInputType='text'}={}){
  return new Promise(resolve=>{
    const host=$('#utDialogHost')||document.body.appendChild(Object.assign(document.createElement('div'),{id:'utDialogHost'}));
    host.className='ut-dialog-host';
    const backdrop=document.createElement('div');
    backdrop.className='modal-backdrop ut-dialog-backdrop';
    const dialog=document.createElement('div');
    dialog.className='modal ut-dialog';
    const input=mode==='input'?`<label class="ut-dialog-field">${esc(placeholder||title)}<input id="utDialogInput" type="${esc(optsInputType||'text')}" value="${esc(value)}" autocomplete="off"></label>`:'';
    dialog.innerHTML=`<div class="ut-dialog-icon ${danger?'danger':''}" aria-hidden="true">${danger?'!':mode==='input'?'✎':'?'}</div><div class="ut-dialog-content"><h3>${esc(title||'Konfirmasi')}</h3><p>${esc(message||'')}</p>${input}</div><div class="ut-dialog-actions"><button type="button" class="btn ghost" data-dialog-cancel>Batal</button><button type="button" class="btn ${danger?'danger':''}" data-dialog-ok>${esc(confirmText)}</button></div>`;
    backdrop.appendChild(dialog); host.appendChild(backdrop);
    const field=dialog.querySelector('#utDialogInput');
    let done=false;
    const finish=result=>{
      if(done)return; done=true; document.removeEventListener('keydown',onKey); backdrop.classList.remove('is-visible');
      setTimeout(()=>backdrop.remove(),160); resolve(result);
    };
    const onKey=e=>{if(e.key==='Escape')finish(null);if(e.key==='Enter'&&mode==='input')finish(field?.value??'');};
    dialog.querySelector('[data-dialog-cancel]').onclick=()=>finish(null);
    dialog.querySelector('[data-dialog-ok]').onclick=()=>finish(mode==='input'?(field?.value??''):true);
    backdrop.addEventListener('click',e=>{if(e.target===backdrop)finish(null)});
    document.addEventListener('keydown',onKey);
    requestAnimationFrame(()=>{backdrop.classList.add('is-visible');field?.focus();field?.select()});
  });
}
window.tmwaDialog={
  confirm:(message,opts={})=>createUTDialog({mode:'confirm',message,title:opts.title||'Konfirmasi',confirmText:opts.confirmText||'Lanjutkan',danger:!!opts.danger}),
  input:(title,value='',opts={})=>createUTDialog({mode:'input',title,value,message:opts.message||'Masukkan nilai yang diperlukan.',placeholder:opts.placeholder||title,confirmText:opts.confirmText||'Simpan',optsInputType:opts.inputType||'text'})
};

function newId(){
  try{
    if(globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if(globalThis.crypto?.getRandomValues){
      const a=new Uint8Array(16); globalThis.crypto.getRandomValues(a);
      a[6]=(a[6]&0x0f)|0x40; a[8]=(a[8]&0x3f)|0x80;
      const h=[...a].map(b=>b.toString(16).padStart(2,'0')).join('');
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
    }
  }catch(e){}
  return 'local-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
}
const esc=s=>String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]));
/* ==========================================================================
   03. Access control, roles & application utilities
   ========================================================================== */
function role(){const r=window.tmwaAuth?.getRole?.();return r==null?null:String(r).trim().toLowerCase()}
function isAdmin(){return role()==='admin'}
function canWrite(){return role()==='admin'||role()==='analyst'}
function canDelete(){return role()==='admin'}
function ensureWrite(){if(!canWrite()){showToast('Akses ini hanya tersedia untuk pengguna Analyst atau Admin.','warning');return false}return true}
function ensureAdmin(){if(!isAdmin()){showToast('Akses ini hanya tersedia untuk Admin.','warning');return false}return true}
function applyRoleUI(){const r=role();const admin=r==='admin';const nav=$('#nav');if(nav)nav.setAttribute('data-current-role',r||'');$$('[data-role]').forEach(el=>{const required=el.dataset.role;if(required==='admin'){const hide=!admin;el.classList.toggle('hidden',hide);el.hidden=hide;el.setAttribute('aria-hidden',String(hide));return}const hide=!!r&&required!==r&&!((required==='analyst')&&r==='admin');el.classList.toggle('hidden',hide);el.hidden=hide;el.setAttribute('aria-hidden',String(hide));});const adminGroup=$('#adminNavGroup');if(adminGroup){const hide=!admin;adminGroup.classList.toggle('hidden',hide);adminGroup.hidden=hide;adminGroup.setAttribute('aria-hidden',String(hide));adminGroup.style.display=hide?'none':'contents';}const usersBtn=$('#nav button[data-view="users"]');if(usersBtn){const hide=!admin;usersBtn.classList.toggle('hidden',hide);usersBtn.hidden=hide;usersBtn.setAttribute('aria-hidden',String(hide));}const exp=$('#exportCsv'),imp=$('#importCsv');const expWrap=exp,impWrap=imp?.closest('.import-btn');[expWrap,impWrap].forEach(el=>{if(el){const hide=!canWrite();el.classList.toggle('hidden',hide);el.hidden=hide;}});}
function operatorList(){return [...new Set(settings.operators.filter(Boolean).map(x=>String(x).trim()).filter(x=>!x.startsWith('Kalau menambah operator baru:')))]}
function westinghouseFactor(r){return 1+(+r.skill||0)+(+r.effort||0)+(+r.condition||0)+(+r.consistency||0)}
/* ==========================================================================
   04. Persistence & study settings helpers
   ========================================================================== */
function save(){
  // Local storage is the immediate commit path. Cloud sync must never block a
  // button click or navigation: Supabase can take seconds on a cold connection.
  const okObs=safeWrite(KEY,observations);
  const okSettings=safeWrite(SETTINGS_KEY,settings);
  if(!okObs||!okSettings){
    showToast('Data lokal tidak dapat disimpan oleh browser ini. Buka aplikasi melalui localhost (bukan file://) agar penyimpanan lokal stabil.','warning');
    return false;
  }
  // Keep IndexedDB as a secondary local cache, but never make the UI wait for it.
  Promise.all([idbSet(KEY,observations),idbSet(SETTINGS_KEY,settings)]).catch(err=>console.warn('IndexedDB local save failed:',err));
  const verify=safeRead(KEY,null);
  if(!Array.isArray(verify)||verify.length<observations.length){
    showToast('Penyimpanan lokal tidak terverifikasi. Data belum dianggap tersimpan. Gunakan localhost untuk pengujian lokal.','warning');
    return false;
  }
  const x=$('#storageStatus');if(x)x.textContent=(window.tmwaCloud?.enabled?'Saved locally • syncing cloud…':'Auto-saved ')+new Date().toLocaleTimeString('id-ID');
  if(window.tmwaCloud?.enabled && canWrite()){
    const snapshot={observations:[...observations],settings:{...settings},master:masterData()};
    window.tmwaCloud.saveSnapshot(snapshot).catch(err=>console.warn('Cloud sync queued failed:',err));
  }
  return true;
}
function fmt(n){return Number(n||0).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtFreq(n){return Number(n||0).toLocaleString('id-ID',{minimumFractionDigits:0,maximumFractionDigits:0})}
// Universal display rule for duration values. Data is still stored/calculated in seconds,
// but every user-facing duration automatically switches to minutes at 60 seconds.
/* ==========================================================================
   05. Time formatting & calculation engine
   ========================================================================== */
function timeUnitFor(seconds){const n=Math.abs(Number(seconds)||0);return n>=60?{label:'menit',divisor:60}:{label:'dtk',divisor:1}}
function fmtDurationNumber(value){return Number(value||0).toLocaleString('id-ID',{minimumFractionDigits:0,maximumFractionDigits:2})}
function fmtTimeValue(seconds){const n=Number(seconds);if(!Number.isFinite(n))return '—';const u=timeUnitFor(n);return `${fmtDurationNumber(n/u.divisor)} ${u.label}`}
function t(sec){if(sec==null||!isFinite(sec))return '—';sec=Math.max(0,Math.round(sec*100)/100);let h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),whole=Math.floor(sec%60),cs=Math.round((sec-Math.floor(sec))*100);if(cs===100){whole++;cs=0}if(whole===60){whole=0;m++}if(m===60){m=0;h++}return `${h?String(h).padStart(2,'0')+':':''}${String(m).padStart(2,'0')}:${String(whole).padStart(2,'0')}.${String(cs).padStart(2,'0')}`}
function unique(a){return [...new Set(a)]}
function opt(list,placeholder='Pilih...'){return `<option value="">${placeholder}</option>`+list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}
function hierarchyKey(row){return [row.process||'',row.activity||'',row.element||''].map(v=>String(v).trim()).join('|')}
function observedElements(){return new Set(observations.map(hierarchyKey)).size}
function grouped(category=false){const map={};observations.forEach(o=>{const base=hierarchyKey(o),k=category?base+'|'+(o.size||''):base;(map[k]??=[]).push(o)});return Object.entries(map).map(([key,rows])=>({key,process:rows[0].process||'',activity:rows[0].activity||'',element:rows[0].element||'',size:category?(rows[0].size||''):'Pooled',rows}));}
function validTimeRows(rows){return rows.filter(r=>Number.isFinite(+r.time)&&+r.time>0);}
function requiredObservationCount(times){
  const x=times.filter(Number.isFinite),n=x.length;
  if(n<2)return null;
  const sum=x.reduce((a,b)=>a+b,0),sumSq=x.reduce((a,b)=>a+b*b,0);
  if(!(sum>0))return null;
  const z=Math.max(0.000001,Number(settings.zValue)||1.96);
  const precision=Math.max(0.000001,Number(settings.precision)||0.05);
  const radicand=Math.max(0,n*sumSq-sum*sum);
  return Math.ceil(((z/precision)*Math.sqrt(radicand)/sum)**2);
}
function zPresetForConfidence(confidence){
  const c=Number(confidence);
  if(Math.abs(c-90)<0.01)return 1.645;
  if(Math.abs(c-95)<0.01)return 1.96;
  if(Math.abs(c-99)<0.01)return 2.576;
  return null;
}
function stats(rows){
  const clean=validTimeRows(rows),x=clean.map(r=>+r.time),n=x.length;
  if(!n)return {n:0,validN:0};
  const mean=x.reduce((a,b)=>a+b,0)/n;
  const variance=n>1?x.reduce((a,b)=>a+(b-mean)**2,0)/(n-1):0;
  const sd=Math.sqrt(variance);
  const ucl=mean+3*sd,lcl=Math.max(0,mean-3*sd);
  const effective=clean.filter(r=>+r.time>=lcl&&+r.time<=ucl);
  const validX=effective.map(r=>+r.time),validN=validX.length;
  const validMean=validN?validX.reduce((a,b)=>a+b,0)/validN:0;
  const validSd=validN>1?Math.sqrt(validX.reduce((a,b)=>a+(b-validMean)**2,0)/(validN-1)):0;
  const out=n-validN;
  const required=requiredObservationCount(validX);
  const uniform=n>=2&&out===0;
  const testable=n>=settings.minInitialN;
  const sufficient=testable&&uniform&&required!=null&&validN>=required;
  return {n,mean,sd,ucl,lcl,out,uniform,testable,required,sufficient,validN,validMean,validSd};
}
function effectiveRows(g){const st=stats(g.rows);return validTimeRows(g.rows).filter(r=>+r.time>=st.lcl&&+r.time<=st.ucl);}
function ratingForObservation(row){const snap=Number(row?.ratingFactorSnapshot);return Number.isFinite(snap)&&snap>0?snap:null;}
function ratingSnapshotFor(operator,activity){const rf=ratingFactorFor(operator,activity);return Number.isFinite(rf)&&rf>0?rf:null;}
function standardFromGroup(g,source){
  if(!g)return null;
  const st=stats(g.rows);
  if(!st.uniform||!st.sufficient||!st.validN)return null;
  const rows=effectiveRows(g);
  const rated=rows.map(r=>({row:r,rf:ratingForObservation(r)}));
  if(!rated.length||rated.some(x=>!Number.isFinite(x.rf)||x.rf<=0))return null;
  const normal=rated.reduce((sum,x)=>sum+(+x.row.time||0)*x.rf,0)/rated.length;
  const rf=rated.reduce((sum,x)=>sum+x.rf,0)/rated.length;
  const allowance=Math.max(0,Number(settings.allowance)||0);
  const standard=normal/(1-allowance);
  return {source,mean:st.validMean,rf,normal,standard,n:st.validN,rawN:st.n,stats:st};
}
function standardFor(process,activity,element,size){
  const base=String(size||'').toLowerCase();
  if(!base||base==='all'||base==='pooled'||base==='gabungan'){
    const pooled=grouped(false).find(g=>g.process===process&&g.activity===activity&&g.element===element);
    return standardFromGroup(pooled,'All / Tanpa Dimensi');
  }
  const cat=grouped(true).find(g=>g.process===process&&g.activity===activity&&g.element===element&&g.size===size);
  return standardFromGroup(cat,'Category specific');
}
function frequencyForSize(master,size){
  const value=master?.frequencyBySize?.[size];
  return Number.isFinite(+value)&&+value>=0?+value:null;
}
function frequencySummary(master){
  return ['Small','Medium','Big'].map(size=>`${size.charAt(0)}: ${frequencyForSize(master,size)==null?'—':fmtFreq(frequencyForSize(master,size))}`).join(' • ');
}
function setHeader(title,eyebrow='TIME & MOTION STUDY'){const t=$('#pageTitle');if(t)t.textContent=title;const e=$('#pageEyebrow');if(e)e.textContent=eyebrow;}
function kpi(label,value,sub=''){return `<div class="card kpi"><div class="kpi-content"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div></div>`}
function dashboardRows(filter={}){
  const match=m=>(!filter.process||m.process===filter.process)&&(!filter.activity||m.activity===filter.activity)&&(!filter.element||m.element===filter.element);
  const rows=[];
  masterData().filter(match).forEach(m=>{
    const size=filter.size||'All';
    const r=standardFor(m.process,m.activity,m.element,size);
    if(r) rows.push({...m,size:r.source==='Category specific'?size:'All / Tanpa Dimensi',...r});
  });
  return rows;
}
function priority(p){return p>=30?'Critical':p>=20?'High':p>=10?'Medium':p>0?'Low':'—'}
function dashboardPie(classNames, cls, total){
  const safeTotal=Number(total)||0;
  if(!(safeTotal>0))return `<div class="chart-empty">Belum ada standard time yang dapat divisualisasikan.</div>`;
  const colors=['#f5b400','#102a43','#2f6fed','#4b5563'];
  // Circumference-based segments are stable for zero, half, full-circle and mixed values.
  const r=68, circumference=2*Math.PI*r; let offset=0;
  const slices=classNames.map((cName,i)=>{
    const value=Math.max(0,Number(cls[cName])||0);
    const length=Math.min(circumference,(value/safeTotal)*circumference);
    const dash=length>0?`${length} ${Math.max(0,circumference-length)}`:`0 ${circumference}`;
    const node=length>0?`<circle class="pie-slice" cx="100" cy="100" r="${r}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="28" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 100 100)"></circle>`:'';
    offset+=length;
    return node;
  }).join('');
  return `<div class="pie-chart-wrap"><svg class="pie-chart" viewBox="0 0 200 200" role="img" aria-label="Time Classification">${slices}<circle cx="100" cy="100" r="48" fill="#fff"></circle><text x="100" y="95" text-anchor="middle" class="pie-total-label">TOTAL</text><text x="100" y="115" text-anchor="middle" class="pie-total-value">${fmtTimeValue(safeTotal)}</text></svg><div class="chart-legend">${classNames.map((cName,i)=>{const value=Math.max(0,Number(cls[cName])||0);return `<div class="chart-legend-item"><div class="chart-legend-label"><i style="background:${colors[i%colors.length]}"></i><span>${esc(cName)}</span></div><div class="chart-legend-metrics"><b>${fmtTimeValue(value)}</b><small>${fmt(value/safeTotal*100)}%</small></div></div>`}).join('')}</div></div>`;
}
function dashboardPareto(top){
  if(!top.length)return `<div class="chart-empty">Belum ada data waste pada filter aktif.</div>`;

  // Pareto chart uses one fixed time unit across the whole chart so the bar axis
  // remains mathematically readable. Display values outside the chart can still
  // follow the universal per-value seconds/minutes rule.
  const unit=timeUnitFor(Math.max(...top.map(x=>Number(x.time)||0)));
  const values=top.map(x=>Math.max(0,Number(x.time)||0)/unit.divisor);
  const rawMax=Math.max(...values,1);
  const niceStep=rawMax<=5?1:rawMax<=20?5:rawMax<=100?20:Math.ceil(rawMax/5/10)*10;
  const maxVal=Math.max(niceStep,Math.ceil(rawMax/niceStep)*niceStep);
  const plotMax=maxVal*1.08;
  let cum=0;
  const W=900,H=380,L=76,R=76,T=30,B=92;
  const PW=W-L-R,PH=H-T-B;
  const barSlot=PW/top.length;
  const barW=Math.min(74,Math.max(30,barSlot*0.48));
  const y=v=>T+PH-(Math.max(0,v)/plotMax)*PH;
  const pctY=p=>T+PH-(Math.max(0,p)/100)*PH;
  const xCenter=i=>L+barSlot*(i+.5);
  const ticks=[0,.25,.5,.75,1].map(r=>({value:maxVal*r,y:y(maxVal*r),label:fmtDurationNumber(maxVal*r)}));
  const rightTicks=[0,25,50,75,100];
  const grid=ticks.map(t=>`<line x1="${L}" y1="${t.y.toFixed(1)}" x2="${W-R}" y2="${t.y.toFixed(1)}" class="pareto-gridline"/>`).join('');
  const bars=values.map((v,i)=>{const topY=y(v),height=Math.max(2,T+PH-topY);return `<rect x="${(xCenter(i)-barW/2).toFixed(1)}" y="${topY.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="7" class="pareto-svg-bar"><title>${esc(top[i].waste)} — ${fmtDurationNumber(v)} ${unit.label}</title></rect><text x="${xCenter(i).toFixed(1)}" y="${Math.max(T+12,topY-8).toFixed(1)}" text-anchor="middle" class="pareto-value-label">${fmtDurationNumber(v)} ${unit.label}</text>`}).join('');
  const points=[];
  top.forEach((x,i)=>{cum+=Number(x.contribution)||0;points.push([xCenter(i),pctY(Math.min(100,cum))]);});
  const path=points.map((p,i)=>`${i?'L':'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const line=`<path d="${path}" class="pareto-cumulative-line"/>${points.map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="5" class="pareto-cumulative-dot"><title>Kumulatif ${fmt(Math.min(100,cum=top.slice(0,i+1).reduce((a,z)=>a+(Number(z.contribution)||0),0)))}%</title></circle><text x="${p[0].toFixed(1)}" y="${(p[1]-10).toFixed(1)}" text-anchor="middle" class="pareto-percent-label">${fmt(Math.min(100,top.slice(0,i+1).reduce((a,z)=>a+(Number(z.contribution)||0),0)))}%</text>`).join('')}`;
  const xLabels=top.map((x,i)=>`<text x="${xCenter(i).toFixed(1)}" y="${H-B+28}" text-anchor="middle" class="pareto-x-label"><tspan x="${xCenter(i).toFixed(1)}" dy="0">${esc(x.waste)}</tspan><tspan x="${xCenter(i).toFixed(1)}" dy="15">${esc(x.element||'')}</tspan></text>`).join('');
  const leftLabels=ticks.map(t=>`<text x="${L-12}" y="${(t.y+4).toFixed(1)}" text-anchor="end" class="pareto-axis-label">${t.label}</text>`).join('');
  const rightLabels=rightTicks.map(p=>`<text x="${W-R+12}" y="${(pctY(p)+4).toFixed(1)}" text-anchor="start" class="pareto-axis-label">${p}%</text>`).join('');
  const axisTitles=`<text x="18" y="${T+PH/2}" text-anchor="middle" class="pareto-axis-title pareto-axis-title-vertical" transform="rotate(-90 18 ${T+PH/2})">Waste Time (${unit.label})</text><text x="${W-18}" y="${T+PH/2}" text-anchor="middle" class="pareto-axis-title pareto-axis-title-vertical" transform="rotate(90 ${W-18} ${T+PH/2})">Kumulatif (%)</text><text x="${W/2}" y="${H-10}" text-anchor="middle" class="pareto-axis-title">Jenis Waste</text>`;
  return `<div class="pareto-chart" role="img" aria-label="Pareto waste: sumbu X menunjukkan jenis waste, sumbu Y kiri menunjukkan estimated waste time dalam ${unit.label}, dan sumbu Y kanan menunjukkan kontribusi kumulatif dalam persen"><div class="pareto-svg-wrap"><svg class="pareto-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><g>${grid}</g><line x1="${L}" y1="${T}" x2="${L}" y2="${T+PH}" class="pareto-axis-line"/><line x1="${W-R}" y1="${T}" x2="${W-R}" y2="${T+PH}" class="pareto-axis-line"/><line x1="${L}" y1="${T+PH}" x2="${W-R}" y2="${T+PH}" class="pareto-axis-line"/>${leftLabels}${rightLabels}${axisTitles}${bars}${line}${xLabels}</svg></div><div class="pareto-legend"><span class="pareto-legend-item"><i class="pareto-legend-box"></i> = Estimated Waste Time</span><span class="pareto-legend-item"><i class="pareto-legend-line"></i> = Kumulatif (%)</span></div></div>`;
}
/* ==========================================================================
   06. Dashboard & analytical summaries
   ========================================================================== */
function renderDashboard(){
  setHeader('Dashboard','TMWA PDC WAREHOUSE • LEAN TIME & MOTION');
  const processes=unique(masterData().map(x=>x.process));
  $('#app').innerHTML=`<div class="content dashboard-content">
    <div class="card dashboard-filter">
      <div class="filter-title"><div><h3>Dashboard Filter</h3><p class="muted">Analisis otomatis mengikuti kombinasi Process, Activity, Element Kerja, dan Kategori Ukuran.</p></div></div>
      <div class="dashboard-filter-controls"><div class="form-grid four dashboard-filter-grid"><label>Process<select id="dashProcess">${opt(processes,'All Process')}</select></label><label>Activity<select id="dashActivity"><option value="">All Activity</option></select></label><label>Element Kerja<select id="dashElement"><option value="">All Element Kerja</option></select></label><label>Kategori Ukuran<select id="dashSize"><option value="">All Category</option><option>Small</option><option>Medium</option><option>Big</option></select></label></div><div class="dashboard-filter-actions"><button id="resetDashFilter" class="btn ghost">Reset Filter</button></div></div>
    </div><div id="dashResults"></div></div>`;
  const f={process:'',activity:'',element:'',size:''};
  const renderActivity=()=>{const arr=f.process?unique(masterData().filter(x=>x.process===f.process).map(x=>x.activity)):unique(masterData().map(x=>x.activity));$('#dashActivity').innerHTML=opt(arr,'All Activity');if(!arr.includes(f.activity))f.activity='';$('#dashActivity').value=f.activity};
  const renderElement=()=>{const arr=masterData().filter(x=>(!f.process||x.process===f.process)&&(!f.activity||x.activity===f.activity)).map(x=>x.element);$('#dashElement').innerHTML=opt(unique(arr),'All Element Kerja');if(!arr.includes(f.element))f.element='';$('#dashElement').value=f.element};
  const renderResults=()=>{
    const rows=dashboardRows(f), normal=rows.reduce((a,x)=>a+x.normal,0), standard=rows.reduce((a,x)=>a+x.standard,0);
    const aggregateMode=f.size?`Category ${f.size}`:'All / Tanpa Dimensi';
    const classNames=['Direct Value-Added','Non-Value-Added','Indirect','Loss'], cls=Object.fromEntries(classNames.map(c=>[c,0]));
    rows.forEach(x=>{const c=classNames.find(c=>String(x.classification||'').toLowerCase()===c.toLowerCase())||'Loss';cls[c]+=x.standard});
    const classTotal=Object.values(cls).reduce((a,b)=>a+b,0);
    const wasteRows=rows.filter(x=>x.waste&&x.waste!=='-'&&String(x.classification).toLowerCase()!=='direct value-added').map(x=>({element:x.element,waste:x.waste,time:x.standard}));
    const wasteTotal=wasteRows.reduce((a,x)=>a+x.time,0);
    const top=[...wasteRows].sort((a,b)=>b.time-a.time).slice(0,5).map((x,i)=>({...x,rank:i+1,contribution:wasteTotal?x.time/wasteTotal*100:0})); const largest=top[0];
    $('#dashResults').innerHTML=`
      <div class="grid cols-4 dashboard-kpis">${kpi('NORMAL TIME',fmtTimeValue(normal),aggregateMode)}${kpi('STANDARD TIME',fmtTimeValue(standard),`Allowance ${fmt(settings.allowance*100)}% • ${aggregateMode}`)}${kpi('TOTAL WASTE',fmtTimeValue(wasteTotal),'Waste dengan waktu terukur')}${kpi('WASTE TERBESAR',largest?largest.waste:'Tidak ada data waste',largest?`${fmtTimeValue(largest.time)} • ${fmt(largest.contribution)}% kontribusi`:'Tambahkan observasi untuk menghitung')}</div>
      <div class="grid cols-2 section">
        <div class="card chart-card"><h3>TIME CLASSIFICATION</h3>${dashboardPie(classNames,cls,classTotal)}<div class="table-wrap compact-table"><table class="data-table"><thead><tr><th>Klasifikasi</th><th>Waktu</th><th>%</th></tr></thead><tbody>${classNames.map(c=>`<tr><td>${c}</td><td>${fmtTimeValue(cls[c])}</td><td>${fmt(classTotal?cls[c]/classTotal*100:0)}%</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card chart-card pareto-card"><h3>PARETO • TOP 5 WASTE</h3>${dashboardPareto(top)}<p class="chart-note">Batang menunjukkan waste time. Garis kumulatif menunjukkan kontribusi terhadap total waste pada filter aktif.</p><div class="pareto-table-block"><h3 class="subtable-title">TOP 5 LEAN / WASTE</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Element Kerja / Area</th><th>Jenis Waste</th><th>Waste Time</th><th>Kontribusi</th><th>Prioritas</th></tr></thead><tbody>${top.length?top.map(x=>`<tr><td><b>${x.rank}</b></td><td>${esc(x.element)}</td><td>${esc(x.waste)}</td><td>${fmtTimeValue(x.time)}</td><td>${fmt(x.contribution)}%</td><td><span class="badge ${x.contribution>=30?'bad':x.contribution>=20?'warn':'ok'}">${priority(x.contribution)}</span></td></tr>`).join(''):Array.from({length:5},(_,i)=>`<tr><td>${i+1}</td><td>Tidak ada data waste</td><td>-</td><td>0,00</td><td>0,0%</td><td>-</td></tr>`).join('')}</tbody></table></div></div></div>
      </div>
      <div class="card section"><h3>TOP 5 IMPROVEMENT PRIORITY</h3><p class="muted">Urutan berdasarkan kontribusi waste terhadap total waste pada filter aktif.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Element Kerja / Area</th><th>Jenis Waste</th><th>Waste Time</th><th>Kontribusi</th><th>Prioritas</th></tr></thead><tbody>${top.length?top.map(x=>`<tr><td><b>${x.rank}</b></td><td>${esc(x.element)}</td><td>${esc(x.waste)}</td><td>${fmtTimeValue(x.time)}</td><td>${fmt(x.contribution)}%</td><td><b>${priority(x.contribution)}</b></td></tr>`).join(''):Array.from({length:5},(_,i)=>`<tr><td>${i+1}</td><td>Tidak ada data waste</td><td>-</td><td>0,00</td><td>0,0%</td><td>-</td></tr>`).join('')}</tbody></table></div></div>`;
  };
  renderActivity();renderElement();renderResults();
  $('#dashProcess').onchange=e=>{f.process=e.target.value;f.activity='';f.element='';renderActivity();renderElement();renderResults()}; $('#dashActivity').onchange=e=>{f.activity=e.target.value;f.element='';renderElement();renderResults()}; $('#dashElement').onchange=e=>{f.element=e.target.value;renderResults()}; $('#dashSize').onchange=e=>{f.size=e.target.value;renderResults()}; $('#resetDashFilter').onclick=()=>{f.process=f.activity=f.element=f.size='';$('#dashProcess').value='';renderActivity();renderElement();$('#dashSize').value='';renderResults()};
}
/* ==========================================================================
   07. Observation entry & video study
   ========================================================================== */
function ensureObservationSession(){if(!state.observationSessionId)state.observationSessionId=newId();return state.observationSessionId}
function observationSessionLabel(id, fallbackDate=''){const raw=String(id||'');if(raw.startsWith('LEGACY-'))return 'Legacy Observation';const date=(fallbackDate||'').replaceAll('-','');return `OBS-${date?date.slice(0,8)+'-':''}${raw.slice(0,8).toUpperCase()}`}
function observationSessions(){
  // Internal source grouping only. A single video may contain many activities;
  // TSKK must therefore never mix different Process/Activity/PIC/Size contexts.
  // This grouping is not a new master level, parameter, or user-facing filter.
  const map=new Map();
  observations.forEach(o=>{
    const sourceId=o.observationSessionId||o.observationCycleId||`LEGACY-${o.id}`;
    const context=[sourceId,o.process||'',o.activity||'',o.operator||'',o.size||'',o.observationMethod||''].join('||');
    if(!map.has(context))map.set(context,{sourceSessionId:sourceId,rows:[]});
    map.get(context).rows.push(o);
  });
  return [...map.values()].map(group=>{
    const rows=group.rows.sort((a,b)=>(a.start??a.createdAt??0)-(b.start??b.createdAt??0)||(a.createdAt??0)-(b.createdAt??0));
    const first=rows[0]||{};
    const method=rows.some(r=>r.observationMethod==='video'||r.start!=null||r.end!=null)?'video':'manual';
    const contextId=[group.sourceSessionId,first.process||'',first.activity||'',first.operator||'',first.size||'',method].join('::');
    return {id:contextId,sourceSessionId:group.sourceSessionId,rows,method,date:first.date||'',process:first.process||'',activity:first.activity||'',operator:first.operator||'',size:first.size||'',count:rows.length,createdAt:Math.min(...rows.map(r=>r.createdAt||Date.now())),label:`${observationSessionLabel(group.sourceSessionId,first.date)} • ${first.activity||'Observation'}`};
  }).sort((a,b)=>b.createdAt-a.createdAt);
}

function renderObserve(){
  setHeader('Observation','RAW DATA CAPTURE');
  $('#app').innerHTML=`<div class="content"><div class="workspace"><div class="card video-card"><div class="video-card-head"><h3 id="observationInputTitle">1. Observation Input</h3><button class="video-close hidden" id="removeVideo" type="button" title="Tutup video ini" aria-label="Tutup video ini">×</button></div><div class="observation-method-switch" role="group" aria-label="Metode observasi"><button type="button" class="method-choice active" id="methodVideo">Video</button><button type="button" class="method-choice" id="methodManual">Manual</button></div><div id="videoObservationPanel"><label class="dropzone">Pilih video pengamatan<small>Video tetap lokal di browser. File tidak di-upload ke server.</small><input id="videoInput" type="file" accept="video/*" hidden></label><div class="video-stage"><div class="video-wrap video-pending" id="videoWrap"><video id="video" controls playsinline preload="metadata"></video><div id="emptyVideo" class="video-empty"><div><strong>Belum ada video</strong><span>Pilih file video untuk memulai observasi</span></div></div></div><div class="seek-panel" id="seekPanel"><div class="seek-meta"><span id="seekCurrent">00:00.00</span><span id="seekDuration">00:00.00</span></div><input id="videoSeek" class="video-seek" type="range" min="0" max="0" value="0" step="0.01" aria-label="Geser posisi video"><div class="seek-caption"><span>Tarik garis waktu untuk maju atau mundur ke posisi yang diinginkan</span></div></div><div class="video-tools"><button class="video-skip" id="back5" type="button" title="Mundur 5 detik">↶ Mundur 5 Detik</button><button class="video-skip" id="forward5" type="button" title="Maju 5 detik">Maju 5 Detik ↷</button><button class="video-skip" id="fullVideo" type="button" title="Layar penuh">⛶ Fullscreen</button></div></div></div><div class="time-grid"><div class="timebox"><span>Current</span><b id="cur">—</b></div><div class="timebox"><span>Start</span><b id="start">—</b></div><div class="timebox"><span>End</span><b id="end">—</b></div><div class="timebox"><span>Observed</span><b id="elapsed">—</b></div><div class="timebox"><span>Duration</span><b id="dur">—</b></div></div><div class="seg-controls" id="videoSegmentControls"><button class="btn ghost plain-segment-btn" id="setStart"><span class="start-play-icon" aria-hidden="true"></span><span>Set Start</span></button><button class="btn ghost plain-segment-btn" id="setEnd"><span class="end-stop-icon" aria-hidden="true"></span><span>Set End</span></button><button class="btn ghost" id="resetSeg">Reset</button></div><div class="manual-time card-lite hidden" id="manualObservationPanel"><div class="manual-time-head"><b>Input Cycle Time Manual</b><span>Masukkan waktu pengamatan manual. Manual tidak memakai Start/End.</span></div><div class="manual-time-grid manual-single"><label>Total Waktu Pengamatan<div class="time-input-row"><input id="manualObservedTime" type="number" min="0.01" step="0.01" placeholder="Contoh: 90"><button class="btn primary manual-apply-inline" id="applyManualTime" type="button">Terapkan</button></div><small class="input-help">Masukkan waktu dalam detik. Tampilan otomatis: <b id="manualTimeAutoDisplay">—</b></small></label></div></div></div><div class="card classify-card"><h3>2. Classify Observation</h3><div class="form-grid classify-top-grid"><label>Date<input id="date" type="date"></label><label>PIC<select id="operator">${opt(operatorList())}</select></label><label>Size<select id="size"><option>Small</option><option>Medium</option><option>Big</option></select></label></div><div class="form-grid classify-process-grid"><label>Process<select id="process">${opt(unique(masterData().map(x=>x.process)))}</select></label></div><div class="form-grid classify-activity-grid"><label>Activity<select id="activity"><option value="">Pilih Process dahulu</option></select></label></div><div class="form-grid classify-element-grid"><label>Element Kerja<select id="element"><option value="">Pilih Activity dahulu</option></select></label></div><div class="master-preview"><div><span>Classification</span><b id="classification">—</b></div><div><span>Waste</span><b id="waste">—</b></div><div><span>Method</span><b id="method">—</b></div><div><span>Equipment</span><b id="equipment">—</b></div></div><label>Catatan<textarea id="note" rows="3"></textarea></label><div class="observation-save-action"><button class="btn primary full" id="saveObs">＋ Simpan Observasi</button></div></div></div></div>`;
  const observeDraft=getDraft('observe');
  if(observeDraft){
    state.observationMethod=observeDraft.observationMethod==='manual'?'manual':'video';
    state.observationSessionId=observeDraft.observationSessionId||null;
    state.videoFileName=observeDraft.videoFileName||'';
    state.start=Number.isFinite(+observeDraft.start)?+observeDraft.start:null;
    state.end=Number.isFinite(+observeDraft.end)?+observeDraft.end:null;
    state.manualTime=Number.isFinite(+observeDraft.manualTime)?+observeDraft.manualTime:null;
  }
  $('#date').value=observeDraft?.date||new Date().toISOString().slice(0,10);
  $('#operator').value=observeDraft?.operator||'';
  $('#size').value=observeDraft?.size||'Small';
  $('#note').value=observeDraft?.note||'';
  $('#manualObservedTime').value=observeDraft?.manualObservedTime??(state.manualTime??'');
  wireObserve();
  if(observeDraft?.process){
    $('#process').value=observeDraft.process;
    $('#process').dispatchEvent(new Event('change'));
    if(observeDraft.activity){
      $('#activity').value=observeDraft.activity;
      $('#activity').dispatchEvent(new Event('change'));
      if(observeDraft.element)$('#element').value=observeDraft.element;
      $('#element').dispatchEvent(new Event('change'));
    }
  }
  setObserveMethodUI(state.observationMethod==='manual'?'manual':'video');
  $('#methodVideo').onclick=()=>setObserveMethodUI('video');
  $('#methodManual').onclick=()=>setObserveMethodUI('manual');
  function setObserveMethodUI(method){
    state.observationMethod=method==='manual'?'manual':'video';
    const isManual=state.observationMethod==='manual';
    $('#methodVideo')?.classList.toggle('active',!isManual); $('#methodManual')?.classList.toggle('active',isManual);
    $('#videoObservationPanel')?.classList.toggle('hidden',isManual); $('#manualObservationPanel')?.classList.toggle('hidden',!isManual); $('#videoSegmentControls')?.classList.toggle('hidden',isManual); document.querySelector('.time-grid')?.classList.toggle('hidden',isManual);
    if($('#observationInputTitle'))$('#observationInputTitle').textContent=isManual?'1. Manual Observation':'1. Video Observation';
    if(isManual){state.start=null;state.end=null;refreshObservationDisplay();}
    captureActiveDraft();
  }
  function refreshObservationDisplay(){const el=$('#elapsed');if(el)el.textContent=state.manualTime!=null?fmtTimeValue(state.manualTime):'—';const auto=$('#manualTimeAutoDisplay');if(auto){const n=Number($('#manualObservedTime')?.value);auto.textContent=Number.isFinite(n)&&n>0?`→ ${fmtTimeValue(n)}`:'—';}}
  $('#manualObservedTime')?.addEventListener('input',refreshObservationDisplay);
  if(!canWrite()){
    ['videoInput','setStart','setEnd','resetSeg','applyManualTime','saveObs','note','date','operator','size','process','activity','element','manualObservedTime','fullVideo','back5','forward5','removeVideo','videoSeek'].forEach(id=>{const el=$('#'+id);if(el)el.disabled=true;});
    const saveWrap=$('.observation-save-action'); if(saveWrap) saveWrap.classList.add('hidden');
    const dz=document.querySelector('.dropzone'); if(dz) dz.classList.add('hidden');
    const c=document.createElement('div'); c.className='analysis-note'; c.innerHTML='<b>Mode View Only.</b> Akun Viewer dapat melihat analisis, tetapi tidak dapat menambah atau mengubah data.'; $('#app .content')?.prepend(c);
  }
}
function wireObserve(){
  const video=$('#video'), wrap=$('#videoWrap'), seek=$('#videoSeek');
  let seeking=false;
  const hasVideo=()=>!!video.src;
  const seekBy=(seconds)=>{if(!Number.isFinite(video.duration))return;video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+seconds));};
  const updateSeek=()=>{
    const current=Number.isFinite(video.currentTime)?video.currentTime:0;
    const duration=Number.isFinite(video.duration)?video.duration:0;
    if(!seeking){seek.max=duration||0;seek.value=Math.min(current,duration||0);}
    $('#seekCurrent').textContent=t(current);
    $('#seekDuration').textContent=t(duration);
    $('#cur').textContent=t(current);
    $('#dur').textContent=t(duration);
  };
  const refreshTimes=()=>{
    $('#start').textContent=state.start==null?'—':t(state.start);
    $('#end').textContent=state.end==null?'—':t(state.end);
    $('#elapsed').textContent=state.manualTime!=null?fmtTimeValue(state.manualTime):(state.start!=null&&state.end!=null?fmtTimeValue(state.end-state.start):'—');
  };
  const captureObserveDraft=()=>({observationMethod:state.observationMethod,observationSessionId:state.observationSessionId||null,videoFileName:state.videoFileName||'',date:$('#date')?.value||'',operator:$('#operator')?.value||'',size:$('#size')?.value||'Small',process:$('#process')?.value||'',activity:$('#activity')?.value||'',element:$('#element')?.value||'',note:$('#note')?.value||'',manualObservedTime:$('#manualObservedTime')?.value||'',manualTime:state.manualTime,start:state.start,end:state.end,savedAt:Date.now()});
  const saveObserveDraft=()=>scheduleDraft('observe',captureObserveDraft);
  const clearSegment=()=>{state.start=state.end=state.manualTime=null;$('#manualObservedTime').value='';refreshTimes();saveObserveDraft();};
  const applyManual=()=>{const observed=Number($('#manualObservedTime').value);if(!Number.isFinite(observed)||observed<=0){showToast('Isi Total Waktu Pengamatan dengan angka lebih dari 0.','warning');return false}state.manualTime=+observed.toFixed(2);state.start=null;state.end=null;refreshTimes();saveObserveDraft();return true};
  const loadVideoFile=f=>{
    if(!f)return;
    if(state.videoUrl)URL.revokeObjectURL(state.videoUrl);
    state.videoUrl=URL.createObjectURL(f);
    state.videoFileName=f.name||'';
    state.observationSessionId=newId();
    state.observationMethod='video';
    clearSegment();
    video.src=state.videoUrl;
    video.load();
    $('#emptyVideo').classList.add('hidden');
    $('#removeVideo').classList.remove('hidden');
      };
  const removeVideo=()=>{
    video.pause();
    video.removeAttribute('src');
    video.load();
    if(state.videoUrl){URL.revokeObjectURL(state.videoUrl);state.videoUrl=null;}
    $('#videoInput').value='';
    $('#emptyVideo').classList.remove('hidden');
    $('#removeVideo').classList.add('hidden');
    wrap.style.setProperty('--video-ratio','16 / 9');
    wrap.className='video-wrap video-pending';
    seek.max=0;seek.value=0;updateSeek();clearSegment();
    idbSet(OBS_VIDEO_DRAFT_KEY,null).catch(()=>{});
    saveObserveDraft();
  };
  const restoreObserveVideo=async()=>{
    const d=getDraft('observe');
    if(!d||d.observationMethod!=='video'||!d.videoFileName)return;
    try{
      const f=await idbGet(OBS_VIDEO_DRAFT_KEY);
      if(!(f instanceof Blob))return;
      loadVideoFile(f);
      state.observationSessionId=d.observationSessionId||state.observationSessionId;
      state.videoFileName=d.videoFileName||f.name||'';
      state.start=Number.isFinite(+d.start)?+d.start:null;
      state.end=Number.isFinite(+d.end)?+d.end:null;
      state.manualTime=Number.isFinite(+d.manualTime)?+d.manualTime:null;
      refreshTimes();
    }catch(err){console.warn('Observation video draft restore skipped:',err)}
  };
  $('#back5').onclick=()=>seekBy(-5);
  $('#forward5').onclick=()=>seekBy(5);
  $('#fullVideo').onclick=async()=>{
    if(!hasVideo())return showToast('Pilih video terlebih dahulu.','warning');
    try{if(video.requestFullscreen)await video.requestFullscreen();else if(wrap.requestFullscreen)await wrap.requestFullscreen();else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();}catch(e){console.warn(e);}
  };
  $('#removeVideo').onclick=()=>{tmwaDialog.confirm('Video akan ditutup. Data observasi yang sudah disimpan tetap aman.',{title:'Tutup video?',confirmText:'Tutup',danger:true}).then(ok=>{if(ok)removeVideo()});};
  $('#videoInput').onchange=async e=>{const f=e.target.files[0];loadVideoFile(f);if(f){try{await idbSet(OBS_VIDEO_DRAFT_KEY,f)}catch(err){console.warn('Observation video draft save skipped:',err)}saveObserveDraft();}};
  seek.onpointerdown=()=>{seeking=true;};
  seek.oninput=()=>{if(!hasVideo())return;const value=Number(seek.value);$('#seekCurrent').textContent=t(value);$('#cur').textContent=t(value);video.currentTime=value;};
  seek.onchange=()=>{seeking=false;if(hasVideo())video.currentTime=Number(seek.value);updateSeek();};
  seek.onpointerup=()=>{seeking=false;updateSeek();};
  video.ontimeupdate=updateSeek;
  video.onloadedmetadata=()=>{
    const w=video.videoWidth||16,h=video.videoHeight||9,ratio=w/h;
    wrap.style.setProperty('--video-ratio',`${w} / ${h}`);
    wrap.classList.remove('video-pending','video-landscape','video-portrait','video-square');
    if(ratio<0.85)wrap.classList.add('video-portrait');else if(ratio>1.15)wrap.classList.add('video-landscape');else wrap.classList.add('video-square');
    updateSeek();
  };
  document.onkeydown=e=>{if(state.view!=='observe')return;if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;if(e.key==='ArrowLeft'){e.preventDefault();seekBy(-5)}if(e.key==='ArrowRight'){e.preventDefault();seekBy(5)}};
  $('#setStart').onclick=()=>{if(state.observationMethod==='manual')return;if(!hasVideo()){showToast('Pilih video terlebih dahulu.','warning');return}state.start=+video.currentTime.toFixed(2);state.end=null;state.manualTime=null;$('#manualObservedTime').value='';refreshTimes();saveObserveDraft();video.play().catch(()=>{})};
  $('#setEnd').onclick=()=>{if(state.observationMethod==='manual')return;if(!hasVideo()){showToast('Pilih video terlebih dahulu.','warning');return}video.pause();state.end=+video.currentTime.toFixed(2);state.manualTime=null;if(state.start!=null&&state.end<state.start){showToast('End harus lebih besar dari Start','warning');state.end=null;return}refreshTimes();saveObserveDraft()};
  $('#applyManualTime').onclick=applyManual;
  $('#resetSeg').onclick=clearSegment;
  ['date','operator','size','process','activity','element','note','manualObservedTime'].forEach(id=>{$('#'+id)?.addEventListener('input',saveObserveDraft);$('#'+id)?.addEventListener('change',saveObserveDraft)});
  $('#process').onchange=e=>{let arr=unique(masterData().filter(x=>x.process===e.target.value).map(x=>x.activity));$('#activity').innerHTML=opt(arr);$('#element').innerHTML='<option value="">Pilih Activity dahulu</option>';updateMaster()};
  $('#activity').onchange=e=>{let arr=masterData().filter(x=>x.process===$('#process').value&&x.activity===e.target.value).map(x=>x.element);$('#element').innerHTML=opt(arr);updateMaster()};
  $('#element').onchange=updateMaster;
  function updateMaster(){let m=getMaster($('#element').value);for(const [id,k] of [['classification','classification'],['waste','waste'],['method','method'],['equipment','equipment']])$('#'+id).textContent=m?m[k]:'—'}
  $('#saveObs').onclick=async()=>{
    try{
      let element=$('#element').value;
      if(state.manualTime==null&&state.start!=null&&state.end!=null)state.manualTime=+(state.end-state.start).toFixed(2);
      if(state.manualTime==null&&$('#manualObservedTime').value!=='')applyManual();
      if(state.manualTime==null||!element||!$('#operator').value){showToast('Lengkapi PIC, Element Kerja, dan Cycle Time / waktu observasi.','warning');return}
      let m=getMaster(element);
      if(!m){showToast('Element Kerja tidak ditemukan di Master Data. Pilih Element dari daftar Master terlebih dahulu.','warning');return}
      const operator=$('#operator').value, activity=m.activity, rf=ratingSnapshotFor(operator,activity);
      if(rf==null){showToast(`Rating Factor belum ditetapkan untuk PIC ${operator} pada Activity ${activity}. Atur terlebih dahulu di menu Rating Factor.`,'warning',5200);return}
      const sessionId=ensureObservationSession();
      const savedId=newId();
      observations.push({id:savedId,observationSessionId:sessionId,observationCycleId:sessionId,observationMethod:state.observationMethod,date:$('#date').value,study:'',operator,process:m.process,activity,element,size:$('#size').value,start:state.start==null?null:+state.start.toFixed(2),end:state.end==null?null:+state.end.toFixed(2),time:+state.manualTime.toFixed(2),classification:m.classification,waste:m.waste,method:m.method,equipment:m.equipment,note:$('#note').value,ratingFactorSnapshot:rf,createdAt:Date.now()});
      rememberPending([savedId]); if(!(await save())){observations=observations.filter(o=>o.id!==savedId);forgetPending([savedId]);return;}
      clearSegment();
      $('#note').value='';
      saveObserveDraft();
      showToast('Observasi berhasil disimpan. Video tetap aktif dan siap digunakan untuk observasi berikutnya.','success');
    }catch(err){
      console.error('Save Observation failed:',err);
      showToast('Observasi gagal disimpan: '+(err?.message||String(err)),'error');
    }
  };
  registerDraftCapture(()=>saveDraft('observe',captureObserveDraft()));
  restoreObserveVideo();
}
function renderData(){
 setHeader('Data Waktu','RAW OBSERVATION MANAGEMENT');
 const proc=unique(masterData().map(x=>x.process).filter(Boolean));
 $('#app').innerHTML=`<div class="content"><div class="card"><div class="filters"><select id="fProc">${opt(proc,'All Process')}</select><select id="fSize"><option value="">All Size</option><option>Small</option><option>Medium</option><option>Big</option></select><input id="search" placeholder="Search element / PIC"></div><div id="dataTable"></div></div></div>`;
 function draw(){
  let rows=[...observations]
   .filter(o=>(!$('#fProc').value||o.process===$('#fProc').value)&&(!$('#fSize').value||o.size===$('#fSize').value)&&(`${o.element} ${o.operator}`.toLowerCase().includes($('#search').value.toLowerCase())))
   .sort((a,b)=>b.createdAt-a.createdAt);
  $('#dataTable').innerHTML=rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>No</th><th>Date</th><th>PIC</th><th>Process</th><th>Activity</th><th>Element</th><th>Size</th><th>Start</th><th>End</th><th>Time</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r.date}</td><td>${esc(r.operator)}</td><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${esc(r.size||'-')}</td><td>${t(r.start)}</td><td>${t(r.end)}</td><td><b>${fmtTimeValue(r.time)}</b></td><td>${canWrite()?`<button class="btn ghost editObs" data-id="${r.id}">Edit</button>`:''} ${canDelete()?`<button class="btn ghost del" data-id="${r.id}">Hapus</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Tidak ada data yang sesuai filter.</div>';

  $$('.del').forEach(b=>b.onclick=async()=>{
   const id=b.dataset.id;
   if(!(await tmwaDialog.confirm('Observasi ini akan dihapus dan tidak dapat dikembalikan.',{title:'Hapus observasi?',confirmText:'Hapus',danger:true})))return;
   try{
    if(window.tmwaCloud?.enabled)await window.tmwaCloud.deleteObservation(id);
    observations=observations.filter(o=>o.id!==id);forgetPending([id]);saveLocalOnly();draw();
   }catch(err){console.error(err);showToast('Observasi gagal dihapus dari cloud: '+(err.message||err),'error');}
  });

  $$('.editObs').forEach(b=>b.onclick=()=>openObservationEditor(b.dataset.id));
 }

 function openObservationEditor(id){
  if(!ensureWrite())return;
  const o=observations.find(x=>x.id===id); if(!o)return;
  const masters=masterData();
  const processes=unique(masters.map(x=>x.process).filter(Boolean));
  const activities=unique(masters.map(x=>x.activity).filter(Boolean));
  const operators=operatorList(); if(o.operator && !operators.includes(o.operator)) operators.push(o.operator);
  const methods=['video','manual'];
  const modal=document.createElement('div');
  modal.className='modal-backdrop obs-edit-backdrop';
  modal.innerHTML=`<div class="modal obs-edit-modal" role="dialog" aria-modal="true" aria-labelledby="obsEditTitle">
   <div class="obs-edit-head"><div><span class="eyebrow">RAW OBSERVATION</span><h3 id="obsEditTitle">Edit Data Observasi</h3><p>Seluruh atribut observasi dapat diperbarui dalam satu form.</p></div><button type="button" class="obs-edit-close" aria-label="Tutup">×</button></div>
   <div class="obs-edit-card">
    <div class="obs-edit-grid">
     <label>Tanggal<input id="oeDate" type="date" value="${esc(o.date||'')}"></label>
     <label>PIC / Operator<select id="oeOperator"><option value="">Pilih PIC / Operator</option>${operators.map(x=>`<option value="${esc(x)}" ${String(x)===String(o.operator||'')?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
     <label>Process<select id="oeProcess"></select></label>
     <label>Activity<select id="oeActivity"></select></label>
     <label class="span-2">Element Kerja<select id="oeElement"></select></label>
     <label>Kategori Ukuran<select id="oeSize"><option ${o.size==='Small'?'selected':''}>Small</option><option ${o.size==='Medium'?'selected':''}>Medium</option><option ${o.size==='Big'?'selected':''}>Big</option></select></label>
     <label>Metode Observasi<select id="oeObservationMethod">${methods.map(x=>`<option value="${x}" ${o.observationMethod===x?'selected':''}>${x==='video'?'Video':'Manual'}</option>`).join('')}</select></label>
     <label>Start (detik)<input id="oeStart" type="number" step="0.01" min="0" value="${o.start==null?'':esc(o.start)}"></label>
     <label>End (detik)<input id="oeEnd" type="number" step="0.01" min="0" value="${o.end==null?'':esc(o.end)}"></label>
     <label>Observed Time (detik)<input id="oeTime" type="number" step="0.01" min="0" value="${esc(Number(o.time||0).toFixed(2))}"></label>
     <label>Klasifikasi<select id="oeClassification">${CLASSIFICATIONS.map(x=>`<option value="${esc(x)}" ${o.classification===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
     <label>Lean Waste<select id="oeWaste"><option value="-">None / Tidak ada waste</option>${WASTE_TYPES.map(x=>`<option value="${esc(x)}" ${o.waste===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
     <label>Metode Kerja<select id="oeMethod">${unique(['-',...masters.map(x=>normalizeMasterMethod(x.method)).filter(Boolean)]).map(x=>`<option value="${esc(x)}" ${normalizeMasterMethod(o.method)===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>
     <label>Peralatan<input id="oeEquipment" value="${esc(o.equipment||'')}"></label>
     <label class="span-2">Catatan<textarea id="oeNote" rows="2" placeholder="Catatan observasi...">${esc(o.note||'')}</textarea></label>
    </div>
   </div>
   <div class="obs-edit-footer"><span class="obs-edit-hint">Perubahan akan disimpan ke data lokal dan disinkronkan ke cloud bila tersedia.</span><div class="obs-edit-actions"><button type="button" class="btn ghost" id="oeCancel">Batal</button><button type="button" class="btn primary" id="oeSave">Simpan Perubahan</button></div></div>
  </div>`;
  document.body.appendChild(modal);

  const close=()=>{modal.classList.remove('is-open');setTimeout(()=>modal.remove(),160)};
  // Process -> Activity -> Element are strict dropdowns sourced from Master Data.
  const optionHtml=(items,placeholder,current='')=>{
   const vals=unique(items.filter(Boolean));
   return `<option value="">${placeholder}</option>`+vals.map(x=>`<option value="${esc(x)}" ${String(x)===String(current)?'selected':''}>${esc(x)}</option>`).join('');
  };
  const renderEditHierarchy=(keep={process:o.process||'',activity:o.activity||'',element:o.element||''})=>{
   const proc=$('#oeProcess'), act=$('#oeActivity'), el=$('#oeElement');
   const processList=processes;
   proc.innerHTML=optionHtml(processList,'Pilih Process',keep.process);
   const selectedProcess=proc.value||keep.process||'';
   const activityList=unique(masters.filter(x=>String(x.process||'')===String(selectedProcess)).map(x=>x.activity));
   act.innerHTML=optionHtml(activityList,'Pilih Activity',keep.activity);
   const selectedActivity=act.value||keep.activity||'';
   const elementList=unique(masters.filter(x=>String(x.process||'')===String(selectedProcess)&&String(x.activity||'')===String(selectedActivity)).map(x=>x.element));
   el.innerHTML=optionHtml(elementList,'Pilih Element Kerja',keep.element);
  };
  const fillFromMaster=()=>{
   const el=$('#oeElement')?.value.trim();
   const m=masters.find(x=>String(x.element||'').trim().toLowerCase()===el.toLowerCase()&&String(x.process||'')===$('#oeProcess').value&&String(x.activity||'')===$('#oeActivity').value);
   if(!m)return;
   $('#oeClassification').value=m.classification||$('#oeClassification').value;
   $('#oeWaste').value=m.waste||'-';
   const mm=normalizeMasterMethod(m.method);
   if(mm&&[...$('#oeMethod').options].some(x=>x.value===mm))$('#oeMethod').value=mm;
   $('#oeEquipment').value=m.equipment||'';
  };
  renderEditHierarchy();
  $('#oeProcess').addEventListener('change',()=>{
   const process=$('#oeProcess').value;
   renderEditHierarchy({process,activity:'',element:''});
  });
  $('#oeActivity').addEventListener('change',()=>{
   const process=$('#oeProcess').value, activity=$('#oeActivity').value;
   renderEditHierarchy({process,activity,element:''});
  });
  $('#oeElement').addEventListener('change',fillFromMaster);
  const commit=()=>{
   const date=$('#oeDate').value;
   const operator=$('#oeOperator').value.trim();
   const process=$('#oeProcess').value.trim();
   const activity=$('#oeActivity').value.trim();
   const element=$('#oeElement').value.trim();
   const time=Math.max(0,Number($('#oeTime').value)||0);
   const start=$('#oeStart').value===''?null:Math.max(0,Number($('#oeStart').value)||0);
   const end=$('#oeEnd').value===''?null:Math.max(0,Number($('#oeEnd').value)||0);
   if(!date||!operator||!process||!activity||!element){showToast('Tanggal, PIC, Process, Activity, dan Element Kerja wajib diisi.','warning');return}
   if(start!=null&&end!=null&&end<start){showToast('End tidak boleh lebih kecil dari Start.','warning');return}
   const idx=observations.findIndex(x=>x.id===id); if(idx<0)return;
   const prior=observations[idx];
   const sameRatingContext=prior.operator===operator&&prior.activity===activity&&Number.isFinite(+prior.ratingFactorSnapshot);
   const ratingFactorSnapshot=sameRatingContext?+prior.ratingFactorSnapshot:ratingSnapshotFor(operator,activity);
   if(ratingFactorSnapshot==null){showToast(`Rating Factor belum ditetapkan untuk PIC ${operator} pada Activity ${activity}. Atur terlebih dahulu di menu Rating Factor.`,'warning',5200);return}
   observations[idx]={...observations[idx],date,operator,process,activity,element,size:$('#oeSize').value,observationMethod:$('#oeObservationMethod').value,start,end,time,classification:$('#oeClassification').value,waste:$('#oeWaste').value,method:$('#oeMethod').value,equipment:$('#oeEquipment').value.trim(),note:$('#oeNote').value.trim(),ratingFactorSnapshot,updatedAt:Date.now()};
   if(!save())return;
   close();draw();showToast('Data observasi berhasil diperbarui.','success');
  };
  $('#oeCancel').onclick=close;
  modal.querySelector('.obs-edit-close').onclick=close;
  $('#oeSave').onclick=commit;
  modal.addEventListener('click',e=>{if(e.target===modal)close()});
  document.addEventListener('keydown',function escEdit(e){if(e.key==='Escape'){document.removeEventListener('keydown',escEdit);close()}},{once:true});
  requestAnimationFrame(()=>modal.classList.add('is-open'));
  setTimeout(()=>$('#oeDate')?.focus(),50);
 }
 ['fProc','fSize','search'].forEach(id=>$('#'+id).oninput=draw);
 draw();
}
/* ==========================================================================
   08. Validation: uniformity, sufficiency & methodology parameters
   ========================================================================== */
function analysisTable(mode='category'){
  const groups = mode==='category' ? grouped(true) : grouped(false);
  if(!groups.length){
    return '<div class="empty">Belum ada observasi untuk dianalisis.</div>';
  }
  const rows=groups.map(g=>{
    const st=stats(g.rows);
    const label=mode==='category'?(g.size||'—'):'All / Pooled';
    let status='Belum cukup data';
    let cls='warn';
    if(st.n>=settings.minInitialN){
      if(!st.uniform){status='Tidak seragam';cls='bad';}
      else if(st.required==null){status='N′ belum dapat dihitung';cls='warn';}
      else if(st.sufficient){status='Seragam & cukup';cls='ok';}
      else {status=`Seragam, perlu ${Math.max(0,st.required-st.validN)} observasi`;cls='warn';}
    }
    const outlier=st.out||0;
    return `<tr>
      <td>${esc(g.process)}</td>
      <td>${esc(g.activity)}</td>
      <td>${esc(g.element)}</td>
      <td>${esc(label)}</td>
      <td class="num">${st.n}</td>
      <td class="num">${st.validN||0}</td>
      <td class="num">${st.uniform&&st.required!=null?st.required:'—'}</td>
      <td class="num">${st.n?fmtTimeValue(st.mean):'—'}</td>
      <td class="num">${st.n>1?fmtTimeValue(st.sd):'—'}</td>
      <td class="num">${st.n?fmtTimeValue(st.ucl):'—'}</td>
      <td class="num">${st.n?fmtTimeValue(st.lcl):'—'}</td>
      <td class="num">${outlier}</td>
      <td><span class="badge ${cls}">${esc(status)}</span></td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-table validation-analysis-table">
    <thead><tr>
      <th>Process</th><th>Activity</th><th>Element</th><th>${mode==='category'?'Kategori':'Kelompok'}</th>
      <th>N (Jumlah Pengamatan)</th><th>Nᵥ (Jumlah Data dalam Batas Kendali)</th><th>N′ (Jumlah Pengamatan yang Diperlukan)</th><th>x̄ (Rata-Rata)</th><th>s (St Dev)</th><th>BKA</th><th>BKB</th><th>Data di Luar Batas Kendali</th><th>Hasil Pengujian</th>
    </tr></thead><tbody>${rows}</tbody>
  </table></div>`;
}
function renderValidation(){
  setHeader('Validasi Data Waktu','KESERAGAMAN & KECUKUPAN');
  const confidence=Number(settings.confidence)||95;
  const zValue=Number(settings.zValue)||1.96;
  const precisionPct=(Number(settings.precision)||0.05)*100;
  $('#app').innerHTML=`<div class="content page-validation">
    <div class="analysis-note"><b>Validasi & Parameter Metodologi</b> menjadi satu titik pengendalian untuk kualitas data dan parameter penelitian. Parameter yang memang perlu disesuaikan penelitian dapat diubah; rumus, tabel Westinghouse, batas ±3 SD, dan pemetaan Z tetap dikunci oleh sistem.</div>
    <div class="card section validation-parameters">
      <div class="section-head"><div><h3>Parameter Penelitian</h3><p class="muted">Yang dapat dikonfigurasi hanya parameter penelitian: N minimum awal, tingkat keyakinan, precision, dan allowance. Z diturunkan otomatis; rumus/metode tidak dapat diubah dari UI.</p></div></div>
      <div class="form-grid four validation-parameter-grid">
        <label>N₀ (Jumlah Pengamatan Awal Minimum)<input id="minInitialN" type="number" min="2" step="1" value="${settings.minInitialN}"><small>Gate penelitian sebelum uji kecukupan; bukan pengganti N′</small></label>
        <label>Tingkat Keyakinan (%)<select id="confidence"><option value="90" ${confidence===90?'selected':''}>90%</option><option value="95" ${confidence===95?'selected':''}>95%</option><option value="99" ${confidence===99?'selected':''}>99%</option></select><small>Preset nilai Z: 90%=1,645; 95%=1,96; 99%=2,576</small></label>
        <label>Nilai Z Kritis<input id="zValue" type="number" value="${zValue}" readonly disabled aria-readonly="true"><small>Otomatis mengikuti tingkat keyakinan</small></label>
        <label>Ketelitian / Precision (%)<input id="precisionPct" type="number" min="0.1" max="50" step="0.1" value="${precisionPct}"><small>Contoh 5% → s = 0,05</small></label>
        <label>Allowance (%)<input id="allowance" type="number" min="0" max="90" step="0.1" value="${settings.allowance*100}"><small>Ditetapkan berdasarkan acuan/kondisi kerja penelitian</small></label>
      </div>
      <div class="validation-setting-actions"><button id="saveValidationSettings" class="btn primary">Simpan Parameter Validasi</button></div>
    </div>
    <div class="grid cols-3 validation-summary">
      <div class="card"><h3>Acuan Z Kritis</h3><p class="muted">Nilai Z standar untuk tingkat keyakinan umum. Nilai Z otomatis mengikuti tingkat keyakinan yang dipilih.</p><div class="table-wrap"><table class="data-table compact-table"><thead><tr><th>Tingkat Keyakinan</th><th>Z Kritis</th></tr></thead><tbody><tr><td>90%</td><td>1,645</td></tr><tr><td>95%</td><td>1,960</td></tr><tr><td>99%</td><td>2,576</td></tr></tbody></table></div></div>
      <div class="card"><h3>Uji Keseragaman</h3><p class="muted">Memeriksa keseragaman observasi individual dengan batas ±3 SD. Nilai 3 SD adalah metode tetap dan tidak terkait langsung dengan pilihan confidence untuk N′.</p><div class="formula-box"><b>BKA</b> = x̄ + 3 × s<br><b>BKB</b> = x̄ − 3 × s<br><small>Implementasi BKB dibatasi minimum 0 karena waktu tidak bernilai negatif.</small></div><p class="muted">Data di luar BKA/BKB ditandai sebagai data di luar batas kendali. Kelompok yang tidak seragam tidak digunakan untuk penetapan Standard Time.</p></div>
      <div class="card"><h3>Uji Kecukupan</h3><p class="muted">Kecukupan dihitung setelah data seragam. Confidence dan precision adalah parameter penelitian; Z diturunkan otomatis dari confidence.</p><div class="formula-box"><b>N′</b> = ⌈[(Z / p) × √(N × Σx² − (Σx)²) / Σx]²⌉<br><small>Keyakinan = ${confidence}% &nbsp;•&nbsp; Z = ${zValue} &nbsp;•&nbsp; s = ${precisionPct.toFixed(1)}% (${(Number(settings.precision)||0.05)})</small></div><p class="muted"><b>N₀ (Jumlah Pengamatan Awal Minimum) = ${settings.minInitialN} observasi.</b> Keputusan sufficient tetap mensyaratkan data seragam dan Nᵥ ≥ N′.</p></div>
    </div>
    <div class="grid cols-4 validation-coverage">${kpi('MASTER ELEMENTS',masterData().length,'Peta Proses')}${kpi('OBSERVED ELEMENTS',observedElements(),`${fmt(masterData().length?observedElements()/masterData().length*100:0)}% coverage`) }${kpi('TOTAL RAW DATA',observations.length,'Observasi tersimpan')}${kpi('INVALID DURATION',observations.filter(x=>!x.time||x.time<=0).length,'Target = 0')}</div>
    <div class="card section"><div class="section-head"><div><h3>Master Coverage</h3><p class="muted">Coverage dipantau di sini dan tidak disamakan dengan uji kecukupan. Element yang belum pernah diamati bukan berarti datanya “insufficient”.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Activity</th><th>Element</th><th>Klasifikasi</th><th>N</th><th>Status</th></tr></thead><tbody>${masterData().map(m=>{const g=grouped(false).find(x=>x.process===m.process&&x.activity===m.activity&&x.element===m.element),n=g?.rows?.length||0,status=n===0?'Not observed':n<2?'Need more data':'Observed';return `<tr><td>${esc(m.process)}</td><td>${esc(m.activity)}</td><td>${esc(m.element)}</td><td>${esc(m.classification)}</td><td>${n}</td><td><span class="badge ${status==='Observed'?'ok':'warn'}">${status}</span></td></tr>`}).join('')||'<tr><td colspan="6">Belum ada master element.</td></tr>'}</tbody></table></div></div>
    <div class="card section"><div class="section-head"><div><h3>Element × Category</h3><p class="muted">Hasil validasi untuk setiap Element Kerja berdasarkan kategori Small, Medium, dan Big. Kolom N dan N' memperlihatkan dasar keputusan kecukupan.</p></div></div>${analysisTable('category')}</div>
    <div class="card section"><div class="section-head"><div><h3>Gabungan Diagnostik</h3><p class="muted">Hasil validasi gabungan seluruh kategori ukuran. Jika seragam dan cukup, hasil kelompok gabungan menjadi Standard Time All / Tanpa Dimensi.</p></div></div>${analysisTable('pooled')}</div>
    <div class="analysis-note validation-rule"><b>Aturan metodologi:</b> Standard Time hanya dihitung jika data memenuhi N₀, seragam, dan Nᵥ ≥ N′. All / Tanpa Dimensi adalah satu perhitungan pooled pada Process + Activity + Element yang sama, bukan penjumlahan Small + Medium + Big; pooled tidak dipaksakan jika tidak seragam. Allowance digunakan dengan konvensi <b>ST = NT / (1 − A)</b>, sehingga nilai allowance harus memiliki dasar acuan/kondisi kerja penelitian. Coverage, uniformity, dan sufficiency adalah pemeriksaan yang berbeda.</div>
  </div>`;

  $('#confidence').onchange=()=>{
    const z=zPresetForConfidence($('#confidence').value);
    if(z!=null)$('#zValue').value=z;
    showToast(z!=null?`Nilai Z otomatis diset ke ${z} untuk keyakinan ${$('#confidence').value}%.`:'Keyakinan diperbarui. Periksa nilai Z sesuai referensi penelitian.','info');
  };
  $('#saveValidationSettings').onclick=()=>{
    if(!ensureAdmin())return;
    const minN=Math.max(2,Math.round(Number($('#minInitialN').value)||5));
    const conf=Math.min(99,Math.max(1,Number($('#confidence').value)||95));
    const z=zPresetForConfidenceLocal(conf)||1.96;
    const precisionPct=Math.min(50,Math.max(0.1,Number($('#precisionPct').value)||5));
    const allowancePct=Math.min(90,Math.max(0,Number($('#allowance').value)||0));
    settings.minInitialN=minN;
    settings.confidence=conf;
    settings.zValue=z;
    settings.precision=precisionPct/100;
    settings.allowance=allowancePct/100;
    save();
    showToast('Parameter validasi, ketelitian, dan allowance berhasil disimpan.','success');
    renderValidation();
  };
  if(!canWrite()){
    ['#minInitialN','#confidence','#zValue','#precisionPct','#allowance','#saveValidationSettings'].forEach(sel=>$(sel).disabled=true);
  }
}
/* ==========================================================================
   09. Rating Factor / Westinghouse
   ========================================================================== */
function renderRating(){
  settings.ratingByActivity??={}; settings.ratings??={}; settings.westinghouse??={}; settings.operators??=[];
  setHeader('Rating Factor','WESTINGHOUSE • PERFORMANCE RATING');
  const skill=[['A1','+0.15'],['A2','+0.13'],['B1','+0.11'],['B2','+0.08'],['C1','+0.06'],['C2','+0.03'],['D','0.00'],['E1','-0.05'],['E2','-0.10'],['F1','-0.16'],['F2','-0.22']];
  const effort=[['A1','+0.13'],['A2','+0.12'],['B1','+0.10'],['B2','+0.08'],['C1','+0.05'],['C2','+0.02'],['D','0.00'],['E1','-0.04'],['E2','-0.08'],['F1','-0.12'],['F2','-0.17']];
  const condition=[['A','+0.06'],['B','+0.04'],['C','+0.02'],['D','0.00'],['E','-0.03'],['F','-0.07']];
  const consistency=[['A','+0.04'],['B','+0.03'],['C','+0.01'],['D','0.00'],['E','-0.02'],['F','-0.04']];
  const grade=(list,value=0)=>{const target=Number.isFinite(+value)?(+value).toFixed(2):'0.00';return `<select class="grade">${list.map(([k,v])=>`<option value="${v}" ${(+v).toFixed(2)===target?'selected':''}>${k} (${v})</option>`).join('')}</select>`};
  const activities=unique(masterData().map(x=>x.activity).filter(Boolean));
  const captureRatingDraft=()=>{
    settings.ratingByActivity??={};
    $$('#app tr[data-pic][data-activity]').forEach(tr=>{
      const pic=String(tr.dataset.pic||'').trim(), activity=String(tr.dataset.activity||'').trim();
      const values=$$('.grade',tr).map(x=>+x.value||0);
      if(!pic||!activity||values.length<4)return;
      settings.ratingByActivity[pic]??={};
      settings.ratingByActivity[pic][activity]={skill:values[0]||0,effort:values[1]||0,condition:values[2]||0,consistency:values[3]||0};
    });
    // Legacy mirrors are retained only for backward compatibility. They must
    // never drive calculations because one PIC can have multiple Activities.
    settings.westinghouse??={}; settings.ratings??={};
    operatorList().forEach(pic=>{
      const first=Object.values(settings.ratingByActivity?.[pic]||{})[0]||defaultWestinghouseLocal();
      settings.westinghouse[pic]={...first};
      settings.ratings[pic]=westinghouseFactor(first);
    });
  };
  const configuredPairs=[];
  operatorList().forEach(pic=>Object.entries(settings.ratingByActivity?.[pic]||{}).forEach(([activity,w])=>configuredPairs.push({pic,activity,w})));
  configuredPairs.sort((a,b)=>a.activity.localeCompare(b.activity)||a.pic.localeCompare(b.pic));
  const rows=configuredPairs.map(({pic,activity,w})=>`<tr data-pic="${esc(pic)}" data-activity="${esc(activity)}"><td>${esc(activity)}</td><td><b>${esc(pic)}</b></td><td>${grade(skill,w.skill)}</td><td>${grade(effort,w.effort)}</td><td>${grade(condition,w.condition)}</td><td>${grade(consistency,w.consistency)}</td><td class="rf-result">${westinghouseFactor(w).toFixed(3)}</td><td>${canDelete()?`<button type="button" class="btn ghost rating-delete-pic" data-pic="${esc(pic)}">Hapus PIC</button>`:'<span class="muted">—</span>'}</td></tr>`).join('');
  const observedPairs=unique(observations.map(o=>`${o.operator}|||${o.activity}`)).map(k=>{const [pic,activity]=k.split('|||');return {pic,activity};});
  const missingPairs=observedPairs.filter(x=>ratingFactorFor(x.pic,x.activity)==null).sort((a,b)=>a.activity.localeCompare(b.activity)||a.pic.localeCompare(b.pic));
  const compatibilityNote=(settings.ratingMigrationConflicts||[]).length?`<div class="analysis-note validation-rule"><b>Rating lama perlu ditinjau:</b> ${settings.ratingMigrationConflicts.length} pasangan perlu ditetapkan ulang karena rating lama berbeda antar-element dalam Activity yang sama.</div>`:'';
  const missingNote=missingPairs.length?`<div class="analysis-note validation-rule"><b>${missingPairs.length} pasangan PIC + Activity belum memiliki rating.</b> Tetapkan Rating Factor pada pasangan yang memang dikerjakan PIC tersebut sebelum menyimpan observasi baru.</div>`:'';
  const refTable=(title,list)=>`<div class="card section"><h3>${title}</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Grade</th><th>Adjustment</th></tr></thead><tbody>${list.map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#app').innerHTML=`<div class="content">
    <div class="card section rating-card"><div class="section-head rating-head"><div class="rating-intro"><h3>WESTINGHOUSE • PERFORMANCE RATING</h3><p class="muted">RF ditetapkan berdasarkan <b>PIC + Activity</b>. Element Kerja hanya menentukan pekerjaan yang waktunya diukur. Skill, Effort, Condition, dan Consistency dinilai pada konteks Activity yang dikerjakan PIC. RF yang dipakai pada setiap observasi disimpan sebagai <b>snapshot</b>, sehingga perubahan rating berikutnya tidak mengubah histori.</p></div><div class="add-pic-form"><input id="newOperator" placeholder="Nama PIC"><button id="addOperator" class="btn secondary" type="button">＋ Tambah PIC</button></div></div>
      <div class="rating-assignment-row"><label>Activity<select id="ratingActivity"><option value="">Pilih Activity</option>${activities.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select></label><label>PIC<select id="ratingPic"><option value="">Pilih PIC</option>${operatorList().map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><button id="addRatingPair" class="btn secondary" type="button">＋ Tambah Rating</button></div>
      ${compatibilityNote}${missingNote}
      <div class="rating-info-strip"><span><b>PIC terdaftar: ${operatorList().length}</b></span><span>Rating dibuat hanya untuk <b>PIC + Activity</b> yang benar-benar dikerjakan PIC.</span></div>
      <div class="table-wrap rating-table-wrap"><table class="data-table rating-table"><thead><tr><th>Activity</th><th>PIC</th><th>Skill</th><th>Effort</th><th>Condition</th><th>Consistency</th><th>Rating Factor</th>${canDelete()?'<th>Aksi</th>':''}</tr></thead><tbody>${rows||`<tr><td colspan="${canDelete()?8:7}" class="muted">Belum ada Rating Factor. Tambahkan pasangan Activity + PIC terlebih dahulu.</td></tr>`}</tbody></table></div><div class="rating-save-row"><button id="saveSettings" class="btn primary">Simpan Rating Factor</button></div></div>
    <div class="grid cols-2 section">${refTable('Acuan Westinghouse — Skill',skill)}${refTable('Acuan Westinghouse — Effort',effort)}${refTable('Acuan Westinghouse — Condition',condition)}${refTable('Acuan Westinghouse — Consistency',consistency)}</div>
  </div>`;
  if(!canWrite()){ $('#addOperator').classList.add('hidden'); $('#addRatingPair').classList.add('hidden'); $('#saveSettings').classList.add('hidden'); }
  $$('#app tr[data-pic][data-activity]').forEach(tr=>{
    const gradeEls=$$('.grade',tr);
    if(!canWrite())gradeEls.forEach(x=>x.disabled=true);
    const recalc=()=>{const v=gradeEls.map(x=>+x.value||0);const out=tr.querySelector('.rf-result');if(out)out.textContent=westinghouseFactor({skill:v[0],effort:v[1],condition:v[2],consistency:v[3]}).toFixed(3)};
    gradeEls.forEach(x=>x.onchange=recalc);recalc();
  });
  $('#addRatingPair').onclick=()=>{if(!ensureWrite())return;captureRatingDraft();const activity=$('#ratingActivity').value,pic=$('#ratingPic').value;if(!activity||!pic)return showToast('Pilih Activity dan PIC terlebih dahulu.','warning');settings.ratingByActivity[pic]??={};if(settings.ratingByActivity[pic][activity])return showToast('Rating untuk PIC + Activity tersebut sudah ada.','warning');settings.ratingByActivity[pic][activity]=defaultWestinghouseLocal();save();renderRating();showToast('Pasangan PIC + Activity ditambahkan. Atur grade Westinghouse lalu simpan.','info');};
  $('#addOperator').onclick=()=>{if(!ensureWrite())return;captureRatingDraft();const name=$('#newOperator').value.trim();if(!name)return showToast('Masukkan nama PIC.','warning');if(operatorList().some(x=>x.localeCompare(name,undefined,{sensitivity:'accent'})===0))return showToast('PIC sudah ada.','warning');settings.operators.push(name);settings.ratingByActivity??={};settings.ratingByActivity[name]??={};settings.westinghouse??={};settings.westinghouse[name]=defaultWestinghouseLocal();settings.ratings[name]=1;save();renderRating()};
  $$('#app .rating-delete-pic').forEach(btn=>btn.onclick=async()=>{
    if(!ensureAdmin())return;
    const name=String(btn.dataset.pic||'').trim();
    if(!name)return;
    captureRatingDraft();
    const activityCount=Object.keys(settings.ratingByActivity?.[name]||{}).length;
    const observationCount=observations.filter(o=>String(o.operator||'').trim()===name).length;
    const detail=activityCount?` ${activityCount} Rating Factor Activity akan ikut dihapus.`:'';
    const historyNote=observationCount?` Histori ${observationCount} observasi tetap dipertahankan, tetapi PIC tidak lagi tersedia untuk input baru.`:'';
    if(!confirm(`Hapus PIC "${name}" dari Rating Factor?${detail}${historyNote}`))return;
    btn.disabled=true;
    try{
      if(window.tmwaCloud?.enabled) await window.tmwaCloud.deleteOperator(name);
      settings.operators=settings.operators.filter(x=>String(x).trim()!==name);
      if(settings.ratingByActivity) delete settings.ratingByActivity[name];
      if(settings.ratings) delete settings.ratings[name];
      if(settings.westinghouse) delete settings.westinghouse[name];
      if(settings.operatorDepartments) delete settings.operatorDepartments[name];
      if(!save())return;
      renderRating();
      showToast(`PIC ${name} berhasil dihapus dari Rating Factor.`,'success');
    }catch(err){
      btn.disabled=false;
      console.error('Delete PIC failed:',err);
      showToast(`PIC ${name} gagal dihapus: ${err?.message||'periksa koneksi cloud.'}`,'error',5200);
    }
  });
  $('#saveSettings').onclick=()=>{if(!ensureAdmin())return;captureRatingDraft();save();showToast('Rating Factor per PIC + Activity berhasil disimpan.','success');renderRating()};
}
/* ==========================================================================
   10. Standard Time
   ========================================================================== */
function renderStandard(){
  setHeader('Standard Time','NORMAL TIME → ALLOWANCE → STANDARD TIME');
  let rows=[];
  masterData().forEach(m=>{
    const all=standardFor(m.process,m.activity,m.element,'All');
    if(all)rows.push({m,size:'All / Tanpa Dimensi',r:all});
    ['Small','Medium','Big'].forEach(size=>{const r=standardFor(m.process,m.activity,m.element,size);if(r)rows.push({m,size,r})});
  });
  $('#app').innerHTML=`<div class="content"><div class="analysis-note"><b>All / Tanpa Dimensi</b> dihitung dari seluruh observasi valid pada Process + Activity + Element Kerja yang sama, tanpa memisahkan Small/Medium/Big. Hasil All hanya tersedia jika data gabungan <b>seragam dan cukup</b>. Jika penggabungan tidak seragam, Standard Time All tidak dipaksakan; gunakan Standard Time berdasarkan dimensi. Small/Medium/Big tetap dihitung terpisah. Normal Time = Σ(Time × RF snapshot) / Nᵥ. Standard Time = Normal Time / (1 − Allowance). RF Avg. hanya informasi ringkas; perhitungan menggunakan RF snapshot setiap observasi.</div><div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Element</th><th>Kategori</th><th>N</th><th>x̄ (Rata-Rata)</th><th>RF Snapshot Avg.</th><th>Normal Time</th><th>Allowance</th><th>Standard Time</th><th>Source</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.m.process)}</td><td>${esc(x.m.element)}</td><td>${x.size}</td><td>${x.r.n}</td><td>${fmtTimeValue(x.r.mean)}</td><td>${fmt(x.r.rf)}</td><td>${fmtTimeValue(x.r.normal)}</td><td>${fmt(settings.allowance*100)}%</td><td><b>${fmtTimeValue(x.r.standard)}</b></td><td><span class="badge ${x.r.source==='Category specific'?'ok':'warn'}">${x.r.source}</span></td></tr>`).join('')||'<tr><td colspan="10">No standard time available. Add observations first.</td></tr>'}</tbody></table></div></div></div>`;
}
/* ==========================================================================
   11. Waste & Pareto analysis
   ========================================================================== */
function renderWaste(){
  setHeader('Waste & Pareto','LEAN ANALYSIS');
  const map={},detail=[]; let missingFrequency=0;
  masterData().forEach(m=>{
    if(!m.waste||m.waste==='-')return;
    ['Small','Medium','Big'].forEach(size=>{
      const st=standardFor(m.process,m.activity,m.element,size),freq=frequencyForSize(m,size);
      if(!st)return;
      if(freq==null){missingFrequency++;return;}
      const time=st.standard*freq;
      map[m.waste]=(map[m.waste]||0)+time;
      detail.push({waste:m.waste,process:m.process,activity:m.activity,element:m.element,size,time,freq});
    });
  });
  const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  const total=rows.reduce((a,x)=>a+x[1],0);
  const paretoRows=rows.map(([waste,time])=>({waste,element:'',time,contribution:total?time/total*100:0}));
  $('#app').innerHTML=`<div class="content page-waste"><div class="grid cols-3">${kpi('Waste Types',rows.length,'With valid Standard Time + category frequency')}${kpi('ESTIMATED WASTE TIME / DAY',fmtTimeValue(total),'Σ(Standard Time kategori × Frequency kategori/hari)')}${kpi('Top Waste',rows[0]?.[0]||'—',rows[0]?fmtTimeValue(rows[0][1])+'/day':'')}</div><div class="analysis-note">Perhitungan Waste/Day dipisahkan menurut Small, Medium, dan Big. Kategori tanpa Standard Time valid atau tanpa frekuensi kategori tidak dihitung dan tidak digantikan dengan frekuensi umum.${missingFrequency?` <b>${missingFrequency} kombinasi kategori memiliki Standard Time valid tetapi frekuensinya belum diisi, sehingga belum masuk total.</b>`:''}</div><div class="card section"><h3>Pareto Waste</h3>${rows.length?`${dashboardPareto(paretoRows)}<p class="chart-note waste-chart-note">Batang vertikal menunjukkan <b>Estimated Waste Time / Day</b>. Garis menunjukkan <b>kontribusi kumulatif (%)</b>. Sumbu X = jenis waste, sumbu Y kiri = estimated waste time, sumbu Y kanan = persentase kumulatif.</p>`:'<div class="empty">Belum ada data waste yang sekaligus memiliki Standard Time valid dan frekuensi per kategori.</div>'}</div><div class="card section"><h3>Contribution Detail</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Waste</th><th>Time / Day</th><th>%</th><th>Cumulative %</th></tr></thead><tbody>${(()=>{let c=0;return rows.map(([k,v])=>{c+=v;return `<tr><td>${esc(k)}</td><td>${fmtTimeValue(v)}</td><td>${fmt(total?v/total*100:0)}%</td><td>${fmt(total?c/total*100:0)}%</td></tr>`}).join('')})()}</tbody></table></div></div><div class="card section"><h3>Dimension Detail</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Waste</th><th>Element</th><th>Kategori</th><th>Frequency / Day</th><th>Standard Time</th><th>Waste Time / Day</th></tr></thead><tbody>${detail.sort((a,b)=>b.time-a.time).map(x=>{const st=standardFor(x.process,x.activity,x.element,x.size);return `<tr><td>${esc(x.waste)}</td><td>${esc(x.element)}</td><td>${x.size}</td><td>${fmtFreq(x.freq)}</td><td>${fmtTimeValue(st.standard)}</td><td><b>${fmtTimeValue(x.time)}</b></td></tr>`}).join('')||'<tr><td colspan="6">Belum ada rincian waste per kategori.</td></tr>'}</tbody></table></div></div></div>`;
}
/* ==========================================================================
   12. CSV import / export
   ========================================================================== */
function exportCsv(){const headers=['No','Tanggal','PIC','Process','Activity','Element Kerja','Klasifikasi','Waste','Waktu','Waktu Detik','Kategori Ukuran','Metode','Peralatan','RF Snapshot','Start','Start Display','End','End Display','Catatan'];const rows=observations.map((o,i)=>[i+1,o.date,o.operator,o.process,o.activity,o.element,o.classification,o.waste,fmtTimeValue(o.time),o.time,o.size,o.method,o.equipment,ratingForObservation(o),o.start,fmtTimeValue(o.start),o.end,fmtTimeValue(o.end),o.note]);const csvSafe=v=>{let s=String(v??'');return /^[=+\-@\t\r]/.test(s)?"'"+s:s};const csv=[headers,...rows].map(r=>r.map(x=>'"'+csvSafe(x).replace(/"/g,'""')+'"').join(';')).join('\r\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='TMWA_PDC_Warehouse_Data_Waktu.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),0)}
function importCsv(file){
  if(!ensureWrite())return;
  const reader=new FileReader();
  reader.onload=e=>{
    let text=e.target.result.replace(/^\ufeff/,'');
    let lines=text.split(/\r?\n/).filter(Boolean);
    if(!lines.length)return;
    const delimiter=(lines[0].includes(';')&&!lines[0].includes(','))?';':',';
    const parseLine=line=>{let cols=[],re=new RegExp('(?:^|'+(delimiter===';'?'\\;':',')+')((?:"(?:[^"]|"")*")|[^'+(delimiter===';'?';':',')+']*)','g'),m;while((m=re.exec(line))!==null){cols.push(m[1].replace(/^"|"$/g,'').replace(/""/g,'"'));}return cols};
    let head=parseLine(lines.shift()),added=0,missingRating=0,invalidMaster=0;
    lines.forEach(line=>{
      let cols=parseLine(line),get=n=>cols[head.indexOf(n)]||'',el=get('Element Kerja'),master=getMaster(el);
      if(!master){invalidMaster++;return;}
      const operator=get('PIC'),activity=master.activity,rf=ratingSnapshotFor(operator,activity);
      if(!Number.isFinite(rf)||rf<=0){missingRating++;return;}
      observations.push({id:newId(),date:get('Tanggal'),operator,process:master.process,activity,element:el,size:get('Kategori Ukuran')||'Small',time:+get('Waktu Detik'),start:+get('Start')||0,end:+get('End')||0,classification:master.classification,waste:master.waste,method:master.method,equipment:master.equipment,note:get('Catatan'),ratingFactorSnapshot:rf,createdAt:Date.now()});
      added++;
    });
    save();
    const msg=[`${added} observations imported.`,(missingRating?`${missingRating} dilewati karena Rating Factor PIC + Activity belum ditetapkan.`:''),(invalidMaster?`${invalidMaster} dilewati karena Element Kerja tidak ditemukan di Master Data.`:'')].filter(Boolean).join(' ');
    showToast(msg,missingRating||invalidMaster?'warning':'success',5200);
    render();
  };
  reader.readAsText(file);
}
/* ==========================================================================
   13. Master Data & User Management
   ========================================================================== */
function renderMaster(){
 setHeader('Master Process & Lean','MASTER DATA • EDITABLE');
 const rows=masterData();
 $('#app').innerHTML=`<div class="content">
 <div class="card"><div class="section-head"><div><h3>Master Data Dinamis</h3></div><div>${canWrite()?'<button id="addMaster" class="btn primary">＋ Tambah Element</button>':''}</div></div>
 <div class="master-legend"><b>8 Lean Waste:</b> ${WASTE_TYPES.map(x=>`<span class="badge warn">${x}</span>`).join(' ')} <span class="badge">None / - = tidak ada waste</span></div>
 <div class="analysis-note">Frekuensi/hari kini dicatat terpisah untuk <b>Small • Medium • Big</b> agar perhitungan Waste/Day tidak menggandakan frekuensi umum ke semua kategori.</div>
 <div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Activity</th><th>Element Kerja</th><th>Klasifikasi</th><th>Lean Waste</th><th>Metode</th><th>Peralatan</th><th>Freq/Hari (S • M • B)</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${esc(r.classification)}</td><td>${esc(r.waste||'-')}</td><td>${esc(r.method||'-')}</td><td>${esc(r.equipment||'-')}</td><td>${esc(frequencySummary(r))}</td><td>${canWrite()?`<button class="btn ghost editMaster" data-i="${i}">Edit</button>`:''} ${canDelete()?`<button class="btn ghost delMaster" data-i="${i}">Hapus</button>`:''}</td></tr>`).join('')}</tbody></table></div></div></div>`;
 function modal(existing={},editIndex=null){if(!ensureWrite())return;
  const savedDraft=getDraft('master');
  if(savedDraft&&savedDraft.editIndex===editIndex){existing={...existing,...savedDraft};}
  const fb=existing.frequencyBySize||{};
  const html=`<div class="modal-backdrop" id="masterModal"><div class="modal"><h3>${editIndex==null?'Tambah':'Edit'} Master Element</h3><div class="form-grid"><label>Process<input id="mProcess" value="${esc(existing.process||'')}"></label><label>Activity<input id="mActivity" value="${esc(existing.activity||'')}"></label><label class="full">Element Kerja<input id="mElement" value="${esc(existing.element||'')}"></label><label>Klasifikasi<select id="mClass">${CLASSIFICATIONS.map(x=>`<option ${existing.classification===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Lean Waste<select id="mWaste"><option value="-">None / Tidak ada waste</option>${WASTE_TYPES.map(x=>`<option ${existing.waste===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Metode<select id="mMethod">${masterMethodOptions().map(m=>`<option value="${m}" ${normalizeMasterMethod(existing.method)===m?'selected':''}>${m}</option>`).join('')}</select></label><label>Peralatan<input id="mEquipment" value="${esc(existing.equipment||'-')}"></label><label class="full">Frekuensi / Hari — isi per kategori ukuran</label><label>Small<input id="mFreqSmall" type="number" min="0" step="1" placeholder="unit/hari" value="${fb.Small==null?'':esc(fb.Small)}"></label><label>Medium<input id="mFreqMedium" type="number" min="0" step="1" placeholder="unit/hari" value="${fb.Medium==null?'':esc(fb.Medium)}"></label><label>Big<input id="mFreqBig" type="number" min="0" step="1" placeholder="unit/hari" value="${fb.Big==null?'':esc(fb.Big)}"></label><div class="analysis-note full">Frekuensi Small, Medium, dan Big disimpan terpisah. Frekuensi lama yang bersifat umum <b>tidak digandakan otomatis</b> ke setiap kategori.</div><label class="full">Catatan<textarea id="mNotes">${esc(existing.notes||'')}</textarea></label></div><div class="modal-actions"><button id="saveMaster" class="btn primary">Simpan</button><button id="closeMaster" class="btn ghost">Batal</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  const readFreq=id=>{const v=$('#'+id)?.value;return v===''||v==null?null:Math.max(0,+v||0)};
  const captureMasterDraft=()=>({editIndex,id:existing.id||null,process:$('#mProcess')?.value||'',activity:$('#mActivity')?.value||'',element:$('#mElement')?.value||'',classification:$('#mClass')?.value||'',waste:$('#mWaste')?.value||'-',method:normalizeMasterMethod($('#mMethod')?.value),equipment:$('#mEquipment')?.value||'-',frequency:Number(existing.frequency)||0,frequencyBySize:{Small:readFreq('mFreqSmall'),Medium:readFreq('mFreqMedium'),Big:readFreq('mFreqBig')},notes:$('#mNotes')?.value||'',savedAt:Date.now()});
  const saveMasterDraft=()=>scheduleDraft('master',captureMasterDraft());
  ['mProcess','mActivity','mElement','mClass','mWaste','mMethod','mEquipment','mFreqSmall','mFreqMedium','mFreqBig','mNotes'].forEach(id=>{$('#'+id)?.addEventListener('input',saveMasterDraft);$('#'+id)?.addEventListener('change',saveMasterDraft)});
  $('#closeMaster').onclick=()=>{$('#masterModal')?.remove();clearDraft('master');};
  $('#saveMaster').onclick=()=>{const v={id:existing.id||((typeof crypto!=='undefined'&&typeof crypto.randomUUID==='function')?crypto.randomUUID():('m-'+Date.now()+'-'+Math.random().toString(16).slice(2))),process:$('#mProcess').value.trim(),activity:$('#mActivity').value.trim(),element:$('#mElement').value.trim(),classification:$('#mClass').value,waste:$('#mWaste').value,method:normalizeMasterMethod($('#mMethod').value),equipment:$('#mEquipment').value.trim()||'-',frequency:Number(existing.frequency)||0,frequencyBySize:{Small:readFreq('mFreqSmall'),Medium:readFreq('mFreqMedium'),Big:readFreq('mFreqBig')},notes:$('#mNotes').value.trim()};if(!v.process||!v.activity||!v.element)return showToast('Process, Activity, dan Element Kerja wajib diisi.','warning');let a=masterData();if(editIndex==null)a.push(v);else a[editIndex]=v;clearDraft('master');saveMaster(a);save();$('#masterModal').remove();renderMaster();};
  saveMasterDraft();
  registerDraftCapture(()=>saveDraft('master',captureMasterDraft()));
 }
 if($('#addMaster')) $('#addMaster').onclick=()=>{if(ensureWrite())modal()};
 $$('.editMaster').forEach(b=>b.onclick=()=>modal(masterData()[+b.dataset.i],+b.dataset.i));
 $$('.delMaster').forEach(b=>b.onclick=async()=>{if(!(await tmwaDialog.confirm('Master element ini akan dihapus. Observasi lama tidak otomatis dihapus.',{title:'Hapus master element?',confirmText:'Hapus',danger:true})))return;const i=+b.dataset.i;let a=masterData();const row=a[i];try{if(window.tmwaCloud?.enabled)await window.tmwaCloud.deleteMaster(row?.id);a.splice(i,1);safeWrite(MASTER_KEY,a);idbSet(MASTER_KEY,a).catch(()=>{});renderMaster()}catch(err){console.error(err);showToast('Master gagal dihapus dari cloud: '+(err.message||err),'error');}});
}
function renderUsers(){
  setHeader('User Management','ACCESS CONTROL • ADMIN ONLY');
  if(!ensureAdmin()){state.view='dashboard';return renderDashboard();}
  const sb=window.tmwaAuth?.getClient?.();
  if(!sb){$('#app').innerHTML='<div class="content"><div class="card"><div class="analysis-note">Supabase client belum siap.</div></div></div>';return;}
  $('#app').innerHTML='<div class="content"><div class="card user-management-page"><div class="section-head user-management-title"><div><h2>User Management</h2><h3>Pengguna Aplikasi</h3><p class="muted">Akun baru masuk dengan status Pending untuk ditinjau oleh admin.</p></div></div><div id="userTable"><div class="empty">Memuat pengguna...</div></div></div></div>';
  (async()=>{
    const {data,error}=await sb.from('user_profiles').select('id,email,full_name,role,status,created_at,approved_at').order('created_at',{ascending:false});
    if(error){$('#userTable').innerHTML='<div class="analysis-note">Gagal memuat user: '+esc(error.message)+'</div>';return;}
    const rows=data||[];
    $('#userTable').innerHTML='<div class="table-wrap user-management-wrap"><table class="data-table user-management-table"><colgroup><col class="user-col-name"><col class="user-col-email"><col class="user-col-role"><col class="user-col-status"><col class="user-col-created"><col class="user-col-action"></colgroup><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>'+rows.map(u=>`<tr data-user="${u.id}"><td>${esc(u.full_name||'—')}</td><td class="user-email-cell">${esc(u.email)}</td><td><select class="user-role"><option value="viewer" ${u.role==='viewer'?'selected':''}>viewer</option><option value="analyst" ${u.role==='analyst'?'selected':''}>analyst</option><option value="admin" ${u.role==='admin'?'selected':''}>admin</option></select></td><td><select class="user-status user-status-select user-status-${esc(u.status)}" aria-label="Status pengguna"><option value="pending" ${u.status==='pending'?'selected':''}>Pending</option><option value="approved" ${u.status==='approved'?'selected':''}>Approved</option><option value="suspended" ${u.status==='suspended'?'selected':''}>Suspended</option></select></td><td class="user-created-cell">${new Date(u.created_at).toLocaleDateString('id-ID')}</td><td><button class="btn primary user-save" data-id="${u.id}">Simpan</button></td></tr>`).join('')+'</tbody></table></div>';
    $$('.user-status-select').forEach(sel=>sel.addEventListener('change',()=>{const v=sel.value;sel.className='user-status user-status-select user-status-'+v;}));
    $$('.user-save').forEach(btn=>btn.onclick=async()=>{
      if(!ensureAdmin())return; const tr=btn.closest('tr'); const id=btn.dataset.id; const newRole=tr.querySelector('.user-role').value; const newStatus=tr.querySelector('.user-status').value;
      if(id===window.tmwaAuth?.getProfile?.()?.id && (newRole!=='admin'||newStatus!=='approved')){showToast('Admin tidak dapat menurunkan atau menonaktifkan akun sendiri.','warning');return;}
      btn.disabled=true; const {error}=await sb.from('user_profiles').update({role:newRole,status:newStatus,approved_at:newStatus==='approved'?new Date().toISOString():null,approved_by:newStatus==='approved'?window.tmwaAuth?.getProfile?.()?.id:null,updated_at:new Date().toISOString()}).eq('id',id); btn.disabled=false;
      if(error) showToast('Perubahan gagal: '+error.message,'error'); else {showToast('Profil berhasil diperbarui.','success');renderUsers();}
    });
  })();
}


/* ========================================================================
   TSKK / SWCT — Observation-driven Standard Work Combination Table
   Source = saved observations. Master Data remains the single source
   for Process / Activity / Element during observation capture.
   ======================================================================== */
/* ==========================================================================
   14. TSKK / SWCT
   ========================================================================== */
const TSKK_KEY='tmwa-pdc-tskk-studies';
const TSKK_TYPES=[
  {value:'manual',label:'Manual / Hand'},
  {value:'auto',label:'Auto / Machine'},
  {value:'walk',label:'Walk / Walking'}
];
function tskkStudies(){try{return JSON.parse(localStorage.getItem(TSKK_KEY)||'[]')}catch(e){return []}}
function saveTSKKLocal(rows){localStorage.setItem(TSKK_KEY,JSON.stringify(rows))}
function tskkTypeLabel(v){return TSKK_TYPES.find(x=>x.value===v)?.label||'Pilih Type'}
function tskkCalc(study){
  const rawItems=Array.isArray(study.items)?study.items:[];
  const isManual=study.observationMethod==='manual';
  const items=rawItems.map((x,i)=>{const start=Number.isFinite(+x.start)?Math.max(0,+x.start):0;const dur=Math.max(0,Number(x.time)||0);return {...x,seq:i+1,start,end:(Number.isFinite(+x.end)?Math.max(start,+x.end):start+dur),time:dur};});
  const manual=items.filter(x=>x.type==='manual').reduce((a,x)=>a+x.time,0);
  const auto=items.filter(x=>x.type==='auto').reduce((a,x)=>a+x.time,0);
  const walk=items.filter(x=>x.type==='walk').reduce((a,x)=>a+x.time,0);
  const cycle=isManual?Math.max(0,Number(study.manualCycleTime)||Number(study.actualCycleTime)||Number(rawItems.find(x=>Number(x.time)>0)?.time)||0):(items.length?Math.max(0,Math.max(...items.map(x=>x.end))-Math.min(...items.map(x=>x.start))):0);
  const takt=Math.max(0,Number(study.taktTime)||0);const gap=takt-cycle;const status=takt<=0?'Takt belum diisi':cycle<=takt+0.0001?'Target tercapai':'Cycle Time > Takt Time';
  return {items,manual,auto,walk,cycle,takt,gap,status,operatorWork:manual+walk,operatorLoad:takt?(manual+walk)/takt*100:0,machineShare:cycle?auto/cycle*100:0,typeComplete:isManual||items.every(x=>!!x.type)};
}
function tskkDefaultStudyFromSession(session){
  const method=session?.method==='manual'?'manual':'video';
  const sourceRows=(session?.rows||[]).sort((a,b)=>(a.start??a.createdAt??0)-(b.start??b.createdAt??0));
  const manualCycleTime=method==='manual'?Math.max(0,Number(sourceRows.find(o=>Number(o.time)>0)?.time)||0):0;
  const rows=sourceRows.map(o=>({id:newId(),sourceObservationId:o.id,element:o.element||'',type:tskkTypeFromMaster(o.element||''),time:method==='video'?Math.max(0,+o.time||0):0,start:method==='video'&&o.start!=null?Math.max(0,+o.start):null,end:method==='video'&&o.end!=null?Math.max(0,+o.end):null,note:o.note||''}));
  if(method==='video'){let cursor=0;rows.forEach(x=>{if(x.start==null)x.start=cursor;if(x.end==null)x.end=x.start+x.time;cursor=Math.max(cursor,x.end)})}
  return {id:newId(),tskkNo:'TSKK-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+String(Date.now()).slice(-4),observationSessionId:session?.id||null,observationCycleId:session?.sourceSessionId||session?.id||null,observationMethod:method,manualCycleTime,sourceObservationIds:sourceRows.map(o=>o.id),partName:'',area:'',process:session?.process||'',activity:session?.activity||'',operator:session?.operator||'',sizeCategory:session?.size||'Small',studyDate:session?.date||tskkEscDate(),shift:'Shift 1',availableMinutes:480,requiredUnits:0,taktTime:0,notes:'',items:rows};
}
function tskkEscDate(v){return v||new Date().toISOString().slice(0,10)}
async function tskkLoadCloud(){
  const sb=window.tmwaAuth?.getClient?.();if(!sb)return null;
  try{
    const q=await sb.from('tskk_studies').select('id,tskk_no,observation_session_id,observation_cycle_id,source_observation_ids,part_name,area,process,activity,operator_name,study_date,size_category,shift,available_minutes,required_units,takt_time,notes,created_at,updated_at').order('created_at',{ascending:false});
    if(q.error){if(/relation .*tskk_studies.*does not exist/i.test(q.error.message||''))return null;throw q.error;}
    const data=q.data||[],ids=data.map(x=>x.id);let itemRows=[];
    if(ids.length){const iq=await sb.from('tskk_items').select('id,study_id,seq,element_name,work_type,time_seconds,start_seconds,end_seconds,notes').in('study_id',ids).order('seq',{ascending:true});if(iq.error)throw iq.error;itemRows=iq.data||[]}
    const by=new Map();itemRows.forEach(x=>{if(!by.has(x.study_id))by.set(x.study_id,[]);const derived=tskkTypeFromMaster(x.element_name||'');by.get(x.study_id).push({id:x.id,element:x.element_name,type:derived||x.work_type||'',time:+x.time_seconds||0,start:+x.start_seconds||0,end:+x.end_seconds||0,note:x.notes||''});});
    return data.map(x=>{const loadedItems=by.get(x.id)||[];const loadedManualCycle=loadedItems.find(it=>Number(it.time)>0)?.time||0;return ({id:x.id,tskkNo:x.tskk_no||'',observationSessionId:x.observation_session_id||x.observation_cycle_id||null,observationCycleId:x.observation_cycle_id||x.observation_session_id||null,sourceObservationIds:Array.isArray(x.source_observation_ids)?x.source_observation_ids:[],manualCycleTime:loadedManualCycle,partName:x.part_name||'',area:x.area||'',process:x.process||'',activity:x.activity||'',operator:x.operator_name||'',studyDate:x.study_date||'',sizeCategory:x.size_category||'Small',shift:x.shift||'',availableMinutes:+x.available_minutes||0,requiredUnits:+x.required_units||0,taktTime:+x.takt_time||0,notes:x.notes||'',items:loadedItems});});
  }catch(err){console.warn('TSKK cloud load skipped:',err);return null}
}
async function tskkPersistCloud(study){
  const sb=window.tmwaAuth?.getClient?.();if(!sb||!canWrite())return false;
  const row={id:study.id,tskk_no:study.tskkNo||null,observation_session_id:study.observationSessionId||study.observationCycleId||null,observation_cycle_id:study.observationCycleId||study.observationSessionId||null,source_observation_ids:study.sourceObservationIds||[],part_name:study.partName||null,area:study.area||null,process:study.process||null,activity:study.activity||null,operator_name:study.operator||null,study_date:study.studyDate||null,size_category:study.sizeCategory||'Small',shift:study.shift||null,available_minutes:+study.availableMinutes||0,required_units:+study.requiredUnits||0,takt_time:+study.taktTime||0,notes:study.notes||null,updated_at:new Date().toISOString()};
  try{const q=await sb.from('tskk_studies').upsert(row,{onConflict:'id'});if(q.error){if(/column .*observation_session_id.*does not exist/i.test(q.error.message||'')){showToast('TSKK cloud belum menggunakan schema terbaru. Jalankan supabase/schema.sql lalu coba lagi.','warning');return false;}if(/relation .*tskk_studies.*does not exist/i.test(q.error.message||''))return false;throw q.error;}const d=await sb.from('tskk_items').delete().eq('study_id',study.id);if(d.error)throw d.error;const items=(study.items||[]).map((x,i)=>({id:x.id||newId(),study_id:study.id,seq:i+1,element_name:x.element||'',work_type:tskkTypeFromMaster(x.element||'')||x.type||'manual',time_seconds:study.observationMethod==='manual'?(i===0?(+study.manualCycleTime||+x.time||0):0):(+x.time||0),start_seconds:+x.start||0,end_seconds:study.observationMethod==='manual'?0:(+x.end||((+x.start||0)+(+x.time||0))),notes:x.note||null}));if(items.length){const ins=await sb.from('tskk_items').insert(items);if(ins.error)throw ins.error;}return true;}catch(err){console.error('TSKK cloud save failed:',err);showToast('TSKK tersimpan lokal, tetapi sinkronisasi cloud gagal: '+(err.message||err),'error');return false}
}
async function tskkDeleteCloud(id){const sb=window.tmwaAuth?.getClient?.();if(!sb||!canDelete())return false;const q=await sb.from('tskk_studies').delete().eq('id',id);if(q.error)throw q.error;return true}
function tskkGraphVisual(type,left,width,timeLabel){
  const t=String(type||'').toLowerCase();
  if(t==='auto') return `<svg class="tskk-line-svg auto-line" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path class="tskk-line-path dashed" d="M0 10 L100 10"/></svg>`;
  if(t==='walk') return `<svg class="tskk-wave-svg walk-wave" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path class="tskk-wave-path solid" d="M0 10 C 5 2, 10 18, 15 10 S 25 2, 30 10 S 40 18, 45 10 S 55 2, 60 10 S 70 18, 75 10 S 85 2, 90 10 S 97 18, 100 10"/></svg>`;
  return `<span class="tskk-solid-line" aria-hidden="true"></span>`;
}
function tskkPrintGraph(type,duration){
  const t=String(type||'').toLowerCase();
  if(t==='auto') return `<svg class="print-line auto-line" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path class="dashed" d="M0 10 L100 10"/></svg>`;
  if(t==='walk') return `<svg class="print-wave walk-wave" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"><path class="solid" d="M0 10 C 5 2, 10 18, 15 10 S 25 2, 30 10 S 40 18, 45 10 S 55 2, 60 10 S 70 18, 75 10 S 85 2, 90 10 S 97 18, 100 10"/></svg>`;
  return `<span class="print-solid-line" aria-hidden="true"></span>`;
}
// Duration display is automatic everywhere: < 60 seconds = dtk; >= 60 seconds = menit.
// Stored values remain in seconds for backward compatibility and calculation accuracy.
function tskkTimeUnit(scaleSeconds){return timeUnitFor(scaleSeconds)}
// TSKK uses ONE display unit for the complete cycle.
// The unit is determined only by Actual Cycle Time: < 60 seconds = dtk;
// >= 60 seconds = menit. All TSKK values (including shorter elements)
// follow that unit so the table, chart, dashboard and PDF stay consistent.
function tskkDominantUnit(study,calc){
  const c=calc||tskkCalc(study||{});
  const cycle=Math.max(0,Number(c.cycle)||0);
  return cycle>=60?{label:'menit',divisor:60}:{label:'dtk',divisor:1};
}
function tskkDisplayTime(value,unit){return fmtDurationNumber((Number(value)||0)/(unit?.divisor||1));}
function tskkAxisTicks(scaleSeconds,unit){
  const divisor=unit?.divisor||1,displayScale=Math.max(0,Number(scaleSeconds)||0)/divisor;
  let step=displayScale<=2?0.5:displayScale<=10?1:displayScale<=60?5:10;
  const ticks=[];
  for(let v=0;v<displayScale+step*0.0001;v+=step){ticks.push(Math.min(displayScale,Number(v.toFixed(4))));}
  if(!ticks.length||Math.abs(ticks[ticks.length-1]-displayScale)>0.0001)ticks.push(Number(displayScale.toFixed(4)));
  return ticks.filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>0.0001).map(display=>({display,raw:display*divisor}));
}
function tskkTimeline(study){
  const c=tskkCalc(study),scale=Math.max(c.cycle,c.takt,1),unit=tskkDominantUnit(study,c),axis=tskkAxisTicks(scale,unit);
  const leftLabel=340;
  const row=(x,i)=>{
    const left=(Number(x.start)||0)/scale*100;
    const width=Math.max(.7,(Number(x.time)||0)/scale*100);
    const type=x.type||'';
    const klass=type||'unassigned';
    const label=type?tskkTypeLabel(type):'Pilih Type';
    const graph=tskkGraphVisual(type,left,width,fmt(x.time));
    return `<div class="tskk-combo-row"><div class="tskk-combo-no">${i+1}</div><div class="tskk-combo-name">${esc(x.element||'—')}</div><div class="tskk-combo-type ${klass}">${esc(label)}</div><div class="tskk-combo-track"><div class="tskk-combo-bar ${klass}" style="left:${left}%;width:${width}%" title="${esc(x.element||'—')} • ${esc(label)} • ${tskkDisplayTime(x.time,unit)} ${unit.label}">${graph}<span>${tskkDisplayTime(x.time,unit)} ${unit.label}</span></div></div></div>`;
  };
  const taktX=c.takt?Math.min(100,c.takt/scale*100):null;
  return `<div class="tskk-combination-chart"><div class="tskk-combo-header"><div class="tskk-combo-no-head">No</div><div class="tskk-combo-heading">Work Element</div><div class="tskk-combo-heading tskk-type-heading">Type</div><div class="tskk-combo-axis"><b class="tskk-axis-caption">Waktu Actual (${unit.label})</b>${axis.map((tick,i)=>`<span class="${i===0?'axis-start ':''}${i===axis.length-1?'axis-end':''}" style="left:${(tick.raw/scale)*100}%">${tick.display}</span>`).join('')}</div></div>${c.items.map(row).join('')}${taktX!==null?`<div class="tskk-combo-takt" style="left:calc(${leftLabel}px + (100% - ${leftLabel}px) * ${taktX/100})"><span>Takt ${tskkDisplayTime(c.takt,unit)} ${unit.label}</span></div>`:''}<div class="tskk-combo-footer"><span class="tskk-combo-note">Actual Time berasal langsung dari Observation. Type ditarik otomatis dari Metode pada Master Data.</span><div class="tskk-legend"><span><i class="tskk-dot manual"></i>Manual / Hand</span><span><i class="tskk-dot auto"></i>Auto / Machine = garis putus-putus</span><span><i class="tskk-dot walk"></i>Walk / Walking</span></div></div></div>`;
}
function tskkStatusBadge(c){const cls=c.status==='Target tercapai'?'ok':c.status==='Takt belum diisi'?'warn':'bad';return `<span class="badge ${cls}">${esc(c.status)}</span>`}
function renderTSKK(skipCloud=false){
  const renderSeq=++tskkRenderSeq;
  setHeader('TSKK / SWCT','STANDARD WORK COMBINATION TABLE');
  const localStudies=tskkStudies();
  const sessions=observationSessions();
  const savedBySession=new Map(localStudies.filter(s=>s.observationSessionId||s.observationCycleId).map(s=>[s.observationSessionId||s.observationCycleId,s]));
  $('#app').innerHTML=`<div class="content tskk-content"><div class="card tskk-header-card">
  <div class="tskk-observation-list"><div class="section-head"><div><h3>Daftar Observation</h3></div></div>
  <div class="table-wrap"><table class="data-table"><thead><tr><th>Observation</th><th>Metode</th><th>Tanggal</th><th>Process</th><th>Activity</th><th>PIC</th><th>Size</th><th>Element</th><th>Status TSKK</th><th>Aksi</th></tr></thead><tbody>${sessions.length?sessions.map(s=>{const saved=savedBySession.get(s.id);return `<tr><td><b>${esc(s.label)}</b></td><td><span class="badge ${s.method==='video'?'ok':'warn'}">${s.method==='video'?'Video':'Manual'}</span></td><td>${esc(s.date||'—')}</td><td>${esc(s.process||'—')}</td><td>${esc(s.activity||'—')}</td><td>${esc(s.operator||'—')}</td><td>${esc(s.size||'—')}</td><td>${s.count}</td><td>${saved?'<span class="badge ok">Sudah dibuat</span>':'<span class="badge warn">Belum dibuat</span>'}</td><td>${saved?`<button class="btn ghost tskk-open" data-id="${saved.id}">Buka TSKK</button>`:(canWrite()?`<button type="button" class="btn primary tskk-create-from-session" data-session="${esc(s.id)}">Buat TSKK</button>`:'<span class="muted">View only</span>')}</td></tr>`}).join(''):'<tr><td colspan="9" class="empty">Belum ada Observation yang tersimpan.</td></tr>'}</tbody></table></div></div>
  <div class="tskk-list-wrap"><div class="section-head"><div><h3>TSKK Tersimpan</h3><p class="muted">Daftar TSKK yang sudah dibuat. Satu record TSKK berisi Work Element dari observasi yang dipilih.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>No TSKK</th><th>Observation</th><th>Process</th><th>Activity</th><th>PIC</th><th>Takt</th><th>Cycle Time</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${localStudies.length?localStudies.map(s=>{const c=tskkCalc(s);const sid=s.observationSessionId||s.observationCycleId||'';const sess=sessions.find(x=>x.id===sid);return `<tr><td>${esc(s.tskkNo)}</td><td>${esc(sess?.label||observationSessionLabel(sid,s.studyDate))}</td><td>${esc(s.process||'—')}</td><td>${esc(s.activity||'—')}</td><td>${esc(s.operator||'—')}</td><td>${tskkDisplayTime(s.taktTime,tskkDominantUnit(s,c))} ${tskkDominantUnit(s,c).label}</td><td>${tskkDisplayTime(c.cycle,tskkDominantUnit(s,c))} ${tskkDominantUnit(s,c).label}</td><td>${tskkStatusBadge(c)}</td><td><button class="btn ghost tskk-open" data-id="${s.id}">Buka</button>${canDelete()?` <button class="btn ghost tskk-delete" data-id="${s.id}">Hapus</button>`:''}</td></tr>`}).join(''):'<tr><td colspan="10" class="empty">Belum ada TSKK tersimpan.</td></tr>'}</tbody></table></div></div></div></div>`;
  const open=selected=>{if(!selected)return;const savedDraft=getDraft('tskk');if(savedDraft&&String(savedDraft.id)===String(selected.id)){selected={...selected,...savedDraft,items:Array.isArray(savedDraft.items)?savedDraft.items:selected.items};}const alreadyOpen=state.tskkEditor&&String(state.tskkDraftId||'')===String(selected.id||'');state.tskkEditor=true;state.tskkDraftId=selected.id||null;if(!alreadyOpen){try{history.pushState({appView:'tskk',tskkEditor:true,tskkId:state.tskkDraftId},'',location.href)}catch(e){console.warn('TSKK history push skipped:',e)}}const readOnly=!canWrite();const sourceRows=(Array.isArray(selected.sourceObservationIds)&&selected.sourceObservationIds.length?observations.filter(o=>selected.sourceObservationIds.includes(o.id)):[]);const sourceSession=sessions.find(x=>x.id===(selected.observationSessionId||selected.observationCycleId));const legacyRows=observations.filter(o=>String(o.observationSessionId||o.observationCycleId||'')===String(selected.observationSessionId||selected.observationCycleId||''));const fallbackRows=sourceRows.length?sourceRows:(sourceSession?.rows?.length?sourceSession.rows:legacyRows);selected.observationMethod=selected.observationMethod||sourceSession?.method||'video';if(fallbackRows.length && (selected.items||[]).length < fallbackRows.length){const oldByElement=new Map((selected.items||[]).map(x=>[x.element,{type:x.type||'',note:x.note||''}]));selected.items=fallbackRows.map(o=>{const old=oldByElement.get(o.element)||{};return {id:newId(),sourceObservationId:o.id,element:o.element||'',type:tskkTypeFromMaster(o.element||'')||old.type||'',time:selected.observationMethod==='video'?Math.max(0,+o.time||0):0,start:selected.observationMethod==='video'&&o.start!=null?Math.max(0,+o.start):null,end:selected.observationMethod==='video'&&o.end!=null?Math.max(0,+o.end):null,note:old.note||o.note||''};});if(selected.observationMethod==='manual'&&(!selected.manualCycleTime||selected.manualCycleTime<=0)){selected.manualCycleTime=Math.max(0,Number(fallbackRows.find(o=>Number(o.time)>0)?.time)||0);}}const isManualObservation=selected.observationMethod==='manual';
  // Use one dominant unit for the complete TSKK editor. The header is
  // refreshed on every draw so the unit stays correct after Takt changes.
  const initialCalc=tskkCalc(selected);
  const editorUnit=tskkDominantUnit(selected,initialCalc);
  $('#app').innerHTML=`<div class="content tskk-content"><div class="card tskk-header-card"><div class="section-head"><div><h3>${esc(selected.tskkNo||'TSKK')}</h3><p class="muted">Source: ${esc(observationSessionLabel(selected.observationSessionId||selected.observationCycleId||'',selected.studyDate))}. ${isManualObservation?'Manual Observation memakai satu Cycle Time; detail Start/End per Work Element tidak tersedia.':'Actual Time dan Start/End berasal langsung dari observasi video.'}</p></div><div class="tskk-actions"><button type="button" class="btn ghost" id="tskkBack">← Kembali</button>${!readOnly?'<button type="button" class="btn primary" id="tskkSave">Simpan TSKK</button>':''}<button type="button" class="btn ghost" id="tskkPrint">Cetak</button></div></div>
  <div class="form-grid tskk-meta-grid"><label>No TSKK<input id="tskkNo" value="${esc(selected.tskkNo)}" ${readOnly?'disabled':''}></label><label>Part / Job<input id="tskkPart" value="${esc(selected.partName)}" ${readOnly?'disabled':''}></label><label>Area / Section<input id="tskkArea" value="${esc(selected.area)}" ${readOnly?'disabled':''}></label><label>PIC<input id="tskkOperator" value="${esc(selected.operator)}" readonly></label><label>Date<input id="tskkDate" type="date" value="${esc(selected.studyDate)}" ${readOnly?'disabled':''}></label><label>Size<select id="tskkSize" ${readOnly?'disabled':''}><option>Small</option><option>Medium</option><option>Big</option></select></label><label>Process<input id="tskkProcess" value="${esc(selected.process)}" readonly></label><label>Activity<input id="tskkActivity" value="${esc(selected.activity)}" readonly></label><label>Shift<input id="tskkShift" value="${esc(selected.shift)}" ${readOnly?'disabled':''}></label><label>Available Time (min)<input id="tskkAvailable" type="number" min="0" step="0.01" value="${selected.availableMinutes||0}" ${readOnly?'disabled':''}></label><label>Required Units<input id="tskkUnits" type="number" min="0" step="1" value="${selected.requiredUnits||0}" ${readOnly?'disabled':''}></label><label>Takt Time<div class="time-input-row"><input id="tskkTakt" type="text" readonly value="${esc(fmtTimeValue(selected.taktTime))}"></div></label><label class="full">Catatan<textarea id="tskkNotes" rows="2" ${readOnly?'disabled':''}>${esc(selected.notes)}</textarea></label></div>
  <div class="tskk-meta-helper"><span><b>Source:</b> data observasi yang dipilih. Work Element, Start, End, dan Actual Time tidak diinput ulang. Type ditarik otomatis dari Metode pada Master Data.</span></div>
  <div class="tskk-kpis" id="tskkKpis"></div>
  <div class="tskk-table-card"><div class="section-head"><div><h3>${isManualObservation?'Observation Summary':'Work Elements / Actual Observation'}</h3><p class="muted">${isManualObservation?'Manual Observation menyimpan satu waktu pengamatan total. Element dipertahankan sebagai konteks Master, bukan sebagai waktu per-element.':'Satu baris = satu Work Element dari observasi video. Nama element dan waktunya berasal dari data observasi.'}</p></div></div><div class="table-wrap"><table class="data-table tskk-work-table ${isManualObservation?'manual-tskk-table':''}"><thead>${isManualObservation?'<tr><th>No</th><th>Work Element</th><th>Type</th><th data-time-header="cycle">Cycle Time</th></tr>':'<tr><th>No</th><th>Work Element</th><th>Type</th><th data-time-header="time">Actual Time</th><th data-time-header="start">Start</th><th data-time-header="end">End</th><th>Keterangan</th></tr>'}</thead><tbody id="tskkWorkBody"></tbody></table></div></div>
  <div class="tskk-chart-card ${isManualObservation?'manual-tskk-summary':''}"><div class="section-head"><div><h3>${isManualObservation?'Actual Cycle Time Summary':'Standard Work Combination Chart'}</h3><p class="muted">${isManualObservation?'Manual Observation menyimpan satu waktu pengamatan total. Tidak dibuat batang Start/End per Work Element.':'Satu baris = satu Work Element. Type berada setelah Work Element; batang menunjukkan Actual Time pada Start–End aktual.'}</p></div></div><div id="tskkTimeline"></div></div><div class="tskk-insight" id="tskkInsight"></div></div>`;
  $('#tskkSize').value=selected.sizeCategory||'Small';
  const syncInputs=()=>{if(isManualObservation&&(!selected.manualCycleTime||selected.manualCycleTime<=0)){selected.manualCycleTime=Math.max(0,Number(selected.items.find(x=>Number(x.time)>0)?.time)||0)}selected.tskkNo=$('#tskkNo').value.trim();selected.partName=$('#tskkPart').value.trim();selected.area=$('#tskkArea').value.trim();selected.studyDate=$('#tskkDate').value;selected.sizeCategory=$('#tskkSize').value;selected.shift=$('#tskkShift').value.trim();selected.availableMinutes=+$('#tskkAvailable').value||0;selected.requiredUnits=+$('#tskkUnits').value||0;selected.taktTime=selected.availableMinutes>0&&selected.requiredUnits>0?+(selected.availableMinutes*60/selected.requiredUnits).toFixed(2):0;selected.notes=$('#tskkNotes').value.trim();};
  const captureTSKKDraft=()=>{syncInputs();return {...selected,items:(selected.items||[]).map(x=>({...x})) ,savedAt:Date.now()};};
  const saveTSKKDraft=()=>scheduleDraft('tskk',captureTSKKDraft);
  ['tskkNo','tskkPart','tskkArea','tskkDate','tskkSize','tskkShift','tskkAvailable','tskkUnits','tskkNotes'].forEach(id=>{$('#'+id)?.addEventListener('input',saveTSKKDraft);$('#'+id)?.addEventListener('change',saveTSKKDraft)});
  // Draft capture belongs to the active TSKK editor scope. Keep it inside
  // `open()` so it can access the editor-local capture function safely.
  registerDraftCapture(()=>saveDraft('tskk',captureTSKKDraft()));
  const updateTakt=()=>{const av=+$('#tskkAvailable').value||0,units=+$('#tskkUnits').value||0;selected.availableMinutes=av;selected.requiredUnits=units;selected.taktTime=av>0&&units>0?+(av*60/units).toFixed(2):0;const input=$('#tskkTakt');if(input){const cc=tskkCalc(selected),unit=tskkDominantUnit(selected,cc);input.value=selected.taktTime>0?`${tskkDisplayTime(selected.taktTime,unit)} ${unit.label}`:'—';}draw();};
  $('#tskkAvailable')?.addEventListener('input',updateTakt);
  $('#tskkUnits')?.addEventListener('input',updateTakt);
  const draw=()=>{selected.items=selected.items.map(x=>{const start=Number.isFinite(+x.start)?Math.max(0,+x.start):0;const time=Math.max(0,+x.time||0);const derivedType=tskkTypeFromMaster(x.element||'');const safeType=['manual','auto','walk'].includes(derivedType)?derivedType:(['manual','auto','walk'].includes(x.type)?x.type:'manual');return {...x,type:safeType,start,end:(Number.isFinite(+x.end)?Math.max(start,+x.end):start+time),time}});const cc=tskkCalc(selected);const displayUnit=tskkDominantUnit(selected,cc);$('#tskkWorkBody').innerHTML=isManualObservation?(selected.items.length?selected.items.map((x,i)=>`<tr><td>${i+1}</td><td><div class="tskk-readonly-element">${esc(x.element||'—')}</div></td><td><div class="tskk-readonly-type ${x.type||'manual'}">${esc(tskkTypeLabel(x.type||'manual'))}</div></td><td>${i===0?`<div class="tskk-readonly-number"><b>${tskkDisplayTime(cc.cycle,displayUnit)} ${displayUnit.label}</b></div>`:'<span class="muted">Satu cycle untuk seluruh observation</span>'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Observation belum memiliki element context.</td></tr>'):(selected.items.length?selected.items.map((x,i)=>`<tr><td>${i+1}</td><td><div class="tskk-readonly-element">${esc(x.element||'—')}</div></td><td><div class="tskk-readonly-type ${x.type||'manual'}">${esc(tskkTypeLabel(x.type||'manual'))}</div></td><td><div class="tskk-readonly-number">${tskkDisplayTime(x.time,displayUnit)}</div></td><td><div class="tskk-readonly-number">${tskkDisplayTime(x.start,displayUnit)}</div></td><td><div class="tskk-readonly-number">${tskkDisplayTime(x.end,displayUnit)}</div></td><td><input class="tskk-item-note" data-i="${i}" value="${esc(x.note||'')}" ${readOnly?'disabled':''}></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Observation belum memiliki element.</td></tr>');$('#tskkKpis').innerHTML=`${kpi('TAKT TIME',tskkDisplayTime(cc.takt,displayUnit)+' '+displayUnit.label,'Target pace')}${kpi('ACTUAL CYCLE TIME',tskkDisplayTime(cc.cycle,displayUnit)+' '+displayUnit.label,cc.gap>=0?'Masih di bawah takt':'Melebihi takt')}${isManualObservation?'':kpi('MANUAL + WALK',tskkDisplayTime(cc.operatorWork,displayUnit)+' '+displayUnit.label,`Load operator ${fmt(cc.operatorLoad)}%`)}${isManualObservation?'':kpi('AUTO / MACHINE',tskkDisplayTime(cc.auto,displayUnit)+' '+displayUnit.label,`Proporsi ${fmt(cc.machineShare)}%`)}`;$('#tskkTimeline').innerHTML=isManualObservation?`<div class="manual-cycle-summary"><div><span>ACTUAL CYCLE</span><b>${tskkDisplayTime(cc.cycle,displayUnit)} ${displayUnit.label}</b></div><div><span>TAKT TIME</span><b>${tskkDisplayTime(cc.takt,displayUnit)} ${displayUnit.label}</b></div><div><span>VARIANCE</span><b>${tskkDisplayTime(cc.gap,displayUnit)} ${displayUnit.label}</b></div><div><span>STATUS</span><b>${esc(cc.status)}</b></div></div>`:`<div class="tskk-chart-scroll">${tskkTimeline(selected)}</div>`;$('#tskkInsight').innerHTML=`<b>Evaluasi:</b> ${tskkStatusBadge(cc)} <span>${cc.walk>0?`Walking ${tskkDisplayTime(cc.walk,displayUnit)} ${displayUnit.label}.`:'Belum ada aktivitas walking.'}</span>`;$$('.tskk-item-note').forEach(el=>el.oninput=()=>{selected.items[+el.dataset.i].note=el.value;saveTSKKDraft()})};
  updateTakt();
  if(!readOnly)$('#tskkSave').onclick=async()=>{if(!ensureWrite())return;syncInputs();if(!selected.items.length){showToast('Tidak ada Work Element dari Observation.','warning');return}selected.items=selected.items.map(x=>({...x,time:Math.max(0,+x.time||0),start:Math.max(0,+x.start||0),end:Math.max(Math.max(0,+x.start||0),Number.isFinite(+x.end)?+x.end:(Math.max(0,+x.start||0)+Math.max(0,+x.time||0)))}));const rows=tskkStudies();const idx=rows.findIndex(x=>x.id===selected.id);if(idx>=0)rows[idx]=selected;else rows.unshift(selected);saveTSKKLocal(rows);const ok=await tskkPersistCloud(selected);if(!ok&&window.tmwaAuth?.getClient?.())return;clearDraft('tskk');state.tskkEditor=false;state.tskkDraftId=null;showToast('TSKK berhasil disimpan.','success');history.replaceState({appView:'tskk',tskkEditor:false,tskkId:null},'',location.href);renderTSKK()};
  $('#tskkBack').onclick=()=>{
  if(!state.tskkEditor)return;
  captureActiveDraft();
  // Use the browser history so Chrome, Safari and mobile back gestures
  // follow the same route as the in-app Kembali button.
  if(history.length>1){history.back();}
  else{state.tskkEditor=false;state.tskkDraftId=null;history.replaceState({appView:'tskk',tskkEditor:false,tskkId:null},'',location.href);renderTSKK();}
};$('#tskkPrint').onclick=()=>{
    syncInputs();
    const cc=tskkCalc(selected);
    const isManualPrint=selected.observationMethod==='manual';
    const scale=Math.max(cc.cycle,cc.takt,1),printUnit=tskkDominantUnit(selected,cc),axis=tskkAxisTicks(scale,printUnit);
    const ticks=axis.map(x=>x.raw);
    const graphStart=0, graphEnd=scale;
    const taktPct=cc.takt?Math.min(100,(cc.takt/scale)*100):null;
    const typeLabel=x=>tskkTypeLabel(x.type||'manual');
    const typeClass=x=>x.type||'manual';
    const bars=cc.items.map((x,i)=>{
      const st=Math.max(0,Number(x.start)||0);
      const en=Math.max(st,Number(x.end)||st+(Number(x.time)||0));
      const dur=Math.max(0,Number(x.time)||0);
      const left=Math.min(100,(st/scale)*100);
      const width=Math.max(dur>0?0.8:0,(dur/scale)*100);
      return `<div class="p-row"><div class="p-no">${i+1}</div><div class="p-element">${esc(x.element||'—')}</div><div class="p-type">${esc(typeLabel(x))}</div><div class="p-time">${isManualPrint?'—':tskkDisplayTime(dur,printUnit)}</div><div class="p-graph"><div class="p-grid">${ticks.map(v=>`<i style="left:${(v/scale)*100}%"></i>`).join('')}</div>${!isManualPrint&&dur>0?`<div class="p-bar ${typeClass(x)}" style="left:${left}%;width:${width}%">${tskkPrintGraph(x.type,dur)}<span class="p-bar-label ${left+width>88?'left':''}">${tskkDisplayTime(dur,printUnit)} ${printUnit.label}</span></div>`:''}</div></div>`;
    }).join('');
    const manualTotal=isManualPrint?0:cc.manual, autoTotal=isManualPrint?0:cc.auto, walkTotal=isManualPrint?0:cc.walk;
    const totalType=(v)=>isManualPrint?'—':tskkDisplayTime(v,printUnit)+' '+printUnit.label;
    const w=window.open('','_blank','width=1400,height=1000');
    if(!w)return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>TSKK ${esc(selected.tskkNo||'')}</title><style>
      *{box-sizing:border-box} @page{size:A4 landscape;margin:8mm} body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111;background:#fff;font-size:10px} .sheet{width:100%;border:1px solid #222;padding:0;background:#fff} .title{height:34px;border-bottom:1px solid #222;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;letter-spacing:.2px}.brand-row{display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr;border-bottom:1px solid #222}.brand{min-height:70px;padding:3px 5px;border-right:1px solid #222;display:flex;align-items:center;justify-content:center;overflow:hidden}.brand img{display:block;width:100%;height:64px;max-width:100%;object-fit:contain;object-position:center}.meta{min-height:70px;padding:7px 9px;border-right:1px solid #222}.meta:last-child{border-right:0}.meta-row{display:grid;grid-template-columns:72px 8px 1fr;line-height:1.55}.meta-row b{font-weight:700}.section-title{font-size:12px;font-weight:800;border:1px solid #222;margin-top:8px;padding:4px 6px;background:#fff;break-after:avoid;page-break-after:avoid}.table{position:relative;border-left:1px solid #222;border-right:1px solid #222}.p-head,.p-row{display:grid;grid-template-columns:30px minmax(180px,1.45fr) 75px 60px minmax(360px,2.8fr)}.p-head{min-height:38px;background:#d9d9d9;border-top:1px solid #222;border-bottom:1px solid #222;font-weight:800;text-align:center}.p-head>div{display:flex;align-items:center;justify-content:center;border-right:1px solid #222;padding:3px}.p-head>div:last-child{border-right:0}.p-head .graph-head{position:relative;display:block;padding:0;overflow:hidden}.graph-title{height:17px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #999}.axis{height:20px;position:relative;font-size:8px;font-weight:400;overflow:hidden;padding:0 34px 0 0}.axis span{position:absolute;top:3px;transform:translateX(-50%);white-space:nowrap}.axis span.axis-start{left:0!important;transform:none!important}.axis span.axis-end{left:auto!important;right:34px!important;transform:none!important}.axis em{position:absolute;right:3px;top:3px;font-style:normal;font-weight:700;background:#d9d9d9;padding-left:2px;z-index:2}.p-row{min-height:29px;height:auto;border-bottom:1px solid #777;break-inside:avoid;page-break-inside:avoid}.p-row>div{border-right:1px solid #777;display:flex;align-items:center;padding:3px 5px;min-height:29px}.p-row>div:last-child{border-right:0}.p-no{justify-content:center;font-weight:700}.p-element{font-weight:700;line-height:1.15;white-space:normal;overflow-wrap:anywhere;word-break:break-word}.p-type{justify-content:center;text-align:center;font-size:8px;line-height:1.1;white-space:normal}.p-time{justify-content:center;font-weight:700;white-space:normal}.p-graph{position:relative;overflow:hidden;padding:0!important;background:#fff}.p-grid{position:absolute;inset:0}.p-grid i{position:absolute;top:0;bottom:0;border-left:1px dotted #aaa}.p-bar{position:absolute;top:6px;height:17px;background:transparent !important;border:0;border-radius:0;display:flex;align-items:center;justify-content:center;overflow:visible;min-width:3px}.p-bar-label{font-size:8px;font-weight:700;color:#111;position:absolute;left:calc(100% + 4px);white-space:nowrap}.p-bar-label.left{left:auto;right:calc(100% + 4px)}.print-solid-line{position:absolute;left:0;right:0;top:7px;height:3px;background:#000;border:1px solid #000}.print-wave{position:absolute;left:0;right:0;top:0;width:100%;height:17px;overflow:visible}.print-wave path{fill:none;stroke:#000;stroke-width:2;vector-effect:non-scaling-stroke}.print-wave path.dashed{stroke-dasharray:5 3}.print-wave path.solid{stroke-dasharray:none}.print-line{position:absolute;inset:0;width:100%;height:17px;overflow:visible}.print-line path{fill:none;stroke:#000;stroke-width:2;vector-effect:non-scaling-stroke}.print-line path.dashed{stroke-dasharray:5 3}.p-bar.walk .print-solid-line{height:2px}.p-bar.wait .print-solid-line{height:2px;border-style:dashed;background:transparent}.tskk-wave-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.tskk-wave-path{fill:none;stroke:#111;stroke-width:2;vector-effect:non-scaling-stroke}.tskk-wave-path.dashed{stroke-dasharray:5 3}.tskk-wave-path.solid{stroke-dasharray:none}.tskk-solid-line{position:absolute;left:0;right:0;top:50%;height:3px;background:#111;transform:translateY(-50%);border-radius:2px}.takt-line{position:absolute;top:0;bottom:0;border-left:2px dashed #d21f1f;z-index:5}.takt-label{position:absolute;top:1px;left:4px;color:#b51515;background:#fff;font-size:8px;font-weight:800;padding:1px 3px;white-space:nowrap}.note{font-size:8px;color:#555;padding:4px 6px;border:1px solid #222;border-top:0;break-inside:avoid;page-break-inside:avoid}.print-legend{display:flex;align-items:center;gap:16px;padding:5px 7px;border:1px solid #222;border-top:0;font-size:8px;font-weight:700;break-inside:avoid;page-break-inside:avoid}.print-legend-item{display:flex;align-items:center;gap:4px;white-space:nowrap}.print-legend-item b{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid #222;border-radius:50%;font-size:8px}.legend-symbol{display:inline-block;flex:0 0 auto;width:32px}.legend-symbol-solid{height:3px;background:#000;border:1px solid #000}.legend-symbol-dashed{height:0;border-top:2px dashed #000}.legend-symbol-wave{height:13px}.legend-symbol-wave path{fill:none;stroke:#000;stroke-width:2;vector-effect:non-scaling-stroke}.summary-title{font-size:12px;font-weight:800;border:1px solid #222;border-bottom:0;margin-top:8px;padding:4px 6px;break-after:avoid;page-break-after:avoid}.summary{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #222;break-inside:avoid;page-break-inside:avoid}.sum{min-height:58px;border-right:1px solid #777;padding:4px 5px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:flex-start}.sum:last-child{border-right:0}.sum b{display:block;font-size:9px;margin-bottom:7px}.sum strong{font-size:10px;line-height:1.2}.status{margin-top:7px;display:inline-block;padding:3px 8px;border:1px solid #222;font-weight:800}.status.ok{background:#e8f4e8}.status.bad{background:#f8e5e5}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:25px;margin-top:18px;padding:0 25px 18px;break-inside:avoid;page-break-inside:avoid}.sig{text-align:center;min-height:54px;display:flex;flex-direction:column;justify-content:space-between}.sig-line{margin:18px auto 0;width:100%;border:0;text-align:center;white-space:pre;font-size:12px}.footer{font-size:7px;text-align:right;color:#777;padding:0 6px 3px}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}.p-row{break-inside:avoid!important;page-break-inside:avoid!important}.p-head{break-after:avoid!important;page-break-after:avoid!important}.note,.print-legend,.summary-title,.summary,.sign{break-inside:avoid!important;page-break-inside:avoid!important}body{background:#fff}.sheet{border:1px solid #222}.print-solid-line{background:#000!important;border-color:#000!important}.print-wave path{stroke:#000!important}.takt-line{border-left-color:#d21f1f!important}}
    </style></head><body><div class="sheet">
      <div class="title">TABEL STANDAR KERJA KOMBINATIF (TSKK)</div>
      <div class="brand-row">
        <div class="brand"><img src="ut-logo-2.png" alt="United Tractors"></div>
        <div class="meta"><div class="meta-row"><b>TSKK No</b><span>:</span><span>${esc(selected.tskkNo||'—')}</span></div><div class="meta-row"><b>Observation</b><span>:</span><span>${esc(selected.observationSessionId||'—')}</span></div><div class="meta-row"><b>Tanggal</b><span>:</span><span>${esc(selected.studyDate||'—')}</span></div></div>
        <div class="meta"><div class="meta-row"><b>PIC</b><span>:</span><span>${esc(selected.operator||'—')}</span></div><div class="meta-row"><b>Process</b><span>:</span><span>${esc(selected.process||'—')}</span></div><div class="meta-row"><b>Activity</b><span>:</span><span>${esc(selected.activity||'—')}</span></div></div>
        <div class="meta"><div class="meta-row"><b>Method</b><span>:</span><span>${esc(isManualPrint?'Manual':'Video')}</span></div><div class="meta-row"><b>Size</b><span>:</span><span>${esc(selected.sizeCategory||'—')}</span></div><div class="meta-row"><b>Takt</b><span>:</span><span>${cc.takt>0?`${tskkDisplayTime(cc.takt,printUnit)} ${printUnit.label}`:'—'}</span></div></div>
      </div>
      <div class="section-title">GRAFIK STANDARD WORK COMBINATION</div>
      <div class="table">
        <div class="p-head"><div>NO</div><div>URUTAN KERJA / WORK ELEMENT</div><div>TYPE</div><div>WAKTU<br>(${printUnit.label})</div><div class="graph-head"><div class="graph-title">SWCT / ACTUAL OBSERVATION</div><div class="axis">${axis.map((tick,i)=>`<span class="${i===0?'axis-start ':''}${i===axis.length-1?'axis-end':''}" style="left:${(tick.raw/scale)*100}%">${tick.display}</span>`).join('')}<em>${printUnit.label}</em></div></div></div>
        ${bars}
        ${taktPct!==null&&!isManualPrint?`<div class="takt-line" style="left:calc(30px + 180px + 75px + 60px + (100% - 345px) * ${taktPct/100})"><span class="takt-label">Takt ${tskkDisplayTime(cc.takt,printUnit)} ${printUnit.label}</span></div>`:''}
      </div>
      <div class="note">Batang menunjukkan Actual Time berdasarkan Start–End hasil Observation Video. Garis merah menunjukkan Takt Time. ${isManualPrint?'Manual Observation menyimpan satu Actual Cycle keseluruhan sehingga tidak dibuatkan batang per Work Element.':''}</div>
      <div class="print-legend"><span style="font-weight:800">Keterangan Simbol:</span><span class="print-legend-item"><i class="legend-symbol legend-symbol-solid"></i> Manual / Hand</span><span class="print-legend-item"><i class="legend-symbol legend-symbol-dashed"></i> Auto / Machine</span><span class="print-legend-item"><svg class="legend-symbol legend-symbol-wave" viewBox="0 0 40 14" preserveAspectRatio="none" aria-hidden="true"><path d="M0 7 C 4 1, 8 13, 12 7 S 20 1, 24 7 S 32 13, 36 7 S 38 4, 40 7"/></svg> Walk / Walking</span></div>
      <div class="summary-title">RINGKASAN</div>
      <div class="summary"><div class="sum"><b>Manual / Hand</b><strong>${totalType(manualTotal)}</strong></div><div class="sum"><b>Auto / Machine</b><strong>${totalType(autoTotal)}</strong></div><div class="sum"><b>Walk / Walking</b><strong>${totalType(walkTotal)}</strong></div><div class="sum"><b>Cycle Time</b><strong>${tskkDisplayTime(cc.cycle,printUnit)} ${printUnit.label}</strong></div><div class="sum"><b>Takt Time</b><strong>${tskkDisplayTime(cc.takt,printUnit)} ${printUnit.label}</strong><span class="status ${cc.status==='Target tercapai'?'ok':'bad'}">${esc(cc.status)}</span></div></div>
      <div class="sign"><div class="sig"><b>Mengetahui,</b><div class="sig-line">(                                  )</div></div><div class="sig"><b>Diperiksa,</b><div class="sig-line">(                                  )</div></div><div class="sig"><b>Dibuat,</b><div class="sig-line">(                                  )</div></div></div>
      <div class="footer">Generated from TMWA PDC Warehouse • ${new Date().toLocaleString('id-ID')}</div>
      </div><script>window.onload=()=>setTimeout(()=>window.print(),150)</script></body></html>`);
    w.document.close();
  };
  draw();
  };
  $$('.tskk-open').forEach(b=>b.onclick=(ev)=>{ev.preventDefault();ev.stopImmediatePropagation();if(state.tskkEditor)return;const s=localStudies.find(x=>String(x.id)===String(b.dataset.id));if(s){try{open(s)}catch(err){console.error('Buka TSKK gagal:',err);showToast('TSKK gagal dibuka: '+(err?.message||err),'error')}}});
  $$('.tskk-delete').forEach(b=>b.onclick=async()=>{if(!ensureAdmin())return;if(!(await tmwaDialog.confirm('Data TSKK ini akan dihapus dan tidak dapat dikembalikan.',{title:'Hapus TSKK?',confirmText:'Hapus',danger:true})))return;const id=b.dataset.id;try{await tskkDeleteCloud(id)}catch(e){console.warn(e)}saveTSKKLocal(localStudies.filter(x=>x.id!==id));renderTSKK()});
  $$('.tskk-create-from-session').forEach(b=>b.onclick=(ev)=>{ev.preventDefault();ev.stopImmediatePropagation();if(state.tskkEditor)return;if(!ensureWrite())return;const session=sessions.find(x=>String(x.id)===String(b.dataset.session));if(!session){console.error('TSKK session not found:',b.dataset.session,sessions);showToast('Observation untuk TSKK tidak ditemukan. Silakan refresh halaman.','warning');return}try{open(tskkDefaultStudyFromSession(session))}catch(err){console.error('Buat TSKK gagal:',err);showToast('TSKK gagal dibuka: '+(err?.message||err),'error')}});
  if(state.tskkEditor&&state.tskkDraftId){const resume=getDraft('tskk');if(resume&&String(resume.id)===String(state.tskkDraftId))setTimeout(()=>open(resume),0);}
  if(!skipCloud) tskkLoadCloud().then(remote=>{
    // Cloud is loaded once for this list render. Never start another cloud-load
    // render loop: that used to reset the mobile table's horizontal scroll and
    // could make the Create TSKK button appear to need multiple clicks.
    if(!remote || renderSeq!==tskkRenderSeq || state.tskkEditor)return;
    saveTSKKLocal(remote);
    if(renderSeq===tskkRenderSeq && !state.tskkEditor)renderTSKK(true);
  }).catch(()=>{});
}

/* ==========================================================================
   15. Navigation, profile UI & routing
   ========================================================================== */
/* ── Sidebar dynamic title ─────────────────────────────────────────────────
   Maps every state.view value → judul yang tampil di h2#sidebarTitle.
   Tambahkan entry baru di sini setiap kali ada view baru. */
const VIEW_LABELS={
  dashboard:'Dashboard',
  observe:'Observation',
  data:'Data Waktu',
  master:'Master Process & Lean',
  tskk:'TSKK / SWCT',
  validation:'Validasi Data Waktu',
  rating:'Rating Factor',
  standard:'Standard Time',
  waste:'Waste & Pareto',
  users:'User Management',
};
function updateSidebarTitle(){
  const el=document.getElementById('sidebarTitle');
  if(!el)return;
  const next=VIEW_LABELS[state.view]||'Dashboard';
  if(el.textContent===next)return;           // skip jika tidak berubah
  el.classList.remove('sidebar-title-in');   // reset animasi
  void el.offsetWidth;                       // reflow trigger
  el.textContent=next;
  el.classList.add('sidebar-title-in');      // jalankan fade-slide masuk
}
const renderers={dashboard:renderDashboard,observe:renderObserve,data:renderData,master:renderMaster,tskk:renderTSKK,validation:renderValidation,rating:renderRating,standard:renderStandard,waste:renderWaste,users:renderUsers};
function setSidebar(open){const shell=$('#appShell'); if(!shell)return; const isOpen=!!open; shell.classList.toggle('sidebar-open',isOpen); const toggle=$('#sidebarToggle'); if(toggle){ toggle.setAttribute('aria-expanded',String(isOpen)); toggle.setAttribute('aria-label',isOpen?'Tutup menu navigasi':'Buka menu navigasi'); }}
function syncNavGroups(){$$('#nav .nav-group').forEach(g=>{const items=g.querySelector('.nav-group-items'),toggle=g.querySelector('.nav-group-toggle');if(!items||!toggle)return;const active=!!g.querySelector('button[data-view].active');g.classList.toggle('open',active);toggle.setAttribute('aria-expanded',String(active));items.setAttribute('aria-hidden',String(!active));});}
function setNavGroup(group,open){if(!group)return;const items=group.querySelector('.nav-group-items'),toggle=group.querySelector('.nav-group-toggle');group.classList.toggle('open',!!open);if(toggle)toggle.setAttribute('aria-expanded',String(!!open));if(items)items.setAttribute('aria-hidden',String(!open));}
function initNavGroups(){$$('#nav .nav-group-toggle').forEach(toggle=>{toggle.onclick=e=>{e.preventDefault();e.stopPropagation();const group=toggle.closest('.nav-group');const open=!group.classList.contains('open');$$('#nav .nav-group').forEach(g=>{if(g!==group)setNavGroup(g,false)});setNavGroup(group,open);};});syncNavGroups();}
function syncProfileUI(){const p=window.tmwaAuth?.getProfile?.()||{};const name=(p.full_name||p.email||'Pengguna').trim();const email=(p.email||'').trim()||'—';const r=String(p.role||window.tmwaAuth?.getRole?.()||'user').trim().toLowerCase();const roleLabel=r==='admin'?'Administrator':r==='analyst'?'Analyst':r==='viewer'?'Viewer':'User';['#profileName','#profileMenuName'].forEach(s=>{const el=$(s);if(el)el.textContent=name});['#profileRole','#profileMenuRole'].forEach(s=>{const el=$(s);if(el)el.textContent=roleLabel});const em=$('#profileMenuEmail');if(em)em.textContent=email;}
initNavGroups();document.addEventListener('tmwa-auth-ready',syncProfileUI);window.addEventListener('load',syncProfileUI);
function render(){activeDraftCapture=null;if(state.view==='uniformity'||state.view==='sufficiency')state.view='validation';if(!renderers[state.view])state.view='dashboard';const active=$(`#nav button[data-view=\"${state.view}\"]`);if(active?.dataset.role==='admin'&&!isAdmin())state.view='dashboard';renderers[state.view]();updateSidebarTitle();$$('#nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));applyRoleUI();syncNavGroups();}
$$('#nav button[data-view]').forEach(b=>b.onclick=()=>{if(b.dataset.role==='admin'&&!isAdmin()){showToast('Menu ini hanya dapat diakses Admin.','warning');return}captureActiveDraft();state.view=b.dataset.view;state.tskkEditor=false;state.tskkDraftId=null;history.replaceState({appView:state.view,tskkEditor:false,tskkId:null},'',location.href);setSidebar(false);render()});
document.body.addEventListener('click',e=>{let b=e.target.closest('[data-go]');if(b){captureActiveDraft();state.view=b.dataset.go;state.tskkEditor=false;state.tskkDraftId=null;history.replaceState({appView:state.view,tskkEditor:false,tskkId:null},'',location.href);setSidebar(false);render()}});
// Preserve the current browser route on reload. This prevents F5/refresh from
// sending the user back to Dashboard when they were on Observation or TSKK.
history.replaceState({...((history.state&&typeof history.state==='object')?history.state:{}),appView:state.view,tskkEditor:state.tskkEditor===true,tskkId:state.tskkDraftId||null},'',location.href);
window.addEventListener('popstate',()=>{
  captureActiveDraft();
  const hs=history.state||{};
  if(state.tskkEditor){
    state.tskkEditor=false;
    // Back from the TSKK editor returns to the TSKK list without creating
    // another history entry, so Chrome/Safari back and the in-app button agree.
    renderTSKK();
    return;
  }
  if(hs.appView){
    state.view=hs.appView;
    state.tskkEditor=hs.appView==='tskk'&&hs.tskkEditor===true;
    render();
  }else{
    state.tskkEditor=false;
    render();
  }
});
$('#sidebarToggle').onclick=()=>setSidebar(!$('#appShell').classList.contains('sidebar-open')); $('#sidebarClose').onclick=()=>setSidebar(false);
$('#sidebarBackdrop').onclick=()=>setSidebar(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape')setSidebar(false)});
$('#exportCsv').onclick=()=>{if(ensureWrite())exportCsv()};
$('#importCsv').onchange=e=>e.target.files[0]&&importCsv(e.target.files[0]);
/* ==========================================================================
   16. Cloud boot, synchronization & application startup
   ========================================================================== */
async function bootCloud(){
  try{
    await hydrateLocalData();
    if(window.tmwaCloud?.enabled){
      if(window.tmwaAuthMiddleware?.waitUntilReady) await window.tmwaAuthMiddleware.waitUntilReady();
      if(window.tmwaAuthMiddleware?.requireSession) await window.tmwaAuthMiddleware.requireSession();
      window.tmwaCloud.onStatus(status=>{
        const x=$('#storageStatus'); if(!x)return;
        const time=new Date().toLocaleTimeString('id-ID');
        if(status==='synced') x.textContent='Cloud synced '+time;
        else if(status==='retrying') x.textContent='Menyambungkan ulang ke cloud…';
        else if(status==='pending') x.textContent='Saved locally • akan disinkronkan otomatis begitu online '+time;
      });
      if(window.tmwaCloud.hasPending()){
        const x=$('#storageStatus'); if(x)x.textContent='Ada data lokal belum tersinkron • mencoba otomatis…';
      }
      const pendingBeforeLoad=window.tmwaCloud.hasPending();
      if(pendingBeforeLoad) await window.tmwaCloud.flushPending();
      const cloud=await window.tmwaCloud.loadState();
      if(cloud){
        if(Array.isArray(cloud.observations)) observations=mergeObservations(cloud.observations,observations);
        const pendingAfterFlush=window.tmwaCloud.hasPending();
        // A pending local snapshot is the newer unsynced state. Never let an
        // older cloud read overwrite local operators/ratings while it waits.
        if(!pendingAfterFlush) settings={...settings,...(cloud.settings||{})};
        normalizeValidationSettings();
        const snapshotBackfilled=backfillRatingSnapshots();
        if(Array.isArray(cloud.master)&&!pendingAfterFlush){safeWrite(MASTER_KEY,cloud.master);idbSet(MASTER_KEY,cloud.master).catch(()=>{});}
        saveLocalOnly();
        if(snapshotBackfilled&&!pendingAfterFlush&&canWrite())
          window.tmwaCloud.saveSnapshot({observations:[...observations],settings:{...settings},master:masterData()}).catch(err=>console.warn('Snapshot RF legacy backfill sync failed:',err));
      }
      window.tmwaCloud.subscribe(async(remote,event)=>{
        if(!remote)return;
        if(Array.isArray(remote.observations)) observations=mergeObservations(remote.observations,observations);
        const pendingRemote=window.tmwaCloud.hasPending();
        if(!pendingRemote) settings={...settings,...(remote.settings||{})};
        normalizeValidationSettings();
        const remoteBackfilled=backfillRatingSnapshots();
        if(Array.isArray(remote.master)&&!pendingRemote){safeWrite(MASTER_KEY,remote.master);idbSet(MASTER_KEY,remote.master).catch(()=>{});}
        if(remoteBackfilled&&!pendingRemote&&canWrite()) window.tmwaCloud.saveSnapshot({observations:[...observations],settings:{...settings},master:masterData()}).catch(err=>console.warn('Realtime RF legacy backfill sync failed:',err));
        saveLocalOnly();

        // Update the visible page only when it is safe. Never rebuild an active
        // form, modal, or video editor because doing so would reset user input.
        const active=document.activeElement;
        const editing=!!document.querySelector('.modal-backdrop')||!!active&&['INPUT','TEXTAREA','SELECT'].includes(active.tagName);
        const inObservation=state.view==='observe';
        const inTSKKEditor=state.view==='tskk'&&state.tskkEditor;
        if(event?.table==='tskk_studies'||event?.table==='tskk_items'){
          if(!inTSKKEditor&&!editing) setTimeout(()=>renderTSKK(),0);
          return;
        }
        if(!editing&&!inObservation) setTimeout(()=>render(),0);
      });
    }
  }catch(err){console.error(err);showToast(err?.code==='AUTH_ACCESS_DENIED'?'Akun belum memiliki akses aktif. Hubungi administrator.':(err?.message||'Backend cloud belum dapat dimuat.'),'error',5000);$('#loginScreen').classList.remove('hidden');$('#appShell').classList.add('hidden');document.body.classList.remove('auth-booting');return;}
  render();
  document.dispatchEvent(new CustomEvent('tmwa-app-ready'));
}
async function saveLocalOnly(){safeWrite(KEY,observations);safeWrite(SETTINGS_KEY,settings);try{await Promise.all([idbSet(KEY,observations),idbSet(SETTINGS_KEY,settings)])}catch(e){console.warn('Local-only save failed:',e)}}
window.addEventListener('beforeunload',()=>captureActiveDraft());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')captureActiveDraft()});
function startAppCloud(){
  // Jika memakai Supabase, jangan load tabel sebelum login berhasil.
  // Pada mode lokal aplikasi dapat langsung berjalan seperti biasa.
  const shell=$('#appShell');
  if(window.tmwaCloud?.enabled && shell?.classList.contains('hidden')){
    document.addEventListener('tmwa-auth-ready',()=>bootCloud(),{once:true});
  }else{
    bootCloud();
  }
}
startAppCloud();


/* ==========================================================================
   17. Profile menu & account actions
   ========================================================================== */
/* PROFILE MENU / ACCOUNT ACTIONS */
/* Profile menu: mobile tap reliability + account actions.
   Kept in its own script so app.js stays untouched. */
(function(){
  var toggle = document.getElementById('profileToggle');
  var menu = document.getElementById('profileMenu');
  if(!toggle || !menu) return;

  function closeMenu(){
    menu.classList.add('hidden');
    toggle.setAttribute('aria-expanded','false');
  }

  toggle.addEventListener('click', function(){
    var isOpen = !menu.classList.contains('hidden');
    menu.classList.toggle('hidden', isOpen);
    toggle.setAttribute('aria-expanded', String(!isOpen));
    if(window.syncProfileUI) window.syncProfileUI();
  });

  /* Close on outside tap (touch devices don't always emit the click app.js listens for). */
  document.addEventListener('pointerdown', function(e){
    if(menu.classList.contains('hidden')) return;
    if(e.target.closest('#profileMenu') || e.target.closest('#profileToggle')) return;
    closeMenu();
  });
  document.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeMenu(); });

  var logoutBtn = document.getElementById('profileLogout');
  if(logoutBtn) logoutBtn.addEventListener('click', function(){
    closeMenu();
    tmwaDialog.confirm('Sesi Anda akan diakhiri dan kembali ke halaman login.',{title:'Keluar dari aplikasi?',confirmText:'Keluar',danger:true}).then(ok=>{if(ok)window.tmwaAuth&&window.tmwaAuth.logout&&window.tmwaAuth.logout()});
  });

  var pwBtn = document.getElementById('profileChangePw');
  if(pwBtn) pwBtn.addEventListener('click', async function(){
    closeMenu();
    var client = window.tmwaAuth && window.tmwaAuth.getClient && window.tmwaAuth.getClient();
    if(!client){
      showToast('Ganti password hanya tersedia saat login memakai akun cloud (Supabase).','warning');
      return;
    }
    var pw = await tmwaDialog.input('Password baru','',{message:'Minimal 6 karakter.',placeholder:'Masukkan password baru',inputType:'password'});
    if(pw === null) return;
    pw = pw.trim();
    if(pw.length < 6){ showToast('Password minimal 6 karakter.','warning'); return; }
    var confirmPw = await tmwaDialog.input('Konfirmasi password','',{message:'Ketik ulang password baru.',placeholder:'Ulangi password baru',inputType:'password'});
    if(confirmPw === null) return;
    if(pw !== confirmPw.trim()){ showToast('Konfirmasi password tidak cocok. Tidak ada perubahan.','warning'); return; }
    try{
      var res = await client.auth.updateUser({ password: pw });
      if(res && res.error) throw new Error(res.error.message);
      showToast('Password berhasil diubah.','success');
    }catch(err){
      showToast('Gagal mengubah password: ' + (err && err.message ? err.message : 'terjadi kesalahan'),'error',5000);
    }
    });
})();

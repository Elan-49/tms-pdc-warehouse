const KEY='tms-pdc-v2-data'; const SETTINGS_KEY='tms-pdc-v2-settings'; const MASTER_KEY='tms-pdc-v2-master';
const IDB_NAME='tms-pdc-warehouse'; const IDB_STORE='kv'; const PENDING_KEY='tms-pdc-pending-observations';
function safeRead(key,fallback){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):fallback}catch(err){console.warn('Local storage read failed:',key,err);return fallback}}
function safeWrite(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true}catch(err){console.warn('Local storage write failed:',key,err);return false}}
function idbOpen(){return new Promise((resolve,reject)=>{try{if(!('indexedDB' in window))return reject(new Error('IndexedDB tidak tersedia'));const req=indexedDB.open(IDB_NAME,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(IDB_STORE))req.result.createObjectStore(IDB_STORE)};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB gagal dibuka'))}catch(e){reject(e)}})}
async function idbGet(key){const db=await idbOpen();return await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,'readonly'),st=tx.objectStore(IDB_STORE),req=st.get(key);req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error||new Error('IndexedDB read gagal'));tx.oncomplete=()=>db.close();tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction gagal'))})}
async function idbSet(key,value){const db=await idbOpen();return await new Promise((resolve,reject)=>{const tx=db.transaction(IDB_STORE,'readwrite'),st=tx.objectStore(IDB_STORE);st.put(value,key);tx.oncomplete=()=>{db.close();resolve(true)};tx.onerror=()=>{const e=tx.error||new Error('IndexedDB write gagal');db.close();reject(e)}})}
function pendingIds(){return new Set(safeRead(PENDING_KEY,[]))}
function rememberPending(ids){const set=pendingIds();ids.forEach(id=>set.add(id));safeWrite(PENDING_KEY,[...set])}
function forgetPending(ids){const set=pendingIds();ids.forEach(id=>set.delete(id));safeWrite(PENDING_KEY,[...set])}
async function hydrateLocalData(){
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
  const pending=pendingIds(); const map=new Map((remote||[]).map(o=>[o.id,o]));
  for(const o of (local||[])){ if(pending.has(o.id)||!map.has(o.id)) map.set(o.id,o); }
  return [...map.values()].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
}
const WASTE_TYPES=['Defects','Overproduction','Waiting','Non-Utilized Talent','Transportation','Inventory','Motion','Extra Processing'];
const CLASSIFICATIONS=['Direct Value-Added','Non-Value-Added','Indirect','Loss'];
function masterData(){const v=safeRead(MASTER_KEY,null);const rows=Array.isArray(v)&&v.length?v:MASTER_DATA;return rows.map(x=>({...x,method:normalizeMasterMethod(x.method),equipment:x.equipment||'-'}));}
function saveMaster(rows){if(!ensureWrite())return false;safeWrite(MASTER_KEY,rows);idbSet(MASTER_KEY,rows).catch(e=>console.warn('Master IndexedDB save failed:',e));if(window.tmsCloud?.enabled)window.tmsCloud.saveSnapshot({observations,settings,master:rows}).catch(console.error);return true;}
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
// Observation cycle/group is the direct source for TSKK. Legacy rows receive a stable one-row cycle id.
observations=observations.map(o=>({...o,observationSessionId:o.observationSessionId||o.observationCycleId||`LEGACY-${o.id}`}));
let settings=safeRead(SETTINGS_KEY,{});
const DEFAULT_OPERATORS=(typeof OPERATORS!=='undefined'&&OPERATORS.length?OPERATORS:['Operator 1']);
settings.allowance ??= 0.1;
settings.confidence ??= 95;
settings.minInitialN ??= 5;
// Barnes sufficiency constants kept fixed to match the study method.
const BARNES_PRECISION = 0.05;
const BARNES_Z = 1.96;
settings.operators ??= [...DEFAULT_OPERATORS];
settings.operatorDepartments ??= {};
settings.ratings ??= {};
settings.operators.forEach(o=>settings.ratings[o]??=1);
settings.westinghouse??={};
settings.operators.forEach(o=>{
  const w=settings.westinghouse[o]||{};
  settings.westinghouse[o]={
    skill:Number.isFinite(+w.skill)?+w.skill:0,
    effort:Number.isFinite(+w.effort)?+w.effort:0,
    condition:Number.isFinite(+w.condition)?+w.condition:0,
    consistency:Number.isFinite(+w.consistency)?+w.consistency:0
  };
});
const initialHistoryState=(history.state&&typeof history.state==='object')?history.state:null;
let state={view:['dashboard','observe','data','master','tskk','quality','uniformity','sufficiency','rating','standard','waste','users'].includes(initialHistoryState?.appView)?initialHistoryState.appView:'dashboard',videoUrl:null,start:null,end:null,manualTime:null,observationMethod:'video',observationSessionId:null,videoFileName:'',tskkEditor:initialHistoryState?.appView==='tskk'&&initialHistoryState?.tskkEditor===true};
let tskkHistoryGuard=false;
let tskkRenderSeq=0;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
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
function role(){const r=window.tmsAuth?.getRole?.();return r==null?null:String(r).trim().toLowerCase()}
function isAdmin(){return role()==='admin'}
function canWrite(){return role()==='admin'||role()==='analyst'}
function canDelete(){return role()==='admin'}
function ensureWrite(){if(!canWrite()){alert('Akses ini hanya tersedia untuk pengguna Analyst atau Admin.');return false}return true}
function ensureAdmin(){if(!isAdmin()){alert('Akses ini hanya tersedia untuk Admin.');return false}return true}
function applyRoleUI(){const r=role();$$('[data-role]').forEach(el=>{const required=el.dataset.role;if(required==='admin'){el.classList.toggle('hidden',r!=='admin');return}el.classList.toggle('hidden',!!r&&required!==r&&!((required==='analyst')&&r==='admin'));});const adminGroup=$('#adminNavGroup')||$('.nav-admin-group');if(adminGroup)adminGroup.classList.toggle('hidden',r!=='admin');const exp=$('#exportCsv'),imp=$('#importCsv');const expWrap=exp,impWrap=imp?.closest('.import-btn');[expWrap,impWrap].forEach(el=>{if(el)el.classList.toggle('hidden',!canWrite())});}
function operatorList(){return [...new Set(settings.operators.filter(Boolean).map(x=>String(x).trim()).filter(x=>!x.startsWith('Kalau menambah operator baru:')))]}
function westinghouseFactor(r){return 1+(+r.skill||0)+(+r.effort||0)+(+r.condition||0)+(+r.consistency||0)}
function save(){
  // Local storage is the immediate commit path. Cloud sync must never block a
  // button click or navigation: Supabase can take seconds on a cold connection.
  const okObs=safeWrite(KEY,observations);
  const okSettings=safeWrite(SETTINGS_KEY,settings);
  if(!okObs||!okSettings){
    alert('Data lokal tidak dapat disimpan oleh browser ini. Buka aplikasi melalui localhost (bukan file://) agar penyimpanan lokal stabil.');
    return false;
  }
  // Keep IndexedDB as a secondary local cache, but never make the UI wait for it.
  Promise.all([idbSet(KEY,observations),idbSet(SETTINGS_KEY,settings)]).catch(err=>console.warn('IndexedDB local save failed:',err));
  const verify=safeRead(KEY,null);
  if(!Array.isArray(verify)||verify.length<observations.length){
    alert('Penyimpanan lokal tidak terverifikasi. Data belum dianggap tersimpan. Gunakan localhost untuk pengujian lokal.');
    return false;
  }
  const x=$('#storageStatus');if(x)x.textContent=(window.tmsCloud?.enabled?'Saved locally • syncing cloud…':'Auto-saved ')+new Date().toLocaleTimeString('id-ID');
  if(window.tmsCloud?.enabled && canWrite()){
    const snapshot={observations:[...observations],settings:{...settings},master:masterData()};
    window.tmsCloud.saveSnapshot(snapshot).then(cloudOk=>{
      const el=$('#storageStatus');
      if(el)el.textContent=(cloudOk?'Cloud synced ':'Saved locally • cloud retry pending ')+new Date().toLocaleTimeString('id-ID');
    }).catch(err=>console.warn('Cloud sync queued failed:',err));
  }
  return true;
}
function fmt(n){return Number(n||0).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtFreq(n){return Number(n||0).toLocaleString('id-ID',{minimumFractionDigits:0,maximumFractionDigits:0})}
// Universal display rule for duration values. Data is still stored/calculated in seconds,
// but every user-facing duration automatically switches to minutes at 60 seconds.
function timeUnitFor(seconds){const n=Math.abs(Number(seconds)||0);return n>=60?{label:'menit',divisor:60}:{label:'dtk',divisor:1}}
function fmtTimeValue(seconds){const n=Number(seconds);if(!Number.isFinite(n))return '—';const u=timeUnitFor(n);return `${fmt(n/u.divisor)} ${u.label}`}
function fmtTimeNumber(seconds){const n=Number(seconds);if(!Number.isFinite(n))return '—';const u=timeUnitFor(n);return fmt(n/u.divisor)}
function fmtTimeUnitLabel(seconds){return timeUnitFor(seconds).label}
function t(sec){if(sec==null||!isFinite(sec))return '—';sec=Math.max(0,Math.round(sec*100)/100);let h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),whole=Math.floor(sec%60),cs=Math.round((sec-Math.floor(sec))*100);if(cs===100){whole++;cs=0}if(whole===60){whole=0;m++}if(m===60){m=0;h++}return `${h?String(h).padStart(2,'0')+':':''}${String(m).padStart(2,'0')}:${String(whole).padStart(2,'0')}.${String(cs).padStart(2,'0')}`}
function unique(a){return [...new Set(a)]}
function opt(list,placeholder='Pilih...'){return `<option value="">${placeholder}</option>`+list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}
function observedElements(){return new Set(observations.map(x=>x.element)).size}
function grouped(category=false){const map={};observations.forEach(o=>{let k=category?o.element+'|'+o.size:o.element;(map[k]??=[]).push(o)});return Object.entries(map).map(([key,rows])=>({key,element:rows[0].element,size:category?rows[0].size:'Pooled',rows}));}
function stats(rows){const x=rows.map(r=>+r.time).filter(Number.isFinite),n=x.length;if(!n)return {n:0};const mean=x.reduce((a,b)=>a+b,0)/n;const variance=n>1?x.reduce((a,b)=>a+(b-mean)**2,0)/(n-1):0;const sd=Math.sqrt(variance);const ucl=mean+3*sd,lcl=Math.max(0,mean-3*sd);const out=x.filter(v=>v>ucl||v<lcl).length; const required=n>1&&mean>0?Math.ceil((BARNES_Z*sd/(BARNES_PRECISION*mean))**2):null; const uniform=n>=2&&out===0; const testable=n>=settings.minInitialN; const sufficient=testable&&required!=null&&n>=required; return {n,mean,sd,ucl,lcl,out,uniform,testable,required,sufficient};}
function effectiveRows(g){const s=stats(g.rows);return g.rows.filter(r=>+r.time<=s.ucl&&+r.time>=s.lcl)}
function standardFor(element,size){const cat=grouped(true).find(g=>g.element===element&&g.size===size);const pool=grouped(false).find(g=>g.element===element);let source='Pooled fallback',g=pool;if(cat&&stats(cat.rows).sufficient&&stats(cat.rows).uniform){source='Category specific';g=cat}if(!g)return null;let st=stats(effectiveRows(g));if(!st.n)return null;let rfAvg=g.rows.reduce((a,r)=>a+(+settings.ratings[r.operator]||1),0)/g.rows.length;let normal=st.mean*rfAvg;let standard=normal/(1-(+settings.allowance||0));return {source,mean:st.mean,rf:rfAvg,normal,standard,n:st.n,stats:st};}
function setHeader(title,eyebrow='TIME & MOTION STUDY'){$('#pageTitle').textContent=title;$('#pageEyebrow').textContent=eyebrow;}
function kpi(label,value,sub=''){return `<div class="card kpi"><div class="kpi-content"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div></div>`}
function dashboardRows(filter={}){
  const match=m=>(!filter.process||m.process===filter.process)&&(!filter.activity||m.activity===filter.activity)&&(!filter.element||m.element===filter.element);
  const sizes=filter.size?[filter.size]:['Small','Medium','Big'];
  const rows=[];
  masterData().filter(match).forEach(m=>sizes.forEach(size=>{
    const r=standardFor(m.element,size);
    if(r) rows.push({...m,size,...r});
  }));
  return rows;
}
function priority(p){return p>=30?'Critical':p>=20?'High':p>=10?'Medium':p>0?'Low':'—'}
function dashboardPie(classNames, cls, total){
  const safeTotal=Number(total)||0;
  if(!(safeTotal>0))return `<div class="chart-empty">Belum ada standard time yang dapat divisualisasikan.</div>`;
  const colors=['#f7c600','#102a43','#263238','#b8860b'];
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
  const max=top[0].time||1; let cum=0;
  return `<div class="pareto-chart"><div class="pareto-scale"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="pareto-bars">${top.map((x,i)=>{cum+=x.contribution;const h=Math.max(6,x.time/max*100);return `<div class="pareto-item"><div class="pareto-bar-wrap"><div class="pareto-bar" style="height:${h}%"><b>${fmtTimeValue(x.time)}</b></div><span class="pareto-dot" style="bottom:${Math.min(100,cum)}%"><i></i><em>${fmt(cum)}%</em></span></div><small title="${esc(x.element)}">${i+1}. ${esc(x.waste)}</small></div>`}).join('')}</div></div>`;
}
function renderDashboard(){
  setHeader('Dashboard','TMS PDC WAREHOUSE • LEAN TIME & MOTION');
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
    const classNames=['Direct Value-Added','Non-Value-Added','Indirect','Loss'], cls=Object.fromEntries(classNames.map(c=>[c,0]));
    rows.forEach(x=>{const c=classNames.find(c=>String(x.classification||'').toLowerCase()===c.toLowerCase())||'Loss';cls[c]+=x.standard});
    const classTotal=Object.values(cls).reduce((a,b)=>a+b,0);
    const wasteRows=rows.filter(x=>x.waste&&x.waste!=='-'&&String(x.classification).toLowerCase()!=='direct value-added').map(x=>({element:x.element,waste:x.waste,time:x.standard}));
    const wasteTotal=wasteRows.reduce((a,x)=>a+x.time,0);
    const top=[...wasteRows].sort((a,b)=>b.time-a.time).slice(0,5).map((x,i)=>({...x,rank:i+1,contribution:wasteTotal?x.time/wasteTotal*100:0})); const largest=top[0];
    $('#dashResults').innerHTML=`
      <div class="grid cols-4 dashboard-kpis">${kpi('NORMAL TIME',fmtTimeValue(normal),'Hasil agregasi filter aktif')}${kpi('STANDARD TIME',fmtTimeValue(standard),`Allowance ${fmt(settings.allowance*100)}% applied`)}${kpi('TOTAL WASTE',fmtTimeValue(wasteTotal),'Waste dengan waktu terukur')}${kpi('WASTE TERBESAR',largest?largest.waste:'Tidak ada data waste',largest?`${fmtTimeValue(largest.time)} • ${fmt(largest.contribution)}% kontribusi`:'Tambahkan observasi untuk menghitung')}</div>
      <div class="grid cols-2 section">
        <div class="card chart-card"><h3>TIME CLASSIFICATION</h3>${dashboardPie(classNames,cls,classTotal)}<div class="table-wrap compact-table"><table class="data-table"><thead><tr><th>Klasifikasi</th><th>Waktu</th><th>%</th></tr></thead><tbody>${classNames.map(c=>`<tr><td>${c}</td><td>${fmtTimeValue(cls[c])}</td><td>${fmt(classTotal?cls[c]/classTotal*100:0)}%</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card chart-card pareto-card"><h3>PARETO • TOP 5 WASTE</h3>${dashboardPareto(top)}<p class="chart-note">Batang menunjukkan waste time. Garis kumulatif menunjukkan kontribusi terhadap total waste pada filter aktif.</p><div class="pareto-table-block"><h3 class="subtable-title">TOP 5 LEAN / WASTE</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Element Kerja / Area</th><th>Jenis Waste</th><th>Waste Time</th><th>Kontribusi</th><th>Prioritas</th></tr></thead><tbody>${top.length?top.map(x=>`<tr><td><b>${x.rank}</b></td><td>${esc(x.element)}</td><td>${esc(x.waste)}</td><td>${fmtTimeValue(x.time)}</td><td>${fmt(x.contribution)}%</td><td><span class="badge ${x.contribution>=30?'bad':x.contribution>=20?'warn':'ok'}">${priority(x.contribution)}</span></td></tr>`).join(''):Array.from({length:5},(_,i)=>`<tr><td>${i+1}</td><td>Tidak ada data waste</td><td>-</td><td>0,00</td><td>0,0%</td><td>-</td></tr>`).join('')}</tbody></table></div></div></div>
      </div>
      <div class="card section"><h3>TOP 5 IMPROVEMENT PRIORITY</h3><p class="muted">Urutan berdasarkan kontribusi waste terhadap total waste pada filter aktif.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Element Kerja / Area</th><th>Jenis Waste</th><th>Waste Time</th><th>Kontribusi</th><th>Prioritas</th></tr></thead><tbody>${top.length?top.map(x=>`<tr><td><b>${x.rank}</b></td><td>${esc(x.element)}</td><td>${esc(x.waste)}</td><td>${fmtTimeValue(x.time)}</td><td>${fmt(x.contribution)}%</td><td><b>${priority(x.contribution)}</b></td></tr>`).join(''):Array.from({length:5},(_,i)=>`<tr><td>${i+1}</td><td>Tidak ada data waste</td><td>-</td><td>0,00</td><td>0,0%</td><td>-</td></tr>`).join('')}</tbody></table></div></div>`;
  };
  renderActivity();renderElement();renderResults();
  $('#dashProcess').onchange=e=>{f.process=e.target.value;f.activity='';f.element='';renderActivity();renderElement();renderResults()}; $('#dashActivity').onchange=e=>{f.activity=e.target.value;f.element='';renderElement();renderResults()}; $('#dashElement').onchange=e=>{f.element=e.target.value;renderResults()}; $('#dashSize').onchange=e=>{f.size=e.target.value;renderResults()}; $('#resetDashFilter').onclick=()=>{f.process=f.activity=f.element=f.size='';$('#dashProcess').value='';renderActivity();renderElement();$('#dashSize').value='';renderResults()};
}
function ensureObservationSession(){if(!state.observationSessionId)state.observationSessionId=newId();return state.observationSessionId}
function observationSessionLabel(id, fallbackDate=''){const raw=String(id||'');if(raw.startsWith('LEGACY-'))return 'Legacy Observation';const date=(fallbackDate||'').replaceAll('-','');return `OBS-${date?date.slice(0,8)+'-':''}${raw.slice(0,8).toUpperCase()}`}
function observationSessions(){
  const map=new Map();
  observations.forEach(o=>{const id=o.observationSessionId||o.observationCycleId||`LEGACY-${o.id}`;if(!map.has(id))map.set(id,[]);map.get(id).push(o)});
  return [...map.entries()].map(([id,rows])=>{
    rows.sort((a,b)=>(a.start??a.createdAt??0)-(b.start??b.createdAt??0)||(a.createdAt??0)-(b.createdAt??0));
    const first=rows[0]||{};
    const method=rows.some(r=>r.observationMethod==='video'||r.start!=null||r.end!=null)?'video':'manual';
    return {id,rows,method,date:first.date||'',process:first.process||'',activity:first.activity||'',operator:first.operator||'',size:first.size||'',count:rows.length,createdAt:Math.min(...rows.map(r=>r.createdAt||Date.now())),label:observationSessionLabel(id,first.date)};
  }).sort((a,b)=>b.createdAt-a.createdAt);
}

function renderObserve(){
  setHeader('Observation','RAW DATA CAPTURE');
  $('#app').innerHTML=`<div class="content"><div class="workspace"><div class="card video-card"><div class="video-card-head"><h3 id="observationInputTitle">1. Observation Input</h3><button class="video-close hidden" id="removeVideo" type="button" title="Tutup video ini" aria-label="Tutup video ini">×</button></div><div class="observation-method-switch" role="group" aria-label="Metode observasi"><button type="button" class="method-choice active" id="methodVideo">Video</button><button type="button" class="method-choice" id="methodManual">Manual</button></div><div id="videoObservationPanel"><label class="dropzone">Pilih video pengamatan<small>Video tetap lokal di browser. File tidak di-upload ke server.</small><input id="videoInput" type="file" accept="video/*" hidden></label><div class="video-stage"><div class="video-wrap video-pending" id="videoWrap"><video id="video" controls playsinline preload="metadata"></video><div id="emptyVideo" class="video-empty"><div><strong>Belum ada video</strong><span>Pilih file video untuk memulai observasi</span></div></div></div><div class="seek-panel" id="seekPanel"><div class="seek-meta"><span id="seekCurrent">00:00.00</span><span id="seekDuration">00:00.00</span></div><input id="videoSeek" class="video-seek" type="range" min="0" max="0" value="0" step="0.01" aria-label="Geser posisi video"><div class="seek-caption"><span>Tarik garis waktu untuk maju atau mundur ke posisi yang diinginkan</span></div></div><div class="video-tools"><button class="video-skip" id="back5" type="button" title="Mundur 5 detik">↶ Mundur 5 Detik</button><button class="video-skip" id="forward5" type="button" title="Maju 5 detik">Maju 5 Detik ↷</button><button class="video-skip" id="fullVideo" type="button" title="Layar penuh">⛶ Fullscreen</button></div></div></div><div class="time-grid"><div class="timebox"><span>Current</span><b id="cur">—</b></div><div class="timebox"><span>Start</span><b id="start">—</b></div><div class="timebox"><span>End</span><b id="end">—</b></div><div class="timebox"><span>Observed</span><b id="elapsed">—</b></div><div class="timebox"><span>Duration</span><b id="dur">—</b></div></div><div class="seg-controls" id="videoSegmentControls"><button class="btn ghost plain-segment-btn" id="setStart"><span class="start-play-icon" aria-hidden="true"></span><span>Set Start</span></button><button class="btn ghost plain-segment-btn" id="setEnd"><span class="end-stop-icon" aria-hidden="true"></span><span>Set End</span></button><button class="btn ghost" id="resetSeg">Reset</button></div><div class="manual-time card-lite hidden" id="manualObservationPanel"><div class="manual-time-head"><b>Input Cycle Time Manual</b><span>Masukkan satu Cycle Time untuk satu Observation. Manual tidak memakai Start/End.</span></div><div class="manual-time-grid manual-single"><label>Total Waktu Pengamatan<div class="time-input-row"><input id="manualObservedTime" type="number" min="0.01" step="0.01" placeholder="Contoh: 8,47"><select id="manualObservedUnit"><option value="sec">dtk</option><option value="min">menit</option></select><button class="btn primary manual-apply-inline" id="applyManualTime" type="button">Terapkan</button></div><small class="input-help">Nilai disimpan otomatis ke detik; satuan dapat dipilih sesuai input.</small></label></div></div></div><div class="card classify-card"><h3>2. Classify Observation</h3><div class="form-grid classify-top-grid"><label>Date<input id="date" type="date"></label><label>PIC<select id="operator">${opt(operatorList())}</select></label><label>Size<select id="size"><option>Small</option><option>Medium</option><option>Big</option></select></label></div><div class="form-grid classify-process-grid"><label>Process<select id="process">${opt(unique(masterData().map(x=>x.process)))}</select></label></div><div class="form-grid classify-activity-grid"><label>Activity<select id="activity"><option value="">Pilih Process dahulu</option></select></label></div><div class="form-grid classify-element-grid"><label>Element Kerja<select id="element"><option value="">Pilih Activity dahulu</option></select></label></div><div class="observation-cycle-banner"><div><span>Observation Aktif</span><b id="observationSessionId">Belum ada observation</b><small>Satu Observation dapat berasal dari <b>satu video</b> (detail element) atau <b>satu input manual</b> (satu cycle time).</small></div></div><div class="master-preview"><div><span>Classification</span><b id="classification">—</b></div><div><span>Waste</span><b id="waste">—</b></div><div><span>Method</span><b id="method">—</b></div><div><span>Equipment</span><b id="equipment">—</b></div></div><label>Catatan<textarea id="note" rows="3"></textarea></label><div class="observation-save-action"><button class="btn primary full" id="saveObs">＋ Simpan Observasi</button></div></div></div></div>`;
  $('#date').value=new Date().toISOString().slice(0,10);
  $('#observationSessionId').textContent=state.observationSessionId?observationSessionLabel(state.observationSessionId,$('#date').value):'Belum ada video';
  wireObserve();
  $('#methodVideo').onclick=()=>setObserveMethodUI('video');
  $('#methodManual').onclick=()=>setObserveMethodUI('manual');
  function setObserveMethodUI(method){
    state.observationMethod=method==='manual'?'manual':'video';
    const isManual=state.observationMethod==='manual';
    $('#methodVideo')?.classList.toggle('active',!isManual); $('#methodManual')?.classList.toggle('active',isManual);
    $('#videoObservationPanel')?.classList.toggle('hidden',isManual); $('#manualObservationPanel')?.classList.toggle('hidden',!isManual); $('#videoSegmentControls')?.classList.toggle('hidden',isManual);
    if($('#observationInputTitle'))$('#observationInputTitle').textContent=isManual?'1. Manual Observation':'1. Video Observation';
    if(isManual){state.start=null;state.end=null;refreshObservationDisplay();}
  }
  function refreshObservationDisplay(){const el=$('#elapsed');if(el)el.textContent=state.manualTime!=null?fmtTimeValue(state.manualTime):'—';}
  if(!canWrite()){
    ['videoInput','setStart','setEnd','resetSeg','applyManualTime','saveObs','note','date','operator','size','process','activity','element','manualObservedTime','manualObservedUnit','fullVideo','back5','forward5','removeVideo','videoSeek'].forEach(id=>{const el=$('#'+id);if(el)el.disabled=true;});
    const saveWrap=$('.observation-save-action'); if(saveWrap) saveWrap.classList.add('hidden');
    const dz=document.querySelector('.dropzone'); if(dz) dz.classList.add('hidden');
    const c=document.createElement('div'); c.className='analysis-note'; c.innerHTML='<b>Mode View Only.</b> Akun Viewer dapat melihat analisis, tetapi tidak dapat menambah atau mengubah data.'; $('#app .content')?.prepend(c);
  }
}
function wireObserve(){
  const video=$('#video'), wrap=$('#videoWrap'), seek=$('#videoSeek');
  let seeking=false;
  const hasVideo=()=>!!video.src;
  const setObservationMethod=(method)=>{
    state.observationMethod=method==='manual'?'manual':'video';
    const isManual=state.observationMethod==='manual';
    $('#methodVideo')?.classList.toggle('active',!isManual);
    $('#methodManual')?.classList.toggle('active',isManual);
    $('#videoObservationPanel')?.classList.toggle('hidden',isManual);
    $('#manualObservationPanel')?.classList.toggle('hidden',!isManual);
    $('#videoSegmentControls')?.classList.toggle('hidden',isManual);
    if($('#observationInputTitle'))$('#observationInputTitle').textContent=isManual?'1. Manual Observation':'1. Video Observation';
    if($('#observationSessionId')&&!state.observationSessionId)$('#observationSessionId').textContent=isManual?'Belum ada observation':'Belum ada video';
    if(isManual){state.start=null;state.end=null;refreshTimes?.();}
  };
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
  const clearSegment=()=>{state.start=state.end=state.manualTime=null;$('#manualObservedTime').value='';refreshTimes();};
  const applyManual=()=>{const observed=Number($('#manualObservedTime').value);if(!Number.isFinite(observed)||observed<=0){alert('Isi Total Waktu Pengamatan dengan angka lebih dari 0.');return false}state.manualTime=+parseTimeInput(observed,$('#manualObservedUnit')?.value||'sec').toFixed(2);state.start=null;state.end=null;refreshTimes();return true};
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
    if($('#observationSessionId'))$('#observationSessionId').textContent=observationSessionLabel(state.observationSessionId,$('#date').value);
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
  };
  $('#back5').onclick=()=>seekBy(-5);
  $('#forward5').onclick=()=>seekBy(5);
  $('#fullVideo').onclick=async()=>{
    if(!hasVideo())return alert('Pilih video terlebih dahulu.');
    try{if(video.requestFullscreen)await video.requestFullscreen();else if(wrap.requestFullscreen)await wrap.requestFullscreen();else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();}catch(e){console.warn(e);}
  };
  $('#removeVideo').onclick=()=>{if(confirm('Tutup video ini? Video tidak akan menghapus data observasi yang sudah disimpan.'))removeVideo();};
  $('#videoInput').onchange=e=>loadVideoFile(e.target.files[0]);
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
  $('#setStart').onclick=()=>{if(state.observationMethod==='manual')return;if(!hasVideo()){alert('Pilih video terlebih dahulu.');return}state.start=+video.currentTime.toFixed(2);state.end=null;state.manualTime=null;$('#manualObservedTime').value='';refreshTimes();video.play().catch(()=>{})};
  $('#setEnd').onclick=()=>{if(state.observationMethod==='manual')return;if(!hasVideo()){alert('Pilih video terlebih dahulu.');return}video.pause();state.end=+video.currentTime.toFixed(2);state.manualTime=null;if(state.start!=null&&state.end<state.start){alert('End harus lebih besar dari Start');state.end=null;return}refreshTimes()};
  $('#applyManualTime').onclick=applyManual;
  $('#resetSeg').onclick=clearSegment;
  $('#process').onchange=e=>{let arr=unique(masterData().filter(x=>x.process===e.target.value).map(x=>x.activity));$('#activity').innerHTML=opt(arr);$('#element').innerHTML='<option value="">Pilih Activity dahulu</option>';updateMaster()};
  $('#activity').onchange=e=>{let arr=masterData().filter(x=>x.process===$('#process').value&&x.activity===e.target.value).map(x=>x.element);$('#element').innerHTML=opt(arr);updateMaster()};
  $('#element').onchange=updateMaster;
  function updateMaster(){let m=getMaster($('#element').value);for(const [id,k] of [['classification','classification'],['waste','waste'],['method','method'],['equipment','equipment']])$('#'+id).textContent=m?m[k]:'—'}
  $('#saveObs').onclick=async()=>{
    try{
      let element=$('#element').value;
      if(state.manualTime==null&&state.start!=null&&state.end!=null)state.manualTime=+(state.end-state.start).toFixed(2);
      if(state.manualTime==null&&$('#manualObservedTime').value!=='')applyManual();
      if(state.manualTime==null||!element||!$('#operator').value){alert('Lengkapi PIC, Element Kerja, dan Cycle Time / waktu observasi.');return}
      let m=getMaster(element);
      if(!m){alert('Element Kerja tidak ditemukan di Master Data. Pilih Element dari daftar Master terlebih dahulu.');return}
      const sessionId=ensureObservationSession();
      const savedId=newId();
      observations.push({id:savedId,observationSessionId:sessionId,observationCycleId:sessionId,observationMethod:state.observationMethod,date:$('#date').value,study:'',operator:$('#operator').value,process:m.process,activity:m.activity,element,size:$('#size').value,start:state.start==null?null:+state.start.toFixed(2),end:state.end==null?null:+state.end.toFixed(2),time:+state.manualTime.toFixed(2),classification:m.classification,waste:m.waste,method:m.method,equipment:m.equipment,note:$('#note').value,createdAt:Date.now()});
      rememberPending([savedId]); if(!(await save())){observations=observations.filter(o=>o.id!==savedId);forgetPending([savedId]);return;}
      clearSegment();
      $('#note').value='';
      alert('Observasi berhasil disimpan. Video tetap aktif dan siap digunakan untuk observasi berikutnya.');
    }catch(err){
      console.error('Save Observation failed:',err);
      alert('Observasi gagal disimpan: '+(err?.message||String(err)));
    }
  };
}
function renderData(){setHeader('Data Waktu','RAW OBSERVATION MANAGEMENT');let proc=unique(masterData().map(x=>x.process));$('#app').innerHTML=`<div class="content"><div class="card"><div class="filters"><select id="fProc">${opt(proc,'All Process')}</select><select id="fSize"><option value="">All Size</option><option>Small</option><option>Medium</option><option>Big</option></select><input id="search" placeholder="Search element / PIC"></div><div id="dataTable"></div></div></div>`;function draw(){let rows=[...observations].filter(o=>(!$('#fProc').value||o.process===$('#fProc').value)&&(!$('#fSize').value||o.size===$('#fSize').value)&&(`${o.element} ${o.operator}`.toLowerCase().includes($('#search').value.toLowerCase()))).sort((a,b)=>b.createdAt-a.createdAt);$('#dataTable').innerHTML=rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>No</th><th>Date</th><th>PIC</th><th>Process</th><th>Activity</th><th>Element</th><th>Size</th><th>Start</th><th>End</th><th>Time</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r.date}</td><td>${esc(r.operator)}</td><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${r.size}</td><td>${t(r.start)}</td><td>${t(r.end)}</td><td><b>${fmtTimeValue(r.time)}</b></td><td>${canWrite()?`<button class="btn ghost editObs" data-id="${r.id}">Edit</button>`:''} ${canDelete()?`<button class="btn ghost del" data-id="${r.id}">Hapus</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Tidak ada data yang sesuai filter.</div>';$$('.del').forEach(b=>b.onclick=async()=>{const id=b.dataset.id;if(!confirm('Hapus observasi ini?'))return;try{if(window.tmsCloud?.enabled)await window.tmsCloud.deleteObservation(id);observations=observations.filter(o=>o.id!==id);saveLocalOnly();draw()}catch(err){console.error(err);alert('Observasi gagal dihapus dari cloud: '+(err.message||err));}});$$('.editObs').forEach(b=>b.onclick=()=>{const o=observations.find(x=>x.id===b.dataset.id);if(!o)return;const nt=prompt(`Observed Time (${fmtTimeUnitLabel(o.time)})`,fmtTimeNumber(o.time));if(nt==null)return;const ns=prompt('Kategori Ukuran: Small / Medium / Big',o.size);if(ns==null)return;o.time=+nt||o.time;o.size=['Small','Medium','Big'].includes(ns)?ns:o.size;save();draw()})}['fProc','fSize','search'].forEach(id=>$('#'+id).oninput=draw);draw();}
function renderQuality(){setHeader('Data Quality','COVERAGE & VALIDATION');const gs=grouped(false);const rows=masterData().map(m=>{let g=gs.find(x=>x.element===m.element),s=g?stats(g.rows):{n:0};return {...m,n:s.n,status:s.n===0?'Not observed':s.n<2?'Need more data':'Observed'}});$('#app').innerHTML=`<div class="content"><div class="grid cols-4">${kpi('Master Elements',masterData().length,'From Peta Proses')}${kpi('Observed Elements',observedElements(),`${fmt(observedElements()/masterData().length*100)}% coverage`)}${kpi('Total Raw Data',observations.length,'Saved observations')}${kpi('Invalid Duration',observations.filter(x=>!x.time||x.time<=0).length,'Must be zero')}</div><div class="card section"><h3>Master Coverage</h3><div class="analysis-note">Element yang belum pernah diobservasi tidak dihitung sebagai “insufficient”. Coverage dan sufficiency sengaja dipisahkan.</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Activity</th><th>Element</th><th>Classification</th><th>N</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${esc(r.classification)}</td><td>${r.n}</td><td><span class="badge ${r.status==='Observed'?'ok':'warn'}">${r.status}</span></td></tr>`).join('')}</tbody></table></div></div></div>`}
function analysisTable(kind){const cat=kind==='category',groups=grouped(cat);const cols=cat?'<th>Size</th>':'';let body=groups.map(g=>{let s=stats(g.rows),uniform=s.n<2?'Not testable':s.uniform?'Uniform':'Outlier detected';return `<tr><td>${esc(g.element)}</td>${cat?'<td>'+g.size+'</td>':''}<td>${s.n}</td><td>${fmtTimeValue(s.mean)}</td><td>${fmtTimeValue(s.sd)}</td><td>${fmtTimeValue(s.ucl)}</td><td>${fmtTimeValue(s.lcl)}</td><td>${s.out}</td><td><span class="badge ${s.uniform?'ok':s.n<2?'warn':'bad'}">${uniform}</span></td><td>${s.required??'—'}</td><td><span class="badge ${s.sufficient?'ok':s.n<2?'warn':'warn'}">${s.sufficient?'Sufficient':s.n<2?'Not testable':'Need data'}</span></td></tr>`}).join('');return `<div class="table-wrap"><table class="data-table stat-table"><thead><tr><th>Element</th>${cols}<th>N</th><th>Mean</th><th>SD</th><th>UCL</th><th>LCL</th><th>Out</th><th>Uniformity</th><th>N' Required</th><th>Sufficiency</th></tr></thead><tbody>${body||'<tr><td colspan="12">No observations yet.</td></tr>'}</tbody></table></div>`}
function renderUniformity(){setHeader('Uji Keseragaman','3-SIGMA CONTROL LIMIT');$('#app').innerHTML=`<div class="content"><div class="analysis-note">Pooled analysis mengikuti seluruh kategori ukuran untuk setiap Element Kerja. Data di luar UCL/LCL ditandai sebagai outlier.</div><div class="card"><h3>Pooled per Element</h3>${analysisTable('pooled')}</div><div class="card section"><h3>Element × Category</h3>${analysisTable('category')}</div></div>`}
function renderSufficiency(){setHeader('Uji Kecukupan','SAMPLE SUFFICIENCY');const groups=grouped(true);$('#app').innerHTML=`<div class="content"><div class="analysis-note"><b>N Minimum Observasi Awal = ${settings.minInitialN} observasi.</b> Jika N aktual masih di bawah nilai ini, statusnya <b>Belum Dapat Diuji</b> dan belum dapat disimpulkan cukup/belum cukup.</div><div class="card"><h3>Element × Category</h3>${analysisTable('category')}</div><div class="card section"><h3>Pooled per Element</h3>${analysisTable('pooled')}</div></div>`}
function renderRating(){
  settings.westinghouse??={}; settings.operatorDepartments??={}; settings.ratings??={}; settings.operators??=[];
  setHeader('Rating Factor','WESTINGHOUSE • PER PIC');
  const skill=[['A1','+0.15'],['A2','+0.13'],['B1','+0.11'],['B2','+0.08'],['C1','+0.06'],['C2','+0.03'],['D','0.00'],['E1','-0.05'],['E2','-0.10'],['F1','-0.16'],['F2','-0.22']];
  const effort=[['A1','+0.13'],['A2','+0.12'],['B1','+0.10'],['B2','+0.08'],['C1','+0.05'],['C2','+0.02'],['D','0.00'],['E1','-0.04'],['E2','-0.08'],['F1','-0.12'],['F2','-0.17']];
  const condition=[['A','+0.06'],['B','+0.04'],['C','+0.02'],['D','0.00'],['E','-0.03'],['F','-0.07']];
  const consistency=[['A','+0.04'],['B','+0.03'],['C','+0.01'],['D','0.00'],['E','-0.02'],['F','-0.04']];
  const activities=unique(masterData().map(x=>x.activity).filter(Boolean));
  const grade=(list,value=0)=>{const target=Number.isFinite(+value)?(+value).toFixed(2):'0.00';return `<select class="grade">${list.map(([k,v])=>`<option value="${v}" ${(+v).toFixed(2)===target?'selected':''}>${k} (${v})</option>`).join('')}</select>`};
  const defaultWestinghouse=()=>({skill:0,effort:0,condition:0,consistency:0});
  const captureRatingDraft=()=>{
    settings.westinghouse??={}; settings.operatorDepartments??={}; settings.ratings??={};
    if(!canWrite()){ $('#addOperator').classList.add('hidden'); $('#saveSettings').classList.add('hidden'); $('#minInitialN').disabled=true; $('#allowance').disabled=true; }
  $$('#app tr[data-pic]').forEach(tr=>{
      const pic=tr.dataset.pic, values=$$('.grade',tr).map(x=>+x.value||0);
      settings.operatorDepartments[pic]=tr.querySelector('.pic-dept')?.value||'';
      settings.westinghouse[pic]={skill:values[0]||0,effort:values[1]||0,condition:values[2]||0,consistency:values[3]||0};
      settings.ratings[pic]=westinghouseFactor(settings.westinghouse[pic]);
    });
  };
  const refTable=(title,list)=>`<div class="card section"><h3>${title}</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Grade</th><th>Adjustment</th></tr></thead><tbody>${list.map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#app').innerHTML=`<div class="content">
    <div class="analysis-note"><b>N Minimum Observasi Awal</b> adalah jumlah minimum observasi aktual (N) yang harus tersedia sebelum data dievaluasi pada Uji Kecukupan. Jika N masih di bawah batas ini, statusnya <b>Belum Dapat Diuji</b>.</div>
    <div class="card section"><div class="form-grid two-equal"><label>N Minimum Observasi Awal (N)<input id="minInitialN" type="number" min="2" step="1" value="${settings.minInitialN}"><small>Minimum jumlah observasi sebelum evaluasi kecukupan</small></label><label>Allowance (%)<input id="allowance" type="number" min="0" max="90" step="0.1" value="${settings.allowance*100}"><small>Allowance untuk perhitungan Standard Time</small></label></div></div>
    <div class="card section"><div class="section-head rating-head"><div><h3>WESTINGHOUSE • PER PIC</h3><p class="muted">RF = 1 + Skill + Effort + Condition + Consistency. Perubahan diterapkan ke Normal Time dan Standard Time.</p></div><div class="add-pic-form"><input id="newOperator" placeholder="Nama"><select id="newOperatorDept">${opt(activities,'Pilih Bagian / Activity')}</select><button id="addOperator" class="btn secondary">＋ Tambah PIC</button></div></div>
    <div class="table-wrap rating-table-wrap"><table class="data-table rating-table"><thead><tr><th>PIC</th><th>Bagian / Activity</th><th>Skill</th><th>Effort</th><th>Condition</th><th>Consistency</th><th>Rating Factor</th><th>Aksi</th></tr></thead><tbody>${operatorList().map(o=>{const w=settings.westinghouse?.[o]||defaultWestinghouse();const dept=settings.operatorDepartments?.[o]||'';return `<tr data-pic="${esc(o)}"><td><b>${esc(o)}</b></td><td><select class="pic-dept">${opt(activities,'Pilih Bagian / Activity')}</select></td><td>${grade(skill,w.skill)}</td><td>${grade(effort,w.effort)}</td><td>${grade(condition,w.condition)}</td><td>${grade(consistency,w.consistency)}</td><td class="rf-result">${westinghouseFactor({skill:Number(w.skill)||0,effort:Number(w.effort)||0,condition:Number(w.condition)||0,consistency:Number(w.consistency)||0}).toFixed(3)}</td><td>${canDelete()?`<button class="btn ghost remove-pic" data-pic="${esc(o)}">Hapus</button>`:'—'}</td></tr>`}).join('')}</tbody></table></div><button id="saveSettings" class="btn primary" style="margin-top:15px">Simpan Rating & Analysis Settings</button></div>
    <div class="grid cols-2 section">${refTable('Acuan Westinghouse — Skill',skill)}${refTable('Acuan Westinghouse — Effort',effort)}${refTable('Acuan Westinghouse — Condition',condition)}${refTable('Acuan Westinghouse — Consistency',consistency)}</div>
  </div>`;
  if(!canWrite()){ $('#addOperator').classList.add('hidden'); $('#saveSettings').classList.add('hidden'); $('#minInitialN').disabled=true; $('#allowance').disabled=true; }
  $$('#app tr[data-pic]').forEach(tr=>{
    const pic=tr.dataset.pic, old=settings.westinghouse?.[pic];
    const dept=tr.querySelector('.pic-dept'); dept.value=settings.operatorDepartments?.[pic]||''; if(!canWrite()){dept.disabled=true;$$('.grade',tr).forEach(x=>x.disabled=true);}
    if(old){const vals=[old.skill,old.effort,old.condition,old.consistency];$$('.grade',tr).forEach((el,i)=>{
      const value=Number.isFinite(+vals[i])?(+vals[i]).toFixed(2):'0.00';
      el.value=value;
      if(!el.value) el.value='0.00';
    })}
    const recalc=()=>{const v=$$('.grade',tr).map(x=>+x.value);tr.querySelector('.rf-result').textContent=westinghouseFactor({skill:v[0],effort:v[1],condition:v[2],consistency:v[3]}).toFixed(3)};
    $$('.grade',tr).forEach(x=>x.onchange=recalc);recalc();
  });
  $('#addOperator').onclick=()=>{if(!ensureWrite())return;captureRatingDraft();const name=$('#newOperator').value.trim(),dept=$('#newOperatorDept').value;if(!name)return alert('Masukkan nama PIC.');if(!dept)return alert('Pilih Bagian / Activity untuk PIC.');if(operatorList().includes(name))return alert('PIC sudah ada.');settings.operators.push(name);settings.operatorDepartments[name]=dept;settings.westinghouse??={};settings.westinghouse[name]=defaultWestinghouse();settings.ratings[name]=1;save();renderRating()};
  $$('.remove-pic').forEach(b=>b.onclick=async()=>{if(!ensureAdmin())return;const pic=b.dataset.pic;if(!confirm(`Hapus PIC ${pic}?`))return;try{if(window.tmsCloud?.enabled)await window.tmsCloud.deleteOperator(pic);settings.operators=settings.operators.filter(x=>x!==pic);delete settings.ratings[pic];delete settings.operatorDepartments[pic];if(settings.westinghouse)delete settings.westinghouse[pic];saveLocalOnly();renderRating()}catch(err){console.error(err);alert('PIC gagal dihapus dari cloud: '+(err.message||err));}});
  $('#saveSettings').onclick=()=>{if(!ensureAdmin())return;settings.allowance=(+$('#allowance').value||0)/100;settings.minInitialN=Math.max(2,Math.round(+$('#minInitialN').value||5));captureRatingDraft();save();alert('Rating Factor, Bagian PIC, N Minimum, dan Allowance berhasil disimpan.');renderRating()};
}
function renderStandard(){setHeader('Standard Time','NORMAL TIME → ALLOWANCE → STANDARD TIME');let rows=masterData().map(m=>{let sizes=['Small','Medium','Big'];return sizes.map(size=>({m,size,r:standardFor(m.element,size)}))}).flat().filter(x=>x.r);$('#app').innerHTML=`<div class="content"><div class="analysis-note">Jika data kategori memenuhi uniformity + sufficiency, digunakan <b>Category specific</b>. Jika belum, sistem menggunakan <b>Pooled fallback</b> untuk element tersebut.</div><div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Element</th><th>Size</th><th>N</th><th>Mean</th><th>RF</th><th>Normal Time</th><th>Allowance</th><th>Standard Time</th><th>Source</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.m.process)}</td><td>${esc(x.m.element)}</td><td>${x.size}</td><td>${x.r.n}</td><td>${fmtTimeValue(x.r.mean)}</td><td>${fmt(x.r.rf)}</td><td>${fmtTimeValue(x.r.normal)}</td><td>${fmt(settings.allowance*100)}%</td><td><b>${fmtTimeValue(x.r.standard)}</b></td><td><span class="badge ${x.r.source==='Category specific'?'ok':'warn'}">${x.r.source}</span></td></tr>`).join('')||'<tr><td colspan="10">No standard time available. Add observations first.</td></tr>'}</tbody></table></div></div></div>`}
function renderWaste(){setHeader('Waste & Pareto','LEAN ANALYSIS');const map={};masterData().forEach(m=>{if(!m.waste||m.waste==='-')return;let vals=['Small','Medium','Big'].map(s=>standardFor(m.element,s)).filter(Boolean);if(!vals.length)return;let avg=vals.reduce((a,x)=>a+x.standard,0)/vals.length;map[m.waste]=(map[m.waste]||0)+avg*(m.frequency||0)});let rows=Object.entries(map).sort((a,b)=>b[1]-a[1]);let total=rows.reduce((a,x)=>a+x[1],0),cum=0,max=rows[0]?.[1]||1;$('#app').innerHTML=`<div class="content"><div class="grid cols-3">${kpi('Waste Types',rows.length,'With measurable standard time')}${kpi('ESTIMATED WASTE TIME / DAY',fmtTimeValue(total),'Standard Time × Frequency/Day (waste elements)')}${kpi('Top Waste',rows[0]?.[0]||'—',rows[0]?fmtTimeValue(rows[0][1])+'/day':'')}</div><div class="card section"><h3>Pareto Waste</h3>${rows.length?rows.map(([k,v])=>{cum+=v;return `<div class="chart-row"><div class="chart-label">${esc(k)}</div><div class="bar" style="width:${Math.max(8,v/max*100)}%"><i style="width:100%"></i><small>${fmtTimeValue(v)}</small></div></div>`}).join(''):'<div class="empty">Waste master belum memiliki kategori yang dapat dianalisis atau belum ada data observasi.</div>'}</div><div class="card section"><h3>Contribution Detail</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Waste</th><th>Time / Day</th><th>%</th><th>Cumulative %</th></tr></thead><tbody>${rows.map(([k,v])=>{cum=(cum||0);return ''}).join('')}${(()=>{let c=0;return rows.map(([k,v])=>{c+=v;return `<tr><td>${esc(k)}</td><td>${fmtTimeValue(v)}</td><td>${fmt(v/total*100)}%</td><td>${fmt(c/total*100)}%</td></tr>`}).join('')})()}</tbody></table></div></div></div>`}
function exportCsv(){const headers=['No','Tanggal','PIC','Process','Activity','Element Kerja','Klasifikasi','Waste','Waktu','Waktu Detik','Kategori Ukuran','Metode','Peralatan','RF PIC','Start','Start Display','End','End Display','Catatan'];const rows=observations.map((o,i)=>[i+1,o.date,o.operator,o.process,o.activity,o.element,o.classification,o.waste,fmtTimeValue(o.time),o.time,o.size,o.method,o.equipment,settings.ratings[o.operator]||1,o.start,fmtTimeValue(o.start),o.end,fmtTimeValue(o.end),o.note]);const csv=[headers,...rows].map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='TMS_PDC_Warehouse_Data_Waktu.csv';a.click();URL.revokeObjectURL(a.href)}
function importCsv(file){if(!ensureWrite())return;const reader=new FileReader();reader.onload=e=>{let lines=e.target.result.split(/\r?\n/).filter(Boolean),head=lines.shift().split(',').map(x=>x.replace(/^"|"$/g,''));let added=0;lines.forEach(line=>{let cols=[],re=/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g,m;while(m=re.exec(line))cols.push(m[1].replace(/^"|"$/g,'').replace(/""/g,'"'));let get=n=>cols[head.indexOf(n)]||'';let el=get('Element Kerja'),master=getMaster(el);if(master){observations.push({id:newId(),date:get('Tanggal'),operator:get('PIC'),process:master.process,activity:master.activity,element:el,size:get('Kategori Ukuran')||'Small',time:+get('Waktu Detik'),start:+get('Start')||0,end:+get('End')||0,classification:master.classification,waste:master.waste,method:master.method,equipment:master.equipment,note:get('Catatan'),createdAt:Date.now()});added++}});save();alert(added+' observations imported.');render();};reader.readAsText(file)}

function renderMaster(){
 setHeader('Master Process & Lean','MASTER DATA • EDITABLE');
 const rows=masterData();
 $('#app').innerHTML=`<div class="content">
 <div class="card"><div class="section-head"><div><h3>Master Data Dinamis</h3></div><div>${canWrite()?'<button id="addMaster" class="btn primary">＋ Tambah Element</button>':''}</div></div>
 <div class="master-legend"><b>8 Lean Waste:</b> ${WASTE_TYPES.map(x=>`<span class="badge warn">${x}</span>`).join(' ')} <span class="badge">None / - = tidak ada waste</span></div>
 <div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Activity</th><th>Element Kerja</th><th>Klasifikasi</th><th>Lean Waste</th><th>Metode</th><th>Peralatan</th><th>Freq/Hari</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${esc(r.classification)}</td><td>${esc(r.waste||'-')}</td><td>${esc(r.method||'-')}</td><td>${esc(r.equipment||'-')}</td><td>${fmtFreq(r.frequency)}</td><td>${canWrite()?`<button class="btn ghost editMaster" data-i="${i}">Edit</button>`:''} ${canDelete()?`<button class="btn ghost delMaster" data-i="${i}">Hapus</button>`:''}</td></tr>`).join('')}</tbody></table></div></div></div>`;
 function modal(existing={},editIndex=null){if(!ensureWrite())return;
  const html=`<div class="modal-backdrop" id="masterModal"><div class="modal"><h3>${editIndex==null?'Tambah':'Edit'} Master Element</h3><div class="form-grid"><label>Process<input id="mProcess" value="${esc(existing.process||'')}"></label><label>Activity<input id="mActivity" value="${esc(existing.activity||'')}"></label><label class="full">Element Kerja<input id="mElement" value="${esc(existing.element||'')}"></label><label>Klasifikasi<select id="mClass">${CLASSIFICATIONS.map(x=>`<option ${existing.classification===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Lean Waste<select id="mWaste"><option value="-">None / Tidak ada waste</option>${WASTE_TYPES.map(x=>`<option ${existing.waste===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Metode<select id="mMethod">${masterMethodOptions().map(m=>`<option value="${m}" ${normalizeMasterMethod(existing.method)===m?'selected':''}>${m}</option>`).join('')}</select></label><label>Peralatan<input id="mEquipment" value="${esc(existing.equipment||'-')}"></label><label>Frekuensi / Hari<input id="mFreq" type="number" min="0" step="1" value="${Math.round(Number(existing.frequency)||0)}"></label><label class="full">Catatan<textarea id="mNotes">${esc(existing.notes||'')}</textarea></label></div><div class="modal-actions"><button id="saveMaster" class="btn primary">Simpan</button><button id="closeMaster" class="btn ghost">Batal</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  $('#closeMaster').onclick=()=>$('#masterModal').remove();
  $('#saveMaster').onclick=()=>{const v={id:existing.id||undefined,process:$('#mProcess').value.trim(),activity:$('#mActivity').value.trim(),element:$('#mElement').value.trim(),classification:$('#mClass').value,waste:$('#mWaste').value,method:normalizeMasterMethod($('#mMethod').value),equipment:$('#mEquipment').value.trim()||'-',frequency:+$('#mFreq').value||0,notes:$('#mNotes').value.trim()};if(!v.process||!v.activity||!v.element)return alert('Process, Activity, dan Element Kerja wajib diisi.');let a=masterData();if(editIndex==null)a.push(v);else a[editIndex]=v;saveMaster(a);save();$('#masterModal').remove();renderMaster();};
 }
 if($('#addMaster')) $('#addMaster').onclick=()=>{if(ensureWrite())modal()};
 $$('.editMaster').forEach(b=>b.onclick=()=>modal(masterData()[+b.dataset.i],+b.dataset.i));
 $$('.delMaster').forEach(b=>b.onclick=async()=>{if(!confirm('Hapus master element ini? Observasi lama tidak otomatis dihapus.'))return;const i=+b.dataset.i;let a=masterData();const row=a[i];try{if(window.tmsCloud?.enabled)await window.tmsCloud.deleteMaster(row?.id);a.splice(i,1);localStorage.setItem(MASTER_KEY,JSON.stringify(a));renderMaster()}catch(err){console.error(err);alert('Master gagal dihapus dari cloud: '+(err.message||err));}});
}

function renderUsers(){
  setHeader('User Management','ACCESS CONTROL • ADMIN ONLY');
  if(!ensureAdmin()){state.view='dashboard';return renderDashboard();}
  const sb=window.tmsAuth?.getClient?.();
  if(!sb){$('#app').innerHTML='<div class="content"><div class="card"><div class="analysis-note">Supabase client belum siap.</div></div></div>';return;}
  $('#app').innerHTML='<div class="content"><div class="card user-management-page"><div class="section-head user-management-title"><div><h2>User Management</h2><h3>Pengguna Aplikasi</h3><p class="muted">Akun baru masuk sebagai Pending. Admin menentukan status dan role.</p></div></div><div id="userTable"><div class="empty">Memuat pengguna...</div></div></div></div>';
  (async()=>{
    const {data,error}=await sb.from('user_profiles').select('id,email,full_name,role,status,created_at,approved_at').order('created_at',{ascending:false});
    if(error){$('#userTable').innerHTML='<div class="analysis-note">Gagal memuat user: '+esc(error.message)+'</div>';return;}
    const rows=data||[];
    $('#userTable').innerHTML='<div class="table-wrap user-management-wrap"><table class="data-table user-management-table"><colgroup><col class="user-col-name"><col class="user-col-email"><col class="user-col-role"><col class="user-col-status"><col class="user-col-created"><col class="user-col-action"></colgroup><thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Dibuat</th><th>Aksi</th></tr></thead><tbody>'+rows.map(u=>`<tr data-user="${u.id}"><td>${esc(u.full_name||'—')}</td><td class="user-email-cell">${esc(u.email)}</td><td><select class="user-role"><option value="viewer" ${u.role==='viewer'?'selected':''}>viewer</option><option value="analyst" ${u.role==='analyst'?'selected':''}>analyst</option><option value="admin" ${u.role==='admin'?'selected':''}>admin</option></select></td><td><select class="user-status user-status-select user-status-${esc(u.status)}" aria-label="Status pengguna"><option value="pending" ${u.status==='pending'?'selected':''}>Pending</option><option value="approved" ${u.status==='approved'?'selected':''}>Approved</option><option value="suspended" ${u.status==='suspended'?'selected':''}>Suspended</option></select></td><td class="user-created-cell">${new Date(u.created_at).toLocaleDateString('id-ID')}</td><td><button class="btn primary user-save" data-id="${u.id}">Simpan</button></td></tr>`).join('')+'</tbody></table></div>';
    $$('.user-status-select').forEach(sel=>sel.addEventListener('change',()=>{const v=sel.value;sel.className='user-status user-status-select user-status-'+v;}));
    $$('.user-save').forEach(btn=>btn.onclick=async()=>{
      if(!ensureAdmin())return; const tr=btn.closest('tr'); const id=btn.dataset.id; const newRole=tr.querySelector('.user-role').value; const newStatus=tr.querySelector('.user-status').value;
      if(id===window.tmsAuth?.getProfile?.()?.id && (newRole!=='admin'||newStatus!=='approved')){alert('Admin tidak dapat menurunkan atau menonaktifkan akun sendiri.');return;}
      btn.disabled=true; const {error}=await sb.from('user_profiles').update({role:newRole,status:newStatus,approved_at:newStatus==='approved'?new Date().toISOString():null,approved_by:newStatus==='approved'?window.tmsAuth?.getProfile?.()?.id:null,updated_at:new Date().toISOString()}).eq('id',id); btn.disabled=false;
      if(error) alert('Perubahan gagal: '+error.message); else {alert('Profil berhasil diperbarui.');renderUsers();}
    });
  })();
}


/* ========================================================================
   TSKK / SWCT — Observation-driven Standard Work Combination Table
   Source = saved observation cycles. Master Data remains the single source
   for Process / Activity / Element during observation capture.
   ======================================================================== */
const TSKK_KEY='tms-pdc-tskk-studies';
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
  const cycle=isManual?Math.max(0,Number(study.manualCycleTime)||Number(study.actualCycleTime)||Number(rawItems.find(x=>Number(x.time)>0)?.time)||0):items.reduce((m,x)=>Math.max(m,x.end),0);
  const takt=Math.max(0,Number(study.taktTime)||0);const gap=takt-cycle;const status=takt<=0?'Takt belum diisi':cycle<=takt+0.0001?'Target tercapai':'Cycle Time > Takt Time';
  return {items,manual,auto,walk,cycle,takt,gap,status,operatorWork:manual+walk,operatorLoad:takt?(manual+walk)/takt*100:0,machineShare:cycle?auto/cycle*100:0,typeComplete:isManual||items.every(x=>!!x.type)};
}
function tskkDefaultStudyFromSession(session){
  const method=session?.method==='manual'?'manual':'video';
  const sourceRows=(session?.rows||[]).sort((a,b)=>(a.start??a.createdAt??0)-(b.start??b.createdAt??0));
  const manualCycleTime=method==='manual'?Math.max(0,Number(sourceRows.find(o=>Number(o.time)>0)?.time)||0):0;
  const rows=sourceRows.map(o=>({id:newId(),sourceObservationId:o.id,element:o.element||'',type:tskkTypeFromMaster(o.element||''),time:method==='video'?Math.max(0,+o.time||0):0,start:method==='video'&&o.start!=null?Math.max(0,+o.start):null,end:method==='video'&&o.end!=null?Math.max(0,+o.end):null,note:o.note||''}));
  if(method==='video'){let cursor=0;rows.forEach(x=>{if(x.start==null)x.start=cursor;if(x.end==null)x.end=x.start+x.time;cursor=Math.max(cursor,x.end)})}
  return {id:newId(),tskkNo:'TSKK-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+String(Date.now()).slice(-4),observationSessionId:session?.id||null,observationCycleId:session?.id||null,observationMethod:method,manualCycleTime,sourceObservationIds:sourceRows.map(o=>o.id),partName:'',area:'',process:session?.process||'',activity:session?.activity||'',operator:session?.operator||'',sizeCategory:session?.size||'Small',studyDate:session?.date||tskkEscDate(),shift:'Shift 1',availableMinutes:480,requiredUnits:0,taktTime:0,fromPoint:'',toPoint:'',machine:'',notes:'',items:rows};
}
function tskkEscDate(v){return v||new Date().toISOString().slice(0,10)}
async function tskkLoadCloud(){
  const sb=window.tmsAuth?.getClient?.();if(!sb)return null;
  try{
    const q=await sb.from('tskk_studies').select('id,tskk_no,observation_session_id,observation_cycle_id,source_observation_ids,part_name,area,process,activity,operator_name,study_date,size_category,shift,available_minutes,required_units,takt_time,from_point,to_point,machine_name,notes,created_at,updated_at').order('created_at',{ascending:false});
    if(q.error){if(/relation .*tskk_studies.*does not exist/i.test(q.error.message||''))return null;throw q.error;}
    const data=q.data||[],ids=data.map(x=>x.id);let itemRows=[];
    if(ids.length){const iq=await sb.from('tskk_items').select('id,study_id,seq,element_name,work_type,time_seconds,start_seconds,end_seconds,notes').in('study_id',ids).order('seq',{ascending:true});if(iq.error)throw iq.error;itemRows=iq.data||[]}
    const by=new Map();itemRows.forEach(x=>{if(!by.has(x.study_id))by.set(x.study_id,[]);const derived=tskkTypeFromMaster(x.element_name||'');by.get(x.study_id).push({id:x.id,element:x.element_name,type:derived||x.work_type||'',time:+x.time_seconds||0,start:+x.start_seconds||0,end:+x.end_seconds||0,note:x.notes||''});});
    return data.map(x=>{const loadedItems=by.get(x.id)||[];const loadedManualCycle=loadedItems.find(it=>Number(it.time)>0)?.time||0;return ({id:x.id,tskkNo:x.tskk_no||'',observationSessionId:x.observation_session_id||x.observation_cycle_id||null,observationCycleId:x.observation_cycle_id||x.observation_session_id||null,sourceObservationIds:Array.isArray(x.source_observation_ids)?x.source_observation_ids:[],manualCycleTime:loadedManualCycle,partName:x.part_name||'',area:x.area||'',process:x.process||'',activity:x.activity||'',operator:x.operator_name||'',studyDate:x.study_date||'',sizeCategory:x.size_category||'Small',shift:x.shift||'',availableMinutes:+x.available_minutes||0,requiredUnits:+x.required_units||0,taktTime:+x.takt_time||0,fromPoint:x.from_point||'',toPoint:x.to_point||'',machine:x.machine_name||'',notes:x.notes||'',items:loadedItems});});
  }catch(err){console.warn('TSKK cloud load skipped:',err);return null}
}
async function tskkPersistCloud(study){
  const sb=window.tmsAuth?.getClient?.();if(!sb||!canWrite())return false;
  const row={id:study.id,tskk_no:study.tskkNo||null,observation_session_id:study.observationSessionId||study.observationCycleId||null,observation_cycle_id:study.observationCycleId||study.observationSessionId||null,source_observation_ids:study.sourceObservationIds||[],part_name:study.partName||null,area:study.area||null,process:study.process||null,activity:study.activity||null,operator_name:study.operator||null,study_date:study.studyDate||null,size_category:study.sizeCategory||'Small',shift:study.shift||null,available_minutes:+study.availableMinutes||0,required_units:+study.requiredUnits||0,takt_time:+study.taktTime||0,from_point:study.fromPoint||null,to_point:study.toPoint||null,machine_name:study.machine||null,notes:study.notes||null,updated_at:new Date().toISOString()};
  try{const q=await sb.from('tskk_studies').upsert(row,{onConflict:'id'});if(q.error){if(/column .*observation_session_id.*does not exist/i.test(q.error.message||'')){alert('TSKK cloud perlu migration terbaru: supabase/tskk_observation_source_migration.sql');return false;}if(/relation .*tskk_studies.*does not exist/i.test(q.error.message||''))return false;throw q.error;}const d=await sb.from('tskk_items').delete().eq('study_id',study.id);if(d.error)throw d.error;const items=(study.items||[]).map((x,i)=>({id:x.id||newId(),study_id:study.id,seq:i+1,element_name:x.element||'',work_type:tskkTypeFromMaster(x.element||'')||x.type||'manual',time_seconds:study.observationMethod==='manual'?(i===0?(+study.manualCycleTime||+x.time||0):0):(+x.time||0),start_seconds:+x.start||0,end_seconds:study.observationMethod==='manual'?0:(+x.end||((+x.start||0)+(+x.time||0))),notes:x.note||null}));if(items.length){const ins=await sb.from('tskk_items').insert(items);if(ins.error)throw ins.error;}return true;}catch(err){console.error('TSKK cloud save failed:',err);alert('TSKK tersimpan lokal, tetapi sinkronisasi cloud gagal: '+(err.message||err));return false}
}
async function tskkDeleteCloud(id){const sb=window.tmsAuth?.getClient?.();if(!sb||!canDelete())return false;const q=await sb.from('tskk_studies').delete().eq('id',id);if(q.error)throw q.error;return true}
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
function timeUnitOptions(seconds){const u=timeUnitFor(seconds);return `<option value="sec" ${u.label==='dtk'?'selected':''}>dtk</option><option value="min" ${u.label==='menit'?'selected':''}>menit</option>`}
function tskkInputValue(seconds){const u=timeUnitFor(seconds);return fmtTimeNumber(seconds)}
function parseTimeInput(value,unit){const n=Math.max(0,Number(value)||0);return unit==='min'?n*60:n}
function tskkDisplayTime(value,unit){return fmt((Number(value)||0)/(unit?.divisor||1));}
function tskkAxisTicks(scaleSeconds,unit){
  const divisor=unit?.divisor||1,displayScale=Math.max(0,Number(scaleSeconds)||0)/divisor;
  let step=displayScale<=2?0.5:displayScale<=10?1:displayScale<=60?5:10;
  const ticks=[];
  for(let v=0;v<displayScale+step*0.0001;v+=step){ticks.push(Math.min(displayScale,Number(v.toFixed(4))));}
  if(!ticks.length||Math.abs(ticks[ticks.length-1]-displayScale)>0.0001)ticks.push(Number(displayScale.toFixed(4)));
  return ticks.filter((v,i,a)=>i===0||Math.abs(v-a[i-1])>0.0001).map(display=>({display,raw:display*divisor}));
}
function tskkTimeline(study){
  const c=tskkCalc(study),scale=Math.max(c.cycle,c.takt,1),unit=tskkTimeUnit(scale),axis=tskkAxisTicks(scale,unit);
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
  return `<div class="tskk-combination-chart"><div class="tskk-combo-header"><div class="tskk-combo-no-head">No</div><div class="tskk-combo-heading">Work Element</div><div class="tskk-combo-heading tskk-type-heading">Type</div><div class="tskk-combo-axis">${axis.map((tick,i)=>`<span class="${i===0?'axis-start ':''}${i===axis.length-1?'axis-end':''}" style="left:${(tick.raw/scale)*100}%">${tick.display}</span>`).join('')}<em>${unit.label}</em></div></div>${c.items.map(row).join('')}${taktX!==null?`<div class="tskk-combo-takt" style="left:calc(${leftLabel}px + (100% - ${leftLabel}px) * ${taktX/100})"><span>Takt ${tskkDisplayTime(c.takt,unit)} ${unit.label}</span></div>`:''}<div class="tskk-combo-footer"><span class="tskk-combo-note">Actual Time berasal langsung dari Observation. Type ditarik otomatis dari Metode pada Master Data.</span><div class="tskk-legend"><span><i class="tskk-dot manual"></i>Manual / Hand</span><span><i class="tskk-dot auto"></i>Auto / Machine = garis putus-putus</span><span><i class="tskk-dot walk"></i>Walk / Walking</span></div></div></div>`;
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
  <div class="tskk-list-wrap"><div class="section-head"><div><h3>TSKK Tersimpan</h3><p class="muted">Daftar TSKK yang sudah dibuat. Satu record TSKK berisi seluruh Work Element dari satu Observation.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>No TSKK</th><th>Observation</th><th>Process</th><th>Activity</th><th>PIC</th><th>Takt</th><th>Cycle</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${localStudies.length?localStudies.map(s=>{const c=tskkCalc(s);const sid=s.observationSessionId||s.observationCycleId||'';const sess=sessions.find(x=>x.id===sid);return `<tr><td>${esc(s.tskkNo)}</td><td>${esc(sess?.label||observationSessionLabel(sid,s.studyDate))}</td><td>${esc(s.process||'—')}</td><td>${esc(s.activity||'—')}</td><td>${esc(s.operator||'—')}</td><td>${fmtTimeValue(s.taktTime)}</td><td>${fmtTimeValue(c.cycle)}</td><td>${tskkStatusBadge(c)}</td><td><button class="btn ghost tskk-open" data-id="${s.id}">Buka</button>${canDelete()?` <button class="btn ghost tskk-delete" data-id="${s.id}">Hapus</button>`:''}</td></tr>`}).join(''):'<tr><td colspan="10" class="empty">Belum ada TSKK tersimpan.</td></tr>'}</tbody></table></div></div></div></div>`;
  const open=selected=>{if(!selected)return;state.tskkEditor=true;try{history.pushState({appView:'tskk',tskkEditor:true},'',location.href)}catch(e){console.warn('TSKK history push skipped:',e)}const readOnly=!canWrite();const sourceSession=sessions.find(x=>x.id===(selected.observationSessionId||selected.observationCycleId));selected.observationMethod=selected.observationMethod||sourceSession?.method||'video';if(sourceSession?.rows?.length && (selected.items||[]).length < sourceSession.rows.length){const oldByElement=new Map((selected.items||[]).map(x=>[x.element,{type:x.type||'',note:x.note||''}]));selected.items=sourceSession.rows.map(o=>{const old=oldByElement.get(o.element)||{};return {id:newId(),sourceObservationId:o.id,element:o.element||'',type:tskkTypeFromMaster(o.element||'')||old.type||'',time:selected.observationMethod==='video'?Math.max(0,+o.time||0):0,start:selected.observationMethod==='video'&&o.start!=null?Math.max(0,+o.start):null,end:selected.observationMethod==='video'&&o.end!=null?Math.max(0,+o.end):null,note:old.note||o.note||''};});if(selected.observationMethod==='manual'&&(!selected.manualCycleTime||selected.manualCycleTime<=0)){selected.manualCycleTime=Math.max(0,Number(sourceSession.rows.find(o=>Number(o.time)>0)?.time)||0);}}const isManualObservation=selected.observationMethod==='manual';$('#app').innerHTML=`<div class="content tskk-content"><div class="card tskk-header-card"><div class="section-head"><div><h3>${esc(selected.tskkNo||'TSKK')}</h3><p class="muted">Source: ${esc(observationSessionLabel(selected.observationSessionId||selected.observationCycleId||'',selected.studyDate))}. ${isManualObservation?'Manual Observation memakai satu Actual Cycle Time; detail Start/End per Work Element tidak tersedia.':'Actual Time dan Start/End berasal langsung dari Observation video.'}</p></div><div class="tskk-actions"><button type="button" class="btn ghost" id="tskkBack">← Kembali</button>${!readOnly?'<button type="button" class="btn primary" id="tskkSave">Simpan TSKK</button>':''}<button type="button" class="btn ghost" id="tskkPrint">Cetak</button></div></div>
  <div class="form-grid tskk-meta-grid"><label>No TSKK<input id="tskkNo" value="${esc(selected.tskkNo)}" ${readOnly?'disabled':''}></label><label>Part / Job<input id="tskkPart" value="${esc(selected.partName)}" ${readOnly?'disabled':''}></label><label>Area / Section<input id="tskkArea" value="${esc(selected.area)}" ${readOnly?'disabled':''}></label><label>PIC<input id="tskkOperator" value="${esc(selected.operator)}" readonly></label><label>Date<input id="tskkDate" type="date" value="${esc(selected.studyDate)}" ${readOnly?'disabled':''}></label><label>Size<select id="tskkSize" ${readOnly?'disabled':''}><option>Small</option><option>Medium</option><option>Big</option></select></label><label>Process<input id="tskkProcess" value="${esc(selected.process)}" readonly></label><label>Activity<input id="tskkActivity" value="${esc(selected.activity)}" readonly></label><label>Shift<input id="tskkShift" value="${esc(selected.shift)}" ${readOnly?'disabled':''}></label><label>Available Time (min)<input id="tskkAvailable" type="number" min="0" step="0.01" value="${selected.availableMinutes||0}" ${readOnly?'disabled':''}></label><label>Required Units<input id="tskkUnits" type="number" min="0" step="1" value="${selected.requiredUnits||0}" ${readOnly?'disabled':''}></label><label>Takt Time<div class="time-input-row"><input id="tskkTakt" type="number" min="0" step="0.01" value="${tskkInputValue(selected.taktTime)}" ${readOnly?'disabled':''}><select id="tskkTaktUnit" ${readOnly?'disabled':''}>${timeUnitOptions(selected.taktTime)}</select></div></label><label>Machine / Equipment<input id="tskkMachine" value="${esc(selected.machine)}" ${readOnly?'disabled':''}></label><label>From<input id="tskkFrom" value="${esc(selected.fromPoint)}" ${readOnly?'disabled':''}></label><label>To<input id="tskkTo" value="${esc(selected.toPoint)}" ${readOnly?'disabled':''}></label><label class="full">Catatan<textarea id="tskkNotes" rows="2" ${readOnly?'disabled':''}>${esc(selected.notes)}</textarea></label></div>
  <div class="tskk-meta-helper"><span><b>Source:</b> satu Observation/video. Work Element, Start, End, dan Actual Time tidak diinput ulang. Type ditarik otomatis dari Metode pada Master Data.</span>${!readOnly?'<button class="btn ghost" id="calcTakt">Hitung Takt dari Demand</button>':''}</div>
  <div class="tskk-kpis" id="tskkKpis"></div>
  <div class="tskk-table-card"><div class="section-head"><div><h3>${isManualObservation?'Observation Summary':'Work Elements / Actual Observation'}</h3><p class="muted">${isManualObservation?'Manual Observation hanya menyimpan satu Cycle Time total. Element dipertahankan sebagai konteks Master, bukan sebagai waktu per-element.':'Satu baris = satu Work Element hasil segment video. Nama element dan waktunya berasal dari Observation.'}</p></div></div><div class="table-wrap"><table class="data-table tskk-work-table ${isManualObservation?'manual-tskk-table':''}"><thead>${isManualObservation?'<tr><th>No</th><th>Work Element</th><th>Type</th><th>Actual Cycle (${displayUnit.label})</th></tr>':'<tr><th>No</th><th>Work Element</th><th>Type</th><th>Actual Time (${displayUnit.label})</th><th>Start (${displayUnit.label})</th><th>End (${displayUnit.label})</th><th>Keterangan</th></tr>'}</thead><tbody id="tskkWorkBody"></tbody></table></div></div>
  <div class="tskk-chart-card ${isManualObservation?'manual-tskk-summary':''}"><div class="section-head"><div><h3>${isManualObservation?'Actual Cycle Summary':'Standard Work Combination Chart'}</h3><p class="muted">${isManualObservation?'Manual Observation hanya menghasilkan satu Cycle Time total. Tidak dibuat batang Start/End per Work Element.':'Satu baris = satu Work Element. Type berada setelah Work Element; batang menunjukkan Actual Time pada Start–End aktual.'}</p></div></div><div id="tskkTimeline"></div></div><div class="tskk-insight" id="tskkInsight"></div></div>`;
  $('#tskkSize').value=selected.sizeCategory||'Small';
  let tskkTaktInputUnit=$('#tskkTaktUnit')?.value||'sec';
  $('#tskkTaktUnit')?.addEventListener('change',()=>{const input=$('#tskkTakt');if(!input)return;const actual=parseTimeInput(input.value,tskkTaktInputUnit);tskkTaktInputUnit=$('#tskkTaktUnit').value||'sec';input.value=fmtTimeNumber(tskkTaktInputUnit==='min'?actual/60:actual);});
  const syncInputs=()=>{if(isManualObservation&&(!selected.manualCycleTime||selected.manualCycleTime<=0)){selected.manualCycleTime=Math.max(0,Number(selected.items.find(x=>Number(x.time)>0)?.time)||0)}selected.tskkNo=$('#tskkNo').value.trim();selected.partName=$('#tskkPart').value.trim();selected.area=$('#tskkArea').value.trim();selected.studyDate=$('#tskkDate').value;selected.sizeCategory=$('#tskkSize').value;selected.shift=$('#tskkShift').value.trim();selected.availableMinutes=+$('#tskkAvailable').value||0;selected.requiredUnits=+$('#tskkUnits').value||0;selected.taktTime=parseTimeInput($('#tskkTakt').value,$('#tskkTaktUnit')?.value||'sec');selected.machine=$('#tskkMachine').value.trim();selected.fromPoint=$('#tskkFrom').value.trim();selected.toPoint=$('#tskkTo').value.trim();selected.notes=$('#tskkNotes').value.trim();};
  const draw=()=>{selected.items=selected.items.map(x=>{const start=Number.isFinite(+x.start)?Math.max(0,+x.start):0;const time=Math.max(0,+x.time||0);const derivedType=tskkTypeFromMaster(x.element||'');const safeType=['manual','auto','walk'].includes(derivedType)?derivedType:(['manual','auto','walk'].includes(x.type)?x.type:'manual');return {...x,type:safeType,start,end:(Number.isFinite(+x.end)?Math.max(start,+x.end):start+time),time}});const cc=tskkCalc(selected);const displayUnit=tskkTimeUnit(Math.max(cc.cycle,cc.takt,1));$('#tskkWorkBody').innerHTML=isManualObservation?(selected.items.length?selected.items.map((x,i)=>`<tr><td>${i+1}</td><td><div class="tskk-readonly-element">${esc(x.element||'—')}</div></td><td><div class="tskk-readonly-type ${x.type||'manual'}">${esc(tskkTypeLabel(x.type||'manual'))}</div></td><td>${i===0?`<div class="tskk-readonly-number"><b>${tskkDisplayTime(cc.cycle,displayUnit)} ${displayUnit.label}</b></div>`:'<span class="muted">Satu cycle untuk seluruh observation</span>'}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Observation belum memiliki element context.</td></tr>'):(selected.items.length?selected.items.map((x,i)=>`<tr><td>${i+1}</td><td><div class="tskk-readonly-element">${esc(x.element||'—')}</div></td><td><div class="tskk-readonly-type ${x.type||'manual'}">${esc(tskkTypeLabel(x.type||'manual'))}</div></td><td><div class="tskk-readonly-number">${tskkDisplayTime(x.time,displayUnit)}</div></td><td><div class="tskk-readonly-number">${tskkDisplayTime(x.start,displayUnit)}</div></td><td><div class="tskk-readonly-number">${tskkDisplayTime(x.end,displayUnit)}</div></td><td><input class="tskk-item-note" data-i="${i}" value="${esc(x.note||'')}" ${readOnly?'disabled':''}></td></tr>`).join(''):'<tr><td colspan="7" class="empty">Observation belum memiliki element.</td></tr>');$('#tskkKpis').innerHTML=`${kpi('TAKT TIME',tskkDisplayTime(cc.takt,displayUnit)+' '+displayUnit.label,'Target pace')}${kpi('ACTUAL CYCLE TIME',tskkDisplayTime(cc.cycle,displayUnit)+' '+displayUnit.label,cc.gap>=0?'Masih di bawah takt':'Melebihi takt')}${isManualObservation?'':kpi('MANUAL + WALK',tskkDisplayTime(cc.operatorWork,displayUnit)+' '+displayUnit.label,`Load operator ${fmt(cc.operatorLoad)}%`)}${isManualObservation?'':kpi('AUTO / MACHINE',tskkDisplayTime(cc.auto,displayUnit)+' '+displayUnit.label,`Proporsi ${fmt(cc.machineShare)}%`)}`;$('#tskkTimeline').innerHTML=isManualObservation?`<div class="manual-cycle-summary"><div><span>ACTUAL CYCLE</span><b>${tskkDisplayTime(cc.cycle,displayUnit)} ${displayUnit.label}</b></div><div><span>TAKT TIME</span><b>${tskkDisplayTime(cc.takt,displayUnit)} ${displayUnit.label}</b></div><div><span>VARIANCE</span><b>${tskkDisplayTime(cc.gap,displayUnit)} ${displayUnit.label}</b></div><div><span>STATUS</span><b>${esc(cc.status)}</b></div></div>`:`<div class="tskk-chart-scroll">${tskkTimeline(selected)}</div>`;$('#tskkInsight').innerHTML=`<b>Evaluasi:</b> ${tskkStatusBadge(cc)} <span>${cc.walk>0?`Walking ${tskkDisplayTime(cc.walk,displayUnit)} ${displayUnit.label}.`:'Belum ada aktivitas walking.'}</span>`;$$('.tskk-item-note').forEach(el=>el.oninput=()=>selected.items[+el.dataset.i].note=el.value)};
  $('#calcTakt')?.addEventListener('click',()=>{syncInputs();const av=+$('#tskkAvailable').value||0,units=+$('#tskkUnits').value||0;if(av>0&&units>0){selected.taktTime=+(av*60/units).toFixed(2);const tu=$('#tskkTaktUnit')?.value||'sec';$('#tskkTakt').value=tu==='min'?fmtTimeNumber(selected.taktTime/60):fmtTimeNumber(selected.taktTime);draw()}else alert('Isi Available Time dan Required Units terlebih dahulu.')});
  if(!readOnly)$('#tskkSave').onclick=async()=>{if(!ensureWrite())return;syncInputs();if(!selected.items.length){alert('Tidak ada Work Element dari Observation.');return}selected.items=selected.items.map(x=>({...x,time:Math.max(0,+x.time||0),start:Math.max(0,+x.start||0),end:Math.max(Math.max(0,+x.start||0),Number.isFinite(+x.end)?+x.end:(Math.max(0,+x.start||0)+Math.max(0,+x.time||0)))}));const rows=tskkStudies();const idx=rows.findIndex(x=>x.id===selected.id);if(idx>=0)rows[idx]=selected;else rows.unshift(selected);saveTSKKLocal(rows);const ok=await tskkPersistCloud(selected);if(!ok&&window.tmsAuth?.getClient?.())return;alert('TSKK berhasil disimpan.');state.tskkEditor=false;history.replaceState({appView:'tskk',tskkEditor:false},'',location.href);renderTSKK()};
  $('#tskkBack').onclick=()=>{
  if(!state.tskkEditor)return;
  // Use the browser history so Chrome, Safari and mobile back gestures
  // follow the same route as the in-app Kembali button.
  if(history.length>1){history.back();}
  else{state.tskkEditor=false;history.replaceState({appView:'tskk',tskkEditor:false},'',location.href);renderTSKK();}
};$('#tskkPrint').onclick=()=>{
    syncInputs();
    const cc=tskkCalc(selected);
    const isManualPrint=selected.observationMethod==='manual';
    const scale=Math.max(cc.cycle,cc.takt,1),printUnit=tskkTimeUnit(scale),axis=tskkAxisTicks(scale,printUnit);
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
      *{box-sizing:border-box} @page{size:A4 landscape;margin:8mm} body{font-family:Arial,Helvetica,sans-serif;margin:0;color:#111;background:#fff;font-size:10px} .sheet{width:100%;border:1px solid #222;padding:0;background:#fff} .title{height:34px;border-bottom:1px solid #222;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;letter-spacing:.2px}.brand-row{display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr;border-bottom:1px solid #222}.brand{min-height:70px;padding:3px 5px;border-right:1px solid #222;display:flex;align-items:center;justify-content:center;overflow:hidden}.brand img{display:block;width:100%;height:64px;max-width:100%;object-fit:contain;object-position:center}.meta{min-height:70px;padding:7px 9px;border-right:1px solid #222}.meta:last-child{border-right:0}.meta-row{display:grid;grid-template-columns:72px 8px 1fr;line-height:1.55}.meta-row b{font-weight:700}.section-title{font-size:12px;font-weight:800;border:1px solid #222;margin-top:8px;padding:4px 6px;background:#fff}.table{position:relative;border-left:1px solid #222;border-right:1px solid #222}.p-head,.p-row{display:grid;grid-template-columns:30px minmax(180px,1.45fr) 75px 60px minmax(360px,2.8fr)}.p-head{min-height:38px;background:#d9d9d9;border-top:1px solid #222;border-bottom:1px solid #222;font-weight:800;text-align:center}.p-head>div{display:flex;align-items:center;justify-content:center;border-right:1px solid #222;padding:3px}.p-head>div:last-child{border-right:0}.p-head .graph-head{position:relative;display:block;padding:0;overflow:hidden}.graph-title{height:17px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #999}.axis{height:20px;position:relative;font-size:8px;font-weight:400;overflow:hidden;padding:0 34px 0 0}.axis span{position:absolute;top:3px;transform:translateX(-50%);white-space:nowrap}.axis span.axis-start{left:0!important;transform:none!important}.axis span.axis-end{left:auto!important;right:34px!important;transform:none!important}.axis em{position:absolute;right:3px;top:3px;font-style:normal;font-weight:700;background:#d9d9d9;padding-left:2px;z-index:2}.p-row{min-height:29px;border-bottom:1px solid #777}.p-row>div{border-right:1px solid #777;display:flex;align-items:center;padding:3px 5px}.p-row>div:last-child{border-right:0}.p-no{justify-content:center;font-weight:700}.p-element{font-weight:700;line-height:1.15}.p-type{justify-content:center;text-align:center;font-size:8px;line-height:1.1}.p-time{justify-content:center;font-weight:700}.p-graph{position:relative;overflow:hidden;padding:0!important;background:#fff}.p-grid{position:absolute;inset:0}.p-grid i{position:absolute;top:0;bottom:0;border-left:1px dotted #aaa}.p-bar{position:absolute;top:6px;height:17px;background:transparent !important;border:0;border-radius:0;display:flex;align-items:center;justify-content:center;overflow:visible;min-width:3px}.p-bar-label{font-size:8px;font-weight:700;color:#111;position:absolute;left:calc(100% + 4px);white-space:nowrap}.p-bar-label.left{left:auto;right:calc(100% + 4px)}.print-solid-line{position:absolute;left:0;right:0;top:7px;height:3px;background:#000;border:1px solid #000}.print-wave{position:absolute;left:0;right:0;top:0;width:100%;height:17px;overflow:visible}.print-wave path{fill:none;stroke:#000;stroke-width:2;vector-effect:non-scaling-stroke}.print-wave path.dashed{stroke-dasharray:5 3}.print-wave path.solid{stroke-dasharray:none}.print-line{position:absolute;inset:0;width:100%;height:17px;overflow:visible}.print-line path{fill:none;stroke:#000;stroke-width:2;vector-effect:non-scaling-stroke}.print-line path.dashed{stroke-dasharray:5 3}.p-bar.walk .print-solid-line{height:2px}.p-bar.wait .print-solid-line{height:2px;border-style:dashed;background:transparent}.tskk-wave-svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.tskk-wave-path{fill:none;stroke:#111;stroke-width:2;vector-effect:non-scaling-stroke}.tskk-wave-path.dashed{stroke-dasharray:5 3}.tskk-wave-path.solid{stroke-dasharray:none}.tskk-solid-line{position:absolute;left:0;right:0;top:50%;height:3px;background:#111;transform:translateY(-50%);border-radius:2px}.takt-line{position:absolute;top:0;bottom:0;border-left:2px dashed #d21f1f;z-index:5}.takt-label{position:absolute;top:1px;left:4px;color:#b51515;background:#fff;font-size:8px;font-weight:800;padding:1px 3px;white-space:nowrap}.note{font-size:8px;color:#555;padding:4px 6px;border:1px solid #222;border-top:0}.print-legend{display:flex;align-items:center;gap:16px;padding:5px 7px;border:1px solid #222;border-top:0;font-size:8px;font-weight:700}.print-legend-item{display:flex;align-items:center;gap:4px;white-space:nowrap}.print-legend-item b{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border:1px solid #222;border-radius:50%;font-size:8px}.legend-symbol{display:inline-block;flex:0 0 auto;width:32px}.legend-symbol-solid{height:3px;background:#000;border:1px solid #000}.legend-symbol-dashed{height:0;border-top:2px dashed #000}.legend-symbol-wave{height:13px}.legend-symbol-wave path{fill:none;stroke:#000;stroke-width:2;vector-effect:non-scaling-stroke}.summary-title{font-size:12px;font-weight:800;border:1px solid #222;border-bottom:0;margin-top:8px;padding:4px 6px}.summary{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid #222}.sum{min-height:58px;border-right:1px solid #777;padding:4px 5px;text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:flex-start}.sum:last-child{border-right:0}.sum b{display:block;font-size:9px;margin-bottom:7px}.sum strong{font-size:10px;line-height:1.2}.status{margin-top:7px;display:inline-block;padding:3px 8px;border:1px solid #222;font-weight:800}.status.ok{background:#e8f4e8}.status.bad{background:#f8e5e5}.sign{display:grid;grid-template-columns:repeat(3,1fr);gap:25px;margin-top:18px;padding:0 25px 18px}.sig{text-align:center;min-height:54px;display:flex;flex-direction:column;justify-content:space-between}.sig-line{margin:18px auto 0;width:100%;border:0;text-align:center;white-space:pre;font-size:12px}.footer{font-size:7px;text-align:right;color:#777;padding:0 6px 3px}@media print{*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}body{background:#fff}.sheet{border:1px solid #222}.print-solid-line{background:#000!important;border-color:#000!important}.print-wave path{stroke:#000!important}.takt-line{border-left-color:#d21f1f!important}}
    </style></head><body><div class="sheet">
      <div class="title">TABEL STANDAR KERJA KOMBINATIF (TSKK)</div>
      <div class="brand-row">
        <div class="brand"><img src="ut-logo-2.png" alt="United Tractors"></div>
        <div class="meta"><div class="meta-row"><b>TSKK No</b><span>:</span><span>${esc(selected.tskkNo||'—')}</span></div><div class="meta-row"><b>Observation</b><span>:</span><span>${esc(selected.observationSessionId||'—')}</span></div><div class="meta-row"><b>Tanggal</b><span>:</span><span>${esc(selected.studyDate||'—')}</span></div></div>
        <div class="meta"><div class="meta-row"><b>PIC</b><span>:</span><span>${esc(selected.operator||'—')}</span></div><div class="meta-row"><b>Process</b><span>:</span><span>${esc(selected.process||'—')}</span></div><div class="meta-row"><b>Activity</b><span>:</span><span>${esc(selected.activity||'—')}</span></div></div>
        <div class="meta"><div class="meta-row"><b>Method</b><span>:</span><span>${esc(isManualPrint?'Manual':'Video')}</span></div><div class="meta-row"><b>Size</b><span>:</span><span>${esc(selected.sizeCategory||'—')}</span></div><div class="meta-row"><b>Takt</b><span>:</span><span>${fmtTimeValue(cc.takt)}</span></div></div>
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
      <div class="summary"><div class="sum"><b>Manual / Hand</b><strong>${totalType(manualTotal)}</strong></div><div class="sum"><b>Auto / Machine</b><strong>${totalType(autoTotal)}</strong></div><div class="sum"><b>Walk / Walking</b><strong>${totalType(walkTotal)}</strong></div><div class="sum"><b>Actual Cycle</b><strong>${tskkDisplayTime(cc.cycle,printUnit)} ${printUnit.label}</strong></div><div class="sum"><b>Takt Time</b><strong>${tskkDisplayTime(cc.takt,printUnit)} ${printUnit.label}</strong><span class="status ${cc.status==='Target tercapai'?'ok':'bad'}">${esc(cc.status)}</span></div></div>
      <div class="sign"><div class="sig"><b>Mengetahui,</b><div class="sig-line">(                                  )</div></div><div class="sig"><b>Diperiksa,</b><div class="sig-line">(                                  )</div></div><div class="sig"><b>Dibuat,</b><div class="sig-line">(                                  )</div></div></div>
      <div class="footer">Generated from TMS PDC Warehouse • ${new Date().toLocaleString('id-ID')}</div>
      </div><script>window.onload=()=>setTimeout(()=>window.print(),150)</script></body></html>`);
    w.document.close();
  };
  draw();
  };
  $$('.tskk-open').forEach(b=>b.onclick=(ev)=>{ev.preventDefault();ev.stopImmediatePropagation();if(state.tskkEditor)return;const s=localStudies.find(x=>String(x.id)===String(b.dataset.id));if(s){try{open(s)}catch(err){console.error('Buka TSKK gagal:',err);alert('TSKK gagal dibuka: '+(err?.message||err))}}});
  $$('.tskk-delete').forEach(b=>b.onclick=async()=>{if(!ensureAdmin())return;if(!confirm('Hapus TSKK ini?'))return;const id=b.dataset.id;try{await tskkDeleteCloud(id)}catch(e){console.warn(e)}saveTSKKLocal(localStudies.filter(x=>x.id!==id));renderTSKK()});
  $$('.tskk-create-from-session').forEach(b=>b.onclick=(ev)=>{ev.preventDefault();ev.stopImmediatePropagation();if(state.tskkEditor)return;if(!ensureWrite())return;const session=sessions.find(x=>String(x.id)===String(b.dataset.session));if(!session){console.error('TSKK session not found:',b.dataset.session,sessions);alert('Observation untuk TSKK tidak ditemukan. Silakan refresh halaman.');return}try{open(tskkDefaultStudyFromSession(session))}catch(err){console.error('Buat TSKK gagal:',err);alert('TSKK gagal dibuka: '+(err?.message||err))}});
  if(!skipCloud) tskkLoadCloud().then(remote=>{
    // Cloud is loaded once for this list render. Never start another cloud-load
    // render loop: that used to reset the mobile table's horizontal scroll and
    // could make the Create TSKK button appear to need multiple clicks.
    if(!remote || renderSeq!==tskkRenderSeq || state.tskkEditor)return;
    saveTSKKLocal(remote);
    if(renderSeq===tskkRenderSeq && !state.tskkEditor)renderTSKK(true);
  }).catch(()=>{});
}

const renderers={dashboard:renderDashboard,observe:renderObserve,data:renderData,master:renderMaster,tskk:renderTSKK,quality:renderQuality,uniformity:renderUniformity,sufficiency:renderSufficiency,rating:renderRating,standard:renderStandard,waste:renderWaste,users:renderUsers};
function setSidebar(open){const shell=$('#appShell'); if(!shell)return; shell.classList.toggle('sidebar-open',!!open); const toggle=$('#sidebarToggle'); if(toggle) toggle.setAttribute('aria-expanded',String(!!open));}
function render(){if(!renderers[state.view])state.view='dashboard';const active=$(`#nav button[data-view=\"${state.view}\"]`);if(active?.dataset.role==='admin'&&!isAdmin())state.view='dashboard';renderers[state.view]();$$('#nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));applyRoleUI();}
$$('#nav button[data-view]').forEach(b=>b.onclick=()=>{if(b.dataset.role==='admin'&&!isAdmin()){alert('Menu ini hanya dapat diakses Admin.');return}state.view=b.dataset.view;state.tskkEditor=false;history.replaceState({appView:state.view,tskkEditor:false},'',location.href);setSidebar(false);render()});
document.body.addEventListener('click',e=>{let b=e.target.closest('[data-go]');if(b){state.view=b.dataset.go;state.tskkEditor=false;history.replaceState({appView:state.view,tskkEditor:false},'',location.href);setSidebar(false);render()}});
// Preserve the current browser route on reload. This prevents F5/refresh from
// sending the user back to Dashboard when they were on Observation or TSKK.
history.replaceState({...((history.state&&typeof history.state==='object')?history.state:{}),appView:state.view,tskkEditor:state.tskkEditor===true},'',location.href);
window.addEventListener('popstate',()=>{
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
$('#sidebarToggle').onclick=()=>setSidebar(!$('#appShell').classList.contains('sidebar-open')); $('#sidebarClose').onclick=()=>setSidebar(false); const menuLogout=$('#menuLogout'); if(menuLogout) menuLogout.onclick=()=>window.tmsAuth?.logout?.();
$('#sidebarBackdrop').onclick=()=>setSidebar(false);
document.addEventListener('keydown',e=>{if(e.key==='Escape')setSidebar(false)});
$('#exportCsv').onclick=()=>{if(ensureWrite())exportCsv()};
$('#importCsv').onchange=e=>e.target.files[0]&&importCsv(e.target.files[0]);
async function bootCloud(){
  try{
    await hydrateLocalData();
    if(window.tmsCloud?.enabled){
      if(window.tmsAuthMiddleware?.waitUntilReady) await window.tmsAuthMiddleware.waitUntilReady();
      if(window.tmsAuthMiddleware?.requireSession) await window.tmsAuthMiddleware.requireSession();
      const cloud=await window.tmsCloud.loadState();
      if(cloud){
        // Jangan pernah menimpa cache/data yang ada dengan respons cloud kosong.
        if(Array.isArray(cloud.observations)) observations=mergeObservations(cloud.observations,observations);
        settings={...settings,...(cloud.settings||{})};
        if(Array.isArray(cloud.master)&&cloud.master.length){safeWrite(MASTER_KEY,cloud.master);idbSet(MASTER_KEY,cloud.master).catch(()=>{});}
        saveLocalOnly();
      }
      window.tmsCloud.subscribe(async(remote)=>{
        if(!remote)return;
        if(Array.isArray(remote.observations)) observations=mergeObservations(remote.observations,observations);
        settings={...settings,...(remote.settings||{})};
        if(Array.isArray(remote.master)&&remote.master.length){safeWrite(MASTER_KEY,remote.master);idbSet(MASTER_KEY,remote.master).catch(()=>{});}
        saveLocalOnly();
        // Saat halaman Observation sedang aktif, jangan re-render seluruh halaman akibat
        // event realtime. Re-render akan membuat elemen <video> dibuat ulang sehingga
        // video lokal/blob URL terlihat seperti tertutup dan pengguna harus upload ulang.
        // Data cloud tetap diperbarui di memori; tampilan lain akan memakai data terbaru
        // saat pengguna berpindah halaman.
        // Realtime data is merged into memory/local cache only. Do not rebuild
        // the active page here: doing so can replace the button DOM while the
        // user is clicking and reset scroll/form/video state. The next explicit
        // navigation or refresh renders the latest cloud state.
        // This is intentionally a no-render realtime listener.
      });
    }
  }catch(err){console.error(err);alert(err?.code==='AUTH_ACCESS_DENIED'?'Akun belum memiliki akses aktif. Hubungi administrator.':(err?.message||'Backend cloud belum dapat dimuat.'));$('#loginScreen').classList.remove('hidden');$('#appShell').classList.add('hidden');return;}
  render();
}
async function saveLocalOnly(){safeWrite(KEY,observations);safeWrite(SETTINGS_KEY,settings);try{await Promise.all([idbSet(KEY,observations),idbSet(SETTINGS_KEY,settings)])}catch(e){console.warn('Local-only save failed:',e)}}
function startAppCloud(){
  // Jika memakai Supabase, jangan load tabel sebelum login berhasil.
  // Pada mode lokal aplikasi dapat langsung berjalan seperti biasa.
  const shell=$('#appShell');
  if(window.tmsCloud?.enabled && shell?.classList.contains('hidden')){
    document.addEventListener('tms-auth-ready',()=>bootCloud(),{once:true});
  }else{
    bootCloud();
  }
}
startAppCloud();

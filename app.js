const KEY='tms-pdc-v2-data'; const SETTINGS_KEY='tms-pdc-v2-settings'; const MASTER_KEY='tms-pdc-v2-master';
const WASTE_TYPES=['Defects','Overproduction','Waiting','Non-Utilized Talent','Transportation','Inventory','Motion','Extra Processing'];
const CLASSIFICATIONS=['Direct Value-Added','Non-Value-Added','Indirect','Loss'];
function masterData(){return JSON.parse(localStorage.getItem(MASTER_KEY)||JSON.stringify(MASTER_DATA));}
function saveMaster(rows){localStorage.setItem(MASTER_KEY,JSON.stringify(rows));}
function getMaster(element){return masterData().find(x=>x.element===element);}
let observations=JSON.parse(localStorage.getItem(KEY)||'[]');
let settings=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');
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
let state={view:'dashboard',videoUrl:null,start:null,end:null,manualTime:null};
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>'"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[m]));
function operatorList(){return [...new Set(settings.operators.filter(Boolean).map(x=>String(x).trim()).filter(x=>!x.startsWith('Kalau menambah operator baru:')))]}
function westinghouseFactor(r){return 1+(+r.skill||0)+(+r.effort||0)+(+r.condition||0)+(+r.consistency||0)}
function save(){localStorage.setItem(KEY,JSON.stringify(observations));localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings)); const x=$('#storageStatus');if(x){x.textContent='Auto-saved '+new Date().toLocaleTimeString('id-ID');}}
function fmt(n){return Number(n||0).toLocaleString('id-ID',{minimumFractionDigits:2,maximumFractionDigits:2})}
function t(sec){if(sec==null||!isFinite(sec))return '—';sec=Math.max(0,Math.round(sec*100)/100);let h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),whole=Math.floor(sec%60),cs=Math.round((sec-Math.floor(sec))*100);if(cs===100){whole++;cs=0}if(whole===60){whole=0;m++}if(m===60){m=0;h++}return `${h?String(h).padStart(2,'0')+':':''}${String(m).padStart(2,'0')}:${String(whole).padStart(2,'0')}.${String(cs).padStart(2,'0')}`}
function unique(a){return [...new Set(a)]}
function opt(list,placeholder='Pilih...'){return `<option value="">${placeholder}</option>`+list.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}
function observedElements(){return new Set(observations.map(x=>x.element)).size}
function grouped(category=false){const map={};observations.forEach(o=>{let k=category?o.element+'|'+o.size:o.element;(map[k]??=[]).push(o)});return Object.entries(map).map(([key,rows])=>({key,element:rows[0].element,size:category?rows[0].size:'Pooled',rows}));}
function stats(rows){const x=rows.map(r=>+r.time).filter(Number.isFinite),n=x.length;if(!n)return {n:0};const mean=x.reduce((a,b)=>a+b,0)/n;const variance=n>1?x.reduce((a,b)=>a+(b-mean)**2,0)/(n-1):0;const sd=Math.sqrt(variance);const ucl=mean+3*sd,lcl=Math.max(0,mean-3*sd);const out=x.filter(v=>v>ucl||v<lcl).length; const required=n>1&&mean>0?Math.ceil((BARNES_Z*sd/(BARNES_PRECISION*mean))**2):null; const uniform=n>=2&&out===0; const testable=n>=settings.minInitialN; const sufficient=testable&&required!=null&&n>=required; return {n,mean,sd,ucl,lcl,out,uniform,testable,required,sufficient};}
function effectiveRows(g){const s=stats(g.rows);return g.rows.filter(r=>+r.time<=s.ucl&&+r.time>=s.lcl)}
function standardFor(element,size){const cat=grouped(true).find(g=>g.element===element&&g.size===size);const pool=grouped(false).find(g=>g.element===element);let source='Pooled fallback',g=pool;if(cat&&stats(cat.rows).sufficient&&stats(cat.rows).uniform){source='Category specific';g=cat}if(!g)return null;let st=stats(effectiveRows(g));if(!st.n)return null;let rfAvg=g.rows.reduce((a,r)=>a+(+settings.ratings[r.operator]||1),0)/g.rows.length;let normal=st.mean*rfAvg;let standard=normal/(1-(+settings.allowance||0));return {source,mean:st.mean,rf:rfAvg,normal,standard,n:st.n,stats:st};}
function setHeader(title,eyebrow='TIME & MOTION STUDY'){$('#pageTitle').textContent=title;$('#pageEyebrow').textContent=eyebrow;}
function kpi(label,value,sub=''){return `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`}
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
  if(!total)return `<div class="chart-empty">Belum ada standard time yang dapat divisualisasikan.</div>`;
  const colors=['#f7c600','#102a43','#263238','#b8860b']; let a=0;
  const slices=classNames.map((c,i)=>{const v=cls[c]||0,p=v/total*100,from=a; a+=p;return `<path d="${piePath(100,100,82,from,a)}" fill="${colors[i]}"></path>`}).join('');
  return `<div class="pie-chart-wrap"><svg class="pie-chart" viewBox="0 0 200 200" role="img" aria-label="Time Classification">${slices}<circle cx="100" cy="100" r="48" fill="#fff"></circle><text x="100" y="95" text-anchor="middle" class="pie-total-label">TOTAL</text><text x="100" y="115" text-anchor="middle" class="pie-total-value">${fmt(total)}</text></svg><div class="chart-legend">${classNames.map((c,i)=>`<div><i style="background:${colors[i]}"></i><span>${esc(c)}</span><b>${fmt(cls[c]||0)} dtk</b><small>${fmt((cls[c]||0)/total*100)}%</small></div>`).join('')}</div></div>`;
}
function piePath(cx,cy,r,from,to){if(to-from<=0)return '';const polar=d=>{const rad=(d-90)*Math.PI/180;return [cx+r*Math.cos(rad),cy+r*Math.sin(rad)]};const [x1,y1]=polar(from),[x2,y2]=polar(to);const large=to-from>50?1:0;return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;}
function dashboardPareto(top){
  if(!top.length)return `<div class="chart-empty">Belum ada data waste pada filter aktif.</div>`;
  const max=top[0].time||1; let cum=0;
  return `<div class="pareto-chart"><div class="pareto-scale"><span>100%</span><span>75%</span><span>50%</span><span>25%</span><span>0%</span></div><div class="pareto-bars">${top.map((x,i)=>{cum+=x.contribution;const h=Math.max(6,x.time/max*100);return `<div class="pareto-item"><div class="pareto-bar-wrap"><div class="pareto-bar" style="height:${h}%"><b>${fmt(x.time)}</b></div><span class="pareto-dot" style="bottom:${Math.min(100,cum)}%"><i></i><em>${fmt(cum)}%</em></span></div><small title="${esc(x.element)}">${i+1}. ${esc(x.waste)}</small></div>`}).join('')}</div></div>`;
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
      <div class="grid cols-4 dashboard-kpis">${kpi('NORMAL TIME (dtk)',fmt(normal),'Hasil agregasi filter aktif')}${kpi('STANDARD TIME (dtk)',fmt(standard),`Allowance ${fmt(settings.allowance*100)}% applied`)}${kpi('TOTAL WASTE (detik)',fmt(wasteTotal),'Waste dengan waktu terukur')}${kpi('WASTE TERBESAR',largest?largest.waste:'Tidak ada data waste',largest?`${fmt(largest.time)} dtk • ${fmt(largest.contribution)}% kontribusi`:'Tambahkan observasi untuk menghitung')}</div>
      <div class="grid cols-2 section">
        <div class="card chart-card"><h3>TIME CLASSIFICATION</h3>${dashboardPie(classNames,cls,classTotal)}<div class="table-wrap compact-table"><table class="data-table"><thead><tr><th>Klasifikasi</th><th>Waktu (dtk)</th><th>%</th></tr></thead><tbody>${classNames.map(c=>`<tr><td>${c}</td><td>${fmt(cls[c])}</td><td>${fmt(classTotal?cls[c]/classTotal*100:0)}%</td></tr>`).join('')}</tbody></table></div></div>
        <div class="card chart-card pareto-card"><h3>PARETO • TOP 5 WASTE</h3>${dashboardPareto(top)}<p class="chart-note">Batang menunjukkan waste time. Garis kumulatif menunjukkan kontribusi terhadap total waste pada filter aktif.</p><div class="pareto-table-block"><h3 class="subtable-title">TOP 5 LEAN / WASTE</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Element Kerja / Area</th><th>Jenis Waste</th><th>Waste Time (dtk)</th><th>Kontribusi</th><th>Prioritas</th></tr></thead><tbody>${top.length?top.map(x=>`<tr><td><b>${x.rank}</b></td><td>${esc(x.element)}</td><td>${esc(x.waste)}</td><td>${fmt(x.time)}</td><td>${fmt(x.contribution)}%</td><td><span class="badge ${x.contribution>=30?'bad':x.contribution>=20?'warn':'ok'}">${priority(x.contribution)}</span></td></tr>`).join(''):Array.from({length:5},(_,i)=>`<tr><td>${i+1}</td><td>Tidak ada data waste</td><td>-</td><td>0,00</td><td>0,0%</td><td>-</td></tr>`).join('')}</tbody></table></div></div></div>
      </div>
      <div class="card section"><h3>TOP 5 IMPROVEMENT PRIORITY</h3><p class="muted">Urutan berdasarkan kontribusi waste terhadap total waste pada filter aktif.</p><div class="table-wrap"><table class="data-table"><thead><tr><th>Rank</th><th>Element Kerja / Area</th><th>Jenis Waste</th><th>Waste Time (dtk)</th><th>Kontribusi</th><th>Prioritas</th></tr></thead><tbody>${top.length?top.map(x=>`<tr><td><b>${x.rank}</b></td><td>${esc(x.element)}</td><td>${esc(x.waste)}</td><td>${fmt(x.time)}</td><td>${fmt(x.contribution)}%</td><td><b>${priority(x.contribution)}</b></td></tr>`).join(''):Array.from({length:5},(_,i)=>`<tr><td>${i+1}</td><td>Tidak ada data waste</td><td>-</td><td>0,00</td><td>0,0%</td><td>-</td></tr>`).join('')}</tbody></table></div></div>`;
  };
  renderActivity();renderElement();renderResults();
  $('#dashProcess').onchange=e=>{f.process=e.target.value;f.activity='';f.element='';renderActivity();renderElement();renderResults()}; $('#dashActivity').onchange=e=>{f.activity=e.target.value;f.element='';renderElement();renderResults()}; $('#dashElement').onchange=e=>{f.element=e.target.value;renderResults()}; $('#dashSize').onchange=e=>{f.size=e.target.value;renderResults()}; $('#resetDashFilter').onclick=()=>{f.process=f.activity=f.element=f.size='';$('#dashProcess').value='';renderActivity();renderElement();$('#dashSize').value='';renderResults()};
}
function renderObserve(){
  setHeader('Observation','RAW DATA CAPTURE');
  $('#app').innerHTML=`<div class="content"><div class="workspace"><div class="card video-card"><div class="video-card-head"><h3>1. Upload & Segment Video</h3><button class="video-close hidden" id="removeVideo" type="button" title="Tutup video ini" aria-label="Tutup video ini">×</button></div><label class="dropzone">📹 <b>Pilih video pengamatan</b><small>Video tetap lokal di browser. File tidak di-upload ke server.</small><input id="videoInput" type="file" accept="video/*" hidden></label><div class="video-stage"><div class="video-wrap video-pending" id="videoWrap"><video id="video" controls playsinline preload="metadata"></video><div id="emptyVideo" class="video-empty"><div><strong>Belum ada video</strong><span>Pilih file video untuk memulai observasi</span></div></div></div><div class="seek-panel" id="seekPanel"><div class="seek-meta"><span id="seekCurrent">00:00.00</span><span id="seekDuration">00:00.00</span></div><input id="videoSeek" class="video-seek" type="range" min="0" max="0" value="0" step="0.01" aria-label="Geser posisi video"><div class="seek-caption"><span>Tarik garis waktu untuk maju atau mundur ke posisi yang diinginkan</span></div></div><div class="video-tools"><button class="video-skip" id="back5" type="button" title="Mundur 5 detik">↶ Mundur 5 Detik</button><button class="video-skip" id="forward5" type="button" title="Maju 5 detik">Maju 5 Detik ↷</button><button class="video-skip" id="fullVideo" type="button" title="Layar penuh">⛶ Fullscreen</button></div></div><div class="time-grid"><div class="timebox"><span>Current</span><b id="cur">—</b></div><div class="timebox"><span>Start</span><b id="start">—</b></div><div class="timebox"><span>End</span><b id="end">—</b></div><div class="timebox"><span>Observed</span><b id="elapsed">—</b></div><div class="timebox"><span>Duration</span><b id="dur">—</b></div></div><div class="seg-controls"><button class="btn secondary" id="setStart">● Set Start</button><button class="btn secondary" id="setEnd">■ Set End</button><button class="btn ghost" id="resetSeg">Reset</button></div><div class="manual-time card-lite"><div class="manual-time-head"><b>Input Waktu Observasi Manual</b><span>Gunakan jika observasi dilakukan tanpa video.</span></div><div class="manual-time-grid manual-single"><label>Total Waktu Pengamatan (detik)<input id="manualObservedTime" type="number" min="0.01" step="0.01" placeholder="Contoh: 8.47"></label><button class="btn primary" id="applyManualTime">Terapkan</button></div></div></div><div class="card classify-card"><h3>2. Classify Segment</h3><div class="form-grid"><label>Date<input id="date" type="date"></label><label>PIC<select id="operator">${opt(operatorList())}</select></label><label>Size<select id="size"><option>Small</option><option>Medium</option><option>Big</option></select></label><label>Study<input id="study" placeholder="Receiving_01"></label></div><label style="margin-top:12px">Process<select id="process">${opt(unique(masterData().map(x=>x.process)))}</select></label><label>Activity<select id="activity"><option value="">Pilih Process dahulu</option></select></label><label>Element Kerja<select id="element"><option value="">Pilih Activity dahulu</option></select></label><div class="master-preview"><div><span>Classification</span><b id="classification">—</b></div><div><span>Waste</span><b id="waste">—</b></div><div><span>Method</span><b id="method">—</b></div><div><span>Equipment</span><b id="equipment">—</b></div></div><label>Catatan<textarea id="note" rows="3"></textarea></label><div class="observation-save-action"><button class="btn primary full" id="saveObs">＋ Simpan Observasi</button></div></div></div></div>`;
  $('#date').value=new Date().toISOString().slice(0,10);
  wireObserve();
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
    $('#elapsed').textContent=state.manualTime!=null?fmt(state.manualTime)+' s':(state.start!=null&&state.end!=null?fmt(state.end-state.start)+' s':'—');
  };
  const clearSegment=()=>{state.start=state.end=state.manualTime=null;$('#manualObservedTime').value='';refreshTimes();};
  const applyManual=()=>{const observed=Number($('#manualObservedTime').value);if(!Number.isFinite(observed)||observed<=0){alert('Isi Total Waktu Pengamatan dengan angka lebih dari 0.');return false}state.manualTime=+observed.toFixed(2);state.start=null;state.end=null;refreshTimes();return true};
  const loadVideoFile=f=>{
    if(!f)return;
    if(state.videoUrl)URL.revokeObjectURL(state.videoUrl);
    state.videoUrl=URL.createObjectURL(f);
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
  $('#setStart').onclick=()=>{if(!hasVideo()){alert('Pilih video terlebih dahulu, atau gunakan Input Waktu Observasi Manual.');return}state.start=+video.currentTime.toFixed(2);state.end=null;state.manualTime=null;$('#manualObservedTime').value='';refreshTimes();video.play().catch(()=>{})};
  $('#setEnd').onclick=()=>{if(!hasVideo()){alert('Pilih video terlebih dahulu, atau gunakan Input Waktu Observasi Manual.');return}video.pause();state.end=+video.currentTime.toFixed(2);state.manualTime=null;if(state.start!=null&&state.end<state.start){alert('End harus lebih besar dari Start');state.end=null;return}refreshTimes()};
  $('#applyManualTime').onclick=applyManual;
  $('#resetSeg').onclick=clearSegment;
  $('#process').onchange=e=>{let arr=unique(masterData().filter(x=>x.process===e.target.value).map(x=>x.activity));$('#activity').innerHTML=opt(arr);$('#element').innerHTML='<option value="">Pilih Activity dahulu</option>';updateMaster()};
  $('#activity').onchange=e=>{let arr=masterData().filter(x=>x.process===$('#process').value&&x.activity===e.target.value).map(x=>x.element);$('#element').innerHTML=opt(arr);updateMaster()};
  $('#element').onchange=updateMaster;
  function updateMaster(){let m=getMaster($('#element').value);for(const [id,k] of [['classification','classification'],['waste','waste'],['method','method'],['equipment','equipment']])$('#'+id).textContent=m?m[k]:'—'}
  $('#saveObs').onclick=()=>{
    let element=$('#element').value;
    if(state.manualTime==null&&state.start!=null&&state.end!=null)state.manualTime=+(state.end-state.start).toFixed(2);
    if(state.manualTime==null&&$('#manualObservedTime').value!=='')applyManual();
    if(state.manualTime==null||!element||!$('#operator').value){alert('Lengkapi PIC, Element Kerja, dan Total Waktu Pengamatan. Waktu dapat diambil dari video atau diinput langsung secara manual.');return}
    let m=getMaster(element);
    observations.push({id:crypto.randomUUID(),date:$('#date').value,study:$('#study').value,operator:$('#operator').value,process:m.process,activity:m.activity,element,size:$('#size').value,start:state.start==null?null:+state.start.toFixed(2),end:state.end==null?null:+state.end.toFixed(2),time:+state.manualTime.toFixed(2),classification:m.classification,waste:m.waste,method:m.method,equipment:m.equipment,note:$('#note').value,createdAt:Date.now()});
    save();
    clearSegment();
    $('#note').value='';
    alert('Observasi berhasil disimpan. Video tetap aktif dan siap digunakan untuk observasi berikutnya.');
  };
}
function renderData(){setHeader('Data Waktu','RAW OBSERVATION MANAGEMENT');let proc=unique(masterData().map(x=>x.process));$('#app').innerHTML=`<div class="content"><div class="card"><div class="filters"><select id="fProc">${opt(proc,'All Process')}</select><select id="fSize"><option value="">All Size</option><option>Small</option><option>Medium</option><option>Big</option></select><input id="search" placeholder="Search element / PIC"></div><div id="dataTable"></div></div></div>`;function draw(){let rows=[...observations].filter(o=>(!$('#fProc').value||o.process===$('#fProc').value)&&(!$('#fSize').value||o.size===$('#fSize').value)&&(`${o.element} ${o.operator}`.toLowerCase().includes($('#search').value.toLowerCase()))).sort((a,b)=>b.createdAt-a.createdAt);$('#dataTable').innerHTML=rows.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>No</th><th>Date</th><th>PIC</th><th>Process</th><th>Activity</th><th>Element</th><th>Size</th><th>Start</th><th>End</th><th>Time</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r.date}</td><td>${esc(r.operator)}</td><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${r.size}</td><td>${t(r.start)}</td><td>${t(r.end)}</td><td><b>${fmt(r.time)} s</b></td><td><button class="btn ghost editObs" data-id="${r.id}">Edit</button> <button class="btn ghost del" data-id="${r.id}">Hapus</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">Tidak ada data yang sesuai filter.</div>';$$('.del').forEach(b=>b.onclick=()=>{if(confirm('Hapus observasi ini?')){observations=observations.filter(o=>o.id!==b.dataset.id);save();draw()}});$$('.editObs').forEach(b=>b.onclick=()=>{const o=observations.find(x=>x.id===b.dataset.id);if(!o)return;const nt=prompt('Observed Time (detik)',o.time);if(nt==null)return;const ns=prompt('Kategori Ukuran: Small / Medium / Big',o.size);if(ns==null)return;o.time=+nt||o.time;o.size=['Small','Medium','Big'].includes(ns)?ns:o.size;save();draw()})}['fProc','fSize','search'].forEach(id=>$('#'+id).oninput=draw);draw();}
function renderQuality(){setHeader('Data Quality','COVERAGE & VALIDATION');const gs=grouped(false);const rows=masterData().map(m=>{let g=gs.find(x=>x.element===m.element),s=g?stats(g.rows):{n:0};return {...m,n:s.n,status:s.n===0?'Not observed':s.n<2?'Need more data':'Observed'}});$('#app').innerHTML=`<div class="content"><div class="grid cols-4">${kpi('Master Elements',masterData().length,'From Peta Proses')}${kpi('Observed Elements',observedElements(),`${fmt(observedElements()/masterData().length*100)}% coverage`)}${kpi('Total Raw Data',observations.length,'Saved observations')}${kpi('Invalid Duration',observations.filter(x=>!x.time||x.time<=0).length,'Must be zero')}</div><div class="card section"><h3>Master Coverage</h3><div class="analysis-note">Element yang belum pernah diobservasi tidak dihitung sebagai “insufficient”. Coverage dan sufficiency sengaja dipisahkan.</div><div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Activity</th><th>Element</th><th>Classification</th><th>N</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${esc(r.classification)}</td><td>${r.n}</td><td><span class="badge ${r.status==='Observed'?'ok':'warn'}">${r.status}</span></td></tr>`).join('')}</tbody></table></div></div></div>`}
function analysisTable(kind){const cat=kind==='category',groups=grouped(cat);const cols=cat?'<th>Size</th>':'';let body=groups.map(g=>{let s=stats(g.rows),uniform=s.n<2?'Not testable':s.uniform?'Uniform':'Outlier detected';return `<tr><td>${esc(g.element)}</td>${cat?'<td>'+g.size+'</td>':''}<td>${s.n}</td><td>${fmt(s.mean)}</td><td>${fmt(s.sd)}</td><td>${fmt(s.ucl)}</td><td>${fmt(s.lcl)}</td><td>${s.out}</td><td><span class="badge ${s.uniform?'ok':s.n<2?'warn':'bad'}">${uniform}</span></td><td>${s.required??'—'}</td><td><span class="badge ${s.sufficient?'ok':s.n<2?'warn':'warn'}">${s.sufficient?'Sufficient':s.n<2?'Not testable':'Need data'}</span></td></tr>`}).join('');return `<div class="table-wrap"><table class="data-table stat-table"><thead><tr><th>Element</th>${cols}<th>N</th><th>Mean</th><th>SD</th><th>UCL</th><th>LCL</th><th>Out</th><th>Uniformity</th><th>N' Required</th><th>Sufficiency</th></tr></thead><tbody>${body||'<tr><td colspan="12">No observations yet.</td></tr>'}</tbody></table></div>`}
function renderUniformity(){setHeader('Uji Keseragaman','3-SIGMA CONTROL LIMIT');$('#app').innerHTML=`<div class="content"><div class="analysis-note">Pooled analysis mengikuti seluruh kategori ukuran untuk setiap Element Kerja. Data di luar UCL/LCL ditandai sebagai outlier.</div><div class="card"><h3>Pooled per Element</h3>${analysisTable('pooled')}</div><div class="card section"><h3>Element × Category</h3>${analysisTable('category')}</div></div>`}
function renderSufficiency(){setHeader('Uji Kecukupan','SAMPLE SUFFICIENCY');const groups=grouped(true);$('#app').innerHTML=`<div class="content"><div class="analysis-note"><b>N Minimum Observasi Awal = ${settings.minInitialN} observasi.</b> Jika N aktual masih di bawah nilai ini, statusnya <b>Belum Dapat Diuji</b> dan belum dapat disimpulkan cukup/belum cukup.</div><div class="card"><h3>Element × Category</h3>${analysisTable('category')}</div><div class="card section"><h3>Pooled per Element</h3>${analysisTable('pooled')}</div></div>`}
function renderRating(){
  setHeader('Rating Factor','WESTINGHOUSE • PER PIC');
  const skill=[['A1','+0.15'],['A2','+0.13'],['B1','+0.11'],['B2','+0.08'],['C1','+0.06'],['C2','+0.03'],['D','0.00'],['E1','-0.05'],['E2','-0.10'],['F1','-0.16'],['F2','-0.22']];
  const effort=[['A1','+0.13'],['A2','+0.12'],['B1','+0.10'],['B2','+0.08'],['C1','+0.05'],['C2','+0.02'],['D','0.00'],['E1','-0.04'],['E2','-0.08'],['F1','-0.12'],['F2','-0.17']];
  const condition=[['A','+0.06'],['B','+0.04'],['C','+0.02'],['D','0.00'],['E','-0.03'],['F','-0.07']];
  const consistency=[['A','+0.04'],['B','+0.03'],['C','+0.01'],['D','0.00'],['E','-0.02'],['F','-0.04']];
  const activities=unique(masterData().map(x=>x.activity).filter(Boolean));
  const grade=(list)=>`<select class="grade">${list.map(([k,v])=>`<option value="${v}">${k} (${v})</option>`).join('')}</select>`;
  const refTable=(title,list)=>`<div class="card section"><h3>${title}</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Grade</th><th>Adjustment</th></tr></thead><tbody>${list.map(x=>`<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`).join('')}</tbody></table></div></div>`;
  $('#app').innerHTML=`<div class="content">
    <div class="analysis-note"><b>N Minimum Observasi Awal</b> adalah jumlah minimum observasi aktual (N) yang harus tersedia sebelum data dievaluasi pada Uji Kecukupan. Jika N masih di bawah batas ini, statusnya <b>Belum Dapat Diuji</b>.</div>
    <div class="card section"><div class="form-grid two-equal"><label>N Minimum Observasi Awal (N)<input id="minInitialN" type="number" min="2" step="1" value="${settings.minInitialN}"><small>Minimum jumlah observasi sebelum evaluasi kecukupan</small></label><label>Allowance (%)<input id="allowance" type="number" min="0" max="90" step="0.1" value="${settings.allowance*100}"><small>Allowance untuk perhitungan Standard Time</small></label></div></div>
    <div class="card section"><div class="section-head rating-head"><div><h3>WESTINGHOUSE • PER PIC</h3><p class="muted">RF = 1 + Skill + Effort + Condition + Consistency. Perubahan diterapkan ke Normal Time dan Standard Time.</p></div><div class="add-pic-form"><input id="newOperator" placeholder="Nama"><select id="newOperatorDept">${opt(activities,'Pilih Bagian / Activity')}</select><button id="addOperator" class="btn secondary">＋ Tambah PIC</button></div></div>
    <div class="table-wrap rating-table-wrap"><table class="data-table rating-table"><thead><tr><th>PIC</th><th>Bagian / Activity</th><th>Skill</th><th>Effort</th><th>Condition</th><th>Consistency</th><th>Rating Factor</th><th>Aksi</th></tr></thead><tbody>${operatorList().map(o=>`<tr data-pic="${esc(o)}"><td><b>${esc(o)}</b></td><td><select class="pic-dept">${opt(activities,'Pilih Bagian / Activity')}</select></td><td>${grade(skill)}</td><td>${grade(effort)}</td><td>${grade(condition)}</td><td>${grade(consistency)}</td><td class="rf-result">1.000</td><td><button class="btn ghost remove-pic" data-pic="${esc(o)}">Hapus</button></td></tr>`).join('')}</tbody></table></div><button id="saveSettings" class="btn primary" style="margin-top:15px">Simpan Rating & Analysis Settings</button></div>
    <div class="grid cols-2 section">${refTable('Acuan Westinghouse — Skill',skill)}${refTable('Acuan Westinghouse — Effort',effort)}${refTable('Acuan Westinghouse — Condition',condition)}${refTable('Acuan Westinghouse — Consistency',consistency)}</div>
  </div>`;
  $$('#app tr[data-pic]').forEach(tr=>{
    const pic=tr.dataset.pic, old=settings.westinghouse?.[pic];
    const dept=tr.querySelector('.pic-dept'); dept.value=settings.operatorDepartments?.[pic]||'';
    if(old){const vals=[old.skill,old.effort,old.condition,old.consistency];$$('.grade',tr).forEach((el,i)=>{if(vals[i]!=null)el.value=String(vals[i])})}
    const recalc=()=>{const v=$$('.grade',tr).map(x=>+x.value);tr.querySelector('.rf-result').textContent=westinghouseFactor({skill:v[0],effort:v[1],condition:v[2],consistency:v[3]}).toFixed(3)};
    $$('.grade',tr).forEach(x=>x.onchange=recalc);recalc();
  });
  $('#addOperator').onclick=()=>{const name=$('#newOperator').value.trim(),dept=$('#newOperatorDept').value;if(!name)return alert('Masukkan nama PIC.');if(!dept)return alert('Pilih Bagian / Activity untuk PIC.');if(operatorList().includes(name))return alert('PIC sudah ada.');settings.operators.push(name);settings.operatorDepartments[name]=dept;settings.ratings[name]=1;save();renderRating()};
  $$('.remove-pic').forEach(b=>b.onclick=()=>{const pic=b.dataset.pic;if(!confirm(`Hapus PIC ${pic}?`))return;settings.operators=settings.operators.filter(x=>x!==pic);delete settings.ratings[pic];delete settings.operatorDepartments[pic];if(settings.westinghouse)delete settings.westinghouse[pic];save();renderRating()});
  $('#saveSettings').onclick=()=>{settings.allowance=(+$('#allowance').value||0)/100;settings.minInitialN=Math.max(2,Math.round(+$('#minInitialN').value||5));settings.westinghouse??={};$$('#app tr[data-pic]').forEach(tr=>{const pic=tr.dataset.pic,v=$$('.grade',tr).map(x=>+x.value);settings.operatorDepartments[pic]=tr.querySelector('.pic-dept').value;settings.westinghouse[pic]={skill:v[0],effort:v[1],condition:v[2],consistency:v[3]};settings.ratings[pic]=westinghouseFactor(settings.westinghouse[pic])});save();alert('Rating Factor, Bagian PIC, N Minimum, dan Allowance berhasil disimpan.');renderRating()};
}
function renderStandard(){setHeader('Standard Time','NORMAL TIME → ALLOWANCE → STANDARD TIME');let rows=masterData().map(m=>{let sizes=['Small','Medium','Big'];return sizes.map(size=>({m,size,r:standardFor(m.element,size)}))}).flat().filter(x=>x.r);$('#app').innerHTML=`<div class="content"><div class="analysis-note">Jika data kategori memenuhi uniformity + sufficiency, digunakan <b>Category specific</b>. Jika belum, sistem menggunakan <b>Pooled fallback</b> untuk element tersebut.</div><div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Element</th><th>Size</th><th>N</th><th>Mean</th><th>RF</th><th>Normal Time</th><th>Allowance</th><th>Standard Time</th><th>Source</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.m.process)}</td><td>${esc(x.m.element)}</td><td>${x.size}</td><td>${x.r.n}</td><td>${fmt(x.r.mean)}</td><td>${fmt(x.r.rf)}</td><td>${fmt(x.r.normal)}</td><td>${fmt(settings.allowance*100)}%</td><td><b>${fmt(x.r.standard)} s</b></td><td><span class="badge ${x.r.source==='Category specific'?'ok':'warn'}">${x.r.source}</span></td></tr>`).join('')||'<tr><td colspan="10">No standard time available. Add observations first.</td></tr>'}</tbody></table></div></div></div>`}
function renderWaste(){setHeader('Waste & Pareto','LEAN ANALYSIS');const map={};masterData().forEach(m=>{if(!m.waste||m.waste==='-')return;let vals=['Small','Medium','Big'].map(s=>standardFor(m.element,s)).filter(Boolean);if(!vals.length)return;let avg=vals.reduce((a,x)=>a+x.standard,0)/vals.length;map[m.waste]=(map[m.waste]||0)+avg*(m.frequency||0)});let rows=Object.entries(map).sort((a,b)=>b[1]-a[1]);let total=rows.reduce((a,x)=>a+x[1],0),cum=0,max=rows[0]?.[1]||1;$('#app').innerHTML=`<div class="content"><div class="grid cols-3">${kpi('Waste Types',rows.length,'With measurable standard time')}${kpi('Total Waste / Day',fmt(total)+' s','Standard Time × Frequency / Day')}${kpi('Top Waste',rows[0]?.[0]||'—',rows[0]?fmt(rows[0][1])+' s/day':'')}</div><div class="card section"><h3>Pareto Waste</h3>${rows.length?rows.map(([k,v])=>{cum+=v;return `<div class="chart-row"><div class="chart-label">${esc(k)}</div><div class="bar" style="width:${Math.max(8,v/max*100)}%"><i style="width:100%"></i><small>${fmt(v)} s</small></div></div>`}).join(''):'<div class="empty">Waste master belum memiliki kategori yang dapat dianalisis atau belum ada data observasi.</div>'}</div><div class="card section"><h3>Contribution Detail</h3><div class="table-wrap"><table class="data-table"><thead><tr><th>Waste</th><th>Time / Day</th><th>%</th><th>Cumulative %</th></tr></thead><tbody>${rows.map(([k,v])=>{cum=(cum||0);return ''}).join('')}${(()=>{let c=0;return rows.map(([k,v])=>{c+=v;return `<tr><td>${esc(k)}</td><td>${fmt(v)} s</td><td>${fmt(v/total*100)}%</td><td>${fmt(c/total*100)}%</td></tr>`}).join('')})()}</tbody></table></div></div></div>`}
function exportCsv(){const headers=['No','Tanggal','PIC','Process','Activity','Element Kerja','Klasifikasi','Waste','Waktu Detik','Kategori Ukuran','Metode','Peralatan','RF PIC','Start','End','Catatan'];const rows=observations.map((o,i)=>[i+1,o.date,o.operator,o.process,o.activity,o.element,o.classification,o.waste,o.time,o.size,o.method,o.equipment,settings.ratings[o.operator]||1,o.start,o.end,o.note]);const csv=[headers,...rows].map(r=>r.map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='TMS_PDC_Warehouse_Data_Waktu.csv';a.click();URL.revokeObjectURL(a.href)}
function importCsv(file){const reader=new FileReader();reader.onload=e=>{let lines=e.target.result.split(/\r?\n/).filter(Boolean),head=lines.shift().split(',').map(x=>x.replace(/^"|"$/g,''));let added=0;lines.forEach(line=>{let cols=[],re=/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g,m;while(m=re.exec(line))cols.push(m[1].replace(/^"|"$/g,'').replace(/""/g,'"'));let get=n=>cols[head.indexOf(n)]||'';let el=get('Element Kerja'),master=getMaster(el);if(master){observations.push({id:crypto.randomUUID(),date:get('Tanggal'),operator:get('PIC'),process:master.process,activity:master.activity,element:el,size:get('Kategori Ukuran')||'Small',time:+get('Waktu Detik'),start:+get('Start')||0,end:+get('End')||0,classification:master.classification,waste:master.waste,method:master.method,equipment:master.equipment,note:get('Catatan'),createdAt:Date.now()});added++}});save();alert(added+' observations imported.');render();};reader.readAsText(file)}

function renderMaster(){
 setHeader('Master Process & Lean','MASTER DATA • EDITABLE');
 const rows=masterData();
 $('#app').innerHTML=`<div class="content">
 <div class="card"><div class="section-head"><div><h3>Master Data Dinamis</h3></div><div><button id="addMaster" class="btn primary">＋ Tambah Element</button></div></div>
 <div class="master-legend"><b>8 Lean Waste:</b> ${WASTE_TYPES.map(x=>`<span class="badge warn">${x}</span>`).join(' ')} <span class="badge">None / - = tidak ada waste</span></div>
 <div class="table-wrap"><table class="data-table"><thead><tr><th>Process</th><th>Activity</th><th>Element Kerja</th><th>Klasifikasi</th><th>Lean Waste</th><th>Metode</th><th>Peralatan</th><th>Freq/Hari</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr><td>${esc(r.process)}</td><td>${esc(r.activity)}</td><td>${esc(r.element)}</td><td>${esc(r.classification)}</td><td>${esc(r.waste||'-')}</td><td>${esc(r.method||'-')}</td><td>${esc(r.equipment||'-')}</td><td>${fmt(r.frequency)}</td><td><button class="btn ghost editMaster" data-i="${i}">Edit</button> <button class="btn ghost delMaster" data-i="${i}">Hapus</button></td></tr>`).join('')}</tbody></table></div></div></div>`;
 function modal(existing={},editIndex=null){
  const html=`<div class="modal-backdrop" id="masterModal"><div class="modal"><h3>${editIndex==null?'Tambah':'Edit'} Master Element</h3><div class="form-grid"><label>Process<input id="mProcess" value="${esc(existing.process||'')}"></label><label>Activity<input id="mActivity" value="${esc(existing.activity||'')}"></label><label class="full">Element Kerja<input id="mElement" value="${esc(existing.element||'')}"></label><label>Klasifikasi<select id="mClass">${CLASSIFICATIONS.map(x=>`<option ${existing.classification===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Lean Waste<select id="mWaste"><option value="-">None / Tidak ada waste</option>${WASTE_TYPES.map(x=>`<option ${existing.waste===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Metode<input id="mMethod" value="${esc(existing.method||'Manual')}"></label><label>Peralatan<input id="mEquipment" value="${esc(existing.equipment||'-')}"></label><label>Frekuensi / Hari<input id="mFreq" type="number" min="0" step="0.01" value="${existing.frequency??0}"></label><label class="full">Catatan<textarea id="mNotes">${esc(existing.notes||'')}</textarea></label></div><div class="modal-actions"><button id="saveMaster" class="btn primary">Simpan</button><button id="closeMaster" class="btn ghost">Batal</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  $('#closeMaster').onclick=()=>$('#masterModal').remove();
  $('#saveMaster').onclick=()=>{const v={process:$('#mProcess').value.trim(),activity:$('#mActivity').value.trim(),element:$('#mElement').value.trim(),classification:$('#mClass').value,waste:$('#mWaste').value,method:$('#mMethod').value.trim()||'-',equipment:$('#mEquipment').value.trim()||'-',frequency:+$('#mFreq').value||0,notes:$('#mNotes').value.trim()};if(!v.process||!v.activity||!v.element)return alert('Process, Activity, dan Element Kerja wajib diisi.');let a=masterData();if(editIndex==null)a.push(v);else a[editIndex]=v;saveMaster(a);save();$('#masterModal').remove();renderMaster();};
 }
 $('#addMaster').onclick=()=>modal();
 $$('.editMaster').forEach(b=>b.onclick=()=>modal(masterData()[+b.dataset.i],+b.dataset.i));
 $$('.delMaster').forEach(b=>b.onclick=()=>{if(confirm('Hapus master element ini? Observasi lama tidak otomatis dihapus.')){let a=masterData();a.splice(+b.dataset.i,1);saveMaster(a);save();renderMaster();}});
}

const renderers={dashboard:renderDashboard,observe:renderObserve,data:renderData,master:renderMaster,quality:renderQuality,uniformity:renderUniformity,sufficiency:renderSufficiency,rating:renderRating,standard:renderStandard,waste:renderWaste};
function setSidebar(open){const shell=$('#appShell'); if(!shell)return; shell.classList.toggle('sidebar-open',!!open); const toggle=$('#sidebarToggle'); if(toggle) toggle.setAttribute('aria-expanded',String(!!open));}
function render(){renderers[state.view]();$$('#nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));}
$$('#nav button[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;setSidebar(false);render()});document.body.addEventListener('click',e=>{let b=e.target.closest('[data-go]');if(b){state.view=b.dataset.go;setSidebar(false);render()}});$('#sidebarToggle').onclick=()=>setSidebar(!$('#appShell').classList.contains('sidebar-open'));$('#sidebarBackdrop').onclick=()=>setSidebar(false);document.addEventListener('keydown',e=>{if(e.key==='Escape')setSidebar(false)});$('#exportCsv').onclick=exportCsv;$('#importCsv').onchange=e=>e.target.files[0]&&importCsv(e.target.files[0]);$('#clearAll').onclick=()=>{if(confirm('Hapus semua local observations?')){observations=[];save();render()}};render();

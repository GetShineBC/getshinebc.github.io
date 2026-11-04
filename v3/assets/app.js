/* ShineIQ Market Atlas V2
   New, independent static frontend. The existing V1 deployment is never written.
   Purely local CSV enrichments; immutable V1 base measurements.
*/
(() => {
'use strict';
const COUNTY = window.SIQV2_DATA || [];
const ENRICH = window.SIQV2_ENRICHMENT || {};
const GEO = window.SIQV2_GEOMETRY || {};
const OUTLINES = window.SIQV2_STATE_OUTLINES || {};
const byId = new Map(COUNTY.map(r=>[r.f,r]));
const T = { solar:1449.0233333333, res:.15692996, com:.12873041 };
const SVG = 'http://www.w3.org/2000/svg';
const REGIONS = {
 northeast:new Set('CT ME MA NH RI VT NJ NY PA'.split(' ')),
 midwest:new Set('IL IN MI OH WI IA KS MN MO NE ND SD'.split(' ')),
 south:new Set('DE DC FL GA MD NC SC VA WV AL KY MS TN AR LA OK TX'.split(' ')),
 west:new Set('AZ CO ID MT NV NM UT WY AK CA HI OR WA'.split(' '))
};
const STATE = {
 tab:'map', sector:'res', metric:'value', region:'all', state:'all', search:'', localOnly:false,
 selected:byId.has('06073')?'06073':COUNTY[0]?.f,
 compare:['06073','15001','06083'].filter(f=>byId.has(f)),
 rankCount:25, zoom:{x:0,y:0,w:1040,h:711},
 weights:{value:55,solar:25,multifamily:0,lihtc:0,confidence:20},
 acs:new Map(Object.entries(ENRICH.acs||{})),lihtc:new Map(Object.entries(ENRICH.lihtc||{})),rates2026:new Map(COUNTY.filter(r=>ENRICH.rates?.[r.st]).map(r=>[r.f,ENRICH.rates[r.st]])),tariffSnapshots:new Map(),refinedSolar:new Map(),useRefinedSolar:false,
 imported:{acs:null,lihtc:null,rates:null,solar:null}, scores:new Map(), scorerNote:'', activeDots:new Map()
};
const palettes={
 value:[[229,243,239],[129,199,175],[29,139,104],[10,91,72]],
 price:[[239,234,248],[195,173,222],[137,98,183],[88,55,129]],
 solar:[[228,243,252],[143,202,229],[58,147,190],[25,87,139]],
 score:[[231,245,236],[154,208,171],[57,151,105],[25,95,65]],
 multifamily:[[230,242,251],[155,204,232],[64,143,186],[28,79,128]],
 lihtc:[[243,233,249],[204,179,224],[151,111,184],[99,61,132]]
};
// V2 VISUAL HOTFIX START: exact, recovered V1 color classes (2026-11-03).
// Price increases left-to-right; solar productivity increases bottom-to-top.
// These palettes match V1's independently archived national SVG maps.
const V1_HIGH_MATRIX=[
 ['#45a9bb','#3c8091','#163d59'], // high PV: low / mid / high retail price
 ['#a7d6d6','#9cbaa5','#7d955a'], // mid PV
 ['#e6eaee','#d9cc9c','#ca9c3b']  // low PV
];
const V1_VALUE_COLORS=['#e6edf1','#b4cdd2','#78aab4','#3d788e','#173f5b'];
let V1_QUALIFIED_ONLY=false;
// V2 VISUAL HOTFIX END

const METRIC = {
 value:['Annual retail-value potential','Annual modeled production × 2025 EIA average retail price; not actual realized savings.','$ / kWdc / year'],
 high:['High electricity price + high solar productivity','Top national third in both dimensions; requires both cutoffs.','Qualified counties'],
 price:['2025 electricity price benchmark','Separate residential and commercial EIA annual realized average rates.','¢ per kWh'],
 solar:['Annual specific solar yield','PVGIS historical weather and standardized installation; kWh AC per kWdc.','kWh / kWdc / year'],
 score:['Shine market-priority score','User-adjustable percentile score based on verified factors.','Score / 100'],
 multifamily:['Multifamily rental-home count','2024 ACS 5-year renter-occupied units in structures with 5+ units; counts of homes, not buildings.','Renter-occupied 5+ units'],
 lihtc:['HUD LIHTC property inventory','HUD historical LIHTC project records mapped to county; not current solar leads or a count of unique buildings.','LIHTC project records'],
 change:['2025 → 2026 electricity price change','EIA state averages: January-August 2026 minus January-August 2025. Identical periods and sector; 2026 preliminary. Counties share their state result.','Change (¢/kWh)']
};
const $ = id => document.getElementById(id);
const fmt = (n,d=0) => n!==null&&n!==''&&n!==undefined&&Number.isFinite(Number(n))?Number(n).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d}):'—';
const money = (n,d=0) => n!==null&&n!==''&&n!==undefined&&Number.isFinite(Number(n))?'$'+fmt(n,d):'—';
const cents = n => n!==null&&n!==''&&n!==undefined&&Number.isFinite(Number(n))?fmt(n*100,2)+'¢':'—';
const esc = s => String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const median = arr => {const x=arr.filter(Number.isFinite).slice().sort((a,b)=>a-b);return x.length?x[Math.floor(x.length/2)]:NaN;};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function p(r){return STATE.sector==='res'?r.res:r.com}
function method(r){return STATE.sector==='res'?r.rm:r.cm}
function isUtility(r){return !String(method(r)).includes('state_average_fallback')}
function solar(r){return STATE.useRefinedSolar && STATE.refinedSolar.has(r.f)?STATE.refinedSolar.get(r.f).solar:r.solar}
const INSTALLED_COST_PER_KW_DC=2760;
function value(r){return solar(r)*p(r)}
function high(r){return p(r)>=T[STATE.sector] && solar(r)>=T.solar}
function textRegion(st){return Object.keys(REGIONS).find(k=>REGIONS[k].has(st))??'none'}
function matches(r){
 if(STATE.state!=='all' && r.st!==STATE.state)return false;
 if(STATE.region!=='all' && !REGIONS[STATE.region]?.has(r.st))return false;
 if(STATE.localOnly && !isUtility(r))return false;
 if(STATE.search && !(r.n+' '+r.st+' '+r.sn).toLowerCase().includes(STATE.search))return false;
 return true;
}
function filtered(){return COUNTY.filter(matches)}
function metric(r,which=STATE.metric){
 switch(which){
  case 'value':return value(r);
  case 'high':return high(r)?1:0;
  case 'price':return p(r)*100;
  case 'solar':return solar(r);
  case 'score':return STATE.scores.get(r.f)?.score??null;
  case 'multifamily':return STATE.acs.get(r.f)?.units??null;
  case 'lihtc':return STATE.lihtc.get(r.f)?.properties??null;
  case 'change':{const t=STATE.rates2026.get(r.f);const v=STATE.sector==='res'?t?.res:t?.com;const old=STATE.sector==='res'?t?.res2025:t?.com2025;return Number.isFinite(v)&&Number.isFinite(old)?(v-old)*100:null;}
 }
 return null;
}
function metricString(r,which=STATE.metric){const v=metric(r,which);if(!Number.isFinite(v))return'Not available';switch(which){case'value':return money(v,0);case'high':return v?'High on both':'Not high on both';case'price':return fmt(v,2)+'¢/kWh';case'solar':return fmt(v,0)+' kWh/kWdc';case'score':return fmt(v,1)+'/100';case'multifamily':return fmt(v)+' rental units';case'lihtc':return fmt(v)+' project records';case'change':return(v>0?'+':'')+fmt(v,2)+'¢/kWh';default:return fmt(v)}}
const pct = (s)=>Math.round(100*s/COUNTY.length);
function toast(msg,bad=false){const t=$('toast');t.textContent=msg;t.style.borderColor=bad?'#bf7453':'#5cbf91';t.style.background=bad?'#57382e':'#1b4538';t.hidden=false;clearTimeout(toast.timer);t.style.background=bad?'#fff0e5':'#e5f6eb';t.style.color=bad?'#8a4920':'#185d45';toast.timer=setTimeout(()=>t.hidden=true,4800)}
function switchTab(tab){if(!['map','quadrant','compare','inventory','economics','scoring','methods'].includes(tab))return;STATE.tab=tab;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));document.querySelectorAll('.tab-panel').forEach(x=>x.classList.toggle('active',x.id==='tab-'+tab));if(tab==='quadrant')updateScatter();if(tab==='compare')updateCompare();if(tab==='inventory')updateInventory();if(tab==='economics')updateScenario();if(tab==='scoring')updateScoring();window.scrollTo({top:document.querySelector('.tabnav').getBoundingClientRect().top+window.scrollY-95,behavior:'smooth'});}
function fillStates(){const states=[...new Map(COUNTY.map(r=>[r.st,r.sn])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));const s=$('stateSelect');for(const [id,name] of states){const o=document.createElement('option');o.value=id;o.textContent=name;s.appendChild(o)};const sc=$('scenarioCounty');for(const r of [...COUNTY].sort((a,b)=>((a.st+a.n).localeCompare(b.st+b.n)))){const o=document.createElement('option');o.value=r.f;o.textContent=r.n+', '+r.st;sc.appendChild(o)}sc.value=STATE.selected;}
function renderStats(){const d=filtered(),pr=d.map(p),ys=d.map(solar),h=d.filter(high).length;const avg=d.map(value);const cards=[['COUNTIES IN VIEW',fmt(d.length),'of 3,144 U.S. county equivalents'],['MEDIAN ELECTRICITY PRICE',cents(median(pr)),STATE.sector==='res'?'2025 residential benchmark':'2025 commercial benchmark'],['MEDIAN ANNUAL PV YIELD',fmt(median(ys)),'kWh AC / kW DC / year'],['HIGH ON BOTH',fmt(h), 'top third in both nationally'],['MEDIAN VALUE / kW DC',money(median(avg)), 'gross retail-value potential / year']];$('statsBar').innerHTML=cards.map((x,i)=>`<div class="stat"><div class="stat-label">${x[0]}</div><div class="stat-value ${i===3?'mint':''}">${x[1]}</div><div class="stat-sub">${x[2]}</div></div>`).join('');$('priceThreshold').textContent=cents(T[STATE.sector]);$('hiBothCount').textContent=fmt(h);}
function colorLerp(a,b,t){return Math.round(a+(b-a)*t)}
function ramp(t,pal){t=clamp(t,0,1)*(pal.length-1);const ix=Math.min(pal.length-2,Math.floor(t));const q=t-ix;return'rgb('+[0,1,2].map(i=>colorLerp(pal[ix][i],pal[ix+1][i],q)).join(',')+')'}
function quantile(arr,q){if(!arr.length)return 0;const s=arr.slice().sort((a,b)=>a-b),i=(s.length-1)*q;const a=Math.floor(i),b=Math.ceil(i);return s[a]+(s[b]-s[a])*(i-a)}
// V2 VISUAL HOTFIX START: fixed NATIONAL thresholds; filtering does not move colors.
function v1ReferenceCuts(){
 const prices=COUNTY.map(p).filter(Number.isFinite);
 const yields=COUNTY.map(solar).filter(Number.isFinite);
 const vals=COUNTY.map(value).filter(Number.isFinite);
 return {
  price:[quantile(prices,1/3),quantile(prices,2/3)],
  solar:[quantile(yields,1/3),quantile(yields,2/3)],
  value:[.2,.4,.6,.8].map(q=>quantile(vals,q)),
  valueMin:Math.min(...vals),valueMax:Math.max(...vals)
 };
}
function v1Tertile(v,cuts){return !Number.isFinite(v)?-1:v>=cuts[1]?2:v>=cuts[0]?1:0}
function v1HighLegend(cuts){
 const tiles=V1_HIGH_MATRIX.flat().map(c=>`<i class="v1-bi-cell" style="background:${c}" aria-hidden="true"></i>`).join('');
 return `<div class="v1-bivariate-legend"><div class="v1-bi-grid" role="img" aria-label="Bivariate legend: solar yield increases from bottom to top, electricity price increases from left to right. Dark blue top right is high in both.">${tiles}</div><div class="v1-bi-copy"><strong>Dark blue = high on both</strong><span>Price ≥ ${fmt(T[STATE.sector]*100,1)}¢/kWh · Yield ≥ ${fmt(T.solar,0)} kWh/kW DC/yr</span><span>Teal: stronger solar · Gold: stronger price</span><button id="v1HighToggle" type="button" aria-pressed="${V1_QUALIFIED_ONLY}" class="v1-map-toggle">${V1_QUALIFIED_ONLY?'Show full spectrum':'Qualified only'}</button></div></div>`;
}
function v1ValueLegend(cuts){
 const samples=V1_VALUE_COLORS.map(c=>`<i class="v1-value-cell" style="background:${c}" aria-hidden="true"></i>`).join('');
 const labels=[cuts.valueMin,...cuts.value,cuts.valueMax].map(v=>`<span>$${fmt(v,0)}</span>`).join('');
 return `<div class="v1-value-legend"><div class="v1-value-head"><strong>Annual value per installed kW DC</strong><span>National quintiles · higher →</span></div><div class="v1-value-tiles" role="img" aria-label="Five discrete county value quintiles, light blue to dark navy">${samples}</div><div class="v1-value-labels">${labels}</div></div>`;
}
// V2 VISUAL HOTFIX END

function legendBounds(){const vals=COUNTY.map(r=>metric(r)).filter(Number.isFinite);if(!vals.length)return null;return{min:quantile(vals,.03),max:quantile(vals,.97),actualMin:Math.min(...vals),actualMax:Math.max(...vals)}}
function pathColor(r,bounds,v1Cuts){
 if(STATE.metric==='high'){
  if(V1_QUALIFIED_ONLY)return high(r)?'#163d59':'#e6eaee';
  const x=v1Tertile(p(r),v1Cuts.price),y=v1Tertile(solar(r),v1Cuts.solar);
  return x<0||y<0?'#e6eaee':V1_HIGH_MATRIX[2-y][x];
 }
 if(STATE.metric==='value'){
  const v=value(r);if(!Number.isFinite(v))return'#e9eef2';
  let q=0;while(q<v1Cuts.value.length&&v>=v1Cuts.value[q])q++;
  return V1_VALUE_COLORS[q];
 }
 const v=metric(r);if(!Number.isFinite(v))return'#e9eef2';
 if(STATE.metric==='change'){
  const m=Math.max(1.0,Math.abs(bounds?.min??0),Math.abs(bounds?.max??0));
  return v>0?ramp(v/m,[[255,248,232],[232,164,77],[173,80,27]]):ramp(Math.abs(v)/m,[[243,248,252],[117,177,208],[36,96,155]]);
 }
 const q=(v-(bounds?.min??0))/Math.max(.00001,(bounds?.max??1)-(bounds?.min??0));
 return ramp(q,palettes[STATE.metric]||palettes.value);
}
function buildMap(){const g=$('countyShapes');const frag=document.createDocumentFragment();for(const r of COUNTY){const path=document.createElementNS(SVG,'path');path.setAttribute('d',GEO[r.f]||'');path.classList.add('county');path.dataset.fips=r.f;path.addEventListener('pointermove',e=>showMapTooltip(e,r));path.addEventListener('pointerleave',()=>{$('mapTooltip').hidden=true});path.addEventListener('click',()=>{if(!mapDrag.moved)selectCounty(r.f)});frag.appendChild(path);}g.appendChild(frag);const st=$('stateOutlines'),frag2=document.createDocumentFragment();for(const [k,d] of Object.entries(OUTLINES)){const path=document.createElementNS(SVG,'path');path.setAttribute('d',d);path.setAttribute('data-state',k);frag2.appendChild(path)}st.appendChild(frag2);initMapZoom();}
function showMapTooltip(e,r){
 const el=$('mapTooltip'),stage=$('mapStage'),bounds=stage.getBoundingClientRect();
 let x=e.clientX-bounds.left+13,y=e.clientY-bounds.top-115;
 x=Math.min(x,Math.max(12,bounds.width-275));
 y=clamp(y,6,Math.max(6,bounds.height-178));
 el.style.left=x+'px';el.style.top=y+'px';
 el.innerHTML=`<b>${esc(r.n)}, ${esc(r.st)}</b><span class="v3-tooltip-return">${((value(r)/INSTALLED_COST_PER_KW_DC)*100).toFixed(1)}%<small>ANNUAL RETURN ON COST</small></span><span class="v3-tooltip-value">${money(value(r))} annual retail-value potential / kW DC</span><span class="v3-tooltip-cost">$2,760 installed cost / kW DC</span><span class="v3-tooltip-quality">${esc(layerProvenance(r))}</span>`;
 el.hidden=false;
}
function updateMap(){const bounds=legendBounds(),v1Cuts=v1ReferenceCuts();const allPaths=$('countyShapes').querySelectorAll('path');let count=0,avail=0,fallback=0;for(const el of allPaths){const r=byId.get(el.dataset.fips),ok=matches(r);if(ok){count++;if(!isUtility(r))fallback++;}el.style.opacity=ok?'1':'.10';el.setAttribute('fill',pathColor(r,bounds,v1Cuts));el.classList.toggle('selected',r.f===STATE.selected);if(Number.isFinite(metric(r)))avail++;}const [title,sub,units]=METRIC[STATE.metric];$('mapTitle').textContent=title;$('mapSubtitle').textContent=sub;$('metricOptions').querySelectorAll('[data-metric]').forEach(b=>b.classList.toggle('active',b.dataset.metric===STATE.metric));const legend=$('mapLegend');if(STATE.metric==='high')legend.innerHTML=v1HighLegend(v1Cuts);else if(STATE.metric==='value')legend.innerHTML=v1ValueLegend(v1Cuts);else if(!bounds)legend.innerHTML='<span class="legend-caption">No verified data available for this measure yet</span>';else legend.innerHTML=`<span class="legend-caption">${esc(fmt(bounds.min,STATE.metric==='price'||STATE.metric==='change'?1:0))}</span><span class="legend-gradient"></span><span class="legend-caption">${esc(fmt(bounds.max,STATE.metric==='price'||STATE.metric==='change'?1:0))} <small>${esc(units)}</small></span>`;const v1Toggle=$('v1HighToggle');if(v1Toggle)v1Toggle.addEventListener('click',()=>{V1_QUALIFIED_ONLY=!V1_QUALIFIED_ONLY;updateMap()});$('mapStatus').textContent=`${fmt(count)} visible · ${STATE.metric==='change'?'51 state-level trends; not county tariffs':['multifamily','lihtc'].includes(STATE.metric)?fmt(filtered().filter(r=>Number.isFinite(metric(r))).length)+' with inventory data':fmt(fallback)+' state-price estimates'}`;
$('coverageMini').innerHTML=`<div class="coverage-heading">DATA COVERAGE · ALL U.S.</div><div class="coverage-row"><span>Solar PVGIS verified</span><strong>3,144 / 3,144</strong></div><div class="coverage-bar"><span style="width:100%"></span></div><div class="coverage-row"><span>Utility-specific price</span><strong>${STATE.sector==='res'?'1,052':'1,055'} / 3,144</strong></div><div class="coverage-bar"><span style="width:${STATE.sector==='res'?33.5:33.6}%"></span></div><div class="coverage-caveat">State fallback rates are distinct from utility-specific county estimates. <button id="coverageAction">Review sources</button></div>`;
$('coverageAction').addEventListener('click',openDataHub);updateLayerState();updateDetail();updateRankings();renderStats();}
const mapDrag={down:false,moved:false,at:null,box:null};
function applyViewBox(){const z=STATE.zoom;$('usaMap').setAttribute('viewBox',`${z.x} ${z.y} ${z.w} ${z.h}`)}
function zoomMap(amount,cx=null,cy=null){const z=STATE.zoom,f=amount>0?.78:1.28,x=cx??(z.x+z.w/2),y=cy??(z.y+z.h/2),newW=clamp(z.w*f,200,1400),newH=newW*(711/1040);const t=(x-z.x)/z.w,u=(y-z.y)/z.h;STATE.zoom={x:x-newW*t,y:y-newH*u,w:newW,h:newH};applyViewBox()}
function initMapZoom(){
 const svg=$('usaMap');
 $('zoomIn').addEventListener('click',()=>zoomMap(1));
 $('zoomOut').addEventListener('click',()=>zoomMap(-1));
 $('zoomReset').addEventListener('click',()=>{STATE.zoom={x:0,y:0,w:1040,h:711};applyViewBox()});
 svg.addEventListener('wheel',e=>{
  e.preventDefault();
  const b=svg.getBoundingClientRect();
  const cx=STATE.zoom.x+(e.clientX-b.left)/b.width*STATE.zoom.w;
  const cy=STATE.zoom.y+(e.clientY-b.top)/b.height*STATE.zoom.h;
  zoomMap(e.deltaY<0?1:-1,cx,cy);
 },{passive:false});
 // Capturing on pointerdown redirects click away from county paths.
 // Capture only when moving far enough to indicate a genuine pan gesture.
 svg.addEventListener('pointerdown',e=>{
  if(e.button!==0 || mapDrag.down)return;
  mapDrag.down=true;
  mapDrag.moved=false;
  mapDrag.at={x:e.clientX,y:e.clientY};
  mapDrag.box={...STATE.zoom};
  mapDrag.pointerId=e.pointerId;
 });
 svg.addEventListener('pointermove',e=>{
  if(!mapDrag.down || e.pointerId!==mapDrag.pointerId)return;
  const dx=e.clientX-mapDrag.at.x,dy=e.clientY-mapDrag.at.y;
  if(!mapDrag.moved && Math.hypot(dx,dy)>6){
   mapDrag.moved=true;
   try{svg.setPointerCapture(e.pointerId)}catch(_){/* capture unsupported */}
  }
  if(mapDrag.moved){
   const b=svg.getBoundingClientRect();
   STATE.zoom={...mapDrag.box,x:mapDrag.box.x-dx*mapDrag.box.w/b.width,y:mapDrag.box.y-dy*mapDrag.box.h/b.height};
   applyViewBox();
  }
 });
 svg.addEventListener('pointerup',e=>{
  if(e.pointerId!==mapDrag.pointerId)return;
  mapDrag.down=false;
  mapDrag.pointerId=null;
  if(svg.hasPointerCapture?.(e.pointerId))svg.releasePointerCapture(e.pointerId);
  // Keep moved=true until next pointerdown to suppress drag-clicks.
 });
 svg.addEventListener('pointercancel',e=>{
  if(e.pointerId!==mapDrag.pointerId)return;
  mapDrag.down=false;
  mapDrag.pointerId=null;
 });
 svg.addEventListener('lostpointercapture',e=>{
  if(e.pointerId!==mapDrag.pointerId)return;
  mapDrag.down=false;
  mapDrag.pointerId=null;
 });
}
function updateDetail(){const r=byId.get(STATE.selected);if(!r)return;const local=isUtility(r),year=STATE.rates2026.get(r.f),housing=STATE.acs.get(r.f),lihtc=STATE.lihtc.get(r.f),ref=STATE.refinedSolar.get(r.f);$('countyDetail').innerHTML=`
<div class="detail-topline"><span class="panel-kicker">SELECTED COUNTY</span><span class="source-pill ${local?'verified':'fallback'}">${local?'UTILITY BENCHMARK':'STATE ESTIMATE'}</span></div><div class="detail-name">${esc(r.n)}</div><div class="detail-state">${esc(r.sn)} · FIPS ${r.f}</div>
<div class="detail-metric-primary v3-metric-primary"><small>ANNUAL RETURN ON COST</small><strong>${((value(r)/INSTALLED_COST_PER_KW_DC)*100).toFixed(1)}%</strong><p>Annual retail-value equivalent ÷ $2,760/kW DC installed</p><div class="v3-retail-secondary"><small>ANNUAL RETAIL-VALUE POTENTIAL</small><b>${money(value(r))}</b><span>per installed kW DC / year</span></div></div>
<div class="detail-grid"><div class="detail-cell"><small>RESIDENTIAL RATE</small><strong>${cents(p(r))}</strong></div><div class="detail-cell"><small>ANNUAL PV YIELD</small><strong>${fmt(solar(r))}</strong></div></div>
<div class="detail-section"><h4>REFERENCE UTILITIES & PRICE METHOD</h4><p class="utility-list">${esc(r.u.split(' | ').join(' · '))}</p><p style="margin-top:9px">${esc(STATE.sector==='res'?r.rdesc:r.cdesc)}</p></div>
${layerDetail(r)}${tariffDetail(r)}<div class="detail-section"><h4>MULTIFAMILY / LIHTC</h4><p>ACS rental units (5+ structures): <strong>${housing?fmt(housing.units):'Not loaded'}</strong><br>HUD LIHTC properties: <strong>${lihtc?fmt(lihtc.properties):'Not loaded'}</strong>${year?`<br>2026 state price (Jan-Aug): <strong>${cents(STATE.sector==='res'?year.res:year.com)}</strong>`:''}${ref?`<br>Multi-point solar result: <strong>${fmt(ref.solar)} kWh/kWdc</strong>`:''}</p></div>
<div class="detail-actions"><button class="btn btn-subtle" id="detailCompare">+ Compare</button><button class="btn btn-primary" id="detailScenario">Model property →</button></div>`;
$('detailCompare').addEventListener('click',()=>addCompare(r.f));$('detailScenario').addEventListener('click',()=>{$('scenarioCounty').value=r.f;switchTab('economics')});}
function selectCounty(f){if(!byId.has(f))return;STATE.selected=f;$('scenarioCounty').value=f;updateDetail();$('countyShapes').querySelectorAll('path.selected').forEach(el=>el.classList.remove('selected'));const el=$('countyShapes').querySelector(`path[data-fips="${f}"]`);if(el)el.classList.add('selected');if(STATE.tab==='quadrant')updateScatter();if(STATE.tab==='economics')updateScenario();}
function rankRows(metricKind=STATE.metric){const pool=filtered().filter(r=>Number.isFinite(metric(r,metricKind)));pool.sort((a,b)=>(metric(b,metricKind)-metric(a,metricKind))||a.f.localeCompare(b.f));return pool}
function updateRankings(){
 const kind=STATE.metric==='high'?'value':STATE.metric;let rows=rankRows(kind);
 if(STATE.metric==='high')rows=rows.filter(high);
 const delta=STATE.metric==='change';
 const heads=delta?['RANK','COUNTY','JAN-AUG 2025','JAN-AUG 2026','CHANGE (cents/kWh)','SOURCE RESOLUTION','ACTION']:['RANK','COUNTY','2025 RATE BENCHMARK','PV YIELD',METRIC[kind][2].toUpperCase(),'2025 PRICE SOURCE','ACTION'];
 $('rankTable').tHead.innerHTML='<tr>'+heads.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr>';
 $('rankingTitle').textContent=delta?'Largest matched-period state price increases (shown by county)':STATE.metric==='high'?'Top high-on-both markets':`Top U.S. markets by ${METRIC[STATE.metric][0].toLowerCase()}`;
 const tbody=$('rankTable').tBodies[0];
 if(!rows.length){tbody.innerHTML=`<tr><td colspan="7" style="padding:28px;text-align:center;color:#526f83">${['multifamily','lihtc','change'].includes(STATE.metric)?'Source data has not been bundled yet. Missing data is not zero.':'No matching counties.'}</td></tr>`;return;}
 tbody.innerHTML=rows.slice(0,STATE.rankCount).map((r,i)=>{
  const t=STATE.rates2026.get(r.f),a=STATE.sector==='res'?t?.res2025:t?.com2025,b=STATE.sector==='res'?t?.res:t?.com;
  const cells=delta?`<td>${cents(a)}</td><td>${cents(b)}</td><td><span class="score-value">${metricString(r,'change')}</span></td><td><span class="small-pill amber">EIA state YTD</span></td>`:`<td>${cents(p(r))}</td><td>${fmt(solar(r))} kWh</td><td><span class="score-value">${metricString(r,kind)}</span></td><td><span class="small-pill ${isUtility(r)?'green':'amber'}">${isUtility(r)?'Utility':'State avg'}</span></td>`;
  return `<tr><td><span class="table-rank">${String(i+1).padStart(2,'0')}</span></td><td><button class="table-link" data-select="${r.f}">${esc(r.n)}, ${esc(r.st)}</button></td>${cells}<td><button class="table-link" data-addcompare="${r.f}">+ Compare</button></td></tr>`;
 }).join('');
}
function downloadCsv(name,rows){const csv=rows.map(row=>row.map(cell=>{const v=String(cell??'');return '"'+v.replace(/"/g,'""')+'"'}).join(',')).join('\r\n');const b=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(b);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),8000);}
function exportRanking(which=STATE.metric){if(which==='change'){const rows=[['county_fips','county','state','sector','geographic_resolution','matched_period','price_2025_cents_kwh','price_2026_cents_kwh','change_cents_kwh','change_percent','source','release_date']];for(const r of rankRows('change')){const t=STATE.rates2026.get(r.f),a=STATE.sector==='res'?t.res2025:t.com2025,b=STATE.sector==='res'?t.res:t.com;rows.push([r.f,r.n,r.st,STATE.sector,'state',t.period,a*100,b*100,(b-a)*100,(b/a-1)*100,t.source,t.release_date])}downloadCsv('ShineIQ_V2_EIA_Matched_YTD_2025_2026.csv',rows);return;}let rows=rankRows(which==='high'?'value':which);if(which==='high')rows=rows.filter(high);const arr=[['county_fips','county','state','rank','solar_kwh_per_kwdc_year','2025_price_usd_per_kwh','retail_value_usd_per_kwdc_year','price_method','metric','metric_value']];rows.forEach((r,i)=>arr.push([r.f,r.n,r.st,i+1,solar(r),p(r),value(r),method(r),which,metric(r,which)]));downloadCsv(`ShineIQ_V2_${which}_${STATE.sector}_county_ranking.csv`,arr)}
function updateScatter(){const svg=$('scatterPlot');const W=970,H=540,L=85,R=35,TOP=37,B=70;const yMin=725,yMax=2110,xMin=0,xMax=68;
 const X=v=>L+(v-xMin)/(xMax-xMin)*(W-L-R),Y=v=>H-B-(v-yMin)/(yMax-yMin)*(H-B-TOP);const tX=X(T[STATE.sector]*100),tY=Y(T.solar);
 let html=`<defs><clipPath id="scatterClip"><rect x="${L}" y="${TOP}" width="${W-L-R}" height="${H-B-TOP}"/></clipPath></defs><rect x="${L}" y="${TOP}" width="${W-L-R}" height="${H-B-TOP}" rx="2" fill="#f8fbfd"/><rect x="${tX}" y="${TOP}" width="${W-R-tX}" height="${tY-TOP}" fill="#dff2e7" opacity=".8"/><text x="${tX+20}" y="${TOP+23}" font-size="12" font-weight="800" fill="#156c4a">HIGH PRICE + HIGH SOLAR</text>`;
 for(let v=0;v<=60;v+=10){const x=X(v);html+=`<line x1="${x}" y1="${TOP}" x2="${x}" y2="${H-B}" stroke="#c1d2de" stroke-opacity=".55"/><text x="${x}" y="${H-B+20}" fill="#587185" font-size="11" text-anchor="middle">${v}¢</text>`}
 for(let v=800;v<=2000;v+=200){const y=Y(v);html+=`<line x1="${L}" y1="${y}" x2="${W-R}" y2="${y}" stroke="#c1d2de" stroke-opacity=".55"/><text x="${L-11}" y="${y+4}" fill="#587185" font-size="11" text-anchor="end">${fmt(v)}</text>`}
 html+=`<line x1="${tX}" y1="${TOP}" x2="${tX}" y2="${H-B}" stroke="#b88125" stroke-width="1.8" stroke-dasharray="6 5"/><line x1="${L}" y1="${tY}" x2="${W-R}" y2="${tY}" stroke="#b88125" stroke-width="1.8" stroke-dasharray="6 5"/><text x="${(L+W-R)/2}" y="${H-17}" fill="#49697e" font-size="13" text-anchor="middle">2025 retail electricity-price benchmark (¢/kWh)</text><text transform="translate(20 ${H/2}) rotate(-90)" fill="#49697e" font-size="13" text-anchor="middle">Annual PV yield (kWh/kW DC)</text><g clip-path="url(#scatterClip)">`;
 const ds=filtered(),dots=new Map();for(const r of ds){const cx=X(p(r)*100),cy=Y(solar(r)),selected=r.f===STATE.selected,color=high(r)?'#b47b1d':'#4787b3';html+=`<circle class="dot ${selected?'selected':''}" data-fips="${r.f}" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${selected?6:high(r)?3.4:2.3}" fill="${color}" opacity="${high(r)?'.84':'.48'}"><title>${esc(r.n)}, ${r.st} · ${cents(p(r))} · ${fmt(solar(r))} kWh/kWdc</title></circle>`;dots.set(r.f,{cx,cy});}html+='</g>';
 svg.innerHTML=html;svg.querySelectorAll('circle[data-fips]').forEach(c=>c.addEventListener('click',()=>{const f=c.dataset.fips;selectCounty(f);highlightScatterSelected(f)}));$('scatterCount').textContent=`${fmt(ds.length)} counties plotted · ${fmt(ds.filter(high).length)} high on both`;
 let focus=$('scatterFocus');if(!focus){focus=document.createElement('div');focus.id='scatterFocus';focus.className='threshold-card';document.querySelector('.scatter-detail').appendChild(focus);}const r=byId.get(STATE.selected);if(r)focus.innerHTML=`<small>SELECTED COUNTY · ${esc(r.st)}</small><strong style="font-size:17px">${esc(r.n)}</strong><span>${cents(p(r))} · ${fmt(solar(r))} kWh/kWdc/yr · ${money(value(r))}/kWdc/yr</span><button class="btn btn-subtle" id="scatterCountyMap" style="margin-top:12px">Find on county map →</button>`;const b=$('scatterCountyMap');if(b)b.addEventListener('click',()=>switchTab('map'));
}
function highlightScatterSelected(f){const svg=$('scatterPlot');svg.querySelectorAll('circle.dot.selected').forEach(c=>{c.classList.remove('selected');c.setAttribute('r',byId.has(c.dataset.fips)&&high(byId.get(c.dataset.fips))?'3.4':'2.3')});const el=svg.querySelector(`[data-fips="${f}"]`);if(el){el.classList.add('selected');el.setAttribute('r','6')}}
function addCompare(f){if(STATE.compare.includes(f)){toast('Already in the comparison');return}if(STATE.compare.length>=5){toast('Compare up to five counties at once',true);return}STATE.compare.push(f);toast(byId.get(f).n+' added to comparison');if(STATE.tab==='compare')updateCompare();}
function removeCompare(f){STATE.compare=STATE.compare.filter(x=>x!==f);updateCompare()}
function updateCompare(){const rs=STATE.compare.map(f=>byId.get(f)).filter(Boolean);$('compareChips').innerHTML=rs.map(r=>`<span class="compare-chip">${esc(r.n)}, ${r.st}<button data-removecompare="${r.f}" aria-label="Remove ${esc(r.n)}">×</button></span>`).join('');
 const stage=$('compareChart');if(!rs.length){stage.innerHTML='<p class="empty-note">Choose counties using the search field above, or add them from the map.</p>';$('compareTable').innerHTML='';return}
 const valMax=Math.max(...rs.map(r=>value(r))),solarMax=Math.max(...rs.map(r=>solar(r)));
 stage.innerHTML=rs.map(r=>`<article class="compare-card"><h3>${esc(r.n)}</h3><small>${esc(r.st)} · #${STATE.sector==='res'?r.rrank:r.crank} value rank</small><div class="bar-chart"><span class="bar green" title="Relative retail-value potential" style="height:${value(r)/valMax*100}%"></span><span class="bar blue" title="Relative solar yield" style="height:${solar(r)/solarMax*100}%"></span></div><div class="bar-legend"><span style="color:#18774f">■ VALUE</span><span style="color:#286e9d">■ SOLAR</span></div><span class="big">${money(value(r))}</span><small>per kW DC per year</small></article>`).join('');
 const fields=[['2025 retail rate',r=>cents(p(r))],['Annual PV yield',r=>fmt(solar(r))+' kWh/kWdc'],['595 W equivalent',r=>fmt(solar(r)*.595)+' kWh/yr'],['Combined value',r=>money(value(r))+'/kWdc/yr'],['High on both',r=>high(r)?'YES':'No'],['National value rank',r=>'#'+(STATE.sector==='res'?r.rrank:r.crank)],['Rate source',r=>isUtility(r)?'Utility-specific':'State estimate'],['ACS 5+ rental units',r=>STATE.acs.get(r.f)?fmt(STATE.acs.get(r.f).units):'Not loaded'],['LIHTC properties',r=>STATE.lihtc.get(r.f)?fmt(STATE.lihtc.get(r.f).properties):'Not loaded'],['2026 state price, Jan-Aug',r=>{const t=STATE.rates2026.get(r.f);return t?cents(STATE.sector==='res'?t.res:t.com):'Not loaded'}],['Multi-point solar',r=>STATE.refinedSolar.get(r.f)?fmt(STATE.refinedSolar.get(r.f).solar):'Not loaded']];
 $('compareTable').innerHTML=`<table><thead><tr><th>MEASURE</th>${rs.map(r=>`<th>${esc(r.n)}, ${r.st}</th>`).join('')}</tr></thead><tbody>${fields.map(([name,fn])=>`<tr><td><strong>${name}</strong></td>${rs.map(r=>`<td>${esc(fn(r))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function populateCompareSearch(){const q=$('compareSearch').value.trim().toLowerCase(),out=$('compareResults');if(q.length<2){out.hidden=true;return}const result=COUNTY.filter(r=>(r.n+' '+r.st+' '+r.sn).toLowerCase().includes(q)&&!STATE.compare.includes(r.f)).slice(0,12);if(!result.length){out.hidden=true;return;}out.innerHTML=result.map(r=>`<button data-choosecompare="${r.f}">${esc(r.n)}, ${esc(r.st)} · ${money(value(r))}/kWdc</button>`).join('');out.hidden=false;}
function updateInventory(){let acs=STATE.acs.size,lihtc=STATE.lihtc.size;
 const acsUnits=[...STATE.acs.values()].reduce((s,x)=>s+x.units,0),propertyCount=[...STATE.lihtc.values()].reduce((s,x)=>s+x.properties,0);
 $('inventoryStats').innerHTML=`<div class="inventory-card"><small>ACS COUNTIES LOADED</small><strong>${fmt(acs)} / 3,144</strong></div><div class="inventory-card"><small>RENTER 5+ UNITS LOADED</small><strong>${acs?fmt(acsUnits):'—'}</strong></div><div class="inventory-card"><small>LIHTC PROJECTS LOADED</small><strong>${lihtc?fmt(propertyCount):'—'}</strong></div>`;
 const audit=ENRICH.sources?.lihtc?.stats;const note=$('inventoryAudit');if(note&&audit){note.innerHTML=`2024 ACS: ${fmt(acs)} counties. HUD snapshot revised May 28, 2026: <strong>${fmt(propertyCount)} located historical project records</strong> in ${fmt(audit.counties_with_records)} counties; ${fmt(audit.counties_without_located_records)} county bins have no located records. <strong>${fmt(audit.unresolved_county_records)} in-scope records remain unresolved</strong> (${fmt(audit.unresolved_by_state?.CT||0)} in Connecticut); ${fmt(audit.skipped.outside_50states_dc||0)} records outside the 50 states and D.C. are excluded. ${fmt(audit.records_missing_unit_counts)} located records have unknown total units. Distinct IDs may be phases or repeat awards. <a href="data/hud_unresolved_records.json" download>Unresolved records</a> · <a href="data/ENRICHMENT_AUDIT.json" download>Source audit & hashes</a>.`; }
 $('acsTag').textContent=acs?fmt(acs)+' COUNTIES':'NOT LOADED';$('lihtcTag').textContent=lihtc?fmt(audit?.counties_with_records??lihtc)+' WITH RECORDS':'NOT LOADED';$('acsTag').classList.toggle('loaded',!!acs);$('lihtcTag').classList.toggle('loaded',!!lihtc);
 if(!acs&&!lihtc){$('inventoryTableArea').innerHTML='<p class="empty-note">No verified county inventory has been loaded. Import ACS/HUD counts to activate the density ranking. The existing solar/rate data is still complete.</p>';return;}
 const rs=filtered().filter(r=>STATE.acs.has(r.f)||STATE.lihtc.has(r.f)).sort((a,b)=>(STATE.acs.get(b.f)?.units??0)-(STATE.acs.get(a.f)?.units??0));
 $('inventoryTableArea').innerHTML=`<table><thead><tr><th>COUNTY</th><th>5+ UNIT RENTAL HOMES</th><th>LIHTC PROPERTIES</th><th>RETAIL VALUE</th></tr></thead><tbody>${rs.slice(0,50).map(r=>`<tr><td><button class="table-link" data-select="${r.f}">${esc(r.n)}, ${r.st}</button></td><td>${STATE.acs.has(r.f)?fmt(STATE.acs.get(r.f).units):'—'}</td><td>${STATE.lihtc.has(r.f)?fmt(STATE.lihtc.get(r.f).properties):'—'}</td><td>${money(value(r))}</td></tr>`).join('')}</tbody></table>`;
}
function validateNumber(v,min=0,max=1e12){const n=Number(v);return v!==''&&v!=null&&Number.isFinite(n)&&n>=min&&n<=max?n:null}
function updateScenario(){const r=byId.get($('scenarioCounty').value)||byId.get(STATE.selected);if(!r)return;const kw=clamp(validateNumber($('systemKw').value,1,100000)??100,1,100000),cost=validateNumber($('costPerW').value,.2,20)??2.25,sc=Number($('selfConsumed').value)/100,ex=Number($('exportRatio').value)/100,capture=Number($('ownerCapture').value)/100,mode=$('meterMode').value,override=validateNumber($('rateOverride').value,0,200);const rate=override===null?p(r):override/100;
 $('selfConsumedVal').textContent=fmt(sc*100)+'%';$('exportRatioVal').textContent=fmt(ex*100)+'%';$('ownerCaptureVal').textContent=fmt(capture*100)+'%';
 const production=solar(r)*kw,onsite=production*sc,exported=production-onsite,gross=onsite*rate+exported*rate*ex,owner=gross*capture,systemCost=kw*1000*cost,payback=owner>0?systemCost/owner:null;
 $('scenarioKpis').innerHTML=`<div class="scenario-kpi"><div class="kpi-small">ANNUAL GENERATION</div><div class="kpi-big">${fmt(production)} kWh</div><div class="kpi-desc">${fmt(kw)} kW DC × ${fmt(solar(r))} yield</div></div><div class="scenario-kpi"><div class="kpi-small">GROSS ELECTRICITY VALUE</div><div class="kpi-big">${money(gross)}</div><div class="kpi-desc">before owner / tenant allocation</div></div><div class="scenario-kpi"><div class="kpi-small">ILLUSTRATIVE OWNER VALUE</div><div class="kpi-big">${money(owner)}</div><div class="kpi-desc">${fmt(capture*100)}% assumed captured</div></div><div class="scenario-kpi"><div class="kpi-small">SIMPLE PAYBACK (NOT UNDERWRITTEN)</div><div class="kpi-big">${payback?fmt(payback,1)+' yr':'Not meaningful'}</div><div class="kpi-desc">${money(systemCost)} modeled upfront cost, excludes incentives</div></div>`;
 const labels='Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '),mx=Math.max(...r.m);$('monthlyBars').innerHTML=r.m.map((v,i)=>`<div class="month-col" title="${labels[i]}: ${fmt(v*kw)} kWh"><div class="month-bar" style="height:${v/mx*95}%"></div><div class="month-label">${labels[i]}</div></div>`).join('');
 $('scenarioFormula').innerHTML=`<strong>Calculation</strong><br>${fmt(production)} kWh × ${fmt(sc*100)}% self-consumed × ${cents(rate)} + ${fmt(exported)} kWh exported × ${fmt(ex*100)}% of retail × ${cents(rate)} = <strong>${money(gross)} gross value/year</strong>.<br>Owner capture assumption × ${fmt(capture*100)}% = <strong>${money(owner)} per year</strong>.`;
 let warning='These are sensitivity assumptions, not a validated tariff or project layout. Confirm actual bill, meter setup, export rules, and incentive eligibility.';if(mode==='tenant')warning='Tenant-metered service: unless a verified allocation or agreement exists, owner-captured benefit may be zero. The slider currently assumes '+fmt(capture*100)+'% capture. This is NOT verified.';else if(mode==='vnm')warning='Hypothetical allocation agreement: confirm jurisdiction-specific eligibility, credit allocation, and billing mechanisms before treating owner benefit as realizable.';if(override!==null)warning+=' A custom price has been substituted for the EIA benchmark.';$('scenarioWarning').textContent=warning;
}
function makePercentiles(fn){const sorted=COUNTY.map(r=>[r.f,fn(r)]).filter(x=>Number.isFinite(x[1])).sort((a,b)=>a[1]-b[1]);const out=new Map();for(let i=0;i<sorted.length;i++){let start=i;while(i+1<sorted.length&&sorted[i+1][1]===sorted[start][1])i++;const pp=(start+i)/2/Math.max(1,sorted.length-1)*100;for(let j=start;j<=i;j++)out.set(sorted[j][0],pp);}return out;}
function recomputeScores(){const unavail={multifamily:STATE.acs.size===0,lihtc:STATE.lihtc.size===0};const weights={...STATE.weights};const disabled=Object.keys(unavail).filter(k=>unavail[k]);for(const k of disabled)weights[k]=0;
 const denominator=Object.values(weights).reduce((s,x)=>s+x,0)||1;
 const percentiles={value:makePercentiles(value),solar:makePercentiles(solar),multifamily:makePercentiles(r=>STATE.acs.get(r.f)?.units??null),lihtc:makePercentiles(r=>STATE.lihtc.get(r.f)?.properties??null)};
 STATE.scores=new Map();let computed=0,excluded=0;
 for(const r of COUNTY){let total=0,missing=false;for(const [name,w] of Object.entries(weights)){if(!w)continue;let q;
 if(name==='confidence')q=isUtility(r)?100:35;
 else q=percentiles[name]?.get(r.f);
 if(!Number.isFinite(q)){missing=true;break}total+=w*q;
 }if(missing){STATE.scores.set(r.f,{score:null,partial:true});excluded++;}else{STATE.scores.set(r.f,{score:total/denominator,partial:false});computed++}}
 STATE.scorerNote=`Active weights total ${denominator} points and renormalize to 100. ${fmt(computed)} counties have complete required inputs; ${fmt(excluded)} excluded for missing housing data.`+(disabled.length?' Unloaded dimensions are disabled: '+disabled.join(', ')+'.':'');
}
const weightDefs={value:{label:'Retail-value potential',short:'ECONOMICS'},solar:{label:'Solar productivity',short:'SOLAR'},multifamily:{label:'5+ rental units',short:'MULTIFAMILY'},lihtc:{label:'LIHTC property count',short:'AFFORDABLE STOCK'},confidence:{label:'Data confidence',short:'PRICE QUALITY'}};
function updateScoring(){recomputeScores();$('weightsBox').innerHTML=Object.entries(weightDefs).map(([k,d])=>{const unavail=(k==='multifamily'&&!STATE.acs.size)||(k==='lihtc'&&!STATE.lihtc.size);return`<div class="weight-row ${unavail?'disabled':''}"><label for="w-${k}" title="${esc(d.label)}">${esc(d.label)}</label><input type="range" min="0" max="100" step="5" id="w-${k}" value="${STATE.weights[k]}" ${unavail?'disabled':''}/><div class="weight-value" id="wval-${k}">${unavail?'NEEDS DATA':STATE.weights[k]+'%'}</div></div>`}).join('');$('scoreNotice').textContent=STATE.scorerNote;
 for(const k of Object.keys(weightDefs)){const el=$('w-'+k);el.addEventListener('input',()=>{STATE.weights[k]=Number(el.value);$('wval-'+k).textContent=STATE.weights[k]+'%';recomputeScores();$('scoreNotice').textContent=STATE.scorerNote;renderScoreTable();if(STATE.metric==='score')updateMap();})}
 renderScoreTable();}
function renderScoreTable(){const rows=rankRows('score').slice(0,40);$('scoreTable').tBodies[0].innerHTML=rows.length?rows.map((r,i)=>`<tr><td><span class="table-rank">${i+1}</span></td><td><button class="table-link" data-select="${r.f}">${esc(r.n)}, ${r.st}</button></td><td><span class="score-value">${fmt(metric(r,'score'),1)}</span></td><td>${money(value(r))}</td><td>${fmt(solar(r))}</td><td><span class="small-pill ${isUtility(r)?'green':'amber'}">${isUtility(r)?'Utility':'State'}</span></td></tr>`).join(''):'<tr><td colspan="6" style="padding:25px">No counties have all required verified data. Reduce unavailable weight dimensions.</td></tr>';}
function setFiltersFromUi(){STATE.sector=$('sectorSelect').value;STATE.region=$('regionSelect').value;STATE.state=$('stateSelect').value;STATE.search=$('searchCounty').value.trim().toLowerCase();STATE.localOnly=$('localOnly').checked;recomputeScores();updateMap();if(STATE.tab==='quadrant')updateScatter();if(STATE.tab==='compare')updateCompare();if(STATE.tab==='inventory')updateInventory();if(STATE.tab==='scoring')renderScoreTable();if(STATE.tab==='economics')updateScenario();}
function openModal(id){const x=$(id);if(!x)return;x.hidden=false;document.body.style.overflow='hidden';}
function closeModal(id){const x=$(id);if(x)x.hidden=true;if([...document.querySelectorAll('.modal-backdrop')].every(x=>x.hidden))document.body.style.overflow='';}
function openDataHub(){updateDataCoverage();openModal('dataHubModal');}
function updateDataCoverage(){const fields=[['PVGIS annual county yield','3,144 / 3,144'],['2025 EIA rate benchmarks','3,144 / 3,144'],['ACS 5+ rental-unit counts',fmt(STATE.acs.size)+' / 3,144'],['HUD LIHTC county bins (including zeros)',fmt(STATE.lihtc.size)+' / 3,144; '+fmt(ENRICH.sources?.lihtc?.stats?.counties_with_records||0)+' with records'],['EIA matched YTD state comparison',fmt(STATE.rates2026.size)+' / 3,144'],['Optional tariff snapshots',fmt(STATE.tariffSnapshots.size)+' counties'],['Multi-point PVGIS',fmt(STATE.refinedSolar.size)+' / 3,144']];$('dataHubCoverage').innerHTML=fields.map(([label,v])=>`<div><span>${label}</span><strong>${v}</strong></div>`).join('');
 if(STATE.refinedSolar.size){let el=$('solarRefinedToggle');if(!el){el=document.createElement('label');el.style.cssText='font-size:11px;color:#196c4d;display:flex;align-items:center;gap:7px';el.innerHTML='<input type="checkbox" id="toggleRefined"/> Use verified multi-point solar results where available';el.id='solarRefinedToggle';$('dataHubCoverage').after(el);$('toggleRefined').addEventListener('change',e=>{STATE.useRefinedSolar=e.target.checked;recomputeScores();updateMap();if(STATE.tab==='quadrant')updateScatter();if(STATE.tab==='economics')updateScenario();if(STATE.tab==='compare')updateCompare();});}else $('toggleRefined').checked=STATE.useRefinedSolar;}
}
function parseCsv(raw){let lines=[],row=[],field='',inside=false;raw=raw.replace(/^\ufeff/,'');for(let i=0;i<raw.length;i++){const ch=raw[i];if(inside){if(ch==='"'&&raw[i+1]==='"'){field+='"';i++}else if(ch==='"')inside=false;else field+=ch;}else if(ch==='"')inside=true;else if(ch===','){row.push(field);field='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&raw[i+1]==='\n')i++;row.push(field);field='';if(row.some(c=>c!==''))lines.push(row);row=[];}else field+=ch;}if(field||row.length){row.push(field);lines.push(row)}if(!lines.length)return[];const head=lines.shift().map(x=>x.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''));if(!head.length)throw Error('Missing CSV header');return lines.map(c=>Object.fromEntries(head.map((k,j)=>[k,(c[j]??'').trim()])));}
function field(row,...keys){for(const k of keys){if(row[k]!=null&&row[k]!=='')return row[k]}return'';}
function fips(row){let s=String(field(row,'county_fips','fips','geoid','county_geoid')).trim();if(/^\d{1,5}$/.test(s))return s.padStart(5,'0');let st=String(field(row,'state_fips','state')).trim(),cnt=String(field(row,'county_code','county_fips_code','county')).trim();if(/^\d{1,2}$/.test(st)&&/^\d{1,3}$/.test(cnt))return st.padStart(2,'0')+cnt.padStart(3,'0');return null;}
function setImportMessage(msg,error=false){const el=$('importMessage');el.textContent=msg;el.classList.toggle('error',error);}
async function importData(kind,file){if(!file)return;try{if(file.size>50e6)throw Error('File exceeds 50 MB; preaggregate it by county before upload.');setImportMessage('Reading and validating '+file.name+'…');const content=await file.text();const rows=parseCsv(content);if(!rows.length)throw Error('No data rows found');let result;
 if(kind==='acs')result=importAcs(rows);
 else if(kind==='lihtc')result=importLihtc(rows);
 else if(kind==='rates')result=importRates(rows);
 else if(kind==='solar')result=importSolar(rows);
 STATE.imported[kind]={filename:file.name,recordCount:rows.length,date:new Date().toISOString()};setImportMessage(`Imported ${fmt(result.matched)} structurally validated county records from ${file.name}. ${result.note}`);updateDataCoverage();recomputeScores();updateMap();if(STATE.tab==='quadrant')updateScatter();if(STATE.tab==='inventory')updateInventory();if(STATE.tab==='scoring')updateScoring();if(STATE.tab==='economics')updateScenario();if(STATE.tab==='compare')updateCompare();
 }catch(e){setImportMessage('Import failed: '+String(e.message||e),true)}finally{const id=kind==='acs'?'uploadAcs':kind==='lihtc'?'uploadLihtc':kind==='rates'?'uploadRates':'uploadSolar';$(id).value='';}}
function importAcs(rows){const merged=new Map();let skipped=0;for(const row of rows){const id=fips(row);if(!id||!byId.has(id)){skipped++;continue}let v=validateNumber(field(row,'renter_5plus_units','multifamily_renter_units','renter_occupied_5plus_units','renter_units_5plus','renter_5_plus_units','five_plus_units','b25032_5plus_renter'),0,1e9);
 if(v===null){const parts=['b25032_018e','b25032_019e','b25032_020e','b25032_021e'].map(k=>validateNumber(field(row,k),0,1e9));if(parts.some(k=>k===null)){skipped++;continue}v=parts.reduce((a,b)=>a+b,0);}
 if(merged.has(id))throw Error('Duplicate ACS county FIPS '+id+'; expected one row per county');merged.set(id,{units:Math.round(v),source:'2024 ACS 5-year B25032 / user import'});}
 if(!merged.size)throw Error('No matching ACS county rows. Provide county_fips and renter_5plus_units or the B25032_018E–021E columns.');STATE.acs=merged;if(STATE.weights.multifamily===0){STATE.weights.multifamily=20;STATE.weights.value=40;STATE.weights.solar=20;STATE.weights.confidence=20;}return{matched:merged.size,note:`${fmt(skipped)} skipped or unmatched. Counts represent occupied rental units, not buildings.`};}
function importLihtc(rows){const merged=new Map(),unique=new Set();let skipped=0,dupes=0;let aggregated=rows.some(row=>field(row,'lihtc_properties','lihtc_project_count','lihtc_property_count','property_count')!=='');
 for(const row of rows){const id=fips(row);if(!id||!byId.has(id)){skipped++;continue}const prior=merged.get(id)||{properties:0,units:0,lowUnits:0,source:'HUD LIHTC / user import'};if(aggregated){const n=validateNumber(field(row,'lihtc_properties','lihtc_project_count','lihtc_property_count','property_count'),0,100000);if(n===null){skipped++;continue}if(merged.has(id))throw Error('Repeated county in preaggregated LIHTC file: '+id);prior.properties=n;prior.units=validateNumber(field(row,'lihtc_units','total_units'),0,1e9)??0;prior.lowUnits=validateNumber(field(row,'low_income_units'),0,1e9)??0;}else{const key=field(row,'hud_id','project_id','property_id','unique_id','site_id','id')||[id,field(row,'name','project','project_name','property_name'),field(row,'street','address','street_address')].join('|');if(unique.has(key)){dupes++;continue}unique.add(key);prior.properties++;prior.units+=validateNumber(field(row,'total_units','units_total','n_units','units','lihtc_units'),0,1e9)??0;prior.lowUnits+=validateNumber(field(row,'low_income_units','low_units','li_units'),0,1e9)??0;}merged.set(id,prior)}
 if(!merged.size)throw Error('No LIHTC county rows matched. File requires county_fips plus project-level records or lihtc_properties counts.');STATE.lihtc=merged;
 if(STATE.weights.lihtc===0){STATE.weights.lihtc=15;STATE.weights.value=35;STATE.weights.confidence=10;}
 return{matched:merged.size,note:`${fmt(skipped)} unmatched, ${fmt(dupes)} deduplicated. Unlisted counties remain unknown rather than zero.`};}
function getSectorRate(row,side){let direct=field(row,side+'_price_usd_per_kwh',side+'_usd_per_kwh');const short=side==='residential'?'res':'com';if(!direct)direct=field(row,short+'_price_usd_per_kwh',short+'_usd_per_kwh');let v=validateNumber(direct,.001,2);if(v!==null)return v;direct=field(row,side+'_cents_per_kwh',short+'_cents_per_kwh');v=validateNumber(direct,.1,200);return v!==null?v/100:null;}
function importRates(rows){const merged=new Map();const conflicts=new Set();let matched=0,skipped=0;
 for(const row of rows){const yr=field(row,'price_year','tariff_year','year');if(yr!=='2026'){skipped++;continue}const rp=getSectorRate(row,'residential'),cp=getSectorRate(row,'commercial');if(rp===null&&cp===null){skipped++;continue}const id=fips(row),util=field(row,'eia_utility_id','utility_eia_id','utility_id');let ids=[];if(id&&byId.has(id))ids=[id];else if(util){ids=COUNTY.filter(r=>r.ru===util||r.cu===util).map(r=>r.f);}
 if(!ids.length){skipped++;continue}for(const f of ids){let prev=merged.get(f)||{res:null,com:null,source:'2026 import',notes:[]};const rowBase=byId.get(f);for(const [key,n,eligible] of [['res',rp,!util||rowBase.ru===util],['com',cp,!util||rowBase.cu===util]]){if(n===null||!eligible)continue;if(prev[key]!=null&&Math.abs(prev[key]-n)>.0001){conflicts.add(f+'-'+key);prev[key]=null;}else if(!conflicts.has(f+'-'+key))prev[key]=n;}
 prev.source=field(row,'source','tariff_source','source_url')||'2026 user-supplied tariff';prev.notes.push(field(row,'effective_date','date_effective')||'2026');merged.set(f,prev);matched++;}}
 for(const [f,v] of [...merged.entries()])if(v.res===null&&v.com===null)merged.delete(f);
 if(!merged.size)throw Error('No 2026 tariff data matched. Include price_year=2026, county_fips or eia_utility_id, and sector-specific $/kWh or cents/kWh.');STATE.tariffSnapshots=merged;return{matched:merged.size,note:`${fmt(skipped)} skipped, ${conflicts.size} conflicts omitted. Tariff snapshots are stored separately and do not overwrite the matched-period EIA rate-shift map.`};}
function importSolar(rows){const merged=new Map();let skipped=0;for(const row of rows){const id=fips(row);if(!id||!byId.has(id)){skipped++;continue}const value=validateNumber(field(row,'solar_refined_kwh_per_kwdc_year','solar_kwh_per_kwdc_year','refined_annual_kwh_per_kwdc_year'),500,3000);const n=validateNumber(field(row,'sample_count','n_points','n_sites'),2,99);const assumption=field(row,'solar_assumption_id');if(value===null||n===null||!assumption.includes('pvgis53_era5_csi_free_20deg_south_14loss_nohorizon_1kwdc_v1')){skipped++;continue}merged.set(id,{solar:value,sites:n,min:validateNumber(field(row,'solar_min_kwh_per_kwdc_year','min_kwh_per_kwdc_year'),0,3000),max:validateNumber(field(row,'solar_max_kwh_per_kwdc_year','max_kwh_per_kwdc_year'),0,3000),source:'Multi-point PVGIS 5.3 user import'});}
 if(!merged.size)throw Error('No comparable multi-point PVGIS rows. Required: matching solar_assumption_id, sample_count >=2, and solar_refined_kwh_per_kwdc_year.');STATE.refinedSolar=merged;return{matched:merged.size,note:`${fmt(skipped)} skipped. Select the refined-solar toggle in Data hub to activate those counties.`};}
function generateBrief(){const filteredRows=filtered(),h=filteredRows.filter(high),leaders=[...filteredRows].sort((a,b)=>value(b)-value(a)).slice(0,8),nLocal=filteredRows.filter(isUtility).length;const geo=STATE.state!=='all'?byId.get(filteredRows[0]?.f)?.sn||STATE.state:STATE.region!=='all'?STATE.region[0].toUpperCase()+STATE.region.slice(1):'United States';const sector=STATE.sector==='res'?'residential':'commercial';
 return`<div class="brief-title">U.S. multifamily solar market screening</div><p style="font-size:12px;color:#496a7f">${esc(geo)} · ${esc(sector)} rate class · V2 screening brief · generated locally</p><div class="brief-grid"><div class="brief-box"><small>COUNTIES IN SCOPE</small><strong>${fmt(filteredRows.length)}</strong></div><div class="brief-box"><small>HIGH ON BOTH</small><strong>${fmt(h.length)}</strong></div><div class="brief-box"><small>UTILITY-SPECIFIC PRICE</small><strong>${fmt(nLocal)}</strong></div></div><h3>Highest annual retail-value potential</h3><ol class="brief-list">${leaders.map(r=>`<li>${esc(r.n)}, ${esc(r.st)} — <strong>${money(value(r))}/kW DC/yr</strong> (${cents(p(r))}, ${fmt(solar(r))} kWh/kW DC/yr; ${isUtility(r)?'utility benchmark':'state price estimate'})</li>`).join('')}</ol><div class="brief-caveat"><strong>How to interpret:</strong> This is a gross retail-value screening metric, not actual system savings. Solar uses PVGIS 5.3 / ERA5 at one Census county internal point with a fixed 20° south-facing crystalline-silicon installation. 2025 sector retail prices use EIA annual revenue divided by sales. Counties may share a utility rate. Multifamily inventory, ETB tariff detail, and owner-versus-tenant allocation must be verified at property level. The nationwide solar set is complete, but ${fmt(filteredRows.length-nLocal)} selected counties still use labeled state-level price estimates. Source package includes all 3,144 counties in the 50 states + DC.</div>`;
}
function briefPlainText(){const ds=filtered(),leaders=[...ds].sort((a,b)=>value(b)-value(a)).slice(0,8);return`SHINEIQ V2 — NATIONAL MULTIFAMILY SOLAR SCREEN\nSector: ${STATE.sector==='res'?'residential':'commercial'} 2025 EIA rate benchmark\nCounties in scope: ${ds.length}\nHigh on both: ${ds.filter(high).length}\nUtility-specific benchmarks: ${ds.filter(isUtility).length}\n\nTop annual gross retail-value potential:\n`+leaders.map((r,i)=>`${i+1}. ${r.n}, ${r.st}: ${money(value(r))}/kW DC/year; ${cents(p(r))}; ${fmt(solar(r))} kWh/kW DC/year; ${isUtility(r)?'utility reference':'state price estimate'}`).join('\n')+'\n\nCaution: market screening potential only; not actual apartment property savings. V1 remains unchanged.';}
function openExecutive(){const el=$('executiveBody');el.innerHTML=generateBrief();openModal('execModal');}
function wire(){document.querySelectorAll('.tabnav .tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));$('sectorSelect').addEventListener('change',setFiltersFromUi);$('regionSelect').addEventListener('change',setFiltersFromUi);$('stateSelect').addEventListener('change',setFiltersFromUi);$('searchCounty').addEventListener('input',setFiltersFromUi);$('localOnly').addEventListener('change',setFiltersFromUi);
 $('resetFilters').addEventListener('click',()=>{$('sectorSelect').value='res';$('regionSelect').value='all';$('stateSelect').value='all';$('searchCounty').value='';$('localOnly').checked=false;setFiltersFromUi()});
 document.querySelectorAll('#metricOptions [data-metric]').forEach(b=>b.addEventListener('click',()=>{STATE.metric=b.dataset.metric;updateMap()}));
 $('rankCount').addEventListener('change',e=>{STATE.rankCount=Number(e.target.value);updateRankings()});$('exportRankings').addEventListener('click',()=>exportRanking());
 $('openDataHub').addEventListener('click',openDataHub);$('inventoryImport').addEventListener('click',openDataHub);$('openExec').addEventListener('click',openExecutive);
 $('exportScores').addEventListener('click',()=>exportRanking('score'));$('resetWeights').addEventListener('click',()=>{STATE.weights={value:55,solar:25,multifamily:0,lihtc:0,confidence:20};updateScoring();if(STATE.metric==='score')updateMap()});$('applyScoreMap').addEventListener('click',()=>{STATE.metric='score';switchTab('map');updateMap()});$('viewHighMap').addEventListener('click',()=>{STATE.metric='high';switchTab('map');updateMap()});
 $('compareSearch').addEventListener('input',populateCompareSearch);$('clearCompare').addEventListener('click',()=>{STATE.compare=[];updateCompare()});
 for(const id of ['scenarioCounty','meterMode','systemKw','costPerW','selfConsumed','exportRatio','ownerCapture','rateOverride'])$(id).addEventListener('input',e=>{if(id==='meterMode'){if(e.target.value==='tenant')$('ownerCapture').value=0;else if(e.target.value==='common')$('ownerCapture').value=100;else $('ownerCapture').value=80;}updateScenario()});
 for(const [id,k] of [['uploadAcs','acs'],['uploadLihtc','lihtc'],['uploadRates','rates'],['uploadSolar','solar']])$(id).addEventListener('change',e=>importData(k,e.target.files[0]));
 for(const b of document.querySelectorAll('[data-close-modal]'))b.addEventListener('click',()=>closeModal(b.dataset.closeModal));for(const m of document.querySelectorAll('.modal-backdrop'))m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)});document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.modal-backdrop:not([hidden])').forEach(x=>closeModal(x.id))});
 $('copyBrief').addEventListener('click',async()=>{const t=briefPlainText();try{await navigator.clipboard.writeText(t);toast('Executive summary copied')}catch(e){const ta=document.createElement('textarea');ta.value=t;document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();toast('Executive summary copied')}});$('printBrief').addEventListener('click',()=>window.print());
 document.addEventListener('click',e=>{const action=e.target.closest('[data-go-tab],[data-select],[data-addcompare],[data-removecompare],[data-choosecompare]');if(!action)return;
 if(action.dataset.goTab)switchTab(action.dataset.goTab);
 if(action.dataset.select){selectCounty(action.dataset.select);switchTab('map')}
 if(action.dataset.addcompare){addCompare(action.dataset.addcompare)}
 if(action.dataset.removecompare)removeCompare(action.dataset.removecompare);
 if(action.dataset.choosecompare){addCompare(action.dataset.choosecompare);$('compareSearch').value='';$('compareResults').hidden=true;}
 });
}

function layerProvenance(r){
 if(STATE.metric==='change')return 'EIA state average; Jan-Aug matched periods';
 if(STATE.metric==='multifamily')return STATE.acs.has(r.f)?'ACS 5-year estimate; rental units, not buildings':'ACS source not loaded';
 if(STATE.metric==='lihtc')return STATE.lihtc.has(r.f)?'HUD historical inventory; located project records':'HUD source not loaded';
 return isUtility(r)?'Utility reference rate':'State price estimate';
}
function tariffDetail(r){
 const t=STATE.tariffSnapshots.get(r.f);if(!t)return '';
 return `<div class="detail-section"><h4>OPTIONAL TARIFF SNAPSHOT</h4><p>Residential: ${cents(t.res)}; commercial: ${cents(t.com)}<br>${esc(t.source)}<br>Effective date: ${esc(t.notes.join('; '))}<br><small>User-supplied, not independently verified. Not used in the matched-period rate-shift map.</small></p></div>`;
}
function layerDetail(r){
 if(STATE.metric==='change'){
  const t=STATE.rates2026.get(r.f);if(!t)return '';
  const a=STATE.sector==='res'?t.res2025:t.com2025,b=STATE.sector==='res'?t.res:t.com;
  return `<div class="detail-section"><h4>SELECTED LAYER: STATE PRICE CHANGE</h4><p>${esc(t.period)} 2025: <strong>${cents(a)}</strong><br>${esc(t.period)} 2026: <strong>${cents(b)}</strong><br>Change: <strong>${metricString(r,'change')} (${b>a?'+':''}${fmt((b/a-1)*100,1)}%)</strong><br><small>State average repeated across counties. 2026 preliminary. This does not replace the original 2025 utility benchmark above.</small></p></div>`;
 }
 if(STATE.metric==='multifamily'){
  const t=STATE.acs.get(r.f);return t?`<div class="detail-section"><h4>SELECTED LAYER: MULTIFAMILY FOOTPRINT</h4><p><strong>${fmt(t.units)}</strong> renter-occupied units in structures with 5+ units.<br>2024 ACS 5-year estimate; not a building count.${Number.isFinite(t.moe)?'<br>Approximate 90% margin of error: '+fmt(t.moe):''}</p></div>`:'';
 }
 if(STATE.metric==='lihtc'){
  const t=STATE.lihtc.get(r.f);return t?`<div class="detail-section"><h4>SELECTED LAYER: HUD INVENTORY</h4><p><strong>${fmt(t.properties)}</strong> located historical project records.<br>${t.properties===0?'No located records in this snapshot; this does not prove no LIHTC housing exists.<br>':''}${fmt(t.units)} reported units; unknown unit counts are excluded from that sum.<br>Different HUD IDs may represent phases or repeat awards at one physical site.</p></div>`:'';
 }
 return '';
}
function updateLayerState(){
 const status={multifamily:STATE.acs.size,lihtc:STATE.lihtc.size,change:STATE.rates2026.size};
 for(const [key,count] of Object.entries(status)){
  const b=document.querySelector(`[data-metric="${key}"]`);let tag=b.querySelector('.layer-status');if(!tag){tag=document.createElement('span');b.querySelector('small').after(tag)}tag.className='layer-status '+(count?'ready':'pending');tag.textContent=count?(key==='change'?'50 STATES + DC':'DATA LOADED'):'SOURCE NOT LOADED';b.classList.toggle('pending',!count);
 }
 const el=$('layerNotice'),which=STATE.metric,missing=(which==='multifamily'&&!STATE.acs.size)||(which==='lihtc'&&!STATE.lihtc.size);
 if(el){const audit=ENRICH.sources?.lihtc?.stats;const partial=which==='lihtc'&&audit?.unresolved_county_records;el.hidden=!missing&&!partial;if(partial)el.innerHTML=`<strong>HUD historical inventory loaded, with unresolved records.</strong>${fmt(audit.located_project_records)} located project records; ${fmt(audit.unresolved_county_records)} in-scope records could not be assigned confidently and are omitted. County zeros mean no located records in this snapshot. <a href="data/hud_unresolved_records.json" download>Review unresolved records</a>.`;if(missing){const name=which==='multifamily'?'Multifamily footprint':'LIHTC inventory';el.innerHTML=`<strong>${name}: source dataset is not installed yet.</strong>The map is not showing zero properties. Its source data is missing. The publishing build must run the included public-inventory preparation script and bundle the output, or load a verified CSV in Data hub. Existing solar and electricity-price maps remain available.`;}}
 const grad=$('mapLegend').querySelector('.legend-gradient');if(grad){grad.style.background=which==='change'?'linear-gradient(90deg,#24609b,#f3f8fc,#fff8e8,#ad501b)':`linear-gradient(90deg,${(palettes[which]||palettes.value).map(v=>'rgb('+v.join(',')+')').join(',')})`;if(which==='change'){const b=legendBounds(),m=Math.max(1,Math.abs(b?.min??0),Math.abs(b?.max??0)),labels=$('mapLegend').querySelectorAll('.legend-caption');labels[0].textContent='-'+fmt(m,1);labels[1].textContent='+'+fmt(m,1)+' cents/kWh';grad.title='Blue: decrease; white: zero; orange: increase. Symmetric scale; extremes clipped.';}}
}

function init(){if(COUNTY.length!==3144||Object.keys(GEO).length!==3144){document.body.innerHTML='<div style="padding:50px;color:#193248;background:#f5f8fb;font:16px sans-serif">The national source dataset failed validation. Expected 3,144 complete counties. Site not started.</div>';return;}fillStates();buildMap();recomputeScores();wire();updateMap();updateScenario();updateInventory();console.info('ShineIQ Market Atlas V2 initialized; 3,144 counties; V1 preserved.');}
init();
})();

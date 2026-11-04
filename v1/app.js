(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fmt = new Intl.NumberFormat('en-US', {maximumFractionDigits: 0});
  const dec = new Intl.NumberFormat('en-US', {minimumFractionDigits: 1, maximumFractionDigits: 1});
  const money = n => finite(n) ? '$' + fmt.format(n) : '—';
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const colors = ['#e6edf1','#b4cdd2','#78aab4','#3d788e','#173f5b'];
  const bothColors = [['#e6eaee','#d9cc9c','#ca9c3b'],['#a7d6d6','#9cbaa5','#7d955a'],['#45a9bb','#3c8091','#163d59']];
  const viewInfo = {
    value: ['Annual retail-value potential','Electricity price × annual solar yield · $ per kW DC per year'],
    rate: ['Average electricity price','Annual sector benchmark · cents per kWh'],
    yield: ['Annual solar productivity','At the county reference point · kWh per kW DC per year'],
    both: ['Find markets that are high on both','Electricity price and solar yield at or above their national 67th percentiles']
  };
  const state = {basis:'res',view:new URLSearchParams(location.search).get('view') || 'value',region:'all',includeFallback:true,selected:null,limit:25};
  if (!viewInfo[state.view]) state.view = 'value';
  let rows=[], byId, geo, meta={}, national={}, mapSvg, mapGroup, countyPaths, hatchPaths, selectedPath, path, zoom;
  let visible=[], tableRows=[], currentScale, toastTimer;
  const rate = r => state.basis === 'res' ? r.rate_res : r.rate_com;
  const method = r => state.basis === 'res' ? r.method_res : r.method_com;
  const methodText = r => state.basis === 'res' ? r.method_text_res : r.method_text_com;
  const fallback = r => typeof r['fallback_'+state.basis] === 'boolean' ? r['fallback_'+state.basis] : /state|fallback|unresolved/.test(method(r) || '');
  const value = r => finite(rate(r)) && finite(r.yield) ? rate(r) * r.yield : null;
  const measure = r => state.view === 'yield' ? r.yield : state.view === 'rate' ? (finite(rate(r)) ? rate(r)*100 : null) : value(r);
  const available = r => finite(measure(r));
  const eligible = r => (state.region === 'all' || r.state === state.region) && (state.includeFallback || !fallback(r));
  const highBoth = r => finite(rate(r)) && finite(r.yield) && rate(r) >= national.rate67 && r.yield >= national.yield67;
  const bin = (v, a, b) => v >= b ? 2 : v >= a ? 1 : 0;
  const metricText = (v, view = state.view) => !finite(v) ? '—' : view === 'rate' ? dec.format(v)+'¢' : view === 'yield' ? fmt.format(v) : money(v);
    const methodLabel = r => fallback(r) ? 'State estimate' : /point|territory/.test(method(r)||'') ? 'Reference utility' : /single/.test(method(r)||'') ? 'Single utility' : /weighted/.test(method(r)||'') ? 'County estimate' : 'Utility benchmark';

  async function init() {
    try {
      const replies = await Promise.all(['data/counties.json','data/counties.geojson','data/meta.json'].map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Data file could not be loaded: '+url);
        return response.json();
      }));
      rows=replies[0];geo=replies[1];meta=replies[2];
      if (!Array.isArray(rows) || !geo.features) throw new Error('The data package is incomplete.');
      rows.forEach(r => {r.fips=String(r.fips).padStart(5,'0');});
      byId = new Map(rows.map(r => [r.fips,r]));
      geo.features.forEach(f => {f.id=String(f.properties.fips||f.properties.GEOID||f.id).padStart(5,'0');});
      const states = [...new Map(rows.map(r=>[r.state,r.state_name||r.state])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
      $('state-filter').innerHTML='<option value="all">All 50 states + D.C.</option>'+states.map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
      updateDatalist('');
      wireControls();
      computeNational();
      drawMap();
      state.selected = byId.has('06099') ? '06099' : rows.find(r=>finite(value(r)))?.fips || rows[0].fips;
      buildMethod();
      render();
      $('map-loading').hidden=true;
      if (meta.build_status !== 'complete') {
        $('footer-data').textContent='Build in progress · '+rows.filter(r=>finite(r.yield)).length+' of '+rows.length+' solar calculations available';
        $('stat-coverage').textContent='Solar batch in progress';
      }
    } catch(error) {
      $('map-loading').innerHTML='<div class="error-state"><strong>The data is still being prepared.</strong><br>'+esc(error.message)+'<br>Reload once the data package is available.</div>';
      console.error(error);
    }
  }

  function computeNational() {
    const complete=rows.filter(r=>finite(value(r)));
    const rates=complete.map(rate).sort((a,b)=>a-b);
    const yields=complete.map(r=>r.yield).sort((a,b)=>a-b);
    national={rate33:d3.quantileSorted(rates,1/3),rate67:d3.quantileSorted(rates,2/3),yield33:d3.quantileSorted(yields,1/3),yield67:d3.quantileSorted(yields,2/3)};
    const ordered=[...complete].sort((a,b)=>value(b)-value(a)||a.fips.localeCompare(b.fips));
    national.rank=new Map(ordered.map((r,i)=>[r.fips,i+1]));
    national.count=complete.length;
  }

  function drawMap() {
    mapSvg=d3.select('#county-map');
    const defs=mapSvg.append('defs');
    const pattern=defs.append('pattern').attr('id','fallback-hatch').attr('width',5).attr('height',5).attr('patternUnits','userSpaceOnUse').attr('patternTransform','rotate(35)');
    pattern.append('line').attr('x1',0).attr('y1',0).attr('x2',0).attr('y2',5).attr('stroke','#ffffff').attr('stroke-width',.65).attr('opacity',.55);
    const projection=d3.geoAlbersUsa().fitExtent([[28,30],[948,552]],geo);
    path=d3.geoPath(projection);
    mapGroup=mapSvg.append('g');
    countyPaths=mapGroup.append('g').selectAll('path').data(geo.features).join('path').attr('class','county-path').attr('d',path).attr('fill','#e5e8ea').attr('stroke','#fff').attr('stroke-width',.15)
      .on('pointermove',(event,f)=>showTooltip(event,byId.get(f.id)))
      .on('pointerleave',hideTooltip)
      .on('click',(_,f)=>selectCounty(f.id));
    countyPaths.append('title').text(f=>{const r=byId.get(f.id);return r ? r.name+', '+r.state : f.id;});
    hatchPaths=mapGroup.append('g').attr('pointer-events','none').selectAll('path').data(geo.features).join('path').attr('d',path).attr('fill','url(#fallback-hatch)');
    selectedPath=mapGroup.append('path').attr('class','selected-outline');
    zoom=d3.zoom().scaleExtent([1,12]).translateExtent([[0,0],[980,585]]).filter(e=>e.type==='wheel'?e.ctrlKey:!e.button).on('zoom',e=>mapGroup.attr('transform',e.transform));
    mapSvg.call(zoom).on('dblclick.zoom',null);
    $('zoom-in').onclick=()=>mapSvg.transition().duration(220).call(zoom.scaleBy,1.6);
    $('zoom-out').onclick=()=>mapSvg.transition().duration(220).call(zoom.scaleBy,1/1.6);
    $('zoom-reset').onclick=()=>mapSvg.transition().duration(250).call(zoom.transform,d3.zoomIdentity);
  }

  function wireControls() {
    document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view;render();});
    $('price-basis').onchange=e=>{state.basis=e.target.value;computeNational();render();};
    $('state-filter').onchange=e=>{state.region=e.target.value;render();};
    $('include-fallback').onchange=e=>{state.includeFallback=e.target.checked;render();};
    $('table-limit').onchange=e=>{state.limit=e.target.value==='all'?Infinity:+e.target.value;renderTable();};
    $('county-search').oninput=e=>updateDatalist(e.target.value);
    const chooseSearch=()=>{const q=$('county-search').value.trim().toLowerCase();if(!q)return;const exact=rows.find(r=>r.fips===q||`${r.name}, ${r.state}`.toLowerCase()===q);const matches=rows.filter(r=>`${r.name} ${r.state} ${r.state_name} ${r.fips}`.toLowerCase().includes(q));const r=exact||(matches.length===1?matches[0]:null);if(r){if(state.region!=='all'&&state.region!==r.state){state.region=r.state;$('state-filter').value=r.state;}if(!state.includeFallback&&fallback(r)){state.includeFallback=true;$('include-fallback').checked=true;toast('State price estimates included to show this county.');}state.selected=r.fips;render();}};
    $('county-search').onchange=chooseSearch;
    $('county-search').onkeydown=e=>{if(e.key==='Enter'){chooseSearch();e.target.blur();}if(e.key==='Escape'){e.target.value='';updateDatalist('');}};
    const showMethod=()=>$('method-dialog').showModal();
    $('method-button').onclick=showMethod;$('footer-method').onclick=showMethod;
    $('close-dialog').onclick=()=>$('method-dialog').close();$('close-dialog-bottom').onclick=()=>$('method-dialog').close();
    $('method-dialog').addEventListener('click',e=>{if(e.target===$('method-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
    $('download-csv').onclick=exportCsv;$('download-map').onclick=exportMap;
    document.addEventListener('scroll',hideTooltip,{passive:true});
  }

  function updateDatalist(query) {
    const q=query.toLowerCase();
    $('county-options').innerHTML=rows.filter(r=>!q||`${r.name} ${r.state} ${r.state_name} ${r.fips}`.toLowerCase().includes(q)).slice(0,50).map(r=>`<option value="${esc(r.name+', '+r.state)}">${esc(r.fips)}</option>`).join('');
  }

  function render() {
    visible=rows.filter(eligible);
    const selected=byId.get(state.selected);
    if(!selected||!eligible(selected))state.selected=visible.find(r=>finite(value(r)))?.fips||visible[0]?.fips||null;
    const allMetric=rows.map(measure).filter(finite).sort((a,b)=>a-b);
    currentScale=d3.scaleQuantile().domain(allMetric).range(colors);
    document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===state.view;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});
    $('map-title').textContent=viewInfo[state.view][0];$('map-subtitle').textContent=viewInfo[state.view][1];
    $('map-count').textContent=state.region==='all'?'National view':rows.find(r=>r.state===state.region)?.state_name||state.region;
    $('basis-note').textContent=state.basis==='res'?'Residential-sector prices are a benchmark for multifamily residential service; they include all residential building types. Confirm each property’s actual meter tariff.':'Commercial-sector prices are a separate sensitivity comparison for meters on commercial service. A master meter is not automatically commercial; use its actual tariff.';
    const withData=visible.filter(r=>finite(value(r)));
    const dataCount=visible.filter(available).length;
    const localCount=visible.filter(r=>finite(rate(r))&&!fallback(r)).length;
    $('stat-count').textContent=fmt.format(visible.length);
    $('stat-coverage').textContent=fmt.format(localCount)+' with utility benchmarks · '+fmt.format(dataCount)+' mapped';
    const medianRate=d3.median(visible.filter(r=>finite(rate(r))),r=>rate(r)*100);
    const medianYield=d3.median(visible.filter(r=>finite(r.yield)),r=>r.yield);
    $('stat-rate').innerHTML=finite(medianRate)?dec.format(medianRate)+'<small>¢ / kWh</small>':'—';
    $('stat-yield').textContent=finite(medianYield)?fmt.format(medianYield):'—';
    $('stat-both').textContent=fmt.format(withData.filter(highBoth).length);
    countyPaths.attr('fill',f=>{const r=byId.get(f.id);if(!r||!eligible(r)||!available(r))return '#e5e8ea';if(state.view==='both')return bothColors[bin(r.yield,national.yield33,national.yield67)][bin(rate(r),national.rate33,national.rate67)];return currentScale(measure(r));}).attr('opacity',f=>{const r=byId.get(f.id);return r&&eligible(r)?1:.23;}).classed('selected',f=>f.id===state.selected);
    hatchPaths.attr('display',f=>{const r=byId.get(f.id);return r&&state.view!=='yield'&&eligible(r)&&available(r)&&fallback(r)?null:'none';});
    selectedPath.attr('d',geo.features.find(f=>f.id===state.selected)?path(geo.features.find(f=>f.id===state.selected)):null);
    renderLegend(allMetric);renderDetail();renderScatter();renderTable();
  }

  function renderLegend(allMetric) {
    if(state.view==='both') {
      $('map-legend').innerHTML=`<div class="bivariate-legend"><div><div class="bivariate-grid">${[2,1,0].flatMap(y=>[0,1,2].map(x=>`<span style="background:${bothColors[y][x]}" title="Solar ${['low','middle','high'][y]}, price ${['low','middle','high'][x]}"></span>`)).join('')}</div><span class="bivariate-axis">Price → &nbsp; Yield ↑</span></div><div class="bivariate-copy"><strong>Dark blue = high on both</strong><br>Price ≥ ${finite(national.rate67)?dec.format(national.rate67*100)+'¢':'—'} / kWh<br>Yield ≥ ${finite(national.yield67)?fmt.format(national.yield67):'—'} kWh / kW / year</div></div>`;
    } else {
      const breaks=[d3.min(allMetric),...currentScale.quantiles(),d3.max(allMetric)];
      $('map-legend').innerHTML=`<div class="legend-caption"><strong>${state.view==='value'?'Annual value per installed kW':state.view==='rate'?'Cents per kWh':'Annual kWh per installed kW'}</strong><span>National quintiles · higher →</span></div><div class="legend-colors">${colors.map(c=>`<span style="background:${c}"></span>`).join('')}</div><div class="legend-values">${breaks.map(v=>`<span>${metricText(v)}</span>`).join('')}</div>`;
    }
  }

  function selectCounty(id) {
    if(!byId.has(id))return;
    if(!eligible(byId.get(id))){toast('This county is outside the current filters. Search its name to include it.');return;}
    state.selected=id;
    countyPaths.classed('selected',f=>f.id===id);
    selectedPath.attr('d',path(geo.features.find(f=>f.id===id)));
    renderDetail();renderTable();renderScatter();hideTooltip();
  }

  function renderDetail() {
    const r=byId.get(state.selected);if(!r){$('detail-body').hidden=true;$('detail-state').textContent='COUNTY DETAIL';$('detail-rank').textContent='No selection';$('detail-name').textContent='No matching counties';$('detail-lead').textContent='Adjust the geography or include state price estimates.';return;}
    $('detail-body').hidden=false;
    $('detail-state').textContent=(r.state_name||r.state).toUpperCase();
    $('detail-name').textContent=r.name;
    const rank=national.rank.get(r.fips);
    $('detail-rank').textContent=rank?'#'+fmt.format(rank)+' of '+fmt.format(national.count):'Data pending';
    $('detail-lead').textContent='FIPS '+r.fips+' · '+(highBoth(r)?'High on both national measures':state.basis==='res'?'Residential meter benchmark':'Commercial meter comparison');
    $('detail-value').textContent=money(value(r));
    $('detail-rate').textContent=finite(rate(r))?dec.format(rate(r)*100)+'¢':'—';
    $('detail-yield').textContent=finite(r.yield)?fmt.format(r.yield):'—';
    $('panel-energy').textContent=finite(r.yield)?fmt.format(r.yield*.595):'—';
    $('panel-value').textContent=money(finite(value(r))?value(r)*.595:null);
    $('detail-method').textContent=methodLabel(r);$('detail-method').className='quality-badge'+(fallback(r)?' fallback':'');
    $('detail-method-text').textContent=methodText(r)||(fallback(r)?'2025 state sector average. A comparable local utility price could not be assigned with sufficient confidence.':'2025 EIA utility-sector average assigned using the documented county method.');
    const utilities=r.utilities||[];
    $('utility-count').textContent=utilities.length?utilities.length+' listed':'—';
    $('utility-list').innerHTML=utilities.length?utilities.map(u=>{const p=state.basis==='res'?u.rate_res:u.rate_com;return `<div class="utility-row"><strong>${esc(u.name||u.utility_name||'Utility '+(u.id||''))}</strong>${u.id?'EIA '+esc(u.id)+' · ':''}${finite(p)?dec.format(p*100)+'¢/kWh sector benchmark':'Comparable sector price unavailable'}${u['selected_'+state.basis]?' · used in estimate':''}</div>`;}).join(''):'<p class="utility-row">Utility allocation is unresolved; the displayed price uses the documented fallback.</p>';
    renderMonthly(r);
  }

  function renderMonthly(r) {
    const svg=d3.select('#monthly-chart');svg.selectAll('*').remove();
    const monthly=r.monthly||[];
    if(monthly.length!==12){svg.append('text').attr('x',150).attr('y',50).attr('text-anchor','middle').attr('fill','#8b9da6').attr('font-size',10).text('Monthly estimate unavailable');return;}
    const x=d3.scaleBand().domain(d3.range(12)).range([3,297]).padding(.3);
    const y=d3.scaleLinear().domain([0,d3.max(monthly)]).range([80,9]);
    svg.selectAll('rect').data(monthly).join('rect').attr('x',(_,i)=>x(i)).attr('y',y).attr('width',x.bandwidth()).attr('height',d=>80-y(d)).attr('rx',2).attr('fill',(d,i)=>i>=4&&i<=7?'#2d7f91':'#bfd5dc').append('title').text((d,i)=>['January','February','March','April','May','June','July','August','September','October','November','December'][i]+': '+dec.format(d)+' kWh per kW DC');
    svg.selectAll('.month').data(['J','F','M','A','M','J','J','A','S','O','N','D']).join('text').attr('x',(_,i)=>x(i)+x.bandwidth()/2).attr('y',96).attr('text-anchor','middle').attr('font-size',8).attr('fill','#93a4ad').text(d=>d);
  }

  function showTooltip(event,r) {
    if(!r)return;
    const t=$('tooltip');t.innerHTML=`<strong>${esc(r.name)}, ${esc(r.state)}</strong><div class="tooltip-grid"><span>Electricity price</span><b>${finite(rate(r))?dec.format(rate(r)*100)+'¢/kWh':'—'}</b><span>Annual yield</span><b>${finite(r.yield)?fmt.format(r.yield):'—'} kWh/kW</b><span>Combined value</span><b>${money(value(r))}/kW/year</b></div><small>${esc(methodLabel(r))}${highBoth(r)?' · High on both':''}</small>`;
    t.hidden=false;const rect=t.getBoundingClientRect();t.style.left=Math.max(8,Math.min(event.clientX+15,innerWidth-rect.width-10))+'px';t.style.top=Math.max(8,Math.min(event.clientY+14,innerHeight-rect.height-10))+'px';
  }
  function hideTooltip(){$('tooltip').hidden=true;}

  function renderScatter() {
    const svg=d3.select('#scatter-chart');svg.selectAll('*').remove();
    const points=visible.filter(r=>finite(value(r)));if(!points.length)return;
    const all=rows.filter(r=>finite(value(r)));
    const x=d3.scaleLinear().domain([Math.floor(d3.min(all,r=>r.yield)/100)*100,d3.max(all,r=>r.yield)*1.04]).nice().range([59,640]);
    const y=d3.scaleLinear().domain([0,d3.max(all,r=>rate(r)*100)*1.06]).nice().range([264,28]);
    svg.append('rect').attr('x',x(national.yield67)).attr('y',28).attr('width',640-x(national.yield67)).attr('height',y(national.rate67*100)-28).attr('fill','#eff6f3');
    svg.append('g').attr('transform','translate(59,0)').call(d3.axisLeft(y).ticks(5).tickSize(-581).tickFormat(d=>d+'¢')).call(g=>g.select('.domain').remove()).call(g=>g.selectAll('line').attr('stroke','#e7eef1')).call(g=>g.selectAll('text').attr('fill','#8d9ea8').attr('font-size',9).attr('dx',-5));
    svg.append('g').attr('transform','translate(0,264)').call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(',d')).tickSize(0)).call(g=>g.select('.domain').attr('stroke','#dce5e9')).call(g=>g.selectAll('text').attr('fill','#8d9ea8').attr('font-size',9).attr('dy',15));
    svg.append('line').attr('x1',x(national.yield67)).attr('x2',x(national.yield67)).attr('y1',28).attr('y2',264).attr('stroke','#7fa5a6').attr('stroke-dasharray','3,4');
    svg.append('line').attr('x1',59).attr('x2',640).attr('y1',y(national.rate67*100)).attr('y2',y(national.rate67*100)).attr('stroke','#7fa5a6').attr('stroke-dasharray','3,4');
    svg.append('text').attr('x',630).attr('y',42).attr('text-anchor','end').attr('font-size',9).attr('font-weight',650).attr('fill','#6e9a8e').text('HIGH ON BOTH');
    svg.append('g').selectAll('circle').data(points).join('circle').attr('class','scatter-dot').attr('cx',r=>x(r.yield)).attr('cy',r=>y(rate(r)*100)).attr('r',r=>r.fips===state.selected?5:2.3).attr('fill',r=>r.fips===state.selected?'#edb51e':highBoth(r)?'#23687b':'#94afbc').attr('opacity',r=>r.fips===state.selected?1:highBoth(r)?.72:.42).on('pointermove',showTooltip).on('pointerleave',hideTooltip).on('click',(_,r)=>selectCounty(r.fips));
    const selected=byId.get(state.selected);if(selected&&eligible(selected)&&finite(value(selected)))svg.append('circle').attr('cx',x(selected.yield)).attr('cy',y(rate(selected)*100)).attr('r',5.5).attr('fill','#edb51e').attr('stroke','#fff').attr('stroke-width',1.1).attr('pointer-events','none');
    svg.append('text').attr('x',350).attr('y',308).attr('text-anchor','middle').attr('font-size',9).attr('fill','#7e939f').text('Annual solar yield (kWh / kW DC) →');
    svg.append('text').attr('x',59).attr('y',13).attr('font-size',9).attr('fill','#7e939f').text('Electricity price (¢ / kWh)');
  }

  function renderTable() {
    tableRows=visible.filter(r=>finite(value(r))&&(state.view!=='both'||highBoth(r))).sort((a,b)=>value(b)-value(a)||a.fips.localeCompare(b.fips));
    const shown=tableRows.slice(0,state.limit);
    $('ranking-title').textContent=state.view==='both'?'Counties high on both':'Counties by combined value';
    $('ranking-description').textContent=state.view==='both'?'Counties meeting both national thresholds, ordered by annual retail-value potential.':'Sorted by annual retail-value potential. Ranks are national; select any row to inspect the county.';
    $('ranking-body').innerHTML=shown.length?shown.map(r=>`<tr data-fips="${r.fips}" class="${r.fips===state.selected?'selected':''}" tabindex="0" aria-label="Inspect ${esc(r.name)}, ${esc(r.state)}"><td>${fmt.format(national.rank.get(r.fips))}</td><td>${esc(r.name)}<small>${esc(r.state)}</small></td><td class="num">${dec.format(rate(r)*100)}</td><td class="num">${fmt.format(r.yield)}</td><td class="num table-value">${money(value(r))}</td><td><span class="row-badge${fallback(r)?' fallback':''}">${esc(methodLabel(r))}</span></td></tr>`).join(''):'<tr><td colspan="6" class="table-empty">No counties meet these filters. Include state estimates or choose another geography.</td></tr>';
    $('ranking-body').querySelectorAll('tr[data-fips]').forEach(tr=>{tr.onclick=()=>selectCounty(tr.dataset.fips);tr.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectCounty(tr.dataset.fips);}};});
    $('table-footer').textContent=`Showing ${fmt.format(shown.length)} of ${fmt.format(tableRows.length)} counties in this view. ${state.basis==='res'?'Residential':'Commercial'} price benchmark · ${state.includeFallback?'State estimates included and labeled.':'State estimates excluded.'}`;
  }

  function buildMethod() {
    const local=rows.filter(r=>finite(r.rate_res)&&r.fallback_res===false).length;
    const complete=rows.filter(r=>finite(r.yield)).length;
    $('method-content').innerHTML=`
      <div class="method-highlight"><strong>Purpose:</strong> screen U.S. counties for multifamily solar by combining the value of electricity with a consistent estimate of solar productivity. This is not a project savings, payback, or roof-capacity model.</div>
      <h3>1. Annual specific PV yield is the comparison metric</h3><p>Annual electricity in <strong>kWh per kW DC per year</strong> makes locations comparable independently of module size. A 595 W equivalent is the yield multiplied by 0.595. The panel display is a capacity conversion, not a manufacturer-specific module simulation.</p>
      <h3>2. Solar model: one consistent configuration</h3><p><a href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5_en" target="_blank" rel="noopener">European Commission Joint Research Centre — PVGIS 5.3</a>, with the ERA5 dataset for 2005–2023. The annual result is the model's mean annual production across that period.</p><table><tbody><tr><td>Capacity / technology</td><td>1 kW DC · crystalline silicon</td></tr><tr><td>Orientation / tilt</td><td>Due south · fixed 20°</td></tr><tr><td>Mounting</td><td>Ventilated rack / free-standing model</td></tr><tr><td>System losses</td><td>14%; PVGIS also models temperature and irradiance effects</td></tr><tr><td>Local shading</td><td>Horizon shading disabled; no building, tree, roof obstruction, or row-spacing model</td></tr><tr><td>Representative location</td><td>Official Census 2025 county internal point; not a population-weighted county average</td></tr></tbody></table><p>The model represents an unshaded reference installation. Weather data is a regional estimate; microclimates, snow/soiling behavior, shading, actual orientation, and equipment can change project production. ${fmt.format(complete)} of ${fmt.format(rows.length)} county calculations are available in this build.</p>
      <h3>3. Electricity price and multifamily use</h3><p><a href="https://www.eia.gov/electricity/data/eia861/" target="_blank" rel="noopener">U.S. EIA — 2025 final annual electricity data</a>. The price benchmark is average sector revenue divided by corresponding electricity sales. Residential prices include all residential building types; this is not an apartment-only observed price dataset.</p><p>The default residential benchmark supports screening for multifamily residential service. The commercial comparison is separate and applies only where a meter is actually on commercial service. A master meter does not by itself establish the rate class. The two sectors are never blended.</p><p>Prices are assigned using the documented method for each county. Counties served by the same utility may share a rate. ${fmt.format(local)} counties have a residential utility benchmark; the remaining areas use the same-year state average, identified by hatching, badges, and the county explanation. The utility list is context, not proof that every provider serves every address.</p><p>Where a unique archived HIFLD utility territory covers the county reference point, its EIA utility identifier is checked against the county provider list and the corresponding utility-state bundled sector price. A separately established single-provider benchmark can also be used. This does not estimate the utility mix across the whole county. The HIFLD copy was archived on August 21, 2025; individual boundaries can be older.</p><p>State estimates can be excluded. Unresolved supply/delivery combinations and absent sector-specific prices do not become invented local prices. The dataset retains sources and method flags.</p>
      <h3>4. Combined value and “high on both”</h3><p><strong>Combined value = annual yield × electricity price</strong>, in dollars per kW DC per year. This build combines a representative county solar point with the documented price estimate, so it is a county screening approximation.</p><p>“High on both” means at or above the national two-thirds quantile for both yield and the selected sector price, displayed as the 67th percentile. Ties can put more than one third of counties above a threshold. National thresholds remain fixed when filtering by state or hiding state price estimates. Median cards describe the counties currently in view; they are not population-weighted national statistics.</p><p>Actual avoided costs depend on the applicable tariff, time of generation and use, self-consumption, export compensation, eligibility, and fixed or demand charges. In multifamily properties, the meter arrangement and allocation rules also determine whether tenants or owners receive the benefit. Retail-value potential is not guaranteed bill savings. Project costs, incentives, roof area, housing-unit counts, and total addressable market are outside this score.</p>
      <h3>5. Geographic and source references</h3><ul><li><a href="https://www.census.gov/geographies/mapping-files/time-series/geo/carto-boundary-file.html" target="_blank" rel="noopener">U.S. Census cartographic county boundaries</a> and <a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noopener">2025 Gazetteer internal points</a>.</li><li><a href="https://www.eia.gov/electricity/data/eia861/" target="_blank" rel="noopener">EIA-861 utility, sector, and county-service records</a>.</li><li><a href="https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/Electric_Retail_Service_Territories_HIFLD/FeatureServer/0" target="_blank" rel="noopener">Archived HIFLD electric retail service territories</a>, with feature-specific source dates retained.</li><li><a href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis/using-pvgis-5/api-non-interactive-service_en" target="_blank" rel="noopener">PVGIS API documentation</a>.</li></ul><p>${esc(meta.method_note||'Every county export includes its price method, source year, representative solar coordinates, and model identifier.')} Prepared November 3, 2026. ${esc(meta.etb_note||'The separate ETB tariff archive has not yet been incorporated into this public-data baseline.')}</p>`;
  }

  function exportCsv() {
    const out=visible.filter(r=>state.view!=='both'||highBoth(r)).sort((a,b)=>(value(b)||0)-(value(a)||0));
    const header=['county_fips','county','state','price_sector','price_usd_per_kwh','solar_kwh_per_kwdc_year','retail_value_usd_per_kwdc_year','equivalent_595w_kwh_year','high_on_both','national_value_rank','price_method','price_method_detail','solar_latitude','solar_longitude','solar_location_method','price_year','solar_model','solar_weather_period','utility_names'];
    const quote=v=>v==null?'':/[",\n\r]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v);
    const body=out.map(r=>[r.fips,r.name,r.state,state.basis==='res'?'residential':'commercial',rate(r),r.yield,value(r),finite(r.yield)?r.yield*.595:null,finite(value(r))?highBoth(r):null,national.rank.get(r.fips),method(r),methodText(r),r.solar_lat,r.solar_lon,'Census 2025 county internal point',2025,'PVGIS 5.3 / ERA5','2005–2023',(r.utilities||[]).map(u=>u.name).join(' | ')].map(quote).join(','));
    downloadBlob(new Blob(['\ufeff'+header.join(',')+'\r\n'+body.join('\r\n')],{type:'text/csv;charset=utf-8'}),`Shine_Multifamily_Solar_${state.basis}_${state.region}_${state.view}.csv`);
    toast('Downloaded '+fmt.format(out.length)+' county records.');
  }

  async function exportMap() {
    try {
      const clone=$('county-map').cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width','1960');clone.setAttribute('height','1170');
      clone.querySelectorAll('.county-path').forEach(p=>{p.setAttribute('stroke','#fff');p.setAttribute('stroke-width','.15');});
      const outline=clone.querySelector('.selected-outline');if(outline){outline.setAttribute('fill','none');outline.setAttribute('stroke','#eab51c');outline.setAttribute('stroke-width','2.3');}
      const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'}));
      const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
      const canvas=document.createElement('canvas');canvas.width=2100;canvas.height=1530;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,2100,1530);
      c.fillStyle='#173348';c.font='bold 24px Arial';c.fillText('SHINEIQ  /  MULTIFAMILY SOLAR OPPORTUNITY',70,60);c.font='bold 48px Arial';c.fillText(viewInfo[state.view][0],70,127);c.fillStyle='#788e9b';c.font='24px Arial';c.fillText(viewInfo[state.view][1],70,173);
      c.font='21px Arial';c.fillText((state.region==='all'?'United States':$('state-filter').selectedOptions[0].text)+' · '+(state.basis==='res'?'Residential benchmark':'Commercial comparison'),70,213);c.drawImage(img,170,230,1760,1050);URL.revokeObjectURL(url);
      if(state.view!=='both') {const vals=rows.map(measure).filter(finite).sort((a,b)=>a-b);const br=[d3.min(vals),...currentScale.quantiles(),d3.max(vals)];const w=200;colors.forEach((color,i)=>{c.fillStyle=color;c.fillRect(70+i*w,1320,w-4,18);});c.font='18px Arial';c.fillStyle='#6c8490';br.forEach((v,i)=>c.fillText(metricText(v),70+i*w-2,1366));c.fillText('National quintiles · higher →',70,1302);}else{for(let y=0;y<3;y++)for(let x=0;x<3;x++){c.fillStyle=bothColors[2-y][x];c.fillRect(70+x*27,1285+y*27,24,24);}c.font='17px Arial';c.fillStyle='#6c8490';c.fillText('Price →   Yield ↑',70,1388);c.font='22px Arial';c.fillStyle='#173348';c.fillText('Dark blue = high on both',190,1310);c.font='20px Arial';c.fillStyle='#6c8490';c.fillText('Price ≥ '+dec.format(national.rate67*100)+'¢/kWh and yield ≥ '+fmt.format(national.yield67)+' kWh/kW DC/year',190,1345);c.fillText('Each axis: lower, middle, upper national third',190,1377);}
      c.font='19px Arial';c.fillStyle='#7a8f99';c.fillText('EIA 2025 prices · PVGIS 5.3 / ERA5 2005–2023 · Fixed 20° south, 1 kW DC, 14% losses · County internal point',70,1422);c.font='18px Arial';c.fillText('Hatching = state price estimate. Retail-value potential is a screening measure, not actual solar bill savings.',70,1460);
      canvas.toBlob(blob=>{downloadBlob(blob,`Shine_Multifamily_Solar_${state.view}_${state.basis}_${state.region}.png`);toast('Presentation map exported.');},'image/png');
    } catch(e) {console.error(e);toast('Map export failed. Try printing this view instead.');}
  }
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('toast').hidden=true;},3800);}
  init();
})();

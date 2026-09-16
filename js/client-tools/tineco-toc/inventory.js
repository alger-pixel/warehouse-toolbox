(function(window){
  'use strict';
  const endpoint='/api/tineco-toc/inventory/search';
  const filters=[['trackingNumber','TRACKING NUMBER'],['sn','SN'],['repairLevel','REPAIR LEVEL'],['repairResult','REPAIR RESULT'],['repairFrom','REPAIR DATE FROM'],['repairTo','REPAIR DATE TO'],['clientStatus','CLIENT STATUS']];
  const defaults={'REPAIR LEVEL':['Level 1','Level 2','Level 3'],'REPAIR RESULT':['Completed','NFF','Awaiting Parts','Can Not Be Fixed','Final QC Fail','Scrap'],'CLIENT STATUS':['Pending','Completed','Disposal']};
  const all={repairLevel:'All Levels',repairResult:'All Results',clientStatus:'All Client Statuses'};
  const columns=['UNIT ID','SN','TRACKING NUMBER','REPAIR DATE','REPAIR LEVEL','REPAIR RESULT','CLIENT STATUS','LABOR MINUTES','TIMES OF RE-ENTER','TOTAL PARTS USED'];
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let ctx,result,busy=false,revision=0,activeQuery={};
  const q=s=>ctx.root.querySelector(s);
  function options(key,label,values,value=''){return `<option value="">${all[key]}</option>${[...new Set([...values,...(value?[value]:[])])].map(v=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(v)}</option>`).join('')}`;}
  function render(){return `<div class="inventory-app tci-app"><form id="tci-form" class="inventory-panel"><h3>Inventory filters</h3><div class="inventory-fields">${filters.map(([key,label])=>`<label>${label}${all[key]?`<select name="${key}">${options(key,label,defaults[label])}</select>`:`<input name="${key}" type="${key.startsWith('repairF')||key==='repairTo'?'date':'text'}" autocomplete="off">`}</label>`).join('')}</div><div class="inventory-actions"><button class="button" type="submit">SEARCH INVENTORY</button><button class="button button-neutral" id="tci-clear" type="button">CLEAR FILTERS</button></div></form><p id="tci-message" role="status" aria-live="polite">Loading inventory...</p><section id="tci-results"></section><dialog id="tci-detail" aria-label="Read-only TINECO unit detail"></dialog></div>`;}
  const step=v=>({'1':'1 — Pre-QC','2':'2 — Repair','3':'3 — Final QC'}[v]||v);
  function resultHtml(data){const p=data.pagination,start=p.totalMatched?(p.page-1)*50+1:0;
    return `<div class="inventory-summary">${[['FOUND',data.summary.found],['PENDING',data.summary.pending],['COMPLETED',data.summary.completed],['DISPOSAL',data.summary.disposal],['TOTAL LABOR MINUTES',data.summary.totalLaborMinutes]].map(([k,v])=>`<div><span>${k}</span><strong>${Number(v).toLocaleString('en-CA')}</strong></div>`).join('')}</div><div class="tci-result-toolbar"><p class="tci-result-range">Showing ${start}–${start?start+data.results.length-1:0} of ${p.totalMatched}</p><nav class="tci-pagination" aria-label="Inventory pagination"><span>Page ${p.page} of ${p.totalPages}</span><button type="button" class="button tci-utility" id="tci-previous" ${p.hasPrevious?'':'disabled'}>← PREVIOUS</button><button type="button" class="button tci-utility" id="tci-next" ${p.hasNext?'':'disabled'}>NEXT →</button></nav><button type="button" class="button tci-utility tci-export" id="tci-export" ${p.totalMatched?'':'disabled'} aria-describedby="tci-export-help">EXPORT FILTERED RESULTS</button><p class="tci-export-help" id="tci-export-help">All matching pages · maximum ${data.exportLimit} records</p></div><div class="inventory-table"><table><thead><tr>${columns.map(k=>`<th>${k}</th>`).join('')}</tr></thead><tbody>${data.results.map((r,i)=>`<tr data-tci-row="${i}" tabindex="0" aria-label="View ${esc(r.SN)}">${columns.map((k,j)=>`<td>${j===0?`<button type="button" data-tci-row="${i}">${esc(r[k]||'View unit')}</button>`:esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${p.totalMatched?'':'<h3>NO TINECO TOC UNITS FOUND</h3><p>Try adjusting the filters.</p>'}`;
  }
  function stepLaborDetail(raw) {
    if(raw==null||String(raw).trim()==='')return '—';
    const values=stepLaborValues(raw);
    if(values.some(v=>v===''))return 'Unavailable';
    return `<dl class="tci-step-labor">${['PRE-QC','REPAIR','FINAL QC'].map((label,i)=>`<div><dt>${label}</dt><dd>${values[i]} min</dd></div>`).join('')}</dl>`;
  }
  const detailGroups=[
    ['identity','UNIT IDENTITY',['UNIT ID','SN','TRACKING NUMBER','CLIENT ID','WAREHOUSE','REPAIR DATE']],
    ['notes','ISSUE / NOTES',['ISSUE FOUND','PRE-QC NOTE','GENERAL NOTE']],
    ['workflow','WORKFLOW STATUS',['CLIENT STATUS','CURRENT STEP','TIMES OF RE-ENTER']],
    ['labor','PARTS & LABOR',['PART USED DETAIL','TOTAL PARTS USED','LABOR MINUTES','LABOR MINUTES PER STEP']],
    ['qc','REPAIR / QC RESULT',['REPAIR LEVEL','REPAIR RESULT','FINAL QC RESULT','FINAL QC NOTE']]
  ];
  const longFields=new Set(['ISSUE FOUND','PRE-QC NOTE','GENERAL NOTE','PART USED DETAIL','FINAL QC NOTE']);
  const statusFields=new Set(['CLIENT STATUS','CURRENT STEP','REPAIR RESULT','FINAL QC RESULT']);
  function detailField(row,key) {
    let value=key==='LABOR MINUTES PER STEP'?stepLaborDetail(row.laborMinutesPerStep):esc(key==='CURRENT STEP'?step(row[key]):row[key]);
    if(key==='LABOR MINUTES'&&value!=='')value+=' min';
    if(statusFields.has(key)&&value)value=`<span class="tci-detail-badge${['Completed','Pass'].includes(row[key])?' is-completed':''}">${value}</span>`;
    return `<div class="tci-detail-field${longFields.has(key)?' is-long':''}${key==='LABOR MINUTES PER STEP'?' is-step-labor':''}"><dt>${esc(key)}</dt><dd>${value||'—'}</dd></div>`;
  }
  function detailSection(row,id,title,fields) {
    return `<section class="tci-detail-section" aria-labelledby="tci-section-${id}"><h4 id="tci-section-${id}">${esc(title)}</h4><dl class="tci-detail-fields">${fields.map(k=>detailField(row,k)).join('')}</dl></section>`;
  }
  function detail(index){
    const row=result?.results[index];if(!row)return;
    const known=new Set(detailGroups.flatMap(([, ,fields])=>fields)),extra=result.columns.filter(k=>!known.has(k));
    const section=group=>detailSection(row,...group);
    const dialog=q('#tci-detail');
    dialog.innerHTML=`<header class="tci-detail-header"><h3>READ-ONLY UNIT DETAIL</h3><button class="button" id="tci-close" type="button">CLOSE</button></header><div class="tci-detail-grid"><div class="tci-detail-column">${detailGroups.slice(0,2).map(section).join('')}${extra.length?detailSection(row,'additional','ADDITIONAL DETAILS',extra):''}</div><div class="tci-detail-column">${detailGroups.slice(2).map(section).join('')}</div></div>`;
    dialog.showModal();q('#tci-close').onclick=()=>dialog.close();
  }
  function lock(value){busy=value;ctx.root.querySelectorAll('input,select,button').forEach(el=>{el.disabled=value;});if(!value&&result)q('#tci-results').innerHTML=resultHtml(result);}
  async function search(body={},page=1){if(busy)return;activeQuery={...body};const run=++revision;result=null;q('#tci-results').innerHTML='';lock(true);q('#tci-message').textContent='Loading inventory...';
    try{const response=await window.MkiteApiClient.post(endpoint,{...body,page});if(!ctx||run!==revision)return;if(!response.ok)throw Error(response.error?.message||'Unable to load TINECO TOC inventory.');result=response.data;
      for(const [key,label] of filters.filter(([key])=>all[key]))q(`[name="${key}"]`).innerHTML=options(key,label,result.options[label]?.length?result.options[label]:defaults[label],body[key]);
      q('#tci-message').textContent=result.results.length?'Search complete. Read-only TINECO TOC results.':'No records found.';
    }catch(e){if(ctx&&run===revision)q('#tci-message').textContent=`Unable to load TINECO TOC inventory. ${e.message}`;}
    finally{if(ctx&&run===revision)lock(false);}
  }
  const stepLaborColumns=['PRE-QC LABOR MINUTES','REPAIR LABOR MINUTES','FINAL QC LABOR MINUTES'];
  function stepLaborValues(raw) {
    try {
      const value=JSON.parse(raw);
      if(!value||value.version!==1||Object.keys(value).sort().join(',')!=='finalQc,preQc,repair,version'||!['preQc','repair','finalQc'].every(k=>Number.isSafeInteger(value[k])&&value[k]>=0))return ['','',''];
      return [value.preQc,value.repair,value.finalQc];
    }catch{return ['','',''];}
  }
  async function exportFiltered(){if(busy||!result)return;const run=revision;lock(true);q('#tci-message').textContent='Loading all filtered results for export...';
    try{const response=await window.MkiteApiClient.post(endpoint,{...activeQuery,export:true});if(!ctx||run!==revision)return;if(!response.ok)throw Error(response.error?.message||'Export failed.');const data=response.data;
      if(data.results.length!==data.pagination.totalMatched)throw Error('Incomplete export response. No workbook was exported.');
      const headers=[...new Set([...data.columns,'LABOR MINUTES PER STEP',...stepLaborColumns])];
      const book=window.XLSX.utils.book_new(),rows=data.results.map(r=>{
        const raw=r.laborMinutesPerStep??r['LABOR MINUTES PER STEP']??'',values=stepLaborValues(raw);
        return {...Object.fromEntries(data.columns.map(k=>[k,r[k]??''])),'LABOR MINUTES PER STEP':raw,...Object.fromEntries(stepLaborColumns.map((k,i)=>[k,values[i]]))};
      });
      window.XLSX.utils.book_append_sheet(book,window.XLSX.utils.json_to_sheet(rows,{header:headers}),'TINECO Inventory');
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      window.XLSX.writeFile(book,`TINECO_TOC_BATCH_INVENTORY_${date}.xlsx`);q('#tci-message').textContent=`Exported all ${rows.length} filtered records.`;
    }catch(e){if(ctx&&run===revision)q('#tci-message').textContent=e.message;}
    finally{if(ctx&&run===revision)lock(false);}
  }
  function init(context){ctx=context;result=null;busy=false;revision++;activeQuery={};
    q('#tci-form').onsubmit=e=>{e.preventDefault();search(Object.fromEntries(filters.map(([k])=>[k,q(`[name="${k}"]`).value.trim()])));};
    q('#tci-clear').onclick=()=>{if(busy)return;q('#tci-form').reset();for(const [key] of filters)q(`[name="${key}"]`).value='';search({});};
    q('#tci-results').onclick=e=>{if(busy)return;const target=e.target;if(target.closest('#tci-export'))return exportFiltered();if(target.closest('#tci-next')&&result?.pagination.hasNext)return search(activeQuery,result.pagination.page+1);if(target.closest('#tci-previous')&&result?.pagination.hasPrevious)return search(activeQuery,result.pagination.page-1);const row=target.closest('[data-tci-row]');if(row)detail(Number(row.dataset.tciRow));};
    q('#tci-results').onkeydown=e=>{if(!busy&&e.key==='Enter'&&e.target.matches('tr[data-tci-row]')){e.preventDefault();detail(Number(e.target.dataset.tciRow));}};
    search({});
  }
  window.MkiteClientToolModules=window.MkiteClientToolModules||{};
  window.MkiteClientToolModules['tineco.inventory']={render,init,cleanup(){revision++;ctx=null;result=null;busy=false;},_test:{search,exportFiltered,resultHtml,detail,step}};
}(window));

(function(window) {
  'use strict';
  const filters = [['pickingListNumber','Picking List Number'],['createdFrom','Created From'],['createdTo','Created To'],['warehouse','Warehouse'],['clientId','Client'],['trackingNumber','Package / Tracking'],['partSku','Actual Part Used SKU'],['hasCommand','Has Command'],['status','Completion / Cancellation']];
  const choices = {warehouse:'All Warehouses',clientId:'All Clients',hasCommand:'Any Command State',status:'All States'};
  const columns = [['pickingListNumber','Picking List'],['createdAt','Created'],['warehouse','Warehouse'],['clientId','Client'],['total','Packages'],['processed','Confirmed Complete'],['remaining','Not Confirmed Complete'],['commandCount','Commands'],['hasParts','Has Parts Used'],['status','Status']];
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let ctx, result, detailResult=null, busy=false, revision=0, activeQuery={};
  const q = s => ctx.root.querySelector(s);
  function options(key, values=[], selected='') {
    return `<option value="">${choices[key]}</option>` + [...new Set([...values,...(selected?[selected]:[])])].map(v => `<option value="${esc(v)}" ${v===selected?'selected':''}>${key==='hasCommand'?v==='yes'?'With Commands':'Without Commands':esc(v)}</option>`).join('');
  }
  function render() {
    return `<div class="inventory-app bpl-app"><form id="bpl-form" class="inventory-panel"><h3>Picking List filters</h3><div class="inventory-fields">${filters.map(([key,label]) => `<label>${label}${choices[key]?`<select name="${key}">${options(key,key==='hasCommand'?['yes','no']:[])}</select>`:`<input name="${key}" type="${key.startsWith('created')?'date':'text'}" maxlength="256" autocomplete="off">`}</label>`).join('')}</div><div class="inventory-actions"><button class="button" type="submit">SEARCH PICKING LISTS</button><button class="button button-neutral" id="bpl-clear" type="button">CLEAR FILTERS</button></div></form><p id="bpl-message" role="status" aria-live="polite">Loading Picking Lists...</p><section id="bpl-results"></section><dialog id="bpl-detail" aria-label="Read-only Picking List detail"></dialog></div>`;
  }
  function serialize(form) { return Object.fromEntries(filters.map(([key]) => [key,String(form.elements[key].value || '').trim()])); }
  function resultHtml(data) {
    const p=data.pagination,start=p.totalMatched?(p.page-1)*p.pageSize+1:0;
    return `<div class="inventory-summary">${[['PICKING LISTS',data.summary.found],['PACKAGES',data.summary.packages],['CONFIRMED COMPLETE',data.summary.processed],['ACTUAL PARTS USED',data.summary.partsQuantity]].map(([label,value]) => `<div><span>${label}</span><strong>${Number(value).toLocaleString()}</strong></div>`).join('')}</div><p class="bpl-help">Completion counts use saved confirmations. Older lists may have incomplete history. Parts totals include confirmed actual usage only.</p><div class="bpl-toolbar"><span>Showing ${start}–${start?start+data.results.length-1:0} of ${p.totalMatched}</span><nav aria-label="Picking List pagination"><span>Page ${p.page} of ${p.totalPages}</span><button type="button" class="button" id="bpl-previous" ${p.hasPrevious?'':'disabled'}>← PREVIOUS</button><button type="button" class="button" id="bpl-next" ${p.hasNext?'':'disabled'}>NEXT →</button></nav><button type="button" class="button" id="bpl-export" ${p.totalMatched?'':'disabled'}>EXPORT FILTERED RESULTS</button></div><p class="bpl-help">All matching pages · maximum ${data.exportLimit} Picking Lists / 8 MB</p>${p.totalMatched?`<div class="inventory-table"><table><thead><tr>${columns.map(([,label])=>`<th scope="col">${label}</th>`).join('')}</tr></thead><tbody>${data.results.map(r=>`<tr>${columns.map(([key],i)=>`<td>${i===0?`<button type="button" data-bpl-detail="${esc(r.recordId)}">${esc(r[key])}</button>`:key==='hasParts'?r[key]?'Yes':'No':esc(r[key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<h3>NO PICKING LISTS FOUND</h3><p>Try adjusting the filters.</p>'}`;
  }
  function partsTable(parts) {
    return parts.length?`<div class="inventory-table bpl-parts-table"><table><thead><tr><th scope="col">Part SKU</th><th scope="col">Total Qty Used</th><th scope="col">Action</th></tr></thead><tbody>${parts.map((p,index)=>`<tr><td>${esc(p.sku)}</td><td>${p.quantity}</td><td><button class="button bpl-copy-button" type="button" data-bpl-copy-part="${index}" aria-label="Copy ${esc(p.sku)} and quantity ${p.quantity}">COPY</button></td></tr>`).join('')}</tbody></table></div>`:'<p>No confirmed actual parts used.</p>';
  }
  const partLine = part => `${part.sku} ×${part.quantity}`;
  const allPartLines = parts => parts.map(partLine).join('\n');
  function detailHtml(row) {
    return `<button class="button" id="bpl-close" type="button">CLOSE</button><h2>${esc(row.pickingListNumber)}</h2><h3>Picking List summary</h3><dl class="bpl-facts">${columns.slice(1).map(([key,label])=>`<div><dt>${label}</dt><dd>${esc(typeof row[key]==='boolean'?row[key]?'Yes':'No':row[key])}</dd></div>`).join('')}</dl><div class="bpl-parts-heading"><h3>Parts Used Summary</h3>${row.partSummary.length?'<button class="button bpl-copy-button" id="bpl-copy-all" type="button">COPY ALL PARTS</button>':''}</div><p>Confirmed actual usage, aggregated across packages. Preparation estimates are excluded.</p><p class="bpl-copy-feedback" id="bpl-copy-feedback" role="status" aria-live="polite"></p>${partsTable(row.partSummary)}<h3>Lifecycle / status</h3><p>${esc(row.status)}${row.cancelledAt?' · '+esc(row.cancelledAt):''}</p><p>${esc(row.completionNote)}</p>${row.warnings.map(w=>`<p role="alert">${esc(w)}</p>`).join('')}<details><summary>Package summary and usage traceability (${row.packages.length})</summary><div class="inventory-table"><table><thead><tr><th>Tracking</th><th>Final Put Away SKU</th><th>Completion</th><th>Confirmed Actual Parts</th></tr></thead><tbody>${row.packages.map(p=>`<tr><td>${esc(p.trackingNumber)}</td><td>${esc(p.finalSku)}</td><td>${esc(p.completedAt||'Not confirmed')}</td><td>${p.actualParts.map(part=>`${esc(part.sku)} ×${part.quantity}`).join('<br>')}</td></tr>`).join('')}</tbody></table></div></details><details><summary>Command summary (${row.commandCount})</summary>${row.packages.filter(p=>p.commandRaw).map(p=>`<section><h4>${esc(p.trackingNumber)}</h4><p class="bpl-command">${esc(p.commandDisplay||p.commandRaw)}</p><details><summary>Original command</summary><p class="bpl-command">${esc(p.commandRaw)}</p></details></section>`).join('')||'<p>No command packages.</p>'}</details>`;
  }
  async function copyText(value) {
    if(!value)return false;
    try {
      if(!window.navigator?.clipboard?.writeText)throw Error('Clipboard access is unavailable.');
      await window.navigator.clipboard.writeText(value);
      q('#bpl-copy-feedback').textContent='Copied';
      return true;
    } catch(error) {
      q('#bpl-copy-feedback').textContent='Unable to copy. Select and copy the part text manually.';
      return false;
    }
  }
  function copyParts(index) {
    const parts=detailResult?.partSummary||[];
    return index==='all' ? copyText(allPartLines(parts)) : Number.isSafeInteger(index)&&parts[index] ? copyText(partLine(parts[index])) : Promise.resolve(false);
  }
  function lock(value) {
    busy=value;ctx.root.querySelectorAll('input,select,button').forEach(el=>{el.disabled=value;});
    if(!value&&result)q('#bpl-results').innerHTML=resultHtml(result);
  }
  async function search(query={},page=1) {
    if(busy)return;activeQuery={...query};result=null;const run=++revision;q('#bpl-results').innerHTML='';lock(true);q('#bpl-message').textContent='Loading Picking Lists...';
    try {
      const response=await window.MkiteApiClient.post('/api/picking-lists/search',{...query,page});
      if(!ctx||run!==revision)return;if(!response.ok)throw Error(response.error?.message||'Search failed.');
      result=response.data;
      for(const key of ['warehouse','clientId','status'])q(`[name="${key}"]`).innerHTML=options(key,result.options[key],query[key]);
      q('#bpl-message').textContent=result.pagination.totalMatched?'Search complete. Read-only Picking List results.':'No records found.';
    } catch(e) { if(ctx&&run===revision)q('#bpl-message').textContent=`Unable to load Picking Lists. ${e.message}`; }
    finally { if(ctx&&run===revision)lock(false); }
  }
  async function detail(recordId) {
    if(busy)return;const run=revision;lock(true);q('#bpl-message').textContent='Loading Picking List detail...';
    try {
      const response=await window.MkiteApiClient.post('/api/picking-lists/detail',{recordId});
      if(!ctx||run!==revision)return;if(!response.ok)throw Error(response.error?.message||'Detail failed.');
      detailResult=response.data;q('#bpl-detail').innerHTML=detailHtml(response.data);q('#bpl-detail').showModal();q('#bpl-close').onclick=()=>q('#bpl-detail').close();q('#bpl-message').textContent='Read-only Picking List detail loaded.';
    }catch(e){if(ctx&&run===revision)q('#bpl-message').textContent=`Unable to load detail. ${e.message}`;}
    finally{if(ctx&&run===revision)lock(false);}
  }
  function workbook(data) {
    if(data.results.length!==data.pagination.totalMatched)throw Error('Incomplete export. No workbook was created.');
    const X=window.XLSX, book=X.utils.book_new();
    const lists=data.results.map(r=>Object.fromEntries(columns.map(([k,label])=>[label,r[k]])));
    const summary=data.results.flatMap(r=>r.partSummary.map(p=>({'Picking List Number':r.pickingListNumber,'Part SKU':p.sku,'Total Qty Used':p.quantity})));
    const packages=data.results.flatMap(r=>r.packages.map(p=>({'Picking List Number':r.pickingListNumber,'Package Record ID':p.packageRecordId,Tracking:p.trackingNumber,'Final Put Away SKU':p.finalSku,'Command Raw':p.commandRaw,'Completion':p.completedAt||'Not confirmed','Confirmed Parts':JSON.stringify(p.actualParts)})));
    for(const [name,rows,header] of [['PICKING LISTS',lists,columns.map(([,label])=>label)],['PART USED SUMMARY',summary,['Picking List Number','Part SKU','Total Qty Used']],['PACKAGE DETAIL',packages,['Picking List Number','Package Record ID','Tracking','Final Put Away SKU','Command Raw','Completion','Confirmed Parts']]])X.utils.book_append_sheet(book,X.utils.json_to_sheet(rows,{header}),name);
    return book;
  }
  async function exportFiltered() {
    if(busy||!result)return;const run=revision;lock(true);q('#bpl-message').textContent='Loading all filtered results for export...';
    try {
      const response=await window.MkiteApiClient.post('/api/picking-lists/search',{...activeQuery,export:true});
      if(!ctx||run!==revision)return;if(!response.ok)throw Error(response.error?.message||'Export failed.');
      const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      window.XLSX.writeFile(workbook(response.data),`BATCH_PICKING_LIST_${date}.xlsx`);q('#bpl-message').textContent='All filtered Picking Lists exported.';
    }catch(e){if(ctx&&run===revision)q('#bpl-message').textContent=`Unable to export. ${e.message}`;}
    finally{if(ctx&&run===revision)lock(false);}
  }
  function click(event) {
    if(busy)return;
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.bplDetail)detail(button.dataset.bplDetail);
    else if(Object.hasOwn(button.dataset,'bplCopyPart'))copyParts(Number(button.dataset.bplCopyPart));
    else if(button.id==='bpl-copy-all')copyParts('all');
    else if(button.id==='bpl-previous'&&result.pagination.hasPrevious)search(activeQuery,result.pagination.page-1);
    else if(button.id==='bpl-next'&&result.pagination.hasNext)search(activeQuery,result.pagination.page+1);
    else if(button.id==='bpl-export')exportFiltered();
    else if(button.id==='bpl-clear'){q('#bpl-form').reset();search();}
  }
  window.MkiteInHouseTools ||= {};
  window.MkiteInHouseTools.batchPickingList={render,init(context){ctx=context;busy=false;result=null;detailResult=null;ctx.root.addEventListener('click',click);q('#bpl-form').onsubmit=e=>{e.preventDefault();search(serialize(e.currentTarget));};search();},cleanup(){revision++;ctx?.root.removeEventListener('click',click);ctx=null;detailResult=null;busy=false;},_test:{serialize,resultHtml,detailHtml,partLine,allPartLines,copyParts,workbook,search,detail,exportFiltered}};
}(window));

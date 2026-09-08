(function (window) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fields = [['sku', 'IN-HOUSE SKU'], ['clientId', 'CLIENT ID'], ['location', 'LOCATION'], ['status', 'STATUS'], ['receivedFrom', 'RECEIVED FROM'], ['receivedTo', 'RECEIVED TO'], ['note', 'PL NUMBER / NOTE']];
  let context, result = null, revision = 0, busy = false, activeQuery = {};
  const q = selector => context.root.querySelector(selector);
  function history(note) { return String(note || '').split(/\r?\n/).filter(v => v.trim()).reverse().map(line => { const m = line.match(/^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}) - (.*)$/); return m ? `<li><time>${esc(m[1])}</time><p>${esc(m[2])}</p></li>` : `<li>${esc(line)}</li>`; }).join(''); }
  function render() { return `<div class="inventory-app"><form id="inventory-form" class="inventory-panel"><h3>Inventory filters</h3><div class="inventory-fields">${fields.map(([key, label]) => `<label>${label}<input name="${key}" ${key.startsWith('received') ? 'type="date"' : 'type="text"'} ${key === 'status' ? 'list="inventory-statuses" placeholder="All — or enter a status"' : ''} autocomplete="off"></label>`).join('')}</div><datalist id="inventory-statuses">${['Active', 'Processing', 'Processed', 'Disposal'].map(s => `<option value="${s}">`).join('')}</datalist><div class="inventory-actions"><button class="button" type="submit">SEARCH INVENTORY</button><button class="button button-neutral" id="inventory-clear" type="button">CLEAR FILTERS</button></div></form><details class="inventory-panel"><summary>Batch Search · exact In-house SKUs</summary><form id="inventory-batch"><label for="inventory-skus">Paste one In-house SKU per line (maximum 500 lines)</label><textarea id="inventory-skus" rows="5" placeholder="One tracking number per line"></textarea><button class="button" type="submit">CHECK INVENTORY</button></form></details><div id="inventory-message" role="status">Loading inventory…</div><section id="inventory-results"></section><dialog id="inventory-detail" aria-label="Package information"></dialog></div>`; }
  function summaryCards(summary) { return `<div class="inventory-summary">${Object.entries(summary).map(([key, value]) => `<div><span>${esc(key.replace(/([A-Z])/g, ' $1').toUpperCase())}</span><strong>${esc(value)}</strong></div>`).join('')}</div>`; }
  function resultHtml(data) {
    const batch = data.batch, p = data.pagination;
    const start = p.totalMatched ? (p.page - 1) * p.pageSize + 1 : 0;
    return `${summaryCards(data.summary)}${batch ? `${summaryCards({ input: batch.input, found: batch.found, notFound: batch.notFound.length, duplicateInput: batch.duplicateInput })}<h3>FOUND PACKAGES</h3>` : ''}<div class="inventory-actions"><p>Showing ${start}–${start ? start + data.results.length - 1 : 0} of ${p.totalMatched} · ${esc(data.matchMode)} · Export includes this page${batch ? ' and all not-found inputs' : ''} only.</p><button class="button" id="inventory-export" ${data.results.length || batch?.notFound.length ? '' : 'disabled'}>EXPORT CURRENT PAGE</button></div><div class="inventory-actions" aria-label="Inventory pagination"><button class="button" id="inventory-previous" ${p.hasPrevious ? "" : "disabled"}>Previous</button><span>Page ${p.page} of ${p.totalPages}</span><button class="button" id="inventory-next" ${p.hasNext ? "" : "disabled"}>Next</button></div><div class="inventory-table"><table><thead><tr>${['IN-HOUSE SKU', 'CLIENT ID', 'LOCATION', 'DATE RECEIVED', 'STATUS', 'LAST ACTIVITY'].map(v => `<th>${v}</th>`).join('')}</tr></thead><tbody>${data.results.map((r, i) => `<tr data-inventory-row="${i}" tabindex="0" aria-label="Inspect ${esc(r.sku)}"><td><button type="button" data-inventory-row="${i}">${esc(r.sku)}</button></td><td>${esc(r.clientId)}</td><td>${esc(r.location)}</td><td>${esc(r.dateReceived)}</td><td><span class="inventory-badge">${esc(r.status)}</span></td><td>${esc(r.lastActivity)}</td></tr>`).join('')}</tbody></table>${!data.results.length ? '<p>No packages found.</p>' : ''}</div>${batch ? `<h3>NOT FOUND INPUTS (${batch.notFound.length})</h3><ul>${batch.notFound.map(sku => `<li>${esc(sku)}</li>`).join('')}</ul>` : ''}`;
  }
  function exportRows(data) { return [...data.results.map(r => ({ 'IN-HOUSE SKU': r.sku, 'CLIENT ID': r.clientId, LOCATION: r.location, 'DATE RECEIVED': r.dateReceived, STATUS: r.status, NOTE: r.note, ...(data.batch ? { RESULT: 'FOUND' } : {}) })), ...(data.batch?.notFound || []).map(sku => ({ 'IN-HOUSE SKU': sku, RESULT: 'NOT FOUND' }))]; }
  async function search(body, page = 1) {
    activeQuery = { ...body };
    const run = ++revision; busy = true; result = null; q('#inventory-results').innerHTML = ''; q('#inventory-message').textContent = 'Loading inventory…';
    try {
      const response = await window.MkiteApiClient.post('/api/inventory/search', { ...body, page, pageSize: 50 });
      if (!context || run !== revision) return;
      if (!response.ok) throw new Error(response.error.message);
      result = response.data; q('#inventory-results').innerHTML = resultHtml(result); q('#inventory-message').textContent = 'Search complete. Read-only inventory results.';
    } catch (error) { if (context && run === revision) { q('#inventory-message').textContent = error.message; context.toast.show(error.message); } }
    finally { if (run === revision) busy = false; }
  }
  function detail(index) {
    const r = result?.results[index]; if (!r) return;
    const dialog = q('#inventory-detail'); dialog.innerHTML = `<button id="inventory-close" class="button">Close</button><h3>PACKAGE INFORMATION</h3><dl>${[['IN-HOUSE SKU', r.sku], ['CLIENT ID', r.clientId], ['CURRENT LOCATION', r.location], ['STATUS', r.status], ['DATE RECEIVED', r.dateReceived]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><h3>ACTIVITY HISTORY</h3><ol>${history(r.note)}</ol><details><summary>Original NOTE</summary><pre>${esc(r.note)}</pre></details>`; dialog.showModal(); q('#inventory-close').onclick = () => dialog.close();
  }
  function init(ctx) {
    context = ctx; result = null; busy = false; revision++;
    q('#inventory-form').onsubmit = e => { e.preventDefault(); if (!busy) search(Object.fromEntries(fields.map(([key]) => [key, q(`[name="${key}"]`).value.trim()]))); };
    q('#inventory-batch').onsubmit = e => { e.preventDefault(); if (!busy) search({ mode: 'batch', skus: q('#inventory-skus').value }); };
    q('#inventory-clear').onclick = () => { revision++; busy = false; result = null; q('#inventory-form').reset(); q('#inventory-skus').value = ''; q('#inventory-results').innerHTML = ''; q('#inventory-message').textContent = 'Loading inventory…'; q('[name="sku"]').focus(); search({}); };
    q('#inventory-results').onclick = e => {
      if (!busy && result && e.target.closest('#inventory-previous') && result.pagination.hasPrevious) { search(activeQuery, result.pagination.page - 1); return; }
      if (!busy && result && e.target.closest('#inventory-next') && result.pagination.hasNext) { search(activeQuery, result.pagination.page + 1); return; }
      const row = e.target.closest('[data-inventory-row]'); if (row) detail(Number(row.dataset.inventoryRow));
      if (e.target.closest('#inventory-export') && result) {
        try { const book = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(book, window.XLSX.utils.json_to_sheet(exportRows(result)), 'Inventory'); window.XLSX.writeFile(book, 'batch-inventory.xlsx'); } catch { context.toast.show('Unable to export inventory.'); }
      }
    };
    search({});
    q('#inventory-results').onkeydown = e => { if (e.key === 'Enter' && e.target.matches('tr[data-inventory-row]')) { e.preventDefault(); detail(Number(e.target.dataset.inventoryRow)); } };
  }
  window.MkiteInHouseTools = window.MkiteInHouseTools || {};
  window.MkiteInHouseTools.batchInventory = { render, init, cleanup() { revision++; context = null; result = null; busy = false; }, _test: { history, exportRows, resultHtml, search } };
}(window));

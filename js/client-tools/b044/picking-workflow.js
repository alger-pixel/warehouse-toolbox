(function (window, document) {
  'use strict';
  const base = '/api/b044/put-away/';
  async function post(path, body) {
    if (window.MkiteApiConfig.mode !== 'live') throw new Error('Picking Lists require the live secure API; mock mode cannot persist a Picking List.');
    const result = await window.MkiteApiClient.post(base + path, body);
    if (!result.ok) {
      const code = result.error?.code || 'PICKING_LIST_REQUEST_FAILED';
      const error = new Error(`${code}: ${result.error?.message || 'Picking List request failed.'}`);
      Object.assign(error, result.error, { message: error.message });
      throw error;
    }
    return result.data;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function exportExceptions(rows) {
    const columns = [['excelRow', 'SOURCE ROW'], ['arrivalDate', '到仓日期'], ['trackingNumber', '跟踪号'], ['inboundSku', '入库SKU'], ['warehouseInboundOrder', '仓库入库单号'], ['clientId', 'CLIENT ID'], ['finalSku', 'FINAL SKU'], ['packageStatus', 'PACKAGE STATUS'], ['reason', 'REASON']];
    const sheet = window.XLSX.utils.aoa_to_sheet([columns.map(c => c[1]), ...rows.map(r => columns.map(c => String(r[c[0]] ?? '')))]);
    const book = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(book, sheet, 'Exceptions'); window.XLSX.writeFile(book, 'B044-Picking-Exceptions.xlsx');
  }
  function a4Markup(pl) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pl.pickingListNumber)}</title><style>
      @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#111;margin:0}h1{font-size:19pt;margin:0 0 4mm}h2{font-size:13pt}dl{display:grid;grid-template-columns:1fr 1fr;gap:2mm;margin:5mm 0}dl div{overflow-wrap:anywhere}dt{font-size:8pt;color:#555}dd{margin:0;font-weight:bold}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8pt}thead{display:table-header-group}th,td{border:1px solid #888;padding:2mm;overflow-wrap:anywhere;text-align:left}tr{break-inside:avoid}th:first-child{width:6%}th:nth-child(2){width:15%}th:nth-child(3){width:23%}th:nth-child(4){width:25%}th:nth-child(5){width:19%}th:nth-child(6),th:nth-child(7){width:6%}footer{margin-top:10mm;display:grid;grid-template-columns:1fr 1fr;gap:10mm;break-inside:avoid}.blocked{border:2px solid #a00;color:#a00;padding:3mm}
      </style></head><body><h1>MKITE INTERNATIONAL</h1><h2>B044 PUT AWAY PICKING LIST</h2>${pl.operational ? '' : '<p class="blocked">ASSIGNMENT INCOMPLETE — DO NOT PICK</p>'}<dl>${[['PL NUMBER', pl.pickingListNumber], ['CLIENT ID', 'B044'], ['CREATED TIME', pl.createdAt], ['SOURCE FILE', pl.metadata?.sourceFile], ['TOTAL SOURCE ROWS', pl.metadata?.totalSourceRows], ['ELIGIBLE PACKAGES', pl.packages.length], ['EXCEPTIONS', pl.exceptions.length]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl><table><thead><tr><th>#</th><th>CURRENT LOCATION</th><th>IN-HOUSE SKU / TRACKING</th><th>FINAL PUT AWAY SKU</th><th>WAREHOUSE ORDER NUMBER</th><th>QTY</th><th>CHECK</th></tr></thead><tbody>${pl.packages.map(r => `<tr><td>${r.sequence}</td><td>${esc(r.currentLocation)}</td><td>${esc(r.trackingNumber)}</td><td>${esc(r.finalSku)}</td><td>${esc(r.warehouseInboundOrder)}</td><td>1</td><td>□</td></tr>`).join('')}</tbody></table><footer><div>PICKED BY: __________________</div><div>START TIME: __________________</div><div>FINISH TIME: __________________</div><div>SIGNATURE: __________________</div></footer></body></html>`;
  }
  function printA4(pl) {
    document.getElementById('b044-a4-frame')?.remove();
    const frame = document.createElement('iframe'); frame.id = 'b044-a4-frame'; frame.title = 'B044 A4 Picking List'; frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0';
    frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
    frame.srcdoc = a4Markup(pl); document.body.appendChild(frame);
  }
  window.MkiteB044Picking = { prepare: body => post('prepare', body), create: body => post('create-picking-list', body), complete: body => post('complete-package', body), cancel: body => post('cancel-picking-list', body), exportExceptions, printA4, a4Markup };
}(window, document));

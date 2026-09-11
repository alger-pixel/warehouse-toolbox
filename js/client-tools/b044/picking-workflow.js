(function (window, document) {
  'use strict';
  const base = '/api/b044/put-away/';
  async function post(path, body, options) {
    if (window.MkiteApiConfig.mode !== 'live') throw new Error('Picking Lists require the live secure API; mock mode cannot persist a Picking List.');
    const result = await window.MkiteApiClient.post(base + path, body, options);
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
  const commandText = row => String(row.commandDisplay || row.commandRaw || '') + (row.commandReference ? '\nREF: '+row.commandReference : '');
  function a4Command(row) { const value=commandText(row);return esc(value.length>400?value.slice(0,250)+'\nCONTINUED IN COMMAND APPENDIX — PACKAGE #'+row.sequence:value); }
  function possiblePartsSummary(pl) {
    const commanded = pl.packages.filter(row => row.commandRaw?.trim());
    if (!commanded.length) return '';
    const parts = window.MkitePickingParts.aggregate(commanded.map(row => window.MkitePickingParts.possible(row.commandRaw)));
    return `<section class="possible-parts-summary"><h2>POSSIBLE PARTS NEEDED SUMMARY</h2><table><thead><tr><th>PART / MATERIAL</th><th>POSSIBLE QTY</th></tr></thead><tbody>${parts.length ? parts.map(part => `<tr><td>${esc(part.sku)}</td><td>${part.quantity}</td></tr>`).join('') : '<tr><td colspan="2">No recognizable parts/materials found in commands.</td></tr>'}</tbody></table><p>Preparation estimate only. Confirm actual parts during Part Used Scan.</p></section>`;
  }
  function pickingListBarcode(value) {
    const number = String(value ?? '');
    if (!number) return '';
    const encoded = {};
    window.JsBarcode(encoded, number, { format: 'CODE128', displayValue: false });
    const bars = encoded.encodings.map(part => part.data).join('');
    // 0.254 mm modules (3 dots at 300 dpi), 10-module quiet zones on both sides.
    const width = bars.length + 20;
    const rectangles = [...bars.matchAll(/1+/g)].map(run => `<rect x="${run.index + 10}" y="0" width="${run[0].length}" height="50"/>`).join('');
    return `<figure class="pl-barcode"><svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Picking List barcode: ${esc(number)}" width="${(width * 0.254).toFixed(3)}mm" height="12.7mm" viewBox="0 0 ${width} 50"><rect width="${width}" height="50" fill="white"/><g fill="black">${rectangles}</g></svg><figcaption>${esc(number)}</figcaption></figure>`;
  }
  function a4Markup(pl) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(pl.pickingListNumber)}</title><style>
      @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font:10pt Arial,sans-serif;color:#111;margin:0}h1{font-size:19pt;margin:0 0 4mm}h2{font-size:13pt}dl{display:grid;grid-template-columns:1fr 1fr;gap:2mm;margin:5mm 0}dl div{overflow-wrap:anywhere}dt{font-size:8pt;color:#555}dd{margin:0;font-weight:bold}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8pt}thead{display:table-header-group}th,td{border:1px solid #888;padding:2mm;overflow-wrap:anywhere;text-align:left}tr{break-inside:avoid}th:first-child{width:6%}th:nth-child(2){width:15%}th:nth-child(3){width:23%}th:nth-child(4){width:25%}th:nth-child(5){width:19%}th:nth-child(6),th:nth-child(7){width:6%}footer{margin-top:3mm;display:grid;grid-template-columns:1.3fr 1fr 1fr 1.5fr;gap:3mm;break-inside:avoid;break-before:auto;font-size:8pt}footer>div{display:flex;align-items:end;gap:1.5mm;white-space:nowrap}footer .write-line{flex:1;min-width:12mm;height:6mm;border-bottom:1px solid #555}.command-appendix{break-before:page}.command-appendix div{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11pt}.commanded{background:#ccc;print-color-adjust:exact;-webkit-print-color-adjust:exact}.command-area{white-space:pre-wrap;font-size:9pt;border-left:4px solid #111;padding:2mm;margin-top:2mm}.blocked{border:2px solid #a00;color:#a00;padding:3mm}
      .possible-parts-summary{margin:3mm 0 4mm;break-inside:auto}.possible-parts-summary h2{font-size:10pt;margin:0 0 2mm;break-after:avoid}.possible-parts-summary th:first-child{width:80%}.possible-parts-summary th:nth-child(2){width:20%}.possible-parts-summary th,.possible-parts-summary td{padding:1mm 2mm}.possible-parts-summary p{font-size:8pt;margin:1.5mm 0 0;break-before:avoid}
      .pl-print-header{display:grid;grid-template-columns:76mm 1fr;gap:4mm;align-items:center;break-inside:avoid}.pl-print-header h1{margin:0 0 2mm}.pl-print-header h2{margin:0}.pl-barcode{margin:0;break-inside:avoid}.pl-barcode svg{display:block;max-width:none}.pl-barcode figcaption{font:9pt monospace;margin-top:1mm}.pl-print-header+dl{margin-top:3mm}
      </style></head><body><header class="pl-print-header">${pickingListBarcode(pl.pickingListNumber)}<div><h1>MKITE INTERNATIONAL</h1><h2>B044 PUT AWAY PICKING LIST</h2></div></header>${pl.operational ? '' : '<p class="blocked">ASSIGNMENT INCOMPLETE — DO NOT PICK</p>'}<dl>${[['PL NUMBER', pl.pickingListNumber], ['CLIENT ID', 'B044'], ['CREATED TIME', pl.createdAt], ['SOURCE FILE', pl.metadata?.sourceFile], ['TOTAL SOURCE ROWS', pl.metadata?.totalSourceRows], ['ELIGIBLE PACKAGES', pl.packages.length], ['EXCEPTIONS', pl.exceptions.length]].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${possiblePartsSummary(pl)}<table><thead><tr><th>#</th><th>CURRENT LOCATION</th><th>IN-HOUSE SKU / TRACKING</th><th>FINAL PUT AWAY SKU</th><th>WAREHOUSE ORDER NUMBER</th><th>QTY</th><th>CHECK</th></tr></thead><tbody>${pl.packages.map(r => `<tr${r.commandRaw?.trim()?' class="commanded"':''}><td>${r.sequence}</td><td>${esc(r.currentLocation)}</td><td>${esc(r.trackingNumber)}</td><td>${esc(r.finalSku)}</td><td>${esc(r.warehouseInboundOrder)}</td><td>1</td><td>□</td></tr>${r.commandRaw?.trim()?`<tr class="commanded"><td colspan="7"><div class="command-area"><strong>COMMANDED</strong>\n${a4Command(r)}</div></td></tr>`:''}`).join('')}</tbody></table>${pl.packages.filter(r=>r.commandRaw?.trim()&&commandText(r).length>400).map(r=>`<section class="command-appendix"><h2>COMMANDED — PACKAGE #${r.sequence}</h2><p>TRACKING: ${esc(r.trackingNumber)}</p><div>${esc(commandText(r))}</div></section>`).join('')}<footer><div>PICKED BY <span class="write-line"></span></div><div>START TIME <span class="write-line"></span></div><div>FINISH TIME <span class="write-line"></span></div><div>SIGNATURE <span class="write-line"></span></div></footer></body></html>`;
  }
  function printA4(pl) {
    document.getElementById('b044-a4-frame')?.remove();
    const frame = document.createElement('iframe'); frame.id = 'b044-a4-frame'; frame.title = 'B044 A4 Picking List'; frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;border:0';
    frame.onload = () => { frame.contentWindow.focus(); frame.contentWindow.print(); };
    frame.srcdoc = a4Markup(pl); document.body.appendChild(frame);
  }
  window.MkiteB044Picking = { adminRecover: (body, key) => post('admin-recover', body, { authorization: 'Bearer ' + key }), reconcile: body => post('reconcile', body), prepare: body => post('prepare', body), create: body => post('create-picking-list', body), complete: body => post('complete-package', body), cancel: body => post('cancel-picking-list', body), exportExceptions, printA4, a4Markup };
}(window, document));

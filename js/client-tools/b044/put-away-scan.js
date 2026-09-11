(function (window, document) {
  "use strict";

  window.MkiteClientToolModules = window.MkiteClientToolModules || {};
  const STORAGE_KEY = "client.b044.put-away-scan.session";
  const REQUIRED_HEADERS = ["到仓日期", "跟踪号", "入库SKU", "仓库入库单号"];
  const SUPPORTED_ORDER_PREFIXES = ["RMA", "RV"].sort((a, b) => b.length - a.length);
  const STATUS = { NOT_PRINTED: "NOT PRINTED", PRINTED: "PRINTED", REPRINTED: "REPRINTED" };
  const emptySession = () => ({ file: null, totalRows: 0, packages: [], invalidRows: [], prepared: null, pl: null, commandCache: [], pendingPackageId: null, pendingConfirmationTracking: null, creationRequestId: null });
  let adminRecoveryKey = '';
  let context = null;
  let state = emptySession();
  let operationBusy = false; let lifecycle = 0;
  let previewOpen = false;
  let scanModeOpen = false;
  let scanState = { type: "ready", scan: "", candidateIds: [] };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
  }

  function text(value) { return String(value == null ? "" : value).trim(); }
  function normalize(value) { return text(value).toLocaleUpperCase(); }

  function parseOrderNumber(value) {
    const order = text(value);
    const dash = order.indexOf("-");
    if (dash < 1) return { valid: false, reason: "WAREHOUSE ORDER MUST CONTAIN A DASH" };
    const segment = order.slice(0, dash).toUpperCase();
    const prefix = SUPPORTED_ORDER_PREFIXES.find((item) => segment.startsWith(item));
    if (!prefix) return { valid: false, reason: "UNSUPPORTED ORDER PREFIX" };
    const clientId = segment.slice(prefix.length).trim();
    if (!clientId) return { valid: false, reason: "EMPTY CLIENT ID" };
    return { valid: true, prefix, clientId };
  }

  function pad(value) { return String(value).padStart(2, "0"); }
  function dateParts(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  function normalizeDate(cell) {
    if (!cell) return "";
    if (cell.v instanceof Date) return dateParts(cell.v);
    if (typeof cell.v === "number" && window.XLSX && window.XLSX.SSF) {
      const parsed = window.XLSX.SSF.parse_date_code(cell.v);
      if (parsed) return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
    }
    const raw = text(cell.w || cell.v);
    if (!raw) return "";
    const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : dateParts(date);
  }
  function cellText(cell) { return text(cell && (cell.w != null ? cell.w : cell.v)); }

  function parseWorksheet(sheet) {
    const range = window.XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    let headerRow = -1; const columns = {};
    for (let row = range.s.r; row <= Math.min(range.e.r, range.s.r + 30); row += 1) {
      const found = {};
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const heading = cellText(sheet[window.XLSX.utils.encode_cell({ r: row, c: col })]);
        if ([...REQUIRED_HEADERS, "登记时间", "操作指令"].includes(heading)) found[heading] = col;
      }
      if (Object.keys(found).length) { headerRow = row; Object.assign(columns, found); break; }
    }
    const missingHeaders = REQUIRED_HEADERS.filter((heading) => columns[heading] == null && !(heading === "到仓日期" && columns["登记时间"] != null));
    if (headerRow < 0 || missingHeaders.length) return { missingHeaders, totalRows: 0, packages: [], invalidRows: [] };

    const provisional = []; const invalidRows = []; let totalRows = 0;
    for (let row = headerRow + 1; row <= range.e.r; row += 1) {
      const cells = {};
      Object.keys(columns).forEach((heading) => { cells[heading] = sheet[window.XLSX.utils.encode_cell({ r: row, c: columns[heading] })]; });
      const arrivalDate = normalizeDate(cellText(cells["登记时间"]) ? cells["登记时间"] : cells["到仓日期"]);
      const trackingNumber = cellText(cells["跟踪号"]);
      const inboundSku = cellText(cells["入库SKU"]);
      const warehouseInboundOrder = cellText(cells["仓库入库单号"]);
      if (![arrivalDate, trackingNumber, inboundSku, warehouseInboundOrder].some(Boolean)) continue;
      totalRows += 1;
      const reasons = [];
      if (!arrivalDate) reasons.push("MISSING ARRIVAL DATE");
      if (!trackingNumber) reasons.push("MISSING TRACKING NUMBER");
      if (!inboundSku) reasons.push("MISSING SKU");
      if (!warehouseInboundOrder) reasons.push("MISSING WAREHOUSE ORDER");
      const order = warehouseInboundOrder ? parseOrderNumber(warehouseInboundOrder) : { valid: false };
      if (warehouseInboundOrder && !order.valid) reasons.push(order.reason);
      const originalCommand = String(cells["操作指令"]?.v ?? "");
      const commandRaw = originalCommand.trim() ? originalCommand : "";
      const record = { commanded:Boolean(commandRaw), commandRaw, commandDisplay:commandRaw, commandAiStatus:commandRaw?'PENDING':'NOT_REQUIRED', commandAiSource:commandRaw?'RAW_FALLBACK':'NONE', id: `row-${row + 1}`, excelRow: row + 1, arrivalDate, trackingNumber, normalizedTracking: normalize(trackingNumber), inboundSku, warehouseInboundOrder, prefix: order.prefix || "", clientId: order.clientId || "", finalSku: order.valid && inboundSku ? `${order.clientId}-${inboundSku}` : "", printStatus: STATUS.NOT_PRINTED, printCount: 0, lastPrintedAt: null };
      if (reasons.length) invalidRows.push({ ...record, reasons }); else provisional.push(record);
    }
    const counts = provisional.reduce((map, item) => map.set(item.normalizedTracking, (map.get(item.normalizedTracking) || 0) + 1), new Map());
    const packages = [];
    provisional.forEach((item) => {
      if (counts.get(item.normalizedTracking) > 1) invalidRows.push({ ...item, reasons: ["DUPLICATE TRACKING NUMBER"] });
      else packages.push(item);
    });
    return { missingHeaders: [], totalRows, packages, invalidRows };
  }
  function parseWorkbook(workbook) {
    const sheetName = workbook && workbook.SheetNames && workbook.SheetNames[0];
    if (!sheetName) throw new Error("Workbook has no worksheets");
    return { sheetName, ...parseWorksheet(workbook.Sheets[sheetName]) };
  }

  function save() { if (context) context.storage.set(STORAGE_KEY, state); }
  function restore() {
    const stored = context.storage.get(STORAGE_KEY, null);
    if (stored && Array.isArray(stored.packages) && Array.isArray(stored.invalidRows)) state = { ...emptySession(), ...stored };
    // Migrate an existing pending session; never reuse the former Final Put Away SKU expectation.
    delete state.pendingConfirmationSku;
    state.pendingConfirmationTracking = state.pendingPackageId ? text(state.pl?.packages?.find(row => row.id === state.pendingPackageId)?.trackingNumber) : null;
  }
  function counts() {
    const packages = currentQueue();
    const printed = packages.filter(item => item.printCount > 0).length;
    return { printed, remaining: packages.filter(item => !item.completedAt && item.packageStatus !== 'Processed').length, reprints: packages.reduce((sum, item) => sum + Math.max(0, (item.printCount || 0) - 1), 0) };
  }

  function qrSvg(value) {
    if (!window.qrcode) return '<div class="pas-qr-error">QR unavailable</div>';
    const qr = window.qrcode(0, "M"); qr.addData(String(value), "Byte"); qr.make();
    return qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
  }
  function labelMarkup(item, preview) {
    return `<article class="pas-label${preview ? " is-preview" : ""}"><header><div><span>到仓日期</span><strong>${esc(item.arrivalDate)}</strong></div><div><span>跟踪号</span><strong>${esc(item.trackingNumber)}</strong></div></header><section class="pas-label-section"><h3>SKU</h3><div class="pas-qr">${qrSvg(item.finalSku)}</div><strong>${esc(item.finalSku)}</strong></section><section class="pas-label-section"><h3>仓库入库单号</h3><div class="pas-qr">${qrSvg(item.warehouseInboundOrder)}</div><strong>${esc(item.warehouseInboundOrder)}</strong></section></article>`;
  }

  // Layout in points: 4x6 inches, with the same .19in inset as the package label.
  // Canvas measures the actual bold font where available; tests use a conservative estimate.
  let commandMeasure;
  function commandTextWidth(value,size){
    if(commandMeasure===undefined){try{commandMeasure=document.createElement('canvas').getContext('2d');}catch{commandMeasure=null;}}
    if(commandMeasure){commandMeasure.font=`700 ${size}px Arial`;return commandMeasure.measureText(value).width;}
    return Array.from(value).reduce((n,c)=>n+(c.charCodeAt(0)>255?1:/[MW@#]/.test(c)?.95:.65),0)*size;
  }
  function commandWrap(value,size){
    const width=254; // Slight reserve inside the 260.64pt content width.
    return String(value).replace(/\r\n?/g,'\n').split('\n').flatMap(paragraph=>{
      const tokens=paragraph.replace(/\t/g,'    ').match(/[A-Za-z0-9]+(?:[A-Za-z0-9_./@#+()-]*[A-Za-z0-9])?| +|[^]/gu)||[''];
      const lines=[];let line='';
      for(const token of tokens){
        if(line&&commandTextWidth(line+token,size)>width){lines.push(line);line='';}
        if(commandTextWidth(token,size)<=width){line+=token;continue;}
        // Exceptionally long unbroken tokens cannot fit even at 20pt: wrap, never clip.
        for(const c of Array.from(token)){if(line&&commandTextWidth(line+c,size)>width){lines.push(line);line='';}line+=c;}
      }
      lines.push(line);return lines;
    });
  }
  function commandPages(item) {
    if (!text(item.commandRaw)) return [];
    const content=String(item.commandDisplay||item.commandRaw),reference=String(item.commandReference||'');
    let size=content.length+reference.length<=40?30:content.length+reference.length<=100?24:20;
    const codes=(content+' '+reference).match(/[A-Za-z0-9][A-Za-z0-9_./@#+()-]*/g)||[];
    while(size>20&&codes.some(code=>commandTextWidth(code,size)>254))size=size===30?24:20;
    let identitySize=14;
    const identityLines=()=>commandWrap(item.trackingNumber||'',identitySize).length+commandWrap(item.warehouseInboundOrder||'',identitySize).length;
    if(identityLines()>8)identitySize=12;
    if(identityLines()>12)identitySize=10;
    const tracking=commandWrap(item.trackingNumber||'',identitySize).join('\n'),order=commandWrap(item.warehouseInboundOrder||'',identitySize).join('\n');
    // Heading 38pt + labels/gaps/rule 48pt + identity lines; reserve another 12pt.
    const available=404.64-38-48-identityLines()*identitySize*1.15-12;
    while(size>20&&available<(reference?2:1)*size*1.15)size=size===30?24:20;
    const capacity=Math.max(reference?2:1,Math.floor(available/(size*1.15)));
    const pages=[];let page={text:'',reference:'',size,identitySize,tracking,order},used=0;
    const push=()=>{pages.push(page);page={text:'',reference:'',size,identitySize,tracking,order};used=0;};
    for(const line of commandWrap(content,size)){if(used>=capacity)push();page.text+=(used?'\n':'')+line;used++;}
    if(reference){
      for(const line of commandWrap(reference,size)){
        // REF heading consumes one line on each page containing a reference.
        if(used+(page.reference?1:2)>capacity)push();
        if(!page.reference)used++;
        page.reference+=(page.reference?'\n':'')+line;used++;
      }
    }
    if(used)push();return pages;
  }
  function commandLabelMarkup(item, preview) {
    const pages=commandPages(item);
    return pages.map((page,i)=>`${preview?`<figure class="pas-label-preview"><figcaption>Command Label${pages.length>1?' '+(i+1)+'/'+pages.length:''}</figcaption>`:''}<article class="pas-label pas-command-label${preview?' is-preview':''}"><h2>COMMAND${pages.length>1?' '+(i+1)+'/'+pages.length:''}</h2><dl class="pas-command-identity" style="--command-identity-size:${page.identitySize}pt"><div><dt>跟踪号 / TRACKING:</dt><dd>${esc(page.tracking)}</dd></div><div><dt>入库单号 / WAREHOUSE ORDER:</dt><dd>${esc(page.order)}</dd></div></dl><div class="pas-command-content" style="font-size:${page.size}pt">${page.text?`<pre>${esc(page.text)}</pre>`:''}${page.reference?`<section class="pas-command-reference"><strong>REF:</strong><pre>${esc(page.reference)}</pre></section>`:''}</div></article>${preview?'</figure>':''}`).join('');
  }
  function packageLabels(item,preview) { const original=labelMarkup(item,preview);return (preview?`<figure class="pas-label-preview"><figcaption>Package Label</figcaption>${original}</figure>`:original)+commandLabelMarkup(item,preview); }
  async function prepareCommands(retry=false) {
    const session=state,run=lifecycle;
    session.commandCache ||= [];
    const cache=new Map(session.commandCache), groups=new Map();
    for(const row of session.packages) if(text(row.commandRaw)) {
      const key=text(row.commandRaw); if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
    }
    const pending=[...groups].filter(([key,rows])=>retry?['FAILED','FALLBACK'].includes(cache.get(key)?.commandAiStatus||rows[0].commandAiStatus):!cache.has(key)).slice(0,10);
    for(const [,rows] of pending)for(const row of rows)row.commandAiStatus='PENDING';
    if(pending.length){save();renderSetup();}
    let cursor=0;
    async function worker(){while(cursor<pending.length){const [key,rows]=pending[cursor++];let result;let timer;
      try{
        const response=await Promise.race([window.MkiteApiClient.post('/api/ai/simplify-command',{command:rows[0].commandRaw}),new Promise((_,reject)=>{timer=window.setTimeout(()=>reject(Error('timeout')),10000);})]);
        if(response.ok&&response.data?.commandAiStatus==='SIMPLIFIED'&&typeof response.data.commandDisplay==='string'&&response.data.commandDisplay.trim())result={commandDisplay:response.data.commandDisplay,commandReference:typeof response.data.commandReference==='string'?response.data.commandReference:'',commandAiStatus:'SIMPLIFIED',commandAiSource:'AI'};
      }catch{}finally{window.clearTimeout?.(timer);}
      if(!context||run!==lifecycle||state!==session)return;
      cache.set(key,result||{commandAiStatus:'FALLBACK',commandAiSource:'RAW_FALLBACK'});session.commandCache=[...cache];
      for(const row of rows)Object.assign(row,cache.get(key),{commandDisplay:result?.commandDisplay||row.commandRaw});save();renderSetup();
    }}
    await Promise.all([worker(),worker()]);
    if(!context||run!==lifecycle||state!==session)return;
    for(const [key,rows] of groups){if(retry&&!cache.has(key))continue;if(!cache.has(key))cache.set(key,{commandAiStatus:'FALLBACK',commandAiSource:'RAW_FALLBACK'});for(const row of rows)Object.assign(row,cache.get(key),{commandDisplay:cache.get(key).commandDisplay||row.commandRaw});}
    session.commandCache=[...cache];save();
  }
  async function retryCommands(){if(operationBusy||state.creationRequestId)return;const run=lifecycle;operationBusy=true;renderSetup();try{await prepareCommands(true);if(context&&run===lifecycle){state.prepared=null;}}finally{if(context&&run===lifecycle){operationBusy=false;renderSetup();prepareInventory();}}}
  function commandSummary(){
    const rows=state.packages.filter(r=>text(r.commandRaw));if(!rows.length)return '';
    const simplified=rows.filter(r=>r.commandAiStatus==='SIMPLIFIED').length;
    const fallback=rows.filter(r=>r.commandAiStatus==='FALLBACK').length;
    const failed=rows.filter(r=>r.commandAiStatus==='FAILED').length;
    const pending=rows.length-simplified-fallback-failed;
    const complete=!pending&&!failed;
    return `<section class="pas-command-summary ${complete?'is-complete':failed?'is-retryable':'is-pending'}" aria-label="AI command preparation"><div class="pas-command-summary-heading"><strong>AI COMMAND PREPARATION</strong><span>${pending?'Processing commands…':failed?'Retry available — raw instructions retained':fallback?'Complete — raw instructions retained':'Complete'}</span></div><dl>${[['COMMAND PACKAGES',rows.length],['Simplified',simplified],['Raw Fallback',fallback],['Pending',pending],['Failed / Retryable',failed]].map(([label,count])=>`<div><dt>${label}</dt><dd>${count}</dd></div>`).join('')}</dl><p>AI-organized instructions should be reviewed before printing.</p>${fallback||failed?'<p>Raw instructions remain available. You can generate the Picking List without retrying.</p>':''}${!state.creationRequestId&&(fallback||failed)?`<button class="button button-neutral" id="pas-retry-commands" ${operationBusy?'disabled':''}>RETRY COMMAND SIMPLIFICATION</button>`:''}</section>`;
  }

  function render() { return '<div class="pas-app" data-client-theme="blue" id="pas-app"></div>'; }
  function renderSetup() {
    previewOpen = false; scanModeOpen = false;
    const totals = counts();
    const ready = usablePickingList();
    const completed = currentQueue().filter(item => item.completedAt || item.packageStatus === "Processed").length;
    context.root.innerHTML = `<div class="pas-app" data-client-theme="blue">
      <section class="pas-workflow-step pas-preparation" aria-labelledby="pas-preparation-title">
        <header class="pas-step-header"><span class="pas-step-number" aria-hidden="true">01</span><div><h2 id="pas-preparation-title">STEP 1 · PICKING LIST PREPARATION</h2><p>Upload your package data, review inventory matches, and prepare the A4 picking list.</p></div></header>
        <div class="pas-step-content"><section class="pas-upload panel"><div><h3>Upload package data</h3><p>Excel <strong>.xlsx</strong> or <strong>.xls</strong>. Only the first worksheet will be processed.</p></div><label class="button button-primary pas-file-button" for="pas-file">Choose Excel File</label><input class="sr-only" id="pas-file" type="file" accept=".xlsx,.xls"></section>
        ${state.file ? uploadSummary() : '<div class="pas-empty"><strong>No package file loaded</strong><span>Required columns: 到仓日期, 跟踪号, 入库SKU, 仓库入库单号</span></div>'}
        ${state.file ? `<div class="pas-overview pas-preparation-stats">${stat("Source rows", state.totalRows)}${stat("Valid labels", state.packages.length)}${stat("Invalid rows", state.invalidRows.length, state.invalidRows.length ? "danger" : "")}${stat("Eligible", state.prepared ? state.prepared.eligible.length : "—")}${stat("Exceptions", state.prepared ? state.prepared.exceptions.length : "—", state.prepared?.exceptions.length ? "danger" : "")}</div>` : ""}
        ${workflowPanel()}${state.file ? invalidTable() : ""}</div>
      </section>
      <section class="pas-workflow-step pas-execution${ready ? " is-ready" : ""}" aria-labelledby="pas-execution-title">
        <header class="pas-step-header"><span class="pas-step-number" aria-hidden="true">02</span><div><h2 id="pas-execution-title">STEP 2 · SCAN &amp; PRINT EXECUTION</h2><p>Scan the package tracking number to print its label. For commanded packages, scan actual parts first. Confirm completion by scanning the same In-House SKU / Tracking again.</p></div></header>
        <div class="pas-step-content"><div class="pas-execution-status" role="status"><strong>${ready ? "Ready for Scan &amp; Print" : (state.pl?.phase === "cancelled" ? "PICKING LIST CANCELLED · LOCKED" : "Complete Picking List Preparation first")}</strong><span>${ready ? `Picking list ${esc(state.pl.pickingListNumber)} · ${completed} / ${state.pl.packages.length} packages completed` : (state.pl?.phase === "cancelled" ? "Reset Page to prepare a new Picking List." : state.pl?.phase === "cancelling" ? "Cancellation is in progress. Scan & Print remains locked." : "Scan mode unlocks once your picking list is created and all eligible packages are assigned.")}</span></div>
        ${state.file ? `<div class="pas-overview pas-execution-stats">${stat("PL labels printed", totals.printed, "success")}${stat("Found packages remaining", totals.remaining)}${stat("Found packages", currentQueue().length)}${stat("PL packages completed", completed, "success")}</div>
        <div class="pas-actions pas-execution-actions"><div class="pas-action-feature"><button class="button button-primary pas-scan-start" id="pas-start-scan" type="button"${ready && !operationBusy ? "" : " disabled"}>Start Scan &amp; Print Mode</button><small>Continuous scan-to-print on kiosk-configured warehouse stations.</small></div><div class="pas-manual-actions"><div class="pas-action-feature"><button class="button button-secondary" id="pas-print-all" type="button"${currentQueue().length && !state.pendingPackageId ? "" : " disabled"}>PRINT FOUND PACKAGES</button><small>Print labels only for packages assigned to this Picking List.</small></div><button class="button button-secondary" id="pas-preview" type="button"${currentQueue().length ? "" : " disabled"}>PREVIEW FOUND PACKAGES</button></div></div>
        <div class="pas-operational-area"><div class="pas-area-heading"><h3>Package labels &amp; execution reference</h3><p>Only found, eligible packages assigned to the current Picking List are shown here.</p></div>${packageTable()}</div>` : '<div class="pas-empty"><strong>Your execution workspace</strong><span>Upload package data in Step 1 to see label controls and generated packages here.</span></div>'}</div>
      </section></div>`;
    bindSetup();
    if (operationBusy) context.root.querySelectorAll('button,input').forEach(node => { node.disabled = true; });
  }
  function stat(label, value, tone) { return `<div class="pas-stat${tone ? ` is-${tone}` : ""}"><span>${esc(label)}</span><strong>${value}</strong></div>`; }
  function uploadSummary() { return `<section class="pas-file-summary"><div><span>File Name</span><strong>${esc(state.file.name)}</strong></div><div><span>Worksheet Used</span><strong>${esc(state.file.sheet)}</strong></div><div><span>Upload processed</span><strong>${esc(state.file.processedAt)}</strong></div></section>`; }
  function packageTable() {
    const packages = currentQueue();
    if (!packages.length) return '<section class="pas-table-section"><div class="section-header"><h3>Valid Packages</h3><span>0</span></div><div class="pas-empty">No operational Picking List packages are available.</div></section>';
    return `<section class="pas-table-section"><div class="section-header"><h3>Generated Packages</h3><span>${packages.length} labels</span></div><div class="table-wrap"><table><thead><tr><th>Row</th><th>到仓日期</th><th>跟踪号</th><th>入库SKU</th><th>仓库入库单号</th><th>Prefix</th><th>Client ID</th><th>Final SKU</th><th>Eligibility</th><th>Current Location</th><th>Package Status</th><th>Reason</th><th>Print Status</th></tr></thead><tbody>${packages.map((item) => `<tr><td>${item.excelRow}</td><td>${esc(item.arrivalDate)}</td><td>${esc(item.trackingNumber)}</td><td>${esc(item.inboundSku)}</td><td>${esc(item.warehouseInboundOrder)}</td><td>${esc(item.prefix)}</td><td>${esc(item.clientId)}</td><td>${esc(item.finalSku)}</td><td><span class="badge">${esc(item.eligibility || "VALID")}</span></td>${["currentLocation", "packageStatus", "reason"].map(key => `<td>${esc((key === "packageStatus" ? (item.completedAt || item.packageStatus === "Processed" ? "Processed" : "Processing") : item[key]) || "")}</td>`).join("")}<td><span class="pas-print-status is-${(item.printStatus || STATUS.NOT_PRINTED).replace(" ", "-").toLowerCase()}">${item.printStatus || STATUS.NOT_PRINTED}</span></td></tr>`).join("")}</tbody></table></div></section>`;
  }
  function invalidTable() {
    if (!state.invalidRows.length) return "";
    return `<section class="pas-table-section pas-invalid"><div class="section-header"><h3>Invalid Rows</h3><span>${state.invalidRows.length} excluded</span></div><div class="table-wrap"><table><thead><tr><th>Excel Row</th><th>Tracking Number</th><th>SKU</th><th>Warehouse Order</th><th>Reason</th></tr></thead><tbody>${state.invalidRows.map((item) => `<tr><td>${item.excelRow}</td><td>${esc(item.trackingNumber)}</td><td>${esc(item.inboundSku)}</td><td>${esc(item.warehouseInboundOrder)}</td><td>${item.reasons.map(esc).join("; ")}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function bindSetup() {
    document.getElementById("pas-retry-commands")?.addEventListener("click", retryCommands);
    document.getElementById("pas-prepare")?.addEventListener("click", prepareInventory);
    document.getElementById("pas-create-pl")?.addEventListener("click", createPickingList);
    document.getElementById("pas-export-exceptions")?.addEventListener("click", () => window.MkiteB044Picking.exportExceptions(state.prepared.exceptions));
    document.getElementById("pas-print-a4")?.addEventListener("click", () => window.MkiteB044Picking.printA4(state.pl));
    document.getElementById("pas-file")?.addEventListener("change", handleFile);
    document.getElementById("pas-preview")?.addEventListener("click", renderPreview);
    document.getElementById("pas-print-all")?.addEventListener("click", printBatchWithDialog);
    document.getElementById("pas-start-scan")?.addEventListener("click", openScanMode);
    document.getElementById("pas-start-new-pl")?.addEventListener("click", startNewPickingList);
    document.getElementById('pas-admin-unlock')?.addEventListener('click', () => adminRecovery(false));
    document.getElementById('pas-admin-recover')?.addEventListener('click', () => adminRecovery(true));
    document.getElementById("pas-reset")?.addEventListener("click", resetSession);
    document.getElementById("pas-remove-excel")?.addEventListener("click", removeExcel);
    document.getElementById("pas-cancel-pl")?.addEventListener("click", cancelPickingList);
  }
  function handleFile(event) {
    if (operationBusy || hasProtectedOperation()) { context.toast.show("Finish the current Picking List before replacing the upload."); return; }
    const file = event.target.files && event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => context.toast.show("Unable to read that file");
    reader.onload = () => {
      try {
        /* Keep Excel dates as serials; SSF conversion avoids browser timezone shifts. */
        const workbook = window.XLSX.read(reader.result, { type: "array", cellDates: false });
        const parsed = parseWorkbook(workbook); const sheetName = parsed.sheetName;
        if (parsed.missingHeaders.length) {
          context.root.querySelector(".pas-app").insertAdjacentHTML("afterbegin", `<div class="pas-header-error"><strong>Missing required columns:</strong><ul>${parsed.missingHeaders.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>`);
          context.toast.show("Excel headers are incomplete"); return;
        }
        state = { ...emptySession(), file: { name: file.name, sheet: sheetName, processedAt: new Date().toLocaleString() }, totalRows: parsed.totalRows, packages: parsed.packages, invalidRows: parsed.invalidRows };
        save(); renderSetup(); context.toast.show(`${state.packages.length} labels generated`); prepareInventory();
      } catch (error) { context.toast.show("Unable to process this workbook"); }
    };
    reader.readAsArrayBuffer(file);
  }
  function usablePickingList() {
    return Boolean(state.pl?.operational && state.pl.pickingListNumber && state.pl.pickingListRecordId && !['cancelled', 'cancelling'].includes(state.pl.phase));
  }
  function recoveryAvailable() {
    return state.pl?.phase === 'admin-recovering' || state.pl?.packages?.some(r => r.packageStatus === 'Processed' && r.reconciliationRequired);
  }
  async function adminRecovery(confirm = false) {
    if (operationBusy || !recoveryAvailable()) return;
    const key = confirm ? adminRecoveryKey : document.getElementById('pas-admin-key')?.value;
    if (!key) return;
    if (confirm && !window.confirm('This is an administrative recovery for a broken TEST Picking List. It will revert eligible packages from incomplete Processed state so the Picking List can be cancelled. Historical audit notes will remain.')) return;
    const typed = confirm ? window.prompt('Type the exact Picking List number to confirm test recovery:') : '';
    if (confirm && typed !== state.pl.pickingListNumber) return;
    operationBusy = true; const run = lifecycle; renderSetup();
    try {
      const result = await window.MkiteB044Picking.adminRecover({ pickingListNumber: state.pl.pickingListNumber, pickingListRecordId: state.pl.pickingListRecordId, confirm, confirmPickingListNumber: typed }, key);
      if (!context || lifecycle !== run) return;
      if (!confirm) adminRecoveryKey = key;
      else {
        adminRecoveryKey = ''; state.pl = result; state.creationRequestId = result.requestId;
        state.temporaryParts = null; state.pendingPackageId = null; state.pendingConfirmationTracking = null; delete state.completedAt;
        scanState = { type: 'ready', scan: '', candidateIds: [] }; state.workflowError = 'Administrative recovery complete. Use CANCEL PICKING LIST next.'; save();
      }
    } catch (error) { if (context && lifecycle === run) { adminRecoveryKey = ''; state.workflowError = error.message; if (confirm) { state.pl.phase = 'admin-recovering'; state.pl.operational = false; save(); } await reconcilePickingList(); } }
    finally { if (context && lifecycle === run) { operationBusy = false; renderSetup(); } }
  }
  function adminRecoveryMarkup() {
    if (!recoveryAvailable()) return '';
    return adminRecoveryKey ? '<button class="button" id="pas-admin-recover">ADMIN RECOVER PL</button>' : '<details><summary>Administrative recovery access</summary><label>Administration key<input id="pas-admin-key" type="password" autocomplete="off"></label><button class="button" id="pas-admin-unlock">VERIFY ADMIN ACCESS</button></details>';
  }
  async function reconcilePickingList() {
    if (!state.pl?.pickingListNumber || state.pl.phase === 'cancelled' || !window.MkiteB044Picking?.reconcile) return;
    const run = lifecycle, pl = state.pl;
    try {
      const result = await window.MkiteB044Picking.reconcile({ pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId });
      if (!context || run !== lifecycle || state.pl !== pl) return;
      if (result.pickingListRecordId) pl.pickingListRecordId = result.pickingListRecordId;
      for (const update of result.packages) {
        const row = pl.packages.find(r => r.packageRecordId === update.packageRecordId);
        if (!row) continue;
        Object.assign(row, update);
        if (row.reconciliationRequired && row.commandRaw && state.pendingPackageId === row.id) {
          const draft = pendingParts(); draft.savePending = true;
        }
      }
      if (result.cancellationAllowed === true && /CANCEL_PROCESSED_BLOCKED/.test(state.workflowError || '')) state.workflowError = '';
      save();
    } catch (error) { if (context && run === lifecycle) state.workflowError = 'Reconciliation required: ' + error.message; }
    if (context && run === lifecycle) { if (scanModeOpen) renderScanMode(); else renderSetup(); }
  }
  function isTerminalPickingList() {
    const pl = state.pl;
    return Boolean(pl?.pickingListRecordId && (pl.phase === 'cancelled' ||
      (pl.operational && pl.phase !== 'cancelling' && pl.packages?.length &&
       !state.pendingPackageId && pl.packages.every(row => Boolean(row.completedAt) && !row.reconciliationRequired))));
  }
  function startNewPickingList() {
    if (operationBusy || !isTerminalPickingList()) return;
    clearLocalSession();
    context.toast.show('Ready for a new Picking List');
  }
  function startNewAction() {
    return isTerminalPickingList() ? `<button class="button button-primary" id="pas-start-new-pl" ${operationBusy ? 'disabled' : ''}>START NEW PICKING LIST</button>` : '';
  }
  function hasProtectedOperation() {
    return !isTerminalPickingList() && Boolean(state.pl?.pickingListRecordId || (state.creationRequestId && state.generationUncertain !== false));
  }
  function clearLocalSession() {
    lifecycle += 1; adminRecoveryKey = ''; state = emptySession(); scanState = { type: 'ready', scan: '', candidateIds: [] };
    previewOpen = false; scanModeOpen = false; context.storage.remove(STORAGE_KEY); renderSetup();
  }
  function removeExcel() {
    if (operationBusy || hasProtectedOperation() || state.pl?.pickingListRecordId) return;
    clearLocalSession(); context.toast.show('Excel removed');
  }
  function resetSession() {
    if (operationBusy) return;
    if (hasProtectedOperation()) { context.toast.show(state.pl?.pickingListRecordId ? 'ACTIVE PICKING LIST EXISTS — Cancel the Picking List before resetting this page.' : 'Generation outcome is unconfirmed. Retry / Resume before resetting this page.'); return; }
    if (!window.confirm('Reset this B044 page? Uploaded Excel, matching, labels and local session state will be cleared.')) return;
    clearLocalSession(); context.toast.show('Page reset');
  }
  async function cancelPickingList() {
    if (operationBusy || !state.pl?.pickingListRecordId || state.pl.phase === 'cancelled') return;
    await reconcilePickingList();
    if (!context || operationBusy || !state.pl?.pickingListRecordId) return;
    if (state.pl.packages.some(r => r.packageStatus === 'Processed')) { context.toast.show('Cancellation blocked: a package is completed.'); return; }
    if (!window.confirm('Cancel this Picking List? No package may be Processed. Processing packages will return to Active and temporary parts will be discarded.')) return;
    state.pl.phase = 'cancelling'; state.pl.operational = false; save();
    operationBusy = true; state.workflowError = ''; renderSetup(); const run = lifecycle;
    try {
      do {
        const result = await window.MkiteB044Picking.cancel({ pickingListNumber: state.pl.pickingListNumber, requestId: state.creationRequestId || state.pl.requestId });
        if (!context || run !== lifecycle) return;
        state.pl = result; state.temporaryParts = null; state.pendingPackageId = null; state.pendingConfirmationTracking = null; scanState = { type: "ready", scan: "", candidateIds: [] }; save();
      } while (state.pl.phase === 'cancelling' && state.pl.cancelPendingCount > 0);
    } catch (error) {
      if (context && run === lifecycle) {
        state.workflowError = error.message;
        if (error.code === 'CANCEL_PROCESSED_BLOCKED') { state.pl.phase = 'operational'; state.pl.operational = true; await reconcilePickingList(); }
        save();
      }
    } finally { if (context && run === lifecycle) { operationBusy = false; renderSetup(); } }
  }

  function renderPreview() {
    if (!currentQueue().length || operationBusy) return;
    previewOpen = true;
    context.root.innerHTML = `<div class="pas-preview-page"><div class="pas-preview-header"><div><span class="tool-kicker">B044 · Put Away Scan</span><h3>Label Preview</h3><p>${currentQueue().length} packages · ${currentQueue().reduce((n,item)=>n+1+commandPages(item).length,0)} label pages (Package Label + Command Label for commanded packages)</p></div><div><button class="button button-secondary" id="pas-preview-back" type="button">Back to Put Away Scan</button><button class="button button-primary" id="pas-preview-print" type="button">PRINT FOUND PACKAGES</button></div></div><div class="pas-preview-grid">${currentQueue().map((item) => packageLabels(item, true)).join("")}</div></div>`;
    document.getElementById("pas-preview-back").addEventListener("click", renderSetup);
    document.getElementById("pas-preview-print").addEventListener("click", printBatchWithDialog);
  }

  function markPrinted(item, reprint) {
    item.printCount = Number(item.printCount || 0) + 1;
    item.printStatus = reprint || item.printCount > 1 ? STATUS.REPRINTED : STATUS.PRINTED;
    item.lastPrintedAt = new Date().toISOString(); save();
  }
  const printService = {
    renderPrintDom(items) {
      let host = document.getElementById("pas-print-host");
      if (!host) { host = document.createElement("div"); host.id = "pas-print-host"; document.body.appendChild(host); }
      host.innerHTML = items.map((item) => packageLabels(item, false)).join("");
      document.body.classList.add("pas-printing");
      return host;
    },
    requestPrint(items, afterPrint) {
      const host = this.renderPrintDom(items);
      window.setTimeout(() => {
        try { window.print(); }
        finally {
          document.body.classList.remove("pas-printing"); host.innerHTML = "";
          if (afterPrint) afterPrint();
        }
      }, 30);
    },
    printSingleForScan(item, reprint) {
      /* In Chrome kiosk-printing this request is auto-confirmed by the browser. */
      if (!currentQueue().includes(item) || (state.pendingPackageId && state.pendingPackageId !== item.id)) return;
      markPrinted(item, reprint); this.requestPrint([item]);
    },
    printBatchWithDialog(items, afterPrint) {
      /* Manual batch intent: the webpage requests the normal native print UI. */
      items.forEach((item) => markPrinted(item, item.printCount > 0));
      this.requestPrint(items, afterPrint);
    }
  };
  function printBatchWithDialog() {
    if (!currentQueue().length || operationBusy || state.pendingPackageId) return;
    const returnToPreview = previewOpen;
    printService.printBatchWithDialog(currentQueue(), () => returnToPreview ? renderPreview() : renderSetup());
    context.toast.show("Batch print requested; review printer and 4 × 6 settings");
  }

  function openScanMode() { if (!usablePickingList() || operationBusy) return; context.audio.setEnabled(true); scanModeOpen = true; scanState = state.pendingPackageId ? { type: "WAITING_FOR_PRINT_CONFIRMATION", scan: "", candidateIds: [state.pendingPackageId] } : { type: "ready", scan: "", candidateIds: [] }; renderScanMode(); }
  function closeScanMode() { scanModeOpen = false; renderSetup(); }
  function scanPackageById(id) { return currentQueue().find((item) => item.id === id); }
  function classifyScan(value, packages) {
    // B044 intentionally retains its established case-insensitive comparison.
    return window.MkitePackageIdentifierMatcher.matchPackageIdentifier(value, packages, { normalize });
  }
  function selectCandidate(id) {
    if (operationBusy || state.pendingPackageId || !scanState.candidateIds.includes(id)) return;
    const item = scanPackageById(id);
    if (!item) return;
    scanState = { ...scanState, candidateIds: [item.id] };
    confirmCandidate(item);
  }
  function possiblePartsMarkup(rows) {
    const parts = window.MkitePickingParts?.aggregate(rows.map(r => window.MkitePickingParts.possible(r.commandRaw))) || [];
    return parts.length ? `<section class="pas-parts-estimate"><h3>POSSIBLE PARTS</h3><p>Preparation estimate only. One suggestion per package mentioning the item; not confirmed usage.</p><div class="pas-parts-list">${parts.map(p => `<span>${esc(p.sku)} <strong>×${p.quantity}</strong></span>`).join('')}</div></section>` : '';
  }
  function pendingParts() {
    const item = scanPackageById(state.pendingPackageId);
    if (!item?.commandRaw) return null;
    if (!state.temporaryParts || state.temporaryParts.packageId !== item.id) {
      const intent = item.completionIntent;
      state.temporaryParts = { packageId: item.id, parts: intent?.parts?.map(p => ({ ...p })) || [], ready: Boolean(intent), submitted: Boolean(intent) };
    }
    return state.temporaryParts;
  }
  function addPart(value) {
    const draft = pendingParts(), sku = text(value);
    if (!draft || draft.ready || draft.submitted || operationBusy || !sku) return;
    const parts = draft.parts.map(p => ({ ...p })), found = parts.find(p => p.sku === sku);
    if (found) found.quantity++; else parts.push({ sku, quantity: 1 });
    try { draft.parts = window.MkitePickingParts.validate(parts); save(); }
    catch (e) { context.toast.show(e.message); }
    renderScanMode();
  }
  function removePart(index) {
    const draft = pendingParts();
    if (!draft || draft.ready || draft.submitted || operationBusy) return;
    draft.parts.splice(index, 1); save(); renderScanMode();
  }
  function confirmParts() {
    const draft = pendingParts(); if (!draft || operationBusy) return;
    draft.ready = true; save(); renderScanMode();
  }
  function editParts() {
    const draft = pendingParts(); if (!draft || draft.submitted || operationBusy) return;
    draft.ready = false; save(); renderScanMode();
  }
  function partsBody(item, draft) {
    return `<section class="pas-scan-ready pas-actual-parts"><h2>ACTUAL PART USED</h2><p>${esc(item.trackingNumber)} · Scan each physically used part. Repeated scans increase quantity.</p><label for="pas-scan-input">Scan Part SKU</label><div class="pas-scan-entry"><input id="pas-scan-input" autocomplete="off" maxlength="128"><button class="button" id="pas-scan-check">ADD PART</button></div><div class="pas-parts-list">${draft.parts.map((p,i) => `<div><strong>${esc(p.sku)} ×${p.quantity}</strong><button class="button" data-pas-remove-part="${i}" aria-label="Remove ${esc(p.sku)}">REMOVE</button></div>`).join('') || '<p>No actual parts scanned.</p>'}</div><p>Temporary only. Usage is saved after the correct In-House SKU / Tracking scan.</p><button class="button" id="pas-confirm-parts">CONFIRM PARTS USED</button>${possiblePartsMarkup([item])}</section>`;
  }
  function renderScanMode() {
    const totals = counts(); const selected = scanState.candidateIds.length === 1 ? scanPackageById(scanState.candidateIds[0]) : null;
    context.root.innerHTML = `<div class="pas-scan-mode state-${scanState.type}${state.pendingPackageId && pendingParts() ? " has-command-pending" : ""}${scanState.error ? " is-confirmation-error" : ""}" role="dialog" aria-modal="true" aria-label="Put Away Scan and Print Mode"><header><strong>PUT AWAY SCAN · ${esc(state.pl.pickingListNumber)}</strong><button class="button pas-exit" id="pas-scan-exit" type="button">Exit Scan &amp; Print Mode</button></header><div class="pas-scan-counters"><span>${currentQueue().filter(r => r.completedAt || r.packageStatus === "Processed").length} / ${currentQueue().length} COMPLETED</span><span>${state.pendingPackageId ? (pendingParts() && !pendingParts().ready ? "PART USED SCAN" : "WAITING FOR PRINT CONFIRMATION") : "WAITING FOR PACKAGE"}</span></div><main>${scanModeBody(selected)}</main></div>`;
    document.getElementById("pas-start-new-pl")?.addEventListener("click", startNewPickingList);
    document.getElementById("pas-scan-exit").addEventListener("click", closeScanMode);
    document.getElementById("pas-scan-input")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); processScan(event.currentTarget.value); } });
    document.getElementById("pas-scan-check")?.addEventListener("click", () => processScan(document.getElementById("pas-scan-input").value));
    document.getElementById("pas-rescan")?.addEventListener("click", readyScan);
    document.getElementById("pas-confirm-print")?.addEventListener("click", () => confirmCandidate(selected));
    document.getElementById("pas-reprint")?.addEventListener("click", () => { if (!operationBusy) { printService.printSingleForScan(selected, true); if (!state.pendingPackageId) readyScan(); } });
    document.getElementById("pas-confirm-parts")?.addEventListener("click", confirmParts);
    document.getElementById("pas-edit-parts")?.addEventListener("click", editParts);
    document.querySelectorAll("[data-pas-remove-part]").forEach(button => button.addEventListener('click', () => removePart(Number(button.dataset.pasRemovePart))));
    document.querySelectorAll("[data-pas-candidate]").forEach((button) => button.addEventListener("click", () => selectCandidate(button.dataset.pasCandidate)));
    window.setTimeout(() => document.getElementById("pas-scan-input")?.focus(), 0);
  }
  function scanModeBody(selected) {
    if (currentQueue().every(r => r.completedAt)) return `<section class="pas-scan-result"><h2>PICKING LIST COMPLETE</h2><strong>${esc(state.pl.pickingListNumber)}</strong><p>${currentQueue().length} TOTAL COMPLETED</p><p>${esc(state.completedAt || currentQueue().map(r => r.completedAt).sort().at(-1))}</p>${startNewAction()}</section>`;
    const draft = state.pendingPackageId ? pendingParts() : null;
    if (draft && !draft.ready) return partsBody(selected, draft);
    if (state.pendingPackageId && draft?.savePending && scanState.error !== "WRONG PACKAGE CONFIRMATION") return `${resultBody("PACKAGE CONFIRMED — PART USED SAVE PENDING", selected, "PACKAGE SCAN MATCHED")}
      <section class="pas-scan-ready" role="status"><p>The package scan matched, but Part Used has not yet been confirmed in the Picking List record. Keep this unit and retry.</p>
      <p>${esc(scanState.error || 'The original actual-parts list is retained for safe recovery.')}</p>
      <p>Retry the same In-House SKU / Tracking: <strong>${esc(selected.trackingNumber)}</strong></p>
      <div class="pas-scan-entry"><input id="pas-scan-input" autocomplete="off" aria-label="Retry In-House SKU / Tracking confirmation" ${operationBusy ? 'disabled' : ''}><button class="button" id="pas-scan-check" ${operationBusy ? 'disabled' : ''}>RETRY SAVE</button></div></section>`;
    if (state.pendingPackageId) return `${draft ? `<p>Actual parts ready: ${draft.parts.reduce((n,p) => n+p.quantity,0)} units. ${draft.submitted ? 'Completion pending. Retry the same In-House SKU / Tracking scan; parts are locked for safe recovery.' : '<button class="button" id="pas-edit-parts">EDIT TEMPORARY PARTS</button>'}</p>` : ''}${resultBody("LABEL PRINTED — CONFIRM PACKAGE", selected, "WAITING FOR PRINT CONFIRMATION")}${scanState.error ? `<div class="pas-confirm-error" role="alert"><h2>${esc(scanState.error)}</h2><p>Expected: ${esc(selected.trackingNumber)}</p><p>Scanned: ${esc(scanState.scan)}</p></div>` : ""}<section class="pas-scan-ready"><p>Scan In-House SKU / Tracking to Confirm Package: <strong>${esc(selected.trackingNumber)}</strong></p><div class="pas-scan-entry"><input id="pas-scan-input" autocomplete="off" aria-label="In-House SKU / Tracking package confirmation" ${operationBusy ? "disabled" : ""}><button class="button" id="pas-scan-check" ${operationBusy ? "disabled" : ""}>Confirm Put Away</button></div><button class="button" id="pas-reprint" ${operationBusy ? "disabled" : ""}>REPRINT LABEL</button></section>`;
    if (scanState.type === "ready") return `<section class="pas-scan-ready"><span>Scan 跟踪号</span><h2>READY TO SCAN</h2><div class="pas-scan-entry"><label class="sr-only" for="pas-scan-input">Tracking number</label><input id="pas-scan-input" type="text" inputmode="text" autocomplete="off" placeholder="Scan or enter tracking number"><button class="button" id="pas-scan-check" type="button">Check</button></div></section>`;
    if (scanState.type === "matched") return resultBody("MATCHED", selected, "Label print initiated.");
    if (scanState.type === "not-found") return `<section class="pas-scan-result"><span>Scanned Value</span><h2>PACKAGE NOT FOUND</h2><p>No matching package in this Picking List.</p><strong>${esc(scanState.scan)}</strong><button class="button" id="pas-rescan" type="button">Rescan</button></section>`;
    if (scanState.type === "multiple") return `<section class="pas-scan-result pas-multiple"><h2>MULTIPLE MATCHES FOUND</h2><p>More than one generated tracking number was found. Select the package on the physical box to confirm and print, or rescan.</p><div class="pas-candidates">${scanState.candidateIds.map((id) => candidateButton(scanPackageById(id))).join("")}</div><button class="button" id="pas-rescan" type="button">CANCEL / RESCAN</button></section>`;
    if (scanState.type === "already") return `${resultBody("PACKAGE ALREADY COMPLETED", selected, `Last printed: ${formatTimestamp(selected.lastPrintedAt)}`)}<div class="pas-result-actions"><button class="button" id="pas-reprint" type="button">Reprint</button><button class="button" id="pas-rescan" type="button">Cancel</button></div>`;
    return `${resultBody("POSSIBLE PACKAGE MATCH", selected, "Found In-house SKU / Tracking Number")}<div class="pas-scan-result"><p>Scanned value: <strong>${esc(scanState.scan)}</strong></p><p>Confirm this is the same package?</p></div><div class="pas-result-actions"><button class="button" id="pas-confirm-print" type="button">CONFIRM &amp; PRINT</button><button class="button" id="pas-rescan" type="button">CANCEL / RESCAN</button></div>`;
  }
  function resultBody(title, item, message) { return `<section class="pas-scan-result"><span>${esc(message)}</span><h2>${title}</h2><strong>${esc(item.trackingNumber)}</strong><dl><div><dt>PL Number</dt><dd>${esc(state.pl?.pickingListNumber)}</dd></div><div><dt>Current Location</dt><dd>${esc(item.currentLocation)}</dd></div><div><dt>Final SKU</dt><dd>${esc(item.finalSku)}</dd></div><div><dt>Warehouse Order</dt><dd>${esc(item.warehouseInboundOrder)}</dd></div></dl></section>`; }
  function candidateButton(item) { return `<button class="pas-candidate" type="button" data-pas-candidate="${esc(item.id)}"><strong>${esc(item.trackingNumber)}</strong><span>Current Location: ${esc(item.currentLocation)}</span><span>Final SKU: ${esc(item.finalSku)}</span><span>${esc(item.warehouseInboundOrder)}</span><small>${item.printStatus}</small></button>`; }
  function formatTimestamp(value) { return value ? new Date(value).toLocaleString() : "Not available"; }
  function currentQueue() { return usablePickingList() ? state.pl.packages : []; }
  function readyScan() { scanState = state.pendingPackageId ? { type: "WAITING_FOR_PRINT_CONFIRMATION", scan: "", candidateIds: [state.pendingPackageId] } : { type: "ready", scan: "", candidateIds: [] }; renderScanMode(); }
  function confirmCandidate(item) {
    if (!item || !currentQueue().includes(item) || state.pendingPackageId || operationBusy) return;
    if (!item.reconciliationRequired && (item.completedAt || item.packageStatus === "Processed")) { scanState.type = "already"; renderScanMode(); return; }
    state.temporaryParts = null; state.pendingPackageId = item.id; pendingParts(); state.pendingConfirmationTracking = text(item.trackingNumber); scanState = { type: "WAITING_FOR_PRINT_CONFIRMATION", scan: "", candidateIds: [item.id] }; save();
    printService.printSingleForScan(item, item.printCount > 0); renderScanMode();
  }
  async function processScan(value) {
    const entered = text(value); if (!entered || operationBusy || !usablePickingList()) return;
    if (state.pendingPackageId) {
      const item = scanPackageById(state.pendingPackageId);
      const draft = pendingParts();
      if (draft && !draft.ready) { addPart(entered); return; }
      state.pendingConfirmationTracking = text(item.trackingNumber);
      scanState = { type: "WAITING_FOR_PRINT_CONFIRMATION", scan: entered, candidateIds: [item.id] };
      if (!state.pendingConfirmationTracking || normalize(entered) !== normalize(state.pendingConfirmationTracking)) { scanState.error = "WRONG PACKAGE CONFIRMATION"; context.audio.warning(); renderScanMode(); return; }
      if (draft) { draft.submitted = true; save(); }
      operationBusy = true; renderScanMode(); const run = lifecycle;
      try {
        const result = await window.MkiteB044Picking.complete({ pickingListNumber: state.pl.pickingListNumber, pickingListRecordId: state.pl.pickingListRecordId, packageRecordId: item.packageRecordId, trackingNumber: item.trackingNumber, confirmationTracking: entered, ...(draft ? { partsReady: true, parts: draft.parts } : {}) });
        if (!context || run !== lifecycle) return;
        if (draft && result.partsPersisted !== true) throw new Error("PART USED persistence was not confirmed. Keep this unit and retry the same tracking scan against the updated Worker.");
        item.actualParts = draft?.parts || []; state.temporaryParts = null; item.completedAt = result.completedAt; item.packageStatus = result.status; item.partsPersisted = result.partsPersisted; item.reconciliationRequired = false; state.pendingPackageId = null; state.pendingConfirmationTracking = null; if (result.pickingListComplete) state.completedAt = result.completedAt; save(); context.audio.success();
      } catch (error) { if (context && run === lifecycle) { scanState.error = error.message; if (draft) { draft.savePending = true; save(); } await reconcilePickingList(); context.audio.failure(); } }
      finally { if (context && run === lifecycle) { operationBusy = false; if (scanModeOpen) { if (state.pendingPackageId) renderScanMode(); else readyScan(); } else renderSetup(); } }
      return;
    }
    const result = classifyScan(entered, currentQueue()); const exact = result.type === "EXACT" ? result.candidates[0] : null;
    if (exact) { scanState = { type: (exact.completedAt || exact.packageStatus === "Processed") ? "already" : "matched", scan: entered, candidateIds: [exact.id] }; if (exact.reconciliationRequired || (!exact.completedAt && exact.packageStatus !== "Processed")) confirmCandidate(exact); else renderScanMode(); return; }
    const candidates = result.candidates;
    if (candidates.length === 1) { context.audio.warning(); scanState = { type: (candidates[0].completedAt || candidates[0].packageStatus === "Processed") ? "already" : "partial", scan: entered, candidateIds: [candidates[0].id] }; renderScanMode(); return; }
    if (candidates.length > 1) { context.audio.warning(); scanState = { type: "multiple", scan: entered, candidateIds: candidates.map(item => item.id) }; renderScanMode(); return; }
    context.audio.failure(); scanState = { type: "not-found", scan: entered, candidateIds: [] }; renderScanMode();
  }
  function workflowPanel() {
    const prepared = state.prepared, pl = state.pl;
    const created = Boolean(pl?.pickingListRecordId), cancelled = pl?.phase === 'cancelled';
    const lifecycleStatus = !cancelled && isTerminalPickingList() ? 'PICKING LIST COMPLETED' : cancelled ? 'PICKING LIST CANCELLED' : pl?.operational ? 'PICKING LIST CREATED' : prepared?.eligible.length && !state.creationRequestId ? 'READY TO GENERATE' : 'PREPARING';
    return `<section class="pas-picking-panel panel" aria-live="polite"><h3>${lifecycleStatus}</h3>${pl?.packages?.some(r => r.reconciliationRequired) ? '<p role="status">SAVE PENDING / RECONCILIATION REQUIRED — Processed packages are counted below. Scan the affected tracking number to recover the pending save.</p>' : ''}${pl?.packages?.filter(r => r.reconciliationRequired && r.commandRaw).map(r => `<p>${esc(r.trackingNumber)} · PACKAGE STATUS: ${esc(r.packageStatus)} · PART USED SAVE PENDING</p>`).join('') || ''}${commandSummary()}${possiblePartsMarkup(pl?.packages || prepared?.eligible || [])}<p>${operationBusy ? 'Working — keep this session open…' : esc(state.workflowError || (!cancelled && pl?.message) || (pl?.operational ? 'Picking List ready for warehouse scanning.' : cancelled ? `${pl.processingReturnedToActive || 0} unfinished packages returned to Active. ${pl.processedRetained || 0} completed packages remain Processed. ${pl.skipped || 0} packages skipped due to unexpected status. Reset the page to prepare a new Picking List.` : 'Upload and matching are read-only. Generate explicitly to assign eligible packages.'))}</p>
      ${pl ? `<p><strong>${esc(pl.pickingListNumber)}</strong> · ${pl.succeeded.length} / ${pl.packages.length} ASSIGNED${pl.createdAt ? ` · Created ${esc(pl.createdAt)}` : ''}</p>${pl.failed.map(r => `<p class="pas-confirm-error">${esc(r.trackingNumber)}: ${esc(r.reason)}</p>`).join('')}` : ''}
      <div class="pas-actions">${startNewAction()}${adminRecoveryMarkup()}
      ${!created ? `<button class="button button-primary" id="pas-create-pl" ${operationBusy || (!prepared?.eligible.length && !state.creationRequestId) || ['blocked', 'persisting'].includes(pl?.phase) ? 'disabled' : ''}>${state.creationRequestId ? 'Retry / Resume Picking List' : 'GENERATE PICKING LIST'}</button><button class="button" id="pas-remove-excel" ${operationBusy || !state.file || hasProtectedOperation() ? 'disabled' : ''}>REMOVE EXCEL</button>` : ''}
      ${created && !cancelled ? `<button class="button" id="pas-cancel-pl" ${operationBusy || pl.packages.some(r => r.packageStatus === 'Processed') || !['operational', 'cancelling'].includes(pl.phase) ? 'disabled' : ''}>${pl.phase === 'cancelling' ? 'Retry Cancellation' : 'CANCEL PICKING LIST'}</button>` : ''}
      ${created && pl.phase === 'assigning' ? '<button class="button button-primary" id="pas-create-pl">Retry / Resume Picking List</button>' : ''}
      <button class="button" id="pas-prepare" ${state.creationRequestId || operationBusy || !state.packages.length ? 'disabled' : ''}>Refresh Inventory Matching</button>
      <button class="button" id="pas-export-exceptions" ${prepared?.exceptions.length ? '' : 'disabled'}>EXPORT EXCEPTIONS</button>
      <button class="button" id="pas-print-a4" ${usablePickingList() ? '' : 'disabled'}>Print A4 Picking List</button>
      <button class="button button-neutral" id="pas-reset" ${operationBusy ? 'disabled' : ''}>RESET PAGE</button></div></section>`;
  }
  async function prepareInventory() {
    if (operationBusy || state.creationRequestId || !state.packages.length) return;
    operationBusy = true; state.workflowError = ""; renderSetup(); const run = lifecycle;
    try { await prepareCommands(); if (!context || run !== lifecycle) return; const result = await window.MkiteB044Picking.prepare({ rows: state.packages }); if (context && run === lifecycle) { state.prepared = result; save(); } }
    catch (error) { if (context && run === lifecycle) { state.prepared = null; state.workflowError = error.message; } }
    finally { if (context && run === lifecycle) { operationBusy = false; renderSetup(); } }
  }
  async function createPickingList() {
    if (operationBusy || state.pl?.operational || ['cancelled', 'cancelling'].includes(state.pl?.phase)) return;
    if (!state.creationRequestId && !window.confirm(`Generate Picking List?\n\n${state.prepared?.eligible.length || 0} eligible packages will be assigned to this Picking List and changed from Active to Processing.`)) return;
    state.creationRequestId = state.creationRequestId || window.crypto.randomUUID(); state.generationUncertain = true; save();
    operationBusy = true; state.workflowError = ""; renderSetup(); const run = lifecycle;
    try {
      do {
        const result = await window.MkiteB044Picking.create({ requestId: state.creationRequestId, rows: state.packages, sourceFile: state.file.name, totalSourceRows: state.totalRows });
        if (!context || run !== lifecycle) return;
        result.packages = result.packages.map(r => ({ printCount: 0, printStatus: STATUS.NOT_PRINTED, ...r }));
        state.generationUncertain = false; state.pl = result; state.prepared = { packages: [...result.packages, ...result.exceptions], eligible: result.packages, exceptions: result.exceptions }; save(); renderSetup();
      } while (state.pl.phase === "assigning" && !state.pl.failed.length && state.pl.pendingCount > 0);
    } catch (error) { if (context && run === lifecycle) {
      state.workflowError = error.message;
      if (!state.pl?.pickingListRecordId && ['INVALID_INPUT', 'REQUEST_ID_REQUIRED', 'INVALID_ROWS', 'DUPLICATE_SOURCE_TRACKING', 'PACKAGE_STATUS_SCHEMA_ERROR', 'PROCESSING_STATUS_NOT_AVAILABLE', 'NO_ELIGIBLE_PACKAGES', 'PL_NUMBER_COLLISION', 'PICKING_LIST_NOT_CONFIGURED'].includes(error.code)) state.generationUncertain = false;
      save();
    } }
    finally { if (context && run === lifecycle) { operationBusy = false; renderSetup(); } }
  }

  const module = {
    render,
    init(nextContext) { lifecycle += 1; operationBusy = false; context = nextContext; restore(); renderSetup(); reconcilePickingList(); },
    cleanup() { adminRecoveryKey = ''; lifecycle += 1; operationBusy = false; document.getElementById("b044-a4-frame")?.remove(); document.body.classList.remove("pas-printing"); document.getElementById("pas-print-host")?.remove(); context = null; previewOpen = false; scanModeOpen = false; },
    _test: { adminRecovery, adminRecoveryMarkup, recoveryAvailable, reconcilePickingList, startNewPickingList, isTerminalPickingList, possiblePartsMarkup, addPart, removePart, confirmParts, editParts, pendingParts, commandSummary, prepareCommands, commandPages, commandLabelMarkup, packageLabels, parseOrderNumber, parseWorksheet, parseWorkbook, normalizeDate, normalize, classifyScan, selectCandidate, printService, processScan, confirmCandidate, openScanMode, closeScanMode, currentQueue, counts, renderPreview, printBatchWithDialog, workflowPanel, prepareInventory, createPickingList, removeExcel, resetSession, cancelPickingList, getState: () => state, getScanState: () => scanState, REQUIRED_HEADERS, SUPPORTED_ORDER_PREFIXES }
  };
  window.MkiteClientToolModules["b044.put-away-scan"] = module;
}(window, document));

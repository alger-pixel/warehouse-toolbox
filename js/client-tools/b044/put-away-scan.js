(function (window, document) {
  "use strict";

  window.MkiteClientToolModules = window.MkiteClientToolModules || {};
  const STORAGE_KEY = "client.b044.put-away-scan.session";
  const REQUIRED_HEADERS = ["到仓日期", "跟踪号", "入库SKU", "仓库入库单号"];
  const SUPPORTED_ORDER_PREFIXES = ["RMA", "RV"].sort((a, b) => b.length - a.length);
  const STATUS = { NOT_PRINTED: "NOT PRINTED", PRINTED: "PRINTED", REPRINTED: "REPRINTED" };
  const emptySession = () => ({ file: null, totalRows: 0, packages: [], invalidRows: [], prepared: null, pl: null, pendingPackageId: null, pendingConfirmationTracking: null, creationRequestId: null });
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
        if (REQUIRED_HEADERS.includes(heading)) found[heading] = col;
      }
      if (Object.keys(found).length) { headerRow = row; Object.assign(columns, found); break; }
    }
    const missingHeaders = REQUIRED_HEADERS.filter((heading) => columns[heading] == null);
    if (headerRow < 0 || missingHeaders.length) return { missingHeaders, totalRows: 0, packages: [], invalidRows: [] };

    const provisional = []; const invalidRows = []; let totalRows = 0;
    for (let row = headerRow + 1; row <= range.e.r; row += 1) {
      const cells = {};
      REQUIRED_HEADERS.forEach((heading) => { cells[heading] = sheet[window.XLSX.utils.encode_cell({ r: row, c: columns[heading] })]; });
      const arrivalDate = normalizeDate(cells["到仓日期"]);
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
      const record = { id: `row-${row + 1}`, excelRow: row + 1, arrivalDate, trackingNumber, normalizedTracking: normalize(trackingNumber), inboundSku, warehouseInboundOrder, prefix: order.prefix || "", clientId: order.clientId || "", finalSku: order.valid && inboundSku ? `${order.clientId}-${inboundSku}` : "", printStatus: STATUS.NOT_PRINTED, printCount: 0, lastPrintedAt: null };
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
        <header class="pas-step-header"><span class="pas-step-number" aria-hidden="true">02</span><div><h2 id="pas-execution-title">STEP 2 · SCAN &amp; PRINT EXECUTION</h2><p>Scan the package tracking number to print its label. Scan the same tracking number again to confirm the label printed successfully.</p></div></header>
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
    document.getElementById("pas-prepare")?.addEventListener("click", prepareInventory);
    document.getElementById("pas-create-pl")?.addEventListener("click", createPickingList);
    document.getElementById("pas-export-exceptions")?.addEventListener("click", () => window.MkiteB044Picking.exportExceptions(state.prepared.exceptions));
    document.getElementById("pas-print-a4")?.addEventListener("click", () => window.MkiteB044Picking.printA4(state.pl));
    document.getElementById("pas-file")?.addEventListener("change", handleFile);
    document.getElementById("pas-preview")?.addEventListener("click", renderPreview);
    document.getElementById("pas-print-all")?.addEventListener("click", printBatchWithDialog);
    document.getElementById("pas-start-scan")?.addEventListener("click", openScanMode);
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
  function hasProtectedOperation() {
    return state.pl?.phase !== 'cancelled' && Boolean(state.pl?.pickingListRecordId || (state.creationRequestId && state.generationUncertain !== false));
  }
  function clearLocalSession() {
    state = emptySession(); scanState = { type: 'ready', scan: '', candidateIds: [] };
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
    if (!window.confirm('Cancel this Picking List?\n\nUnfinished Processing packages will return to Active. Already Processed packages will remain Processed.\n\nThis action will stop further Scan & Print activity for this Picking List.')) return;
    state.pl.phase = 'cancelling'; state.pl.operational = false; save();
    operationBusy = true; state.workflowError = ''; renderSetup(); const run = lifecycle;
    try {
      do {
        const result = await window.MkiteB044Picking.cancel({ pickingListNumber: state.pl.pickingListNumber, requestId: state.creationRequestId || state.pl.requestId });
        if (!context || run !== lifecycle) return;
        state.pl = result; state.pendingPackageId = null; state.pendingConfirmationTracking = null; scanState = { type: "ready", scan: "", candidateIds: [] }; save();
      } while (state.pl.phase === 'cancelling' && state.pl.cancelPendingCount > 0);
    } catch (error) {
      if (context && run === lifecycle) {
        state.workflowError = error.message;
        save();
      }
    } finally { if (context && run === lifecycle) { operationBusy = false; renderSetup(); } }
  }

  function renderPreview() {
    if (!currentQueue().length || operationBusy) return;
    previewOpen = true;
    context.root.innerHTML = `<div class="pas-preview-page"><div class="pas-preview-header"><div><span class="tool-kicker">B044 · Put Away Scan</span><h3>Label Preview</h3><p>${currentQueue().length} labels generated</p></div><div><button class="button button-secondary" id="pas-preview-back" type="button">Back to Put Away Scan</button><button class="button button-primary" id="pas-preview-print" type="button">PRINT FOUND PACKAGES</button></div></div><div class="pas-preview-grid">${currentQueue().map((item) => labelMarkup(item, true)).join("")}</div></div>`;
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
      host.innerHTML = items.map((item) => labelMarkup(item, false)).join("");
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
  function renderScanMode() {
    const totals = counts(); const selected = scanState.candidateIds.length === 1 ? scanPackageById(scanState.candidateIds[0]) : null;
    context.root.innerHTML = `<div class="pas-scan-mode state-${scanState.type}${scanState.error ? " is-confirmation-error" : ""}" role="dialog" aria-modal="true" aria-label="Put Away Scan and Print Mode"><header><strong>PUT AWAY SCAN · ${esc(state.pl.pickingListNumber)}</strong><button class="button pas-exit" id="pas-scan-exit" type="button">Exit Scan &amp; Print Mode</button></header><div class="pas-scan-counters"><span>${currentQueue().filter(r => r.completedAt).length} / ${currentQueue().length} COMPLETED</span><span>${state.pendingPackageId ? "WAITING FOR PRINT CONFIRMATION" : "WAITING FOR PACKAGE"}</span></div><main>${scanModeBody(selected)}</main></div>`;
    document.getElementById("pas-scan-exit").addEventListener("click", closeScanMode);
    document.getElementById("pas-scan-input")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); processScan(event.currentTarget.value); } });
    document.getElementById("pas-scan-check")?.addEventListener("click", () => processScan(document.getElementById("pas-scan-input").value));
    document.getElementById("pas-rescan")?.addEventListener("click", readyScan);
    document.getElementById("pas-confirm-print")?.addEventListener("click", () => confirmCandidate(selected));
    document.getElementById("pas-reprint")?.addEventListener("click", () => { if (!operationBusy) { printService.printSingleForScan(selected, true); if (!state.pendingPackageId) readyScan(); } });
    document.querySelectorAll("[data-pas-candidate]").forEach((button) => button.addEventListener("click", () => selectCandidate(button.dataset.pasCandidate)));
    window.setTimeout(() => document.getElementById("pas-scan-input")?.focus(), 0);
  }
  function scanModeBody(selected) {
    if (currentQueue().every(r => r.completedAt)) return `<section class="pas-scan-result"><h2>PICKING LIST COMPLETE</h2><strong>${esc(state.pl.pickingListNumber)}</strong><p>${currentQueue().length} TOTAL COMPLETED</p><p>${esc(state.completedAt || currentQueue().map(r => r.completedAt).sort().at(-1))}</p></section>`;
    if (state.pendingPackageId) return `${resultBody("LABEL PRINTED — CONFIRM PACKAGE", selected, "WAITING FOR PRINT CONFIRMATION")}${scanState.error ? `<div class="pas-confirm-error" role="alert"><h2>${esc(scanState.error)}</h2><p>Expected: ${esc(selected.trackingNumber)}</p><p>Scanned: ${esc(scanState.scan)}</p></div>` : ""}<section class="pas-scan-ready"><p>Scan the same In-house SKU / Tracking Number again: <strong>${esc(selected.trackingNumber)}</strong></p><div class="pas-scan-entry"><input id="pas-scan-input" autocomplete="off" aria-label="Tracking number print confirmation" ${operationBusy ? "disabled" : ""}><button class="button" id="pas-scan-check" ${operationBusy ? "disabled" : ""}>Confirm Label</button></div><button class="button" id="pas-reprint" ${operationBusy ? "disabled" : ""}>REPRINT LABEL</button></section>`;
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
    if (item.completedAt || item.packageStatus === "Processed") { scanState.type = "already"; renderScanMode(); return; }
    state.pendingPackageId = item.id; state.pendingConfirmationTracking = text(item.trackingNumber); scanState = { type: "WAITING_FOR_PRINT_CONFIRMATION", scan: "", candidateIds: [item.id] }; save();
    printService.printSingleForScan(item, item.printCount > 0); renderScanMode();
  }
  async function processScan(value) {
    const entered = text(value); if (!entered || operationBusy || !usablePickingList()) return;
    if (state.pendingPackageId) {
      const item = scanPackageById(state.pendingPackageId);
      state.pendingConfirmationTracking = text(item.trackingNumber);
      scanState = { type: "WAITING_FOR_PRINT_CONFIRMATION", scan: entered, candidateIds: [item.id] };
      if (normalize(entered) !== normalize(state.pendingConfirmationTracking)) { scanState.error = "WRONG PACKAGE CONFIRMATION"; context.audio.warning(); renderScanMode(); return; }
      operationBusy = true; renderScanMode(); const run = lifecycle;
      try {
        const result = await window.MkiteB044Picking.complete({ pickingListNumber: state.pl.pickingListNumber, pickingListRecordId: state.pl.pickingListRecordId, packageRecordId: item.packageRecordId, trackingNumber: item.trackingNumber, confirmationTracking: entered });
        if (!context || run !== lifecycle) return;
        item.completedAt = result.completedAt; item.packageStatus = result.status; state.pendingPackageId = null; state.pendingConfirmationTracking = null; if (result.pickingListComplete) state.completedAt = result.completedAt; save(); context.audio.success();
      } catch (error) { if (context && run === lifecycle) { scanState.error = error.message; context.audio.failure(); } }
      finally { if (context && run === lifecycle) { operationBusy = false; if (scanModeOpen) { if (state.pendingPackageId) renderScanMode(); else readyScan(); } else renderSetup(); } }
      return;
    }
    const result = classifyScan(entered, currentQueue()); const exact = result.type === "EXACT" ? result.candidates[0] : null;
    if (exact) { scanState = { type: (exact.completedAt || exact.packageStatus === "Processed") ? "already" : "matched", scan: entered, candidateIds: [exact.id] }; if (!exact.completedAt && exact.packageStatus !== "Processed") confirmCandidate(exact); else renderScanMode(); return; }
    const candidates = result.candidates;
    if (candidates.length === 1) { context.audio.warning(); scanState = { type: (candidates[0].completedAt || candidates[0].packageStatus === "Processed") ? "already" : "partial", scan: entered, candidateIds: [candidates[0].id] }; renderScanMode(); return; }
    if (candidates.length > 1) { context.audio.warning(); scanState = { type: "multiple", scan: entered, candidateIds: candidates.map(item => item.id) }; renderScanMode(); return; }
    context.audio.failure(); scanState = { type: "not-found", scan: entered, candidateIds: [] }; renderScanMode();
  }
  function workflowPanel() {
    const prepared = state.prepared, pl = state.pl;
    const created = Boolean(pl?.pickingListRecordId), cancelled = pl?.phase === 'cancelled';
    const lifecycleStatus = cancelled ? 'PICKING LIST CANCELLED' : pl?.operational ? 'PICKING LIST CREATED' : prepared?.eligible.length && !state.creationRequestId ? 'READY TO GENERATE' : 'PREPARING';
    return `<section class="pas-picking-panel panel" aria-live="polite"><h3>${lifecycleStatus}</h3><p>${operationBusy ? 'Working — keep this session open…' : esc(state.workflowError || (!cancelled && pl?.message) || (pl?.operational ? 'Picking List ready for warehouse scanning.' : cancelled ? `${pl.processingReturnedToActive || 0} unfinished packages returned to Active. ${pl.processedRetained || 0} completed packages remain Processed. ${pl.skipped || 0} packages skipped due to unexpected status. Reset the page to prepare a new Picking List.` : 'Upload and matching are read-only. Generate explicitly to assign eligible packages.'))}</p>
      ${pl ? `<p><strong>${esc(pl.pickingListNumber)}</strong> · ${pl.succeeded.length} / ${pl.packages.length} ASSIGNED${pl.createdAt ? ` · Created ${esc(pl.createdAt)}` : ''}</p>${pl.failed.map(r => `<p class="pas-confirm-error">${esc(r.trackingNumber)}: ${esc(r.reason)}</p>`).join('')}` : ''}
      <div class="pas-actions">
      ${!created ? `<button class="button button-primary" id="pas-create-pl" ${operationBusy || (!prepared?.eligible.length && !state.creationRequestId) || ['blocked', 'persisting'].includes(pl?.phase) ? 'disabled' : ''}>${state.creationRequestId ? 'Retry / Resume Picking List' : 'GENERATE PICKING LIST'}</button><button class="button" id="pas-remove-excel" ${operationBusy || !state.file || hasProtectedOperation() ? 'disabled' : ''}>REMOVE EXCEL</button>` : ''}
      ${created && !cancelled ? `<button class="button" id="pas-cancel-pl" ${operationBusy || !['operational', 'cancelling'].includes(pl.phase) ? 'disabled' : ''}>${pl.phase === 'cancelling' ? 'Retry Cancellation' : 'CANCEL PICKING LIST'}</button>` : ''}
      ${created && pl.phase === 'assigning' ? '<button class="button button-primary" id="pas-create-pl">Retry / Resume Picking List</button>' : ''}
      <button class="button" id="pas-prepare" ${state.creationRequestId || operationBusy || !state.packages.length ? 'disabled' : ''}>Refresh Inventory Matching</button>
      <button class="button" id="pas-export-exceptions" ${prepared?.exceptions.length ? '' : 'disabled'}>EXPORT EXCEPTIONS</button>
      <button class="button" id="pas-print-a4" ${usablePickingList() ? '' : 'disabled'}>Print A4 Picking List</button>
      <button class="button button-neutral" id="pas-reset" ${operationBusy ? 'disabled' : ''}>RESET PAGE</button></div></section>`;
  }
  async function prepareInventory() {
    if (operationBusy || state.creationRequestId || !state.packages.length) return;
    operationBusy = true; state.workflowError = ""; renderSetup(); const run = lifecycle;
    try { const result = await window.MkiteB044Picking.prepare({ rows: state.packages }); if (context && run === lifecycle) { state.prepared = result; save(); } }
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
    init(nextContext) { lifecycle += 1; operationBusy = false; context = nextContext; restore(); renderSetup(); },
    cleanup() { lifecycle += 1; operationBusy = false; document.getElementById("b044-a4-frame")?.remove(); document.body.classList.remove("pas-printing"); document.getElementById("pas-print-host")?.remove(); context = null; previewOpen = false; scanModeOpen = false; },
    _test: { parseOrderNumber, parseWorksheet, parseWorkbook, normalizeDate, normalize, classifyScan, selectCandidate, printService, processScan, confirmCandidate, openScanMode, closeScanMode, currentQueue, counts, renderPreview, printBatchWithDialog, workflowPanel, prepareInventory, createPickingList, removeExcel, resetSession, cancelPickingList, getState: () => state, getScanState: () => scanState, REQUIRED_HEADERS, SUPPORTED_ORDER_PREFIXES }
  };
  window.MkiteClientToolModules["b044.put-away-scan"] = module;
}(window, document));

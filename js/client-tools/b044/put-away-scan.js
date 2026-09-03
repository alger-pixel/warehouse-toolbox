(function (window, document) {
  "use strict";

  window.MkiteClientToolModules = window.MkiteClientToolModules || {};
  const STORAGE_KEY = "client.b044.put-away-scan.session";
  const REQUIRED_HEADERS = ["到仓日期", "跟踪号", "入库SKU", "仓库入库单号"];
  const SUPPORTED_ORDER_PREFIXES = ["RMA", "RV"].sort((a, b) => b.length - a.length);
  const STATUS = { NOT_PRINTED: "NOT PRINTED", PRINTED: "PRINTED", REPRINTED: "REPRINTED" };
  const emptySession = () => ({ file: null, totalRows: 0, packages: [], invalidRows: [] });
  let context = null;
  let state = emptySession();
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
    if (stored && Array.isArray(stored.packages) && Array.isArray(stored.invalidRows)) state = stored;
  }
  function counts() {
    const printed = state.packages.filter((item) => item.printCount > 0).length;
    return { printed, remaining: state.packages.length - printed, reprints: state.packages.reduce((sum, item) => sum + Math.max(0, item.printCount - 1), 0) };
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
    context.root.innerHTML = `<div class="pas-app" data-client-theme="blue"><section class="pas-upload panel"><div><h3>Upload package data</h3><p>Excel <strong>.xlsx</strong> or <strong>.xls</strong>. Only the first worksheet will be processed.</p></div><label class="button button-primary pas-file-button" for="pas-file">Choose Excel File</label><input class="sr-only" id="pas-file" type="file" accept=".xlsx,.xls"></section>
      ${state.file ? uploadSummary() : '<div class="pas-empty"><strong>No package file loaded</strong><span>Required columns: 到仓日期, 跟踪号, 入库SKU, 仓库入库单号</span></div>'}
      ${state.file ? `<section class="pas-overview">${stat("Total Rows", state.totalRows)}${stat("Valid Labels", state.packages.length)}${stat("Invalid Rows", state.invalidRows.length, state.invalidRows.length ? "danger" : "")}${stat("Printed", totals.printed, "success")}${stat("Remaining", totals.remaining)}</section>
      <section class="pas-actions"><div class="pas-action-feature"><button class="button button-primary pas-scan-start" id="pas-start-scan" type="button"${state.packages.length ? "" : " disabled"}>Start Scan &amp; Print Mode</button><small>Designed for continuous scan-to-print on kiosk-configured warehouse stations.</small></div><div class="pas-action-feature"><button class="button button-secondary" id="pas-print-all" type="button"${state.packages.length ? "" : " disabled"}>Print All Labels</button><small>Opens printer settings for manual batch printing.</small></div><button class="button button-secondary" id="pas-preview" type="button"${state.packages.length ? "" : " disabled"}>Preview All Labels</button><button class="button button-neutral" id="pas-reset" type="button">Reset Session</button></section>
      ${packageTable()}${invalidTable()}` : ""}</div>`;
    bindSetup();
  }
  function stat(label, value, tone) { return `<div class="pas-stat${tone ? ` is-${tone}` : ""}"><span>${esc(label)}</span><strong>${value}</strong></div>`; }
  function uploadSummary() { return `<section class="pas-file-summary"><div><span>File Name</span><strong>${esc(state.file.name)}</strong></div><div><span>Worksheet Used</span><strong>${esc(state.file.sheet)}</strong></div><div><span>Processed</span><strong>${esc(state.file.processedAt)}</strong></div></section>`; }
  function packageTable() {
    if (!state.packages.length) return '<section class="pas-table-section"><div class="section-header"><h3>Valid Packages</h3><span>0</span></div><div class="pas-empty">No valid labels were generated.</div></section>';
    return `<section class="pas-table-section"><div class="section-header"><h3>Generated Packages</h3><span>${state.packages.length} labels</span></div><div class="table-wrap"><table><thead><tr><th>Row</th><th>到仓日期</th><th>跟踪号</th><th>入库SKU</th><th>仓库入库单号</th><th>Prefix</th><th>Client ID</th><th>Final SKU</th><th>Validation</th><th>Print Status</th></tr></thead><tbody>${state.packages.map((item) => `<tr><td>${item.excelRow}</td><td>${esc(item.arrivalDate)}</td><td>${esc(item.trackingNumber)}</td><td>${esc(item.inboundSku)}</td><td>${esc(item.warehouseInboundOrder)}</td><td>${esc(item.prefix)}</td><td>${esc(item.clientId)}</td><td>${esc(item.finalSku)}</td><td><span class="badge badge-success">VALID</span></td><td><span class="pas-print-status is-${item.printStatus.replace(" ", "-").toLowerCase()}">${item.printStatus}</span></td></tr>`).join("")}</tbody></table></div></section>`;
  }
  function invalidTable() {
    if (!state.invalidRows.length) return "";
    return `<section class="pas-table-section pas-invalid"><div class="section-header"><h3>Invalid Rows</h3><span>${state.invalidRows.length} excluded</span></div><div class="table-wrap"><table><thead><tr><th>Excel Row</th><th>Tracking Number</th><th>SKU</th><th>Warehouse Order</th><th>Reason</th></tr></thead><tbody>${state.invalidRows.map((item) => `<tr><td>${item.excelRow}</td><td>${esc(item.trackingNumber)}</td><td>${esc(item.inboundSku)}</td><td>${esc(item.warehouseInboundOrder)}</td><td>${item.reasons.map(esc).join("; ")}</td></tr>`).join("")}</tbody></table></div></section>`;
  }

  function bindSetup() {
    document.getElementById("pas-file")?.addEventListener("change", handleFile);
    document.getElementById("pas-preview")?.addEventListener("click", renderPreview);
    document.getElementById("pas-print-all")?.addEventListener("click", printBatchWithDialog);
    document.getElementById("pas-start-scan")?.addEventListener("click", openScanMode);
    document.getElementById("pas-reset")?.addEventListener("click", resetSession);
  }
  function handleFile(event) {
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
        state = { file: { name: file.name, sheet: sheetName, processedAt: new Date().toLocaleString() }, totalRows: parsed.totalRows, packages: parsed.packages, invalidRows: parsed.invalidRows };
        save(); renderSetup(); context.toast.show(`${state.packages.length} labels generated`);
      } catch (error) { context.toast.show("Unable to process this workbook"); }
    };
    reader.readAsArrayBuffer(file);
  }
  function resetSession() {
    if (!window.confirm("Reset the B044 Put Away Scan session?\nUploaded data and print history will be cleared.")) return;
    state = emptySession(); context.storage.remove(STORAGE_KEY); renderSetup(); context.toast.show("Session reset");
  }

  function renderPreview() {
    previewOpen = true;
    context.root.innerHTML = `<div class="pas-preview-page"><div class="pas-preview-header"><div><span class="tool-kicker">B044 · Put Away Scan</span><h3>Label Preview</h3><p>${state.packages.length} labels generated</p></div><div><button class="button button-secondary" id="pas-preview-back" type="button">Back to Put Away Scan</button><button class="button button-primary" id="pas-preview-print" type="button">Print All Labels</button></div></div><div class="pas-preview-grid">${state.packages.map((item) => labelMarkup(item, true)).join("")}</div></div>`;
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
      markPrinted(item, reprint); this.requestPrint([item]);
    },
    printBatchWithDialog(items, afterPrint) {
      /* Manual batch intent: the webpage requests the normal native print UI. */
      items.forEach((item) => markPrinted(item, item.printCount > 0));
      this.requestPrint(items, afterPrint);
    }
  };
  function printBatchWithDialog() {
    if (!state.packages.length) return;
    const returnToPreview = previewOpen;
    printService.printBatchWithDialog(state.packages, () => returnToPreview ? renderPreview() : renderSetup());
    context.toast.show("Batch print requested; review printer and 4 × 6 settings");
  }

  function openScanMode() { if (!state.packages.length) return; context.audio.setEnabled(true); scanModeOpen = true; scanState = { type: "ready", scan: "", candidateIds: [] }; renderScanMode(); }
  function closeScanMode() { scanModeOpen = false; renderSetup(); }
  function scanPackageById(id) { return state.packages.find((item) => item.id === id); }
  function classifyScan(value, packages) {
    const entered = text(value); const normalized = normalize(entered);
    const exact = packages.find((item) => item.normalizedTracking === normalized);
    if (exact) return { type: "exact", candidates: [exact] };
    const candidates = packages.filter((item) => normalized.includes(item.normalizedTracking));
    return { type: candidates.length ? "contained" : "not-found", candidates };
  }
  function renderScanMode() {
    const totals = counts(); const selected = scanState.candidateIds.length === 1 ? scanPackageById(scanState.candidateIds[0]) : null;
    context.root.innerHTML = `<div class="pas-scan-mode state-${scanState.type}" role="dialog" aria-modal="true" aria-label="Put Away Scan and Print Mode"><header><strong>PUT AWAY SCAN</strong><button class="button pas-exit" id="pas-scan-exit" type="button">Exit Scan &amp; Print Mode</button></header><div class="pas-scan-counters"><span>Generated <strong>${state.packages.length}</strong></span><span>Printed <strong>${totals.printed}</strong></span><span>Remaining <strong>${totals.remaining}</strong></span></div><main>${scanModeBody(selected)}</main></div>`;
    document.getElementById("pas-scan-exit").addEventListener("click", closeScanMode);
    document.getElementById("pas-scan-input")?.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); processScan(event.currentTarget.value); } });
    document.getElementById("pas-scan-check")?.addEventListener("click", () => processScan(document.getElementById("pas-scan-input").value));
    document.getElementById("pas-rescan")?.addEventListener("click", readyScan);
    document.getElementById("pas-confirm-print")?.addEventListener("click", () => confirmCandidate(selected));
    document.getElementById("pas-reprint")?.addEventListener("click", () => { printService.printSingleForScan(selected, true); readyScan(); });
    document.querySelectorAll("[data-pas-candidate]").forEach((button) => button.addEventListener("click", () => { const item = scanPackageById(button.dataset.pasCandidate); scanState = { ...scanState, type: item.printCount > 0 ? "already" : "partial", candidateIds: [item.id] }; renderScanMode(); }));
    window.setTimeout(() => document.getElementById("pas-scan-input")?.focus(), 0);
  }
  function scanModeBody(selected) {
    if (scanState.type === "ready") return `<section class="pas-scan-ready"><span>Scan 跟踪号</span><h2>READY TO SCAN</h2><div class="pas-scan-entry"><label class="sr-only" for="pas-scan-input">Tracking number</label><input id="pas-scan-input" type="text" inputmode="text" autocomplete="off" placeholder="Scan or enter tracking number"><button class="button" id="pas-scan-check" type="button">Check</button></div></section>`;
    if (scanState.type === "matched") return resultBody("MATCHED", selected, "Label print initiated.");
    if (scanState.type === "not-found") return `<section class="pas-scan-result"><span>Scanned Value</span><h2>NOT FOUND</h2><strong>${esc(scanState.scan)}</strong><button class="button" id="pas-rescan" type="button">Rescan</button></section>`;
    if (scanState.type === "multiple") return `<section class="pas-scan-result pas-multiple"><h2>MULTIPLE MATCHES FOUND</h2><p>More than one generated tracking number was found. Select the package on the physical box.</p><div class="pas-candidates">${scanState.candidateIds.map((id) => candidateButton(scanPackageById(id))).join("")}</div><button class="button" id="pas-rescan" type="button">Cancel / Rescan</button></section>`;
    if (scanState.type === "already") return `${resultBody("ALREADY PRINTED", selected, `Last printed: ${formatTimestamp(selected.lastPrintedAt)}`)}<div class="pas-result-actions"><button class="button" id="pas-reprint" type="button">Reprint</button><button class="button" id="pas-rescan" type="button">Cancel</button></div>`;
    return `${resultBody("PARTIAL SCAN MATCH", selected, "Tracking number found inside scanned value. Confirm before printing.")}<div class="pas-result-actions"><button class="button" id="pas-confirm-print" type="button">Confirm &amp; Print</button><button class="button" id="pas-rescan" type="button">Cancel / Rescan</button></div>`;
  }
  function resultBody(title, item, message) { return `<section class="pas-scan-result"><span>${esc(message)}</span><h2>${title}</h2><strong>${esc(item.trackingNumber)}</strong><dl><div><dt>Final SKU</dt><dd>${esc(item.finalSku)}</dd></div><div><dt>Warehouse Order</dt><dd>${esc(item.warehouseInboundOrder)}</dd></div></dl></section>`; }
  function candidateButton(item) { return `<button class="pas-candidate" type="button" data-pas-candidate="${esc(item.id)}"><strong>${esc(item.trackingNumber)}</strong><span>${esc(item.finalSku)}</span><span>${esc(item.warehouseInboundOrder)}</span><small>${item.printStatus}</small></button>`; }
  function formatTimestamp(value) { return value ? new Date(value).toLocaleString() : "Not available"; }
  function readyScan() { scanState = { type: "ready", scan: "", candidateIds: [] }; renderScanMode(); }
  function confirmCandidate(item) { if (item.printCount > 0) { scanState.type = "already"; renderScanMode(); return; } printService.printSingleForScan(item, false); scanState.type = "matched"; renderScanMode(); window.setTimeout(readyScan, 1100); }
  function processScan(value) {
    const entered = text(value); if (!entered) return;
    const result = classifyScan(entered, state.packages); const exact = result.type === "exact" ? result.candidates[0] : null;
    if (exact) { scanState = { type: exact.printCount > 0 ? "already" : "matched", scan: entered, candidateIds: [exact.id] }; if (!exact.printCount) { printService.printSingleForScan(exact, false); renderScanMode(); window.setTimeout(readyScan, 1100); } else renderScanMode(); return; }
    const candidates = result.candidates;
    if (candidates.length === 1) { context.audio.warning(); scanState = { type: candidates[0].printCount > 0 ? "already" : "partial", scan: entered, candidateIds: [candidates[0].id] }; renderScanMode(); return; }
    if (candidates.length > 1) { context.audio.warning(); scanState = { type: "multiple", scan: entered, candidateIds: candidates.map((item) => item.id) }; renderScanMode(); return; }
    context.audio.failure(); scanState = { type: "not-found", scan: entered, candidateIds: [] }; renderScanMode();
  }

  const module = {
    render,
    init(nextContext) { context = nextContext; restore(); renderSetup(); },
    cleanup() { document.body.classList.remove("pas-printing"); document.getElementById("pas-print-host")?.remove(); context = null; previewOpen = false; scanModeOpen = false; },
    _test: { parseOrderNumber, parseWorksheet, parseWorkbook, normalizeDate, normalize, classifyScan, printService, REQUIRED_HEADERS, SUPPORTED_ORDER_PREFIXES }
  };
  window.MkiteClientToolModules["b044.put-away-scan"] = module;
}(window, document));

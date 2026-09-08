(function (window, document) {
  "use strict";

  window.MkiteInHouseTools = window.MkiteInHouseTools || {};
  const SESSION_KEY = "in-house.receiving.session";
  const STATES = Object.freeze({ READY: "ready", ENTERING: "entering", CHECKING: "checking-duplicate", DUPLICATE: "duplicate-warning", MULTIPLE: "multiple-duplicates", SAVING: "saving", SUCCESS: "success", ERROR: "error", CONNECTION: "connection-error" });
  const REPEAT_GUARD_MS = 1600;
  let context = null; let root = null; let pending = false; let resetTimer = null; let lifecycle = 0;
  let lastSubmission = { key: "", at: 0 };
  let viewState = { type: STATES.READY, title: "Ready to receive", message: "Scan a package tracking number to begin.", receipt: null, records: [] };
  let session = blankSession();

  function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function clean(value) { return String(value == null ? "" : value).trim(); }
  function validLocation(value) { const raw = String(value == null ? "" : value); return Boolean(raw.trim()) && !/[\u0000-\u001F\u007F]/.test(raw); }
  function submissionKey(clientId, sku, location) { return `${clientId}\u0000${sku.toLocaleUpperCase()}\u0000${location.toLocaleUpperCase()}`; }
  function isRepeatedSubmission(key, now, previous) { return key === previous.key && now - previous.at < REPEAT_GUARD_MS; }
  function localDate(value = new Date()) { const pad = (part) => String(part).padStart(2, "0"); return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`; }
  function blankSession(date = localDate()) { return { sessionDate: date, receipts: [], receivedCount: 0, failedCount: 0, duplicateWarnings: 0, lastLocation: "" }; }
  function validSession(value) {
    const today = localDate(); if (!value || value.sessionDate !== today || !Array.isArray(value.receipts)) return blankSession(today);
    return { sessionDate: today, receipts: value.receipts.slice(0, 20), receivedCount: Number(value.receivedCount) || value.receipts.length, failedCount: Number(value.failedCount) || 0, duplicateWarnings: Number(value.duplicateWarnings) || 0, lastLocation: clean(value.lastLocation) };
  }

  function render() {
    return `<div class="receiving-app" data-in-house-theme="receiving">
      <section class="receiving-mode-banner" id="receiving-mode-banner"></section>
      <section class="receiving-overview" aria-label="Local session overview"><div><span>Received this session</span><strong id="receiving-count">0</strong></div><div><span>Failed</span><strong id="receiving-failed">0</strong></div><div><span>Duplicate warnings</span><strong id="receiving-duplicates">0</strong></div><div><span>Last location</span><strong id="receiving-last-location">—</strong></div></section>
      <section class="receiving-workspace"><div class="receiving-form-panel"><div class="receiving-panel-heading"><span class="receiving-step">01</span><div><h3>Receive a package</h3><p>The tracking number becomes the MKITE in-house SKU.</p></div></div><form id="receiving-form" novalidate><div class="receiving-field"><label for="receiving-sku">Package / In-house SKU</label><input id="receiving-sku" type="text" autocomplete="off" inputmode="text" placeholder="Scan tracking number..." aria-describedby="receiving-sku-help"><small id="receiving-sku-help">Enter sends focus to Current Location.</small></div><div class="receiving-field"><label for="receiving-location">Current Location</label><input id="receiving-location" type="text" autocomplete="off" inputmode="text" placeholder="Scan or enter location..." aria-describedby="receiving-location-help"><small id="receiving-location-help">Enter checks for an exact duplicate, then receives.</small></div><button class="button receiving-submit" id="receiving-submit" type="submit" disabled>Receive Package</button></form></div><aside class="receiving-status is-ready" id="receiving-status" aria-live="polite"></aside></section>
      <section class="receiving-history"><div class="section-header"><div><h3>Recent Receiving</h3><span>Local workstation activity · ${localDate()}</span></div><button class="button button-neutral" id="receiving-reset-session" type="button">Reset Session</button></div><div id="receiving-history-content"></div></section></div>`;
  }

  function init(nextContext) { context = nextContext; root = context.root; lifecycle += 1; session = validSession(context.storage.get(SESSION_KEY, null)); save(); installClientField(); bind(); renderMode(); renderOverview(); renderStatus(); renderHistory(); updateSubmit(); focusClient(); }
  function installClientField() {
    root.querySelector("#receiving-form").insertAdjacentHTML("afterbegin", `<div class="receiving-field"><label for="receiving-client">Client ID</label><input id="receiving-client" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Enter or scan Client ID..." aria-describedby="receiving-client-help"><small id="receiving-client-help">Enter sends focus to SKU. Client ID is converted to uppercase.</small></div>`);
    inputs().sku.disabled = true; inputs().location.disabled = true;
  }
  function bind() {
    const form = root.querySelector("#receiving-form"); const client=root.querySelector("#receiving-client"); const sku = root.querySelector("#receiving-sku"); const location = root.querySelector("#receiving-location");
    form.addEventListener("submit", (event) => { event.preventDefault(); startReceiving(); }); client.addEventListener("input",handleClientInput);client.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); advanceClient(); } }); client.addEventListener("compositionend", handleClientInput);sku.addEventListener("input",handleEntering); location.addEventListener("input",handleEntering);
    sku.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); if (clean(sku.value)) location.focus(); } }); location.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); startReceiving(); } });
    root.addEventListener("click", (event) => { if (event.target.closest("#receiving-retry")) startReceiving({ bypassGuard: true }); if (event.target.closest("#receiving-confirm-duplicate")) createPackage(true, viewState.records.length); if (event.target.closest("#receiving-clear")) clearForm(); if (event.target.closest("#receiving-reset-session")) resetSession(); });
  }
  function normalizeClient() { const client = inputs().client; client.value = clean(client.value).toUpperCase(); return client.value; }
  function clientRequired() {
    viewState = { type: STATES.ENTERING, title: "CLIENT ID REQUIRED", message: "Enter or scan a Client ID to continue.", receipt: null, records: [] };
    renderStatus(); inputs().client.focus(); updateSubmit();
  }
  function handleClientInput(event) {
    if (event?.isComposing) return;
    const f = inputs();
    const start = f.client.selectionStart; const end = f.client.selectionEnd;
    const value = f.client.value;
    f.client.value = value.toUpperCase();
    if (start != null && f.client.setSelectionRange) f.client.setSelectionRange(value.slice(0, start).toUpperCase().length, value.slice(0, end).toUpperCase().length);
    f.sku.value = ""; f.location.value = "";
    f.sku.disabled = !clean(f.client.value); f.location.disabled = true;
    viewState = { type: STATES.ENTERING, title: "Package details", message: "Enter Client ID, SKU, and location to receive.", receipt: null, records: [] };
    renderStatus(); updateSubmit();
  }
  function advanceClient() {
    if (pending || inputs().client.disabled) return;
    if (!normalizeClient()) { clientRequired(); return; }
    inputs().sku.disabled = false; updateSubmit(); inputs().sku.focus();
  }
  function handleEntering() { const f=inputs();if(clean(f.client.value)&&clean(f.sku.value))f.location.disabled=false;else if(!clean(f.sku.value)){f.location.value="";f.location.disabled=true;}updateSubmit(); if ([STATES.READY, STATES.ENTERING].includes(viewState.type)) { viewState = { type: STATES.ENTERING, title: "Package details", message: "Enter SKU and location to receive for this client.", receipt: null, records: [] }; renderStatus(); } }
  function renderMode() { const mock = window.MkiteReceivingService.mode() === "mock"; const banner = root.querySelector("#receiving-mode-banner"); banner.innerHTML = mock ? '<strong>Development / Mock Mode</strong><span>Receipts and duplicate lookups are simulated; nothing is written to Feishu.</span>' : '<strong>Live Secure API</strong><span>Duplicate checks and receipts use the secure MKITE API.</span>'; banner.classList.toggle("is-mock", mock); }
  function renderOverview() { root.querySelector("#receiving-count").textContent = session.receivedCount; root.querySelector("#receiving-failed").textContent = session.failedCount; root.querySelector("#receiving-duplicates").textContent = session.duplicateWarnings; root.querySelector("#receiving-last-location").textContent = session.lastLocation || "—"; }
  function recordCards() { return viewState.records.length ? `<div class="receiving-duplicate-list">${viewState.records.map((record) => `<article><span>Existing record</span><strong>${escapeHtml(record.location || "Location unavailable")}</strong><small>${escapeHtml(record.recordId || "No record ID")}</small>${record.receivedAt ? `<time datetime="${escapeHtml(record.receivedAt)}">${escapeHtml(new Date(record.receivedAt).toLocaleString())}</time>` : ""}</article>`).join("")}</div>` : ""; }
  function renderStatus() {
    const panel = root.querySelector("#receiving-status"); panel.className = `receiving-status is-${viewState.type}`; const receipt = viewState.receipt;
    const symbol = [STATES.DUPLICATE, STATES.MULTIPLE, STATES.CONNECTION].includes(viewState.type) ? "!" : viewState.type === STATES.SUCCESS ? "✓" : viewState.type === STATES.ERROR ? "×" : "";
    const detail = receipt ? `<dl>${receipt.clientId ? `<div><dt>Client ID</dt><dd>${escapeHtml(receipt.clientId)}</dd></div>` : ""}<div><dt>SKU</dt><dd>${escapeHtml(receipt.sku)}</dd></div><div><dt>${[STATES.DUPLICATE, STATES.MULTIPLE].includes(viewState.type) ? "New Location" : "Location"}</dt><dd>${escapeHtml(receipt.location)}</dd></div>${receipt.warehouseStatus ? `<div><dt>Status</dt><dd>${escapeHtml(receipt.warehouseStatus)}</dd></div>` : ""}${receipt.savedAt ? `<div><dt>Received At</dt><dd>${escapeHtml(new Date(receipt.savedAt).toLocaleString())}</dd></div>` : ""}${receipt.serverRecordId ? `<div><dt>Server Record ID</dt><dd>${escapeHtml(receipt.serverRecordId)}</dd></div>` : ""}</dl>` : "";
    const duplicateActions = [STATES.DUPLICATE, STATES.MULTIPLE].includes(viewState.type) ? `<div class="receiving-status-actions"><button class="button" id="receiving-clear" type="button">Cancel</button><button class="button receiving-confirm" id="receiving-confirm-duplicate" type="button">${viewState.type === STATES.MULTIPLE ? "Confirm Another Physical Package" : "Confirm Duplicate Package"}</button></div>` : "";
    const retryActions = [STATES.ERROR, STATES.CONNECTION].includes(viewState.type) ? '<div class="receiving-status-actions"><button class="button" id="receiving-retry" type="button">Retry</button><button class="button" id="receiving-clear" type="button">Cancel / Clear</button></div>' : "";
    panel.innerHTML = `${symbol ? `<i class="receiving-status-symbol" aria-hidden="true">${symbol}</i>` : ""}<span>Current status</span><h3>${escapeHtml(viewState.title)}</h3><p>${escapeHtml(viewState.message)}</p>${detail}${recordCards()}${receipt && receipt.duplicateOverride ? '<span class="receiving-override">Duplicate verified by operator</span>' : ""}${duplicateActions}${retryActions}`;
  }
  function renderHistory() {
    const target = root.querySelector("#receiving-history-content"); if (!session.receipts.length) { target.innerHTML = '<div class="receiving-history-empty">No packages received on this workstation yet.</div>'; return; }
    target.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Client ID</th><th>SKU</th><th>Location</th><th>Status</th><th>Duplicate</th><th>Time</th></tr></thead><tbody>${session.receipts.map((item) => `<tr><td><strong>${escapeHtml(item.clientId||"—")}</strong></td><td class="receiving-sku-value">${escapeHtml(item.sku)}</td><td>${escapeHtml(item.location)}</td><td><span class="badge badge-success">RECEIVED</span></td><td>${item.duplicateOverride ? `<span class="badge badge-warning">VERIFIED (${Number(item.duplicateMatchCount) || 1})</span>` : "—"}</td><td>${escapeHtml(new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }))}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function inputs() { return { client:root.querySelector("#receiving-client"),sku: root.querySelector("#receiving-sku"), location: root.querySelector("#receiving-location") }; }
  function updateSubmit() { if (!root) return; const fields = inputs(); root.querySelector("#receiving-submit").disabled = pending || !clean(fields.client.value) || fields.sku.disabled || fields.location.disabled || !clean(fields.sku.value) || !validLocation(fields.location.value); }
  function setInputsDisabled(disabled) { const fields = inputs(); fields.client.disabled=disabled;fields.sku.disabled = disabled||!clean(fields.client.value); fields.location.disabled = disabled||!clean(fields.client.value)||!clean(fields.sku.value); updateSubmit(); }
  function focusSku() { window.setTimeout(() => root && root.querySelector("#receiving-sku")?.focus(), 0); }
  function focusClient() { window.setTimeout(() => root && root.querySelector("#receiving-client")?.focus(), 0); }
  function ensureDailySession() { if (session.sessionDate === localDate()) return false; session = blankSession(); if (root) { renderOverview(); renderHistory(); } return true; }
  function save() { context.storage.set(SESSION_KEY, session); }
  function currentValues() { const fields = inputs(); return { clientId:normalizeClient(),sku: clean(fields.sku.value), location: clean(fields.location.value) }; }
  function setBusy(type, title, message) { pending = true; viewState = { type, title, message, receipt: currentValues(), records: [] }; setInputsDisabled(true); renderStatus(); }

  async function startReceiving(options) {
    const settings = options || {}; if (pending || !root) return false; ensureDailySession(); save(); const values = currentValues(); const rawLocation = inputs().location.value;
    if (!values.clientId) { clientRequired(); return false; }
    if (!values.sku || !validLocation(rawLocation)) { context.toast.show(!values.sku ? "Scan a package SKU first" : "Enter a valid location without control characters"); updateSubmit(); return false; }
    const key = submissionKey(values.clientId, values.sku, values.location); const now = Date.now(); if (!settings.bypassGuard && isRepeatedSubmission(key, now, lastSubmission)) { context.toast.show("Repeated receive event ignored"); return false; }
    lastSubmission = { key, at: now }; context.audio.setEnabled(true); const run = lifecycle; setBusy(STATES.CHECKING, "Checking exact SKU...", "No package will be created until duplicate verification completes.");
    const lookup = await window.MkiteReceivingService.findExactSku(values.sku); if (!context || run !== lifecycle) return false; pending = false;
    if (!lookup.ok) { showFailure(lookup.error, values, "Duplicate check failed. Package was not created.", true); return false; }
    if (lookup.found && lookup.records.length) { showDuplicate(values, lookup.records); return false; }
    return createPackage(false, 0, run);
  }
  async function createPackage(duplicateOverride, duplicateMatchCount, existingRun) {
    if (pending || !root) return false; const values = currentValues(); const run = existingRun || lifecycle; setBusy(STATES.SAVING, "Saving package...", "Duplicate verification passed. Waiting for create confirmation.");
    const result = await window.MkiteReceivingService.receivePackage({ ...values, duplicateOverride }); if (!context || run !== lifecycle) return false; pending = false;
    if (!result.ok) { if (result.error && result.error.code === "DUPLICATE_SKU" && result.records.length) { showDuplicate(values, result.records); return false; } showFailure(result.error, values, "Package was not confirmed saved.", false); return false; }
    ensureDailySession(); const savedAt = result.data.receivedAt || new Date().toISOString(); const receipt = { localId: `receiving-${Date.now()}-${Math.random().toString(16).slice(2)}`, toolId: "receiving", clientId:result.data.clientId||values.clientId,sku: result.data.sku, location: result.data.location, status: "RECEIVED", warehouseStatus: result.data.status || "Active", createdAt: savedAt, savedAt, serverRecordId: result.data.recordId || "", duplicateOverride: Boolean(duplicateOverride), duplicateMatchCount: Number(duplicateMatchCount) || 0 };
    session.receipts.unshift(receipt); session.receipts = session.receipts.slice(0, 20); session.receivedCount += 1; session.lastLocation = receipt.location; save(); renderOverview(); renderHistory(); setInputsDisabled(true); context.audio.success(); viewState = { type: STATES.SUCCESS, title: "RECEIVED", message: window.MkiteReceivingService.mode() === "mock" ? "Mock receipt confirmed. No Feishu record was created." : "Package record confirmed by the secure API.", receipt, records: [] }; renderStatus(); resetTimer = window.setTimeout(() => { if (root) clearForm(false); }, 1300); return true;
  }
  function showDuplicate(values, records) { pending = false; ensureDailySession(); session.duplicateWarnings += 1; save(); renderOverview(); context.audio.warning(); setInputsDisabled(true); viewState = { type: records.length > 1 ? STATES.MULTIPLE : STATES.DUPLICATE, title: records.length > 1 ? "MULTIPLE EXISTING SKU RECORDS" : "DUPLICATE SKU FOUND", message: records.length > 1 ? "Multiple records use this exact SKU. Confirm only if this is another physical package." : "This SKU already exists. Verify that this is a separate physical package before creating another record.", receipt: values, records }; renderStatus(); }
  function showFailure(error, values, fallback, lookupPhase) { setInputsDisabled(false); ensureDailySession(); session.failedCount += 1; save(); renderOverview(); context.audio.failure(); const connection = error && error.code === "CONNECTION_ERROR"; viewState = { type: connection ? STATES.CONNECTION : STATES.ERROR, title: connection ? "CONNECTION ERROR" : lookupPhase ? "DUPLICATE CHECK FAILED" : "FAILED TO SAVE", message: error && error.message ? error.message : fallback, receipt: values, records: [] }; renderStatus(); updateSubmit(); }
  function clearForm(showToast = true) { if (resetTimer) window.clearTimeout(resetTimer); resetTimer = null; pending = false; const fields = inputs();fields.client.disabled=false;fields.client.value="";fields.sku.value = ""; fields.location.value = "";fields.sku.disabled=true;fields.location.disabled=true; viewState = { type: STATES.READY, title: "Ready to receive", message: "Enter or scan a Client ID to begin.", receipt: null, records: [] }; renderStatus(); updateSubmit(); focusClient(); if (showToast) context.toast.show("Receiving form cleared"); }
  function resetSession() { if (!window.confirm("Reset today's Receiving workstation session?\n\nThis clears local counters and recent activity only.\nIt does not delete warehouse records from Feishu.")) return; session = blankSession(); save(); renderOverview(); renderHistory(); clearForm(false); context.toast.show("Receiving session reset"); }
  function cleanup() { lifecycle += 1;  if (resetTimer) window.clearTimeout(resetTimer); resetTimer = null; pending = false; context = null; root = null; }

  window.MkiteInHouseTools.receiving = { render, init, cleanup, test: { clean, validLocation, submissionKey, isRepeatedSubmission, localDate, blankSession, validSession, STATES, REPEAT_GUARD_MS } };
}(window, document));

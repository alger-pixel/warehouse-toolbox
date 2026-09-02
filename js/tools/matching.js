(function (window) {
  "use strict";
  window.MkiteTools = window.MkiteTools || {};

  const SESSION_KEY = "matching.session";
  const STATUS = { READY: "READY TO SCAN", MATCHED: "MATCHED", DUPLICATE: "ALREADY SCANNED", FAILED: "FAILED MATCHING" };
  const RESULT_DELAY = { MATCHED: 1000, "ALREADY SCANNED": 1200 };

  function normalize(value) { return String(value || "").trim().toLocaleLowerCase(); }
  function uniqueKnown(text) {
    const values = new Map();
    String(text || "").split(/\r?\n/).forEach((line) => { const display = line.trim(); const key = normalize(display); if (key && !values.has(key)) values.set(key, display); });
    return values;
  }
  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character])); }
  function blankSession(knownText) { return { version: 1, knownText: knownText || "", history: [], scannedValues: [], counters: { total: 0, matched: 0, duplicate: 0, failed: 0 }, locked: false, lastFailed: "", nextNumber: 1 }; }
  function validSession(stored) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return blankSession("");
    const state = blankSession(typeof stored.knownText === "string" ? stored.knownText : "");
    state.history = Array.isArray(stored.history) ? stored.history.filter((item) => item && typeof item.input === "string") : [];
    state.scannedValues = Array.isArray(stored.scannedValues) ? [...new Set(stored.scannedValues.map(normalize).filter(Boolean))] : [];
    state.counters = state.history.reduce((counts, item) => { counts.total += 1; if (item.status === STATUS.MATCHED) counts.matched += 1; else if (item.status === STATUS.DUPLICATE) counts.duplicate += 1; else if (item.status === STATUS.FAILED) counts.failed += 1; return counts; }, { total: 0, matched: 0, duplicate: 0, failed: 0 });
    state.locked = Boolean(stored.locked); state.lastFailed = state.locked ? String(stored.lastFailed || "") : "";
    state.nextNumber = Math.max(1, ...state.history.map((item) => Number(item.number) + 1 || 1)); return state;
  }
  function decide(value, knownValues, scannedValues) {
    const key = normalize(value); if (!key) return null; if (!knownValues.has(key)) return STATUS.FAILED;
    return scannedValues.has(key) ? STATUS.DUPLICATE : STATUS.MATCHED;
  }
  function localDateParts(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`, hm: `${pad(date.getHours())}${pad(date.getMinutes())}` };
  }
  function uniqueSummary(history, knownValues) {
    const rows = new Map();
    history.slice().reverse().forEach((item) => {
      const key = normalize(item.input); if (!key) return;
      if (!rows.has(key)) rows.set(key, { input: knownValues.get(key) || String(item.input).trim(), total: 0, matched: 0, duplicate: 0, failed: 0 });
      const row = rows.get(key); row.total += 1;
      if (item.status === STATUS.MATCHED) row.matched += 1; else if (item.status === STATUS.DUPLICATE) row.duplicate += 1; else if (item.status === STATUS.FAILED) row.failed += 1;
    });
    return Array.from(rows.values());
  }
  function exportRows(state, knownValues, now) {
    const chronological = state.history.slice().reverse(); const unique = uniqueSummary(state.history, knownValues); const parts = localDateParts(now);
    const historyRows = chronological.map((item) => {
      const eventDate = item.timestamp ? new Date(item.timestamp) : null; const validDate = eventDate && !Number.isNaN(eventDate.getTime()) ? localDateParts(eventDate) : { date: "", time: item.time || "" };
      return [Number(item.number) || "", item.input, item.status, validDate.date, validDate.time];
    });
    return {
      history: [["Sequence", "Input", "Status", "Date", "Time"], ...historyRows],
      unique: [["Input", "Total Scans", "Matched", "Already Scanned", "Failed Matching"], ...unique.map((row) => [row.input, row.total, row.matched, row.duplicate, row.failed])],
      summary: [["Metric", "Value"], ["Known Items", knownValues.size], ["Total Scans", state.counters.total], ["Matched", state.counters.matched], ["Already Scanned", state.counters.duplicate], ["Failed", state.counters.failed], ["Unique Scanned Values", unique.length], ["Export Date", parts.date], ["Export Time", parts.time]],
      filename: `MKITE-Matching-${parts.date}-${parts.hm}.xlsx`
    };
  }

  window.MkiteTools.matching = {
    render() {
      return `<div class="matching-workspace tool-page workspace-stack" id="matching-workspace" data-tool-theme="matching">
        <div class="page-header matching-page-header tool-hero"><div><span class="tool-kicker">Validation tool</span><h2>Matching</h2><p>Validate scanned values against a known list.</p></div><div class="matching-header-actions tool-actions"><button class="button button-primary tool-primary-action" type="button" data-tool-action="start-scan-mode">START SCAN MODE</button><button class="button button-secondary tool-secondary-action" type="button" data-tool-action="export">EXPORT EXCEL</button></div></div>
        <div class="stats-grid matching-stats tool-overview" aria-label="Matching statistics">
          <div class="stat tool-stat"><span class="stat-label">Known Items</span><strong class="stat-value" data-stat="known">0</strong></div><div class="stat tool-stat"><span class="stat-label">Total Scans</span><strong class="stat-value" data-stat="total">0</strong></div><div class="stat tool-stat"><span class="stat-label">Matched</span><strong class="stat-value" data-stat="matched">0</strong></div><div class="stat tool-stat"><span class="stat-label">Already Scanned</span><strong class="stat-value" data-stat="duplicate">0</strong></div><div class="stat tool-stat"><span class="stat-label">Failed</span><strong class="stat-value" data-stat="failed">0</strong></div>
        </div>
        <section class="panel matching-main tool-workspace" aria-label="Matching workspace"><div class="matching-columns">
          <div class="known-panel tool-panel form-control"><div class="matching-field-header"><label for="known-box">Known List</label><span><strong data-known-count>0</strong> unique items</span></div><textarea class="textarea matching-input" id="known-box" placeholder="Paste one known value per line&#10;ABC001&#10;ABC002&#10;ABC003" spellcheck="false"></textarea><div class="known-actions"><small>Blank and duplicate lines are ignored.</small><button class="button button-neutral tool-management-action" type="button" data-tool-action="clear-known">Clear Known Box</button></div></div>
          <div class="scan-panel tool-panel"><div class="form-control"><label for="matching-scan">Scan Input</label><div class="scan-input-row"><input class="input scan-input" id="matching-scan" placeholder="Scan or enter a value" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="button button-primary" type="button" data-tool-action="check">Check</button></div></div><div class="matching-status tool-status-surface is-ready" data-matching-status role="status" aria-live="assertive" aria-atomic="true"><span class="status-kicker">Current status</span><strong class="status-title">READY TO SCAN</strong><span class="status-value">Waiting for input</span></div><div class="matching-lock" data-matching-lock hidden><strong>Scanning is locked</strong><p>A failed value must be acknowledged before scanning can continue.</p><button class="button matching-unlock" type="button" data-tool-action="unlock">ACKNOWLEDGE &amp; UNLOCK</button></div></div>
        </div></section>
        <section class="panel matching-history tool-history" aria-labelledby="matching-history-title"><div class="panel-header"><div><h3 id="matching-history-title">Scan History</h3><p>Newest scan appears first.</p></div><button class="button button-neutral tool-management-action" type="button" data-tool-action="reset">Reset Session</button></div><div class="table-wrap" data-history-table><table><thead><tr><th scope="col">#</th><th scope="col">Input</th><th scope="col">Status</th><th scope="col">Time</th></tr></thead><tbody data-history-body></tbody></table></div><div class="empty-state matching-history-empty" data-history-empty><h3>No scans yet</h3><p>Processed values will appear here.</p></div></section>
        <section class="matching-scan-mode tool-focus-mode is-ready" data-scan-mode hidden aria-label="Matching Scan Mode">
          <header class="scan-mode-header"><strong>MATCHING SCAN MODE</strong><button class="button scan-mode-exit" type="button" data-tool-action="exit-scan-mode">EXIT SCAN MODE</button></header>
          <div class="scan-mode-stats" aria-label="Scan Mode statistics"><span>KNOWN <strong data-stat="known">0</strong></span><span>TOTAL <strong data-stat="total">0</strong></span><span>MATCHED <strong data-stat="matched">0</strong></span><span>DUPLICATES <strong data-stat="duplicate">0</strong></span><span>FAILED <strong data-stat="failed">0</strong></span></div>
          <main class="scan-mode-content"><div class="scan-mode-status" role="status" aria-live="assertive" aria-atomic="true"><strong data-scan-mode-title>READY TO SCAN</strong><span data-scan-mode-value>Scan or enter a value</span></div><div class="scan-mode-entry"><label for="scan-mode-input">Scan or enter a value</label><div><input class="scan-mode-input" id="scan-mode-input" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="button scan-mode-check" type="button" data-tool-action="scan-mode-check">CHECK</button></div></div><button class="button scan-mode-unlock" type="button" data-tool-action="scan-mode-unlock" hidden>ACKNOWLEDGE &amp; UNLOCK</button></main>
        </section>
      </div>`;
    },

    init(context) {
      this.context = context; this.root = context.root; this.state = validSession(context.storage.get(SESSION_KEY, null)); this.knownValues = uniqueKnown(this.state.knownText); this.scannedValues = new Set(this.state.scannedValues); this.scanModeActive = false; this.scanModeBusy = false; this.resultTimer = null;
      this.elements = {
        workspace: this.root.querySelector("#matching-workspace"), known: this.root.querySelector("#known-box"), scan: this.root.querySelector("#matching-scan"), check: this.root.querySelector('[data-tool-action="check"]'), unlock: this.root.querySelector('[data-tool-action="unlock"]'), lock: this.root.querySelector("[data-matching-lock]"), status: this.root.querySelector("[data-matching-status]"), historyBody: this.root.querySelector("[data-history-body]"), historyTable: this.root.querySelector("[data-history-table]"), historyEmpty: this.root.querySelector("[data-history-empty]"), scanMode: this.root.querySelector("[data-scan-mode]"), scanModeInput: this.root.querySelector("#scan-mode-input"), scanModeCheck: this.root.querySelector('[data-tool-action="scan-mode-check"]'), scanModeTitle: this.root.querySelector("[data-scan-mode-title]"), scanModeValue: this.root.querySelector("[data-scan-mode-value]"), scanModeUnlock: this.root.querySelector('[data-tool-action="scan-mode-unlock"]')
      };
      this.handlers = { knownInput: () => this.handleKnownChange(), setupKeydown: (event) => this.handleScanKey(event, false), modeKeydown: (event) => this.handleScanKey(event, true), check: () => this.processScan(false), modeCheck: () => this.processScan(true), unlock: () => this.unlock(), reset: () => this.reset(), clearKnown: () => this.clearKnown(), startMode: () => this.startScanMode(), exitMode: () => this.exitScanMode(), export: () => this.exportExcel() };
      this.elements.known.value = this.state.knownText; this.elements.known.addEventListener("input", this.handlers.knownInput); this.elements.scan.addEventListener("keydown", this.handlers.setupKeydown); this.elements.scanModeInput.addEventListener("keydown", this.handlers.modeKeydown); this.elements.check.addEventListener("click", this.handlers.check); this.elements.scanModeCheck.addEventListener("click", this.handlers.modeCheck); this.elements.unlock.addEventListener("click", this.handlers.unlock); this.elements.scanModeUnlock.addEventListener("click", this.handlers.unlock);
      const actions = { reset: this.handlers.reset, "clear-known": this.handlers.clearKnown, "start-scan-mode": this.handlers.startMode, "exit-scan-mode": this.handlers.exitMode, export: this.handlers.export };
      Object.entries(actions).forEach(([name, handler]) => this.root.querySelector(`[data-tool-action="${name}"]`).addEventListener("click", handler));
      this.renderStatistics(); this.renderHistory();
      if (this.state.locked) { this.elements.scan.value = this.state.lastFailed; this.setSetupStatus(STATUS.FAILED, this.state.lastFailed); this.setLocked(true); } else { this.setSetupStatus(STATUS.READY, "Waiting for input"); this.deferFocus(false); }
    },

    handleKnownChange() { this.state.knownText = this.elements.known.value; this.knownValues = uniqueKnown(this.state.knownText); this.renderStatistics(); this.saveSession(); },
    handleScanKey(event, inScanMode) { if (event.key === "Enter") { event.preventDefault(); this.processScan(inScanMode); } },

    processScan(inScanMode) {
      if (this.state.locked || (inScanMode && this.scanModeBusy) || (inScanMode && !this.scanModeActive)) return false;
      const input = inScanMode ? this.elements.scanModeInput : this.elements.scan; const displayValue = input.value.trim(); const result = decide(displayValue, this.knownValues, this.scannedValues);
      if (!result) { this.context.toast.show("Enter or scan a value first"); this.deferFocus(inScanMode); return false; }
      const key = normalize(displayValue); const now = new Date(); this.state.counters.total += 1;
      if (result === STATUS.MATCHED) { this.scannedValues.add(key); this.state.counters.matched += 1; } else if (result === STATUS.DUPLICATE) this.state.counters.duplicate += 1; else { this.state.counters.failed += 1; this.state.locked = true; this.state.lastFailed = displayValue; }
      this.state.history.unshift({ number: this.state.nextNumber++, input: displayValue, status: result, timestamp: now.toISOString(), time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }); this.state.scannedValues = Array.from(this.scannedValues);
      this.setSetupStatus(result, displayValue); this.renderStatistics(); this.renderHistory(); this.announce(result); this.saveSession();
      if (inScanMode) this.showScanModeResult(result, displayValue); else if (result === STATUS.FAILED) this.setLocked(true); else { input.value = ""; this.deferFocus(false); }
      return result;
    },

    showScanModeResult(status, value) {
      this.clearResultTimer(); this.setScanModeStatus(status, value);
      if (status === STATUS.FAILED) { this.elements.scanModeInput.value = value; this.setLocked(true); return; }
      this.scanModeBusy = true; this.elements.scanModeInput.disabled = true; this.elements.scanModeCheck.disabled = true;
      this.resultTimer = window.setTimeout(() => { this.resultTimer = null; if (!this.elements || !this.scanModeActive || this.state.locked) return; this.scanModeBusy = false; this.elements.scanModeInput.value = ""; this.elements.scanModeInput.disabled = false; this.elements.scanModeCheck.disabled = false; this.setScanModeStatus(STATUS.READY, "Scan or enter a value"); this.deferFocus(true); }, RESULT_DELAY[status]);
    },

    startScanMode() {
      this.handleKnownChange();
      if (!this.knownValues.size) { this.context.toast.show("Add known values before starting Scan Mode."); this.elements.known.focus(); return; }
      this.scanModeActive = true; this.scanModeBusy = false; this.elements.scanMode.hidden = false; document.body.classList.add("matching-scan-mode-active");
      if (this.state.locked) { this.elements.scanModeInput.value = this.state.lastFailed; this.setScanModeStatus(STATUS.FAILED, this.state.lastFailed); this.setLocked(true); } else { this.elements.scanModeInput.value = ""; this.setScanModeStatus(STATUS.READY, "Scan or enter a value"); this.setLocked(false); this.deferFocus(true); }
    },

    exitScanMode() {
      this.clearResultTimer(); this.scanModeActive = false; this.scanModeBusy = false; this.elements.scanMode.hidden = true; document.body.classList.remove("matching-scan-mode-active");
      if (this.state.locked) { this.elements.scan.value = this.state.lastFailed; this.setSetupStatus(STATUS.FAILED, this.state.lastFailed); this.setLocked(true); } else { this.elements.scanModeInput.value = ""; this.elements.scan.disabled = false; this.elements.check.disabled = false; this.deferFocus(false); }
    },

    setScanModeStatus(status, value) {
      const className = status === STATUS.MATCHED ? "is-matched" : status === STATUS.DUPLICATE ? "is-duplicate" : status === STATUS.FAILED ? "is-failed" : "is-ready";
      this.elements.scanMode.className = `matching-scan-mode ${className}`; this.elements.scanModeTitle.textContent = status; this.elements.scanModeValue.textContent = value;
    },

    announce(status) { const phrase = status === STATUS.MATCHED ? "Matched" : status === STATUS.DUPLICATE ? "Already scanned" : "Failed matching"; this.context.audio.speak(phrase); if (status === STATUS.MATCHED) this.context.audio.success(); else if (status === STATUS.DUPLICATE) this.context.audio.warning(); else this.context.audio.failure(); },
    setSetupStatus(status, value) { const className = status === STATUS.MATCHED ? "is-matched" : status === STATUS.DUPLICATE ? "is-duplicate" : status === STATUS.FAILED ? "is-failed" : "is-ready"; this.elements.status.className = `matching-status ${className}`; this.elements.status.querySelector(".status-title").textContent = status; this.elements.status.querySelector(".status-value").textContent = value || "Waiting for input"; },

    setLocked(locked) {
      this.state.locked = locked; this.elements.scan.disabled = locked; this.elements.check.disabled = locked; this.elements.lock.hidden = !locked; this.elements.workspace.classList.toggle("is-locked", locked); this.elements.scanModeInput.disabled = locked; this.elements.scanModeCheck.disabled = locked; this.elements.scanModeUnlock.hidden = !locked;
      if (locked) (this.scanModeActive ? this.elements.scanModeUnlock : this.elements.unlock).focus();
    },

    unlock() {
      if (!this.state.locked) return; this.state.locked = false; this.state.lastFailed = ""; this.elements.scan.value = ""; this.elements.scanModeInput.value = ""; this.setLocked(false); this.setSetupStatus(STATUS.READY, "Waiting for input"); if (this.scanModeActive) this.setScanModeStatus(STATUS.READY, "Scan or enter a value"); this.saveSession(); this.deferFocus(this.scanModeActive);
    },

    reset() {
      if (!window.confirm("Reset current matching session?\nThe Known Box will be kept.")) return;
      const knownText = this.elements.known.value; this.state = blankSession(knownText); this.scannedValues = new Set(); this.elements.scan.value = ""; this.setLocked(false); this.setSetupStatus(STATUS.READY, "Waiting for input"); this.renderStatistics(); this.renderHistory(); this.saveSession(); this.context.toast.show("Matching session reset"); this.deferFocus(false);
    },
    clearKnown() { if (!this.elements.known.value.trim()) return; if (!window.confirm("Clear the Known Box?\nThis cannot be undone.")) return; this.elements.known.value = ""; this.state.knownText = ""; this.knownValues = new Map(); this.renderStatistics(); this.saveSession(); this.context.toast.show("Known Box cleared"); },

    exportExcel() {
      if (!this.state.history.length) { this.context.toast.show("No scan history to export."); return false; }
      if (!window.XLSX) { this.context.toast.show("Excel export is unavailable."); return false; }
      try {
        const data = exportRows(this.state, this.knownValues, new Date()); const workbook = window.XLSX.utils.book_new();
        const historySheet = window.XLSX.utils.aoa_to_sheet(data.history); historySheet["!cols"] = [{ wch: 11 }, { wch: 28 }, { wch: 20 }, { wch: 13 }, { wch: 12 }];
        const uniqueSheet = window.XLSX.utils.aoa_to_sheet(data.unique); uniqueSheet["!cols"] = [{ wch: 28 }, { wch: 13 }, { wch: 11 }, { wch: 18 }, { wch: 18 }];
        const summarySheet = window.XLSX.utils.aoa_to_sheet(data.summary); summarySheet["!cols"] = [{ wch: 24 }, { wch: 22 }];
        window.XLSX.utils.book_append_sheet(workbook, historySheet, "Scan History"); window.XLSX.utils.book_append_sheet(workbook, uniqueSheet, "Unique Summary"); window.XLSX.utils.book_append_sheet(workbook, summarySheet, "Session Summary"); window.XLSX.writeFile(workbook, data.filename, { compression: true }); this.context.toast.show("Excel workbook exported"); return true;
      } catch (error) { this.context.toast.show("Excel export failed."); return false; }
    },

    renderStatistics() { const values = { known: this.knownValues.size, total: this.state.counters.total, matched: this.state.counters.matched, duplicate: this.state.counters.duplicate, failed: this.state.counters.failed }; Object.entries(values).forEach(([name, value]) => this.root.querySelectorAll(`[data-stat="${name}"]`).forEach((element) => { element.textContent = value; })); this.root.querySelector("[data-known-count]").textContent = this.knownValues.size; },
    renderHistory() { this.elements.historyBody.innerHTML = this.state.history.map((item) => { const badgeClass = item.status === STATUS.MATCHED ? "badge-success" : item.status === STATUS.DUPLICATE ? "badge-warning" : "badge-danger"; return `<tr><td>${Number(item.number) || "—"}</td><td class="history-value">${escapeHtml(item.input)}</td><td><span class="badge ${badgeClass}">${escapeHtml(item.status)}</span></td><td>${escapeHtml(item.time || "")}</td></tr>`; }).join(""); const empty = this.state.history.length === 0; this.elements.historyTable.hidden = empty; this.elements.historyEmpty.hidden = !empty; },
    deferFocus(inScanMode) { window.setTimeout(() => { if (!this.elements || this.state.locked) return; if (inScanMode && this.scanModeActive) this.elements.scanModeInput.focus(); else if (!inScanMode && document.activeElement !== this.elements.known) this.elements.scan.focus(); }, 0); },
    clearResultTimer() { if (this.resultTimer) window.clearTimeout(this.resultTimer); this.resultTimer = null; },
    saveSession() { this.context.storage.set(SESSION_KEY, this.state); }, restoreSession() { return this.context ? this.context.storage.get(SESSION_KEY, null) : null; },
    cleanup() { this.clearResultTimer(); document.body.classList.remove("matching-scan-mode-active"); if (this.context && this.context.audio) this.context.audio.cancelSpeech(); this.context = null; this.root = null; this.elements = null; this.handlers = null; },

    test: { normalize, uniqueKnown, decide, uniqueSummary, exportRows, blankSession, validSession, STATUS }
  };
}(window));

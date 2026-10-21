const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const XLSX = require('../vendor/xlsx.full.min.js');

function load() {
  const bodyClasses = new Set();
  const window = { XLSX, setTimeout: callback => { callback(); return 1; }, clearTimeout() {}, confirm: () => true, MkiteTools: {} };
  const document = { activeElement: null, body: { classList: { add: value => bodyClasses.add(value), remove: value => bodyClasses.delete(value) } } };
  vm.runInNewContext(fs.readFileSync('js/tools/matching.js', 'utf8'), { window, document, Intl, Date, structuredClone });
  return { tool: window.MkiteTools.matching, window, document, bodyClasses };
}

function session(tool, knownText, events) {
  const state = tool.test.blankSession(knownText);
  state.history = events.slice().reverse().map((event, index) => ({ number: events.length - index, ...event }));
  state.scannedValues = [...new Set(events.filter(event => event.status !== tool.test.STATUS.FAILED).map(event => tool.test.normalize(event.input)))];
  state.counters = tool.test.validSession(state).counters;
  state.nextNumber = events.length + 1;
  return state;
}

function uiFixture() {
  const h = load(), removed = [], saved = [], notices = [], stats = {};
  const classSet = new Set(); const input = () => ({ value: '', disabled: false, hidden: false, focus() { this.focused = true; } });
  const statusTitle = { textContent: '' }, statusValue = { textContent: '' };
  const elements = {
    workspace: { classList: { toggle(name, on) { if (on) classSet.add(name); else classSet.delete(name); } } }, known: input(), scan: input(), check: input(), unlock: input(), lock: { hidden: true },
    status: { className: '', querySelector(selector) { return selector === '.status-title' ? statusTitle : statusValue; } }, historyBody: { innerHTML: '' }, historyTable: { hidden: false }, historyEmpty: { hidden: true },
    scanMode: { hidden: true, className: '' }, scanModeInput: input(), scanModeCheck: input(), scanModeTitle: { textContent: '' }, scanModeValue: { textContent: '' }, scanModeUnlock: input(),
    cleanResetDialog: { open: false, showModal() { this.open = true; }, close() { this.open = false; } }
  };
  const root = { querySelector(selector) { if (selector === '[data-known-count]') return stats.known ||= { textContent: '' }; return null; }, querySelectorAll(selector) { const name = selector.match(/data-stat="([^"]+)/)?.[1]; return name ? [stats[name] ||= { textContent: '' }] : []; } };
  const tool = h.tool; tool.context = { storage: { set: (key, value) => saved.push([key, structuredClone(value)]), remove: key => removed.push(key) }, toast: { show: value => notices.push(value) }, audio: { cancelSpeech() {} } };
  tool.root = root; tool.elements = elements; tool.state = tool.test.blankSession('ABC001\nABC002'); tool.knownValues = tool.test.uniqueKnown(tool.state.knownText); tool.scannedValues = new Set(); tool.scanModeActive = false; tool.scanModeBusy = false; tool.resultTimer = null;
  elements.known.value = tool.state.knownText;
  return { ...h, tool, elements, stats, saved, removed, notices, statusTitle, statusValue };
}

test('registry, route assets and Matching V2 controls remain wired to the existing tool', () => {
  const registryWindow = {}; vm.runInNewContext(fs.readFileSync('js/tools-registry.js', 'utf8'), { window: registryWindow });
  const entry = registryWindow.MkiteToolRegistry.get('matching'); assert.equal(entry.module, 'matching'); assert.equal(entry.status, 'active');
  const html = load().tool.render(); assert.match(html, /START SCAN MODE/); assert.match(html, /EXPORT EXCEL/); assert.match(html, /data-tool-action="reset">Reset Session/); assert.match(html, /CLEAN RESET MATCHING TOOL/); assert.match(html, /data-clean-reset-dialog/);
  const index = fs.readFileSync('index.html', 'utf8'); assert.match(index, /vendor\/xlsx\.full\.min\.js/); assert.match(index, /js\/tools\/matching\.js/); assert.match(index, /css\/tools\/matching\.css/);
});

test('existing normalization, match, duplicate and failed classifications remain unchanged', () => {
  const { test: api } = load().tool, known = api.uniqueKnown('  ABC001  \nabc001\n0000123\nABC002');
  assert.equal(known.size, 3); assert.equal(known.get('abc001'), 'ABC001'); assert.equal(known.get('0000123'), '0000123');
  const scanned = new Set(); assert.equal(api.decide(' abc001 ', known, scanned), api.STATUS.MATCHED); scanned.add(api.normalize('abc001'));
  assert.equal(api.decide('ABC001', known, scanned), api.STATUS.DUPLICATE); assert.equal(api.decide('XYZ999', known, scanned), api.STATUS.FAILED);
});

test('Clean Reset requires the in-tool dialog; cancel preserves state and confirmation clears everything', () => {
  const h = uiFixture(), before = structuredClone(h.tool.state); h.tool.state.history = [{ number: 1, input: 'BAD', status: h.tool.test.STATUS.FAILED, time: '4:00 PM' }]; h.tool.state.counters = { total: 1, matched: 0, duplicate: 0, failed: 1 }; h.tool.state.locked = true; h.tool.state.lastFailed = 'BAD'; h.tool.scanModeActive = true; h.elements.scan.value = 'BAD'; h.elements.scanModeInput.value = 'BAD'; h.elements.scanMode.hidden = false;
  h.tool.openCleanReset(); assert.equal(h.elements.cleanResetDialog.open, true); h.tool.closeCleanReset(); assert.equal(h.elements.cleanResetDialog.open, false); assert.equal(h.tool.state.history.length, 1); assert.equal(h.tool.state.knownText, before.knownText);
  h.tool.openCleanReset(); h.tool.cleanReset(); assert.equal(h.elements.cleanResetDialog.open, false); assert.equal(h.tool.knownValues.size, 0); assert.equal(h.tool.state.history.length, 0); assert.deepEqual(structuredClone(h.tool.state.counters), { total: 0, matched: 0, duplicate: 0, failed: 0 }); assert.equal(h.tool.state.locked, false); assert.equal(h.tool.state.lastFailed, ''); assert.equal(h.elements.known.value, ''); assert.equal(h.elements.scan.value, ''); assert.equal(h.elements.scanModeInput.value, ''); assert.equal(h.tool.scanModeActive, false); assert.equal(h.elements.scanMode.hidden, true); assert.equal(h.statusTitle.textContent, 'READY TO SCAN'); assert.equal(h.statusValue.textContent, 'Waiting for input'); assert.deepEqual(h.removed, ['matching.session']); assert.equal(h.saved.length, 0);
});

test('Reset Session retains the Known List and only resets session state', () => {
  const h = uiFixture(); h.elements.known.value = 'ABC001\nABC002'; h.tool.state.history = [{ number: 1, input: 'ABC001', status: h.tool.test.STATUS.MATCHED }]; h.tool.state.counters.total = 1; h.window.confirm = () => true;
  h.tool.reset(); assert.equal(h.tool.state.knownText, 'ABC001\nABC002'); assert.equal(h.tool.knownValues.size, 2); assert.equal(h.tool.state.history.length, 0); assert.equal(h.saved.at(-1)[0], 'matching.session'); assert.equal(h.removed.length, 0); assert.equal(h.statusTitle.textContent, 'READY TO SCAN');
});

test('SUMMARY starts from unique Known items and aggregates recognized events only', () => {
  const tool = load().tool, S = tool.test.STATUS, known = tool.test.uniqueKnown('ABC001\nABC002\nABC003\nABC004\nABC005\n abc001 ');
  const events = [
    { input: 'ABC001', status: S.MATCHED, timestamp: '2026-10-20T16:21:08' }, { input: 'ABC002', status: S.MATCHED, timestamp: '2026-10-20T16:21:15' },
    { input: ' abc001 ', status: S.DUPLICATE, timestamp: '2026-10-20T16:22:03' }, { input: 'abc001', status: S.DUPLICATE, timestamp: '2026-10-20T16:23:12' },
    { input: 'XYZ999', status: S.FAILED, timestamp: '2026-10-20T16:24:00' }
  ];
  const rows = tool.test.summaryRows(session(tool, [...known.values()].join('\n'), events).history, known); assert.equal(rows.length, 5);
  assert.deepEqual({ item: rows[0].knownItem, status: rows[0].status, count: rows[0].scanCount }, { item: 'ABC001', status: 'MULTIPLE SCAN', count: 3 });
  assert.equal(rows[0].firstScanned, '2026-10-20 16:21:08'); assert.equal(rows[0].lastScanned, '2026-10-20 16:23:12'); assert.equal(rows[0].scanTimes, '2026-10-20 16:21:08 / 2026-10-20 16:22:03 / 2026-10-20 16:23:12');
  assert.deepEqual([rows[1].status, rows[1].scanCount], ['MATCHED', 1]); assert.deepEqual([rows[2].status, rows[2].scanCount, rows[2].firstScanned, rows[2].lastScanned, rows[2].scanTimes], ['NOT FOUND', 0, '', '', '']); assert.equal(rows.some(row => row.knownItem === 'XYZ999'), false);
});

test('workbook contains exactly SCAN HISTORY and SUMMARY with correct rows and statistics', () => {
  const tool = load().tool, S = tool.test.STATUS, knownText = 'ABC001\nABC002\nABC003\nABC004\nABC005', known = tool.test.uniqueKnown(knownText);
  const events = [{ input: 'ABC001', status: S.MATCHED, timestamp: '2026-10-20T16:21:08' }, { input: 'ABC002', status: S.MATCHED, timestamp: '2026-10-20T16:21:15' }, { input: 'ABC001', status: S.DUPLICATE, timestamp: '2026-10-20T16:22:03' }, { input: 'ABC001', status: S.DUPLICATE, timestamp: '2026-10-20T16:23:12' }, { input: 'XYZ999', status: S.FAILED, timestamp: '2026-10-20T16:24:00' }];
  const artifact = tool.test.buildWorkbook(XLSX, session(tool, knownText, events), known, new Date('2026-10-20T17:00:00')); assert.deepEqual(artifact.workbook.SheetNames, ['SCAN HISTORY', 'SUMMARY']);
  const history = XLSX.utils.sheet_to_json(artifact.workbook.Sheets['SCAN HISTORY']); assert.equal(history.length, 5); assert.deepEqual(Object.keys(history[0]), ['SEQUENCE', 'SCANNED VALUE', 'STATUS', 'SCANNED TIME']); assert.equal(history.at(-1)['SCANNED VALUE'], 'XYZ999'); assert.equal(history.at(-1).STATUS, 'FAILED MATCHING');
  const summary = XLSX.utils.sheet_to_json(artifact.workbook.Sheets.SUMMARY, { header: 1, defval: '' }); assert.deepEqual(summary.slice(0, 6).map(row => row.slice(0, 2)), [['TOTAL KNOWN ITEMS', 5], ['MATCHED', 1], ['MULTIPLE SCAN', 1], ['NOT FOUND', 3], ['TOTAL SCANS', 5], ['FAILED SCANS', 1]]); assert.equal(summary[0][1], summary[1][1] + summary[2][1] + summary[3][1]); assert.deepEqual(summary[7], ['KNOWN ITEM', 'STATUS', 'SCAN COUNT', 'FIRST SCANNED', 'LAST SCANNED', 'SCAN TIMES']); assert.equal(summary.length - 8, 5);
});

test('leading-zero identities stay text and restored persistence produces the same summary', () => {
  const tool = load().tool, S = tool.test.STATUS, knownText = '0000123\nABC', events = [{ input: ' 0000123 ', status: S.MATCHED, timestamp: '2026-10-20T10:00:00' }], state = session(tool, knownText, events), restored = tool.test.validSession(structuredClone(state)), known = tool.test.uniqueKnown(restored.knownText);
  const { workbook } = tool.test.buildWorkbook(XLSX, restored, known, new Date('2026-10-20T11:00:00')); const history = workbook.Sheets['SCAN HISTORY'], summary = workbook.Sheets.SUMMARY;
  assert.equal(history.B2.t, 's'); assert.equal(history.B2.v, ' 0000123 '); assert.equal(summary.A9.t, 's'); assert.equal(summary.A9.v, '0000123'); assert.deepEqual(XLSX.utils.sheet_to_json(summary, { header: 1, defval: '' })[8].slice(0, 3), ['0000123', 'MATCHED', 1]);
});

test('full-screen Scan Mode still opens and exits with the existing Known List', () => {
  const h = uiFixture(); h.tool.startScanMode(); assert.equal(h.tool.scanModeActive, true); assert.equal(h.elements.scanMode.hidden, false); assert.equal(h.bodyClasses.has('matching-scan-mode-active'), true); assert.equal(h.elements.scanModeTitle.textContent, 'READY TO SCAN');
  h.tool.exitScanMode(); assert.equal(h.tool.scanModeActive, false); assert.equal(h.elements.scanMode.hidden, true); assert.equal(h.bodyClasses.has('matching-scan-mode-active'), false);
});

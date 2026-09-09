const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function setup(operational = true) {
  const nodes = new Map(), calls = [], notices = [];
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: '', value: '', addEventListener() {}, focus() {}, remove() {} });
    return nodes.get(id);
  };
  const document = { getElementById: node, querySelectorAll: () => [], body: { classList: { add() {}, remove() {} } } };
  const row = { id: 'row-2', trackingNumber: 'TRACK1', normalizedTracking: 'TRACK1', finalSku: 'B044-001', packageRecordId: 'rec1', printCount: 0, printStatus: 'NOT PRINTED' };
  let saved = { file: { name: 'test.xlsx' }, packages: [row], invalidRows: [], pl: { operational, pickingListNumber: 'B044-PL-20260907-0001', pickingListRecordId: 'pl1', packages: [row], succeeded: ['rec1'], failed: [] } };
  const root = { innerHTML: '', querySelectorAll: () => [] };
  const window = { setTimeout() {}, MkiteB044Picking: { async complete(input) { calls.push(input); return { status: 'Processed', completedAt: '2026-09-07T12:00:00Z', pickingListComplete: true }; } } };
  vm.runInNewContext(fs.readFileSync('js/services/package-identifier-matcher.js', 'utf8'), { window });
  vm.runInNewContext(fs.readFileSync('js/client-tools/b044/put-away-scan.js', 'utf8'), { window, document });
  const module = window.MkiteClientToolModules['b044.put-away-scan'];
  const context = { root, storage: { get: () => structuredClone(saved), set: (_, value) => { saved = structuredClone(value); }, remove: () => { saved = null; } }, audio: { setEnabled() {}, success() {}, failure() {}, warning() {} }, toast: { show: message => notices.push(message) } };
  module.init(context);
  return { tool: module._test, module, context, calls, window, root, notices };
}

test('Scan & Print requires an operational persisted PL', async () => {
  const h = setup(false);
  h.tool.openScanMode(); await h.tool.processScan('TRACK1');
  assert.match(h.root.innerHTML, /id="pas-start-scan"[^>]*disabled/);
  assert.equal(h.calls.length, 0); assert.equal(h.tool.getState().pendingPackageId, null);
});

test('printing, reprinting and wrong confirmation never complete a package; correct physical label does', async () => {
  const h = setup(); h.tool.openScanMode(); await h.tool.processScan('TRACK1');
  const row = h.tool.currentQueue()[0];
  assert.equal(row.printCount, 1); assert.equal(h.calls.length, 0);
  assert.equal(h.tool.getState().pendingPackageId, row.id);
  assert.match(h.root.innerHTML, /WAITING FOR PRINT CONFIRMATION/);
  h.tool.printService.printSingleForScan(row, true);
  assert.equal(row.printCount, 2); assert.equal(h.calls.length, 0);
  await h.tool.processScan('OTHER'); await h.tool.processScan('B044-001');
  assert.equal(h.calls.length, 0); assert.match(h.root.innerHTML, /WRONG PACKAGE CONFIRMATION/);
  await h.tool.processScan(' track1 ');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].packageRecordId, 'rec1');
  assert.equal(h.calls[0].confirmationTracking, 'track1');
  assert.equal(h.tool.getState().pendingPackageId, null);
  assert.match(h.root.innerHTML, /PICKING LIST COMPLETE/);
});

test('pending confirmation survives remount and completion failure permits retry', async () => {
  const h = setup(); await h.tool.processScan('TRACK1');
  h.module.cleanup(); h.module.init(h.context); h.tool.openScanMode();
  assert.match(h.root.innerHTML, /WAITING FOR PRINT CONFIRMATION/);
  h.window.MkiteB044Picking.complete = async () => { throw new Error('Server recheck blocked'); };
  await h.tool.processScan('TRACK1');
  assert.equal(h.tool.getState().pendingPackageId, 'row-2');
  assert.equal(h.tool.currentQueue()[0].completedAt, undefined);
  assert.match(h.root.innerHTML, /Server recheck blocked/);
});

test('frontend routes all PL requests through secure API and exports exception reasons', async () => {
  const calls = []; let workbook;
  const XLSX = require('../vendor/xlsx.full.min.js');
  const window = { XLSX: { ...XLSX, writeFile: book => { workbook = book; } }, MkiteApiConfig: { mode: 'live' }, MkiteApiClient: { post: async (path, body) => { calls.push({ path, body }); return { ok: true, data: body }; } } };
  vm.runInNewContext(fs.readFileSync('js/client-tools/b044/picking-workflow.js', 'utf8'), { window, document: {} });
  for (const action of ['prepare', 'create', 'complete', 'cancel']) await window.MkiteB044Picking[action]({ test: true });
  assert.deepEqual(calls.map(c => c.path), ['/api/b044/put-away/prepare', '/api/b044/put-away/create-picking-list', '/api/b044/put-away/complete-package', '/api/b044/put-away/cancel-picking-list']);
  window.MkiteB044Picking.exportExceptions([{ trackingNumber: '001', reason: 'NOT FOUND IN MKITE PACKAGE CLASS' }, { trackingNumber: '002', reason: 'STATUS Processing' }, { trackingNumber: '003', reason: 'AMBIGUOUS PARTIAL MATCH — MULTIPLE ACTIVE PACKAGE RECORDS' }]);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets.Exceptions);
  assert.equal(rows[2].REASON, 'AMBIGUOUS PARTIAL MATCH — MULTIPLE ACTIVE PACKAGE RECORDS');
  assert.equal(rows[0].REASON, 'NOT FOUND IN MKITE PACKAGE CLASS'); assert.equal(rows[1].REASON, 'STATUS Processing');
  const markup = window.MkiteB044Picking.a4Markup({ pickingListNumber: '<unsafe>', operational: true, packages: [], exceptions: [] });
  assert.match(markup, /size:A4/); assert.match(markup, /&lt;unsafe&gt;/); assert.match(markup, /PICKED BY/);
});

test('creation retry retains the original operation and source rows after 409 and remount; duplicate click is suppressed', async () => {
  const h = setup(); const state = h.tool.getState(); state.pl = null;
  state.prepared = { packages: state.packages, eligible: state.packages, exceptions: [] };
  h.window.confirm = () => true; h.window.crypto = { randomUUID: () => 'operation-123456789' };
  const requests = []; let rejectFirst;
  h.window.MkiteB044Picking.create = body => { requests.push(structuredClone(body)); return new Promise((resolve, reject) => { rejectFirst = reject; }); };
  const first = h.tool.createPickingList(); await h.tool.createPickingList();
  assert.equal(requests.length, 1);
  rejectFirst(new Error('PROCESSING_STATUS_NOT_AVAILABLE: configure status options')); await first;
  assert.match(h.root.innerHTML, /PROCESSING_STATUS_NOT_AVAILABLE/);
  h.module.cleanup(); h.module.init(h.context);
  h.window.MkiteB044Picking.create = async body => { requests.push(structuredClone(body)); return { operational: true, phase: 'operational', packages: [], exceptions: [], succeeded: [], failed: [] }; };
  await h.tool.createPickingList();
  assert.equal(requests.length, 2); assert.deepEqual(requests[1], requests[0]);
  assert.equal(requests[1].requestId, 'operation-123456789');
});

test('API and Picking List helper retain normalized conflict code, stage and state', async () => {
  const window = { MkiteApiConfig: { mode: 'live', baseUrl: 'https://api.example' }, fetch: async () => ({ status: 409, ok: false, json: async () => ({ ok: false, error: { code: 'PROCESSING_STATUS_NOT_AVAILABLE', message: 'Configure status options.', stage: 'CHECK_PACKAGE_SCHEMA', operationState: 'new', retryable: false } }) }) };
  vm.runInNewContext(fs.readFileSync('js/services/api-client.js', 'utf8'), { window });
  vm.runInNewContext(fs.readFileSync('js/client-tools/b044/picking-workflow.js', 'utf8'), { window, document: {} });
  await assert.rejects(window.MkiteB044Picking.create({}), error => {
    assert.equal(error.code, 'PROCESSING_STATUS_NOT_AVAILABLE'); assert.equal(error.stage, 'CHECK_PACKAGE_SCHEMA');
    assert.equal(error.operationState, 'new'); assert.match(error.message, /^PROCESSING_STATUS_NOT_AVAILABLE:/); return true;
  });
});

test('prepare stays read-only and generation requires explicit confirmation before creating', async () => {
  const h = setup(); const state = h.tool.getState(); state.pl = null;
  let creates = 0, prepares = 0;
  h.window.MkiteB044Picking.prepare = async () => { prepares++; return { packages: state.packages, eligible: state.packages, exceptions: [] }; };
  h.window.MkiteB044Picking.create = async () => { creates++; return { operational: true, phase: 'operational', pickingListNumber: 'PL-1', pickingListRecordId: 'master', packages: state.packages, exceptions: [], succeeded: ['rec1'], failed: [] }; };
  await h.tool.prepareInventory(); assert.equal(prepares, 1); assert.equal(creates, 0);
  assert.match(h.root.innerHTML, /READY TO GENERATE/); assert.match(h.root.innerHTML, /id="pas-print-a4" disabled/);
  h.window.confirm = () => false; await h.tool.createPickingList(); assert.equal(creates, 0); assert.equal(state.creationRequestId, null);
  h.window.confirm = () => true; h.window.crypto = { randomUUID: () => 'generation-request-1234' };
  await h.tool.createPickingList(); assert.equal(creates, 1);
  assert.match(h.root.innerHTML, /PICKING LIST CREATED/); assert.match(h.root.innerHTML, /Ready for Scan &amp; Print/);
  assert.doesNotMatch(h.root.innerHTML, /id="pas-remove-excel"/);
});

test('Remove Excel and confirmed Reset Page clear pre-generation local state without requests', () => {
  for (const action of ['removeExcel', 'resetSession']) {
    const h = setup(); const state = h.tool.getState(); state.pl = null;
    state.prepared = { packages: state.packages, eligible: state.packages, exceptions: [] };
    h.window.confirm = () => true; h.tool[action]();
    assert.equal(h.tool.getState().file, null); assert.equal(h.tool.getState().packages.length, 0);
    assert.equal(h.tool.getState().prepared, null); assert.equal(h.tool.getState().creationRequestId, null);
    assert.equal(h.calls.length, 0); assert.match(h.root.innerHTML, /PREPARING/);
  }
});

test('Reset Page requires confirmation and protects active or uncertain operations', () => {
  const h = setup(); h.window.confirm = () => { throw new Error('active PL must not ask to reset'); };
  h.tool.resetSession(); assert.match(h.notices.at(-1), /ACTIVE PICKING LIST EXISTS/);
  const state = h.tool.getState(); state.pl = null; state.creationRequestId = 'uncertain-operation';
  h.tool.removeExcel(); h.tool.resetSession(); assert.ok(state.file);
  state.creationRequestId = null; h.window.confirm = () => false; h.tool.resetSession(); assert.ok(state.file);
});

test('cancel uses original identity, locks A4 and Scan & Print, then permits a local reset', async () => {
  const h = setup(); const state = h.tool.getState(); state.pl.phase = 'operational'; state.creationRequestId = 'operation-123456789';
  h.window.confirm = () => true; const requests = [];
  h.window.MkiteB044Picking.cancel = async input => { requests.push(input); return { ...state.pl, phase: 'cancelled', operational: false }; };
  await h.tool.cancelPickingList();
  assert.equal(requests[0].requestId, 'operation-123456789'); assert.equal(requests[0].pickingListNumber, 'B044-PL-20260907-0001');
  assert.match(h.root.innerHTML, /PICKING LIST CANCELLED/); assert.match(h.root.innerHTML, /id="pas-start-scan"[^>]*disabled/);
  assert.match(h.root.innerHTML, /id="pas-print-a4" disabled/);
  await h.tool.processScan('TRACK1'); assert.equal(h.calls.length, 0);
  h.tool.resetSession(); assert.equal(h.tool.getState().file, null);
});

test('failed cancellation retains the operation for retry and keeps scan locked on an unknown outcome', async () => {
  const h = setup(); h.tool.getState().pl.phase = 'operational'; h.window.confirm = () => true;
  h.window.MkiteB044Picking.cancel = async () => { throw new Error('Connection lost'); };
  await h.tool.cancelPickingList();
  assert.equal(h.tool.getState().pl.phase, 'cancelling'); assert.equal(h.tool.getState().pl.operational, false);
  assert.match(h.root.innerHTML, /Retry Cancellation/); h.tool.resetSession(); assert.ok(h.tool.getState().file);
});

function foundPackagesFixture() {
  const h = setup(), state = h.tool.getState();
  state.packages = Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, trackingNumber: `TRACK${i}`, normalizedTracking: `TRACK${i}`, finalSku: 'SHARED-FINAL-SKU', packageRecordId: `rec${i}`, printStatus: 'NOT PRINTED', printCount: 0 }));
  state.totalRows = 20; state.pl.packages = state.packages.slice(0, 6).map(row => ({ ...row, eligibility: 'ELIGIBLE', packageStatus: 'Processing' }));
  state.pl.succeeded = state.pl.packages.map(row => row.packageRecordId);
  state.prepared = { packages: state.packages, eligible: state.pl.packages, exceptions: state.packages.slice(6) };
  h.tool.closeScanMode(); return h;
}

test('20 uploaded / 6 found: Step 2 table, preview, batch print and counters use six PL packages only', () => {
  const h = foundPackagesFixture();
  assert.equal(h.tool.getState().packages.length, 20); assert.equal(h.tool.currentQueue().length, 6);
  const execution = h.root.innerHTML.split('id="pas-execution-title"')[1];
  assert.doesNotMatch(execution, /TRACK6|TRACK19|Batch labels/);
  assert.equal((execution.match(/<tbody>(.*?)<\/tbody>/s)[1].match(/<tr>/g) || []).length, 6);
  assert.match(execution, /PRINT FOUND PACKAGES/); assert.match(execution, /PREVIEW FOUND PACKAGES/);
  assert.equal(h.tool.counts().printed, 0); assert.equal(h.tool.counts().remaining, 6);
  h.tool.renderPreview(); assert.equal((h.root.innerHTML.match(/class="pas-label is-preview"/g) || []).length, 6);
  assert.doesNotMatch(h.root.innerHTML, /TRACK6|TRACK19/);
  let printed;
  h.tool.printService.requestPrint = (items, after) => { printed = items; after?.(); };
  h.tool.printBatchWithDialog(); assert.equal(printed.length, 6);
  assert.ok(printed.every(row => h.tool.currentQueue().includes(row)));
  assert.equal(h.tool.counts().printed, 6); assert.equal(h.tool.counts().remaining, 6); // Print is not completion.
  assert.ok(h.tool.getState().packages.every(row => row.printCount === 0));
});

test('pending confirmation rejects Final SKU, another package and partial/contained scans without printing or completion', async () => {
  const h = foundPackagesFixture(); let prints = 0;
  h.tool.printService.requestPrint = () => { prints++; };
  h.tool.openScanMode(); await h.tool.processScan('track0');
  assert.equal(prints, 1); assert.equal(h.tool.getScanState().type, 'WAITING_FOR_PRINT_CONFIRMATION');
  assert.match(h.root.innerHTML, /LABEL PRINTED — CONFIRM PACKAGE/);
  for (const wrong of ['SHARED-FINAL-SKU', 'TRACK1', 'TRACK', 'prefix TRACK0 suffix']) {
    await h.tool.processScan(wrong);
    assert.equal(h.tool.getState().pendingPackageId, 'row-0'); assert.equal(prints, 1); assert.equal(h.calls.length, 0);
    assert.match(h.root.innerHTML, /WRONG PACKAGE CONFIRMATION/);
  }
  h.tool.printService.printSingleForScan(h.tool.currentQueue()[0], true);
  assert.equal(prints, 2); assert.equal(h.tool.getState().pendingPackageId, 'row-0');
  h.tool.printService.printSingleForScan(h.tool.currentQueue()[1], true); assert.equal(prints, 2);
  await h.tool.processScan(' TRACK0 ');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].confirmationTracking, 'TRACK0');
  assert.equal(h.tool.currentQueue()[0].packageStatus, 'Processed'); assert.equal(h.tool.counts().remaining, 5);
  assert.equal(h.tool.getState().pendingPackageId, null);
  await h.tool.processScan('TRACK0'); assert.equal(prints, 2); assert.equal(h.calls.length, 1);
  assert.match(h.root.innerHTML, /PACKAGE ALREADY COMPLETED/);
});

test('first-scan partial match remains explicit and ambiguous matches never auto-print', async () => {
  const h = foundPackagesFixture(); let prints = 0; h.tool.printService.requestPrint = () => { prints++; };
  h.tool.openScanMode(); await h.tool.processScan('prefix TRACK0 suffix');
  assert.equal(h.tool.getScanState().type, 'partial'); assert.equal(prints, 0);
  await h.tool.processScan('TRACK0 TRACK1'); assert.equal(h.tool.getScanState().type, 'multiple'); assert.equal(prints, 0);
  await h.tool.processScan('TRACK9'); assert.equal(h.tool.getScanState().type, 'not-found'); assert.equal(prints, 0);
});

test('contained confirmation prints stored identity and keeps second scan strict', async () => {
  const h = foundPackagesFixture(); let prints = 0, warnings = 0;
  h.context.audio.warning = () => warnings++;
  h.tool.printService.requestPrint = () => prints++;
  const item = h.tool.currentQueue()[0]; item.trackingNumber = 'ABC/123@B044';
  h.tool.openScanMode(); await h.tool.processScan('XXABC/123@B044YY');
  assert.equal(prints, 0); assert.equal(warnings, 1);
  assert.match(h.root.innerHTML, /POSSIBLE PACKAGE MATCH/);
  assert.match(h.root.innerHTML, /CONFIRM &amp; PRINT/);
  h.tool.confirmCandidate(item);
  assert.equal(prints, 1); assert.equal(h.tool.getState().pendingConfirmationTracking, 'ABC/123@B044');
  for (const wrong of ['XXABC/123@B044YY', '123@B044', 'TRACK1', item.finalSku]) {
    await h.tool.processScan(wrong);
    assert.equal(h.calls.length, 0); assert.equal(prints, 1);
    assert.equal(h.tool.getState().pendingConfirmationTracking, 'ABC/123@B044');
  }
  await h.tool.processScan(' ABC/123@B044 ');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].confirmationTracking, 'ABC/123@B044');
  assert.equal(h.tool.getState().pendingConfirmationTracking, null);
});

test('multiple matches print only the explicitly selected current PL candidate', async () => {
  const h = foundPackagesFixture(); let prints = 0;
  h.tool.printService.requestPrint = () => prints++;
  h.tool.openScanMode(); await h.tool.processScan('TRACK0 TRACK1');
  assert.equal(prints, 0); assert.match(h.root.innerHTML, /MULTIPLE MATCHES FOUND/);
  h.tool.selectCandidate('row-9'); assert.equal(prints, 0);
  h.tool.selectCandidate('row-1'); assert.equal(prints, 1);
  assert.equal(h.tool.getState().pendingConfirmationTracking, 'TRACK1');
  h.tool.selectCandidate('row-0'); assert.equal(prints, 1);
  assert.equal(h.tool.getState().pendingPackageId, 'row-1');
});

test('completed exact and contained candidates never automatically print', async () => {
  const h = foundPackagesFixture(); let prints = 0;
  h.tool.printService.requestPrint = () => prints++;
  h.tool.currentQueue()[0].packageStatus = 'Processed';
  h.tool.openScanMode();
  for (const scan of ['TRACK0', 'prefixTRACK0suffix']) {
    await h.tool.processScan(scan);
    assert.match(h.root.innerHTML, /PACKAGE ALREADY COMPLETED/);
    assert.equal(prints, 0); assert.equal(h.tool.getState().pendingPackageId, null);
  }
});

test('partial cancellation clears pending print confirmation and displays authoritative outcomes', async () => {
  const h = foundPackagesFixture(); let prints = 0;
  h.tool.printService.requestPrint = () => prints++;
  h.tool.getState().pl.phase = 'operational';
  h.tool.openScanMode(); await h.tool.processScan('TRACK0');
  assert.equal(h.tool.getState().pendingConfirmationTracking, 'TRACK0');
  h.window.confirm = copy => { assert.match(copy, /Already Processed packages will remain Processed/); return true; };
  h.window.MkiteB044Picking.cancel = async () => ({ ...h.tool.getState().pl, phase: 'cancelled', operational: false, message: 'PICKING LIST CANCELLED', processingReturnedToActive: 4, processedRetained: 2, skipped: 1 });
  await h.tool.cancelPickingList();
  assert.equal(h.tool.getState().pendingPackageId, null);
  assert.equal(h.tool.getState().pendingConfirmationTracking, null);
  assert.equal(h.tool.getScanState().type, 'ready');
  assert.match(h.root.innerHTML, /4 unfinished packages returned to Active/);
  assert.match(h.root.innerHTML, /2 completed packages remain Processed/);
  assert.match(h.root.innerHTML, /1 packages skipped/);
  assert.equal(h.tool.currentQueue().length, 0);
  h.tool.openScanMode(); await h.tool.processScan('TRACK0'); h.tool.printBatchWithDialog();
  assert.equal(prints, 1); assert.equal(h.calls.length, 0);
});

 test('partial PL identities alone reach preview and print while ambiguous and missing source rows stay excluded', () => {
  const h = foundPackagesFixture(), state = h.tool.getState();
  state.pl.packages[0].trackingNumber = '875539379028';
  state.pl.packages[0].normalizedTracking = '875539379028';
  state.pl.packages[0].sourceTrackingNumber = 'ABC875539379028XYZ';
  state.pl.packages[0].matchType = 'PARTIAL';
  state.prepared.exceptions[0].eligibility = 'AMBIGUOUS';
  state.prepared.exceptions[1].eligibility = 'NOT_FOUND';
  h.tool.renderPreview(); assert.match(h.root.innerHTML, /875539379028/);
  assert.doesNotMatch(h.root.innerHTML, /ABC875539379028XYZ|TRACK6|TRACK7/);
  let printed; h.tool.printService.requestPrint = items => { printed = items; };
  h.tool.printBatchWithDialog();
  assert.equal(printed.length, 6); assert.equal(printed[0].trackingNumber, '875539379028');
  assert.ok(printed.every(row => row.eligibility === 'ELIGIBLE'));
});

for(const dateHeader of ['到仓日期','登记时间'])test(`${dateHeader} and optional 操作指令 preserve source command text`,()=>{
 const h=setup(),XLSX=require('../vendor/xlsx.full.min.js');h.window.XLSX=XLSX;
 for(const command of [undefined,'   ','  补螺栓 <原样>\nM8LS-14-BS  ']){
 const headers=[dateHeader,'跟踪号','入库SKU','仓库入库单号',...(command===undefined?[]:['操作指令'])];
 const parsed=h.tool.parseWorksheet(XLSX.utils.aoa_to_sheet([headers,['2026-09-09','TRACK','SKU','RMAB044-1',command]]));
 assert.equal(parsed.missingHeaders.length,0);assert.equal(parsed.packages[0].arrivalDate,'2026-09-09');
 assert.equal(parsed.packages[0].commandRaw,command?.trim()?command:'');assert.equal(parsed.packages[0].commanded,Boolean(command?.trim()));
 assert.equal(parsed.packages[0].commandAiStatus,command?.trim()?'PENDING':'NOT_REQUIRED');
 }
});
test('populated 登记时间 wins; blank 登记时间 falls back to 到仓日期',()=>{
 const h=setup(),XLSX=require('../vendor/xlsx.full.min.js');h.window.XLSX=XLSX;
 const p=h.tool.parseWorksheet(XLSX.utils.aoa_to_sheet([['到仓日期','登记时间','跟踪号','入库SKU','仓库入库单号'],['2026-09-01','2026-09-09','A','SKU','RMAB044-1'],['2026-09-02','','B','SKU','RMAB044-1']]));
 assert.deepEqual(Array.from(p.packages,r=>r.arrivalDate),['2026-09-09','2026-09-02']);
});
test('command preparation deduplicates, caches across remount, and falls back without blocking inventory',async()=>{
 const h=setup(),state=h.tool.getState();state.pl=null;state.packages=Array.from({length:20},(_,i)=>({id:'row-'+i,commandRaw:'  补说明书  ',commandAiStatus:'PENDING'}));
 let calls=0;h.window.MkiteApiClient={post:async()=>{calls++;return {ok:true,data:{commandDisplay:'补说明书',commandAiStatus:'SIMPLIFIED',commandReference:'REF-1'}};}};
 await h.tool.prepareCommands();assert.equal(calls,1);assert.ok(state.packages.every(r=>r.commandRaw==='  补说明书  '&&r.commandDisplay==='补说明书'));
 h.module.cleanup();h.module.init(h.context);await h.tool.prepareCommands();assert.equal(calls,1);
 h.tool.getState().packages.push({id:'other',commandRaw:'不同指令'});h.window.MkiteApiClient.post=async()=>{throw Error('offline');};
 h.window.MkiteB044Picking.prepare=async({rows})=>({packages:rows,eligible:rows,exceptions:[]});
 await h.tool.prepareInventory();assert.equal(h.tool.getState().prepared.eligible.length,21);assert.equal(h.tool.getState().packages.at(-1).commandDisplay,'不同指令');assert.equal(h.tool.getState().packages.at(-1).commandAiStatus,'FALLBACK');
});
test('command preparation caps unique calls and concurrency; successful cache entries are not retried',async()=>{
 const h=setup(),state=h.tool.getState();state.pl=null;state.packages=Array.from({length:15},(_,i)=>({commandRaw:'command-'+i}));
 let calls=0,active=0,max=0;h.window.MkiteApiClient={post:async(_,body)=>{calls++;max=Math.max(max,++active);await new Promise(resolve=>setImmediate(resolve));active--;return {ok:true,data:{commandAiStatus:'SIMPLIFIED',commandDisplay:body.command}};}};
 await h.tool.prepareCommands();assert.equal(calls,10);assert.equal(max,2);assert.equal(state.packages.filter(r=>r.commandAiStatus==='FALLBACK').length,5);
 await h.tool.prepareCommands();assert.equal(calls,10);await h.tool.prepareCommands(true);assert.equal(calls,15);
});
test('normal prints one page; commanded prints original then safe command pages and one strict confirmation',async()=>{
 const h=setup(),row=h.tool.currentQueue()[0];
 assert.equal((h.tool.packageLabels(row,false).match(/<article/g)||[]).length,1);
 Object.assign(row,{commandRaw:'<script>原始</script>',commandDisplay:'补说明书',commandReference:'REF-1'});
 const html=h.tool.packageLabels(row,false);assert.equal((html.match(/<article/g)||[]).length,2);assert.ok(html.indexOf('pas-label-section')<html.indexOf('pas-command-label'));assert.match(html,/COMMAND/);assert.match(html,/TRACKING:<\/dt><dd>TRACK1/);assert.match(html.replace(/<[^>]+>/g,'').replace(/\s/g,''),/REF:REF-1/);
 row.commandDisplay='';assert.match(h.tool.packageLabels(row,false),/&lt;script/);assert.doesNotMatch(h.tool.packageLabels(row,false),/<script>/);
 h.tool.openScanMode();await h.tool.processScan('TRACK1');assert.equal(row.printCount,1);assert.equal(h.calls.length,0);
 await h.tool.processScan('PREFIX-TRACK1');assert.equal(h.calls.length,0);await h.tool.processScan('TRACK1');assert.equal(h.calls.length,1);assert.equal(h.tool.getState().pendingPackageId,null);
});
test('long command continues at readable font sizes without dropping text; preview shows page count',()=>{
 const h=setup(),row=h.tool.currentQueue()[0];row.commandRaw='中'.repeat(800)+'END';
 const pages=h.tool.commandPages(row);assert.ok(pages.length>1);assert.ok(pages.every(p=>p.size>=20));assert.equal(pages.map(p=>p.text.replace(/\n/g,'')).join(''),row.commandRaw);
 assert.match(h.tool.commandLabelMarkup(row,false),/COMMAND 1\//);h.tool.renderPreview();assert.match(h.root.innerHTML,/Package Label \+ Command Label/);
 const css=fs.readFileSync('css/client-tools/b044-put-away-scan.css','utf8');assert.match(css,/pas-label\.pas-command-label[^}]*overflow:visible/);
});
test('A4 commanded rows display organized or raw text safely and exclude exceptions',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('js/client-tools/b044/picking-workflow.js','utf8'),{window,document:{}});
 const row={sequence:1,commandRaw:'<raw>&',commandDisplay:'organized',trackingNumber:'TRACK',commandReference:'REF-1'};
 const pl={packages:[row],exceptions:[{commandRaw:'DO NOT PRINT EXCEPTION'}],operational:true};
 let html=window.MkiteB044Picking.a4Markup(pl);assert.match(html,/class="commanded"/);assert.match(html,/COMMANDED/);assert.match(html,/organized/);assert.match(html,/REF-1/);assert.doesNotMatch(html,/DO NOT PRINT EXCEPTION/);
 row.commandDisplay='';html=window.MkiteB044Picking.a4Markup(pl);assert.match(html,/&lt;raw&gt;&amp;/);assert.doesNotMatch(html,/<raw>/);
});

test('long A4 commands use compact row plus complete printable appendix',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('js/client-tools/b044/picking-workflow.js','utf8'),{window,document:{}});
 const raw='完整原始操作'.repeat(200)+'LAST REQUIREMENT';
 const html=window.MkiteB044Picking.a4Markup({packages:[{sequence:1,commandRaw:raw}],exceptions:[],operational:true});
 assert.match(html,/CONTINUED IN COMMAND APPENDIX/);assert.match(html,/class="command-appendix"/);assert.ok(html.includes(raw));
});

test('AI preparation summary separates counts, completion, review note and optional retry',()=>{
 const h=setup(),state=h.tool.getState();state.pl=null;
 state.packages=['SIMPLIFIED','SIMPLIFIED','FALLBACK','PENDING','FAILED'].map(commandAiStatus=>({commandRaw:'command',commandAiStatus}));
 let html=h.tool.commandSummary();
 for(const [label,count] of [['COMMAND PACKAGES',5],['Simplified',2],['Raw Fallback',1],['Pending',1],['Failed / Retryable',1]])assert.ok(html.includes(`<dt>${label}</dt><dd>${count}</dd>`));
 assert.match(html,/Processing commands/);assert.match(html,/AI-organized instructions should be reviewed before printing/);assert.match(html,/generate the Picking List without retrying/);assert.match(html,/RETRY COMMAND SIMPLIFICATION/);
 state.packages.forEach(r=>r.commandAiStatus='SIMPLIFIED');html=h.tool.commandSummary();assert.match(html,/is-complete/);assert.doesNotMatch(html,/id="pas-retry-commands"/);
 state.packages[0].commandAiStatus='FALLBACK';html=h.tool.commandSummary();assert.match(html,/Complete — raw instructions retained/);assert.match(html,/id="pas-retry-commands"/);
 state.creationRequestId='existing';assert.doesNotMatch(h.tool.commandSummary(),/id="pas-retry-commands"/);
});
test('explicit command retry calls only FAILED/FALLBACK and displays pending during request',async()=>{
 const h=setup(),state=h.tool.getState();state.pl=null;
 state.packages=['SIMPLIFIED','FALLBACK','FAILED','PENDING'].map((commandAiStatus,i)=>({commandRaw:'command-'+i,commandAiStatus}));
 state.commandCache=state.packages.slice(0,3).map(r=>[r.commandRaw,{commandAiStatus:r.commandAiStatus,commandDisplay:r.commandRaw}]);
 const calls=[];h.window.MkiteApiClient={post:async(_,body)=>{calls.push(body.command);assert.match(h.tool.commandSummary(),/Processing commands/);return {ok:true,data:{commandAiStatus:'SIMPLIFIED',commandDisplay:body.command}};}};
 await h.tool.prepareCommands(true);assert.deepEqual(calls.sort(),['command-1','command-2']);assert.equal(state.packages[3].commandAiStatus,'PENDING');assert.equal(state.packages[0].commandAiStatus,'SIMPLIFIED');
});
test('captioned command preview lists every label in package-first order without altering print markup',()=>{
 const h=setup(),row=h.tool.currentQueue()[0];row.commandRaw='补说明书'.repeat(120);row.commandReference='FD-B044-260908-0001';
 const pages=h.tool.commandPages(row).length,preview=h.tool.packageLabels(row,true),print=h.tool.packageLabels(row,false);
 assert.equal((preview.match(/<figcaption>Package Label/g)||[]).length,1);assert.equal((preview.match(/<figcaption>Command Label/g)||[]).length,pages);assert.ok(preview.indexOf('Package Label')<preview.indexOf('Command Label'));
 assert.doesNotMatch(print,/<figure|<figcaption/);assert.equal((print.match(/<article/g)||[]).length,pages+1);assert.match(print,/TRACKING:<\/dt><dd>TRACK1/);
});

test('command label repeats bold tracking and warehouse order in every fixed 4x6 continuation',()=>{
 const h=setup(),row={...h.tool.currentQueue()[0],trackingNumber:'1ZR09J502019436973',warehouseInboundOrder:'RMAB044-260902-0002',commandRaw:'补螺栓+补说明书\n'.repeat(60),commandReference:'FD-B044-260902-0001'};
 const pages=h.tool.commandPages(row),html=h.tool.commandLabelMarkup(row,false);assert.ok(pages.length>1);
 assert.equal((html.match(/class="pas-label pas-command-label"/g)||[]).length,pages.length);
 assert.equal((html.match(/1ZR09J502019436973/g)||[]).length,pages.length);assert.equal((html.match(/RMAB044-260902-0002/g)||[]).length,pages.length);
 assert.ok(html.indexOf('COMMAND 1/')<html.indexOf('TRACKING:'));assert.ok(html.indexOf('WAREHOUSE ORDER:')<html.indexOf('pas-command-content'));
 assert.ok(pages.every(p=>p.size>=20));assert.equal(pages.map(p=>p.reference).filter(Boolean).join(''),'FD-B044-260902-0001');
 const css=fs.readFileSync('css/client-tools/b044-put-away-scan.css','utf8');assert.match(css,/\.pas-label\.pas-command-label \{[^}]*width:4in; height:6in/);assert.match(css,/\.pas-label\.pas-command-label\.is-preview \{[^}]*width:4in; height:6in; aspect-ratio:2\/3/);assert.match(css,/body\.pas-printing \.pas-command-label \{[^}]*width:4in; height:6in/);
});
test('mixed-language command keeps common model and reference codes intact with separate REF section',()=>{
 const h=setup(),row={trackingNumber:'TRACK',warehouseInboundOrder:'ORDER',commandRaw:'原文',commandDisplay:'换箱CARTON-405-250-295\n补螺栓+补说明书\nM8LS-14-BS',commandReference:'FD-B044-260902-0001'};
 const pages=h.tool.commandPages(row),html=h.tool.commandLabelMarkup(row,false);
 for(const code of ['CARTON-405-250-295','M8LS-14-BS'])assert.ok(pages.some(p=>p.text.includes(code)),code);
 assert.ok(pages.some(p=>p.reference==='FD-B044-260902-0001'));assert.match(html,/class="pas-command-reference"/);assert.doesNotMatch(pages.map(p=>p.text).join(''),/FD-B044/);
 delete row.commandReference;assert.doesNotMatch(h.tool.commandLabelMarkup(row,false),/pas-command-reference|REF:/);
 row.commandDisplay='';row.commandRaw='<换箱>&"';assert.match(h.tool.commandLabelMarkup(row,false),/&lt;换箱&gt;&amp;&quot;/);assert.doesNotMatch(h.tool.commandLabelMarkup(row,false),/<换箱>/);
});
test('short command stays very large and common codes have no forced hyphen fragments',()=>{
 const h=setup();assert.equal(h.tool.commandPages({commandRaw:'换箱'})[0].size,30);
 for(const code of ['CARTON-405-250-295','M8LS-14-BS','FD-B044-260908-0001']){
  const pages=h.tool.commandPages({commandRaw:'换箱'+code});assert.ok(pages.some(p=>p.text.includes(code)));assert.ok(pages.every(p=>p.size>=20));
 }
 const css=fs.readFileSync('css/client-tools/b044-put-away-scan.css','utf8');assert.match(css,/\.pas-command-content pre \{[^}]*overflow-wrap:break-word; word-break:normal/);assert.doesNotMatch(css,/\.pas-command[^}]*break-all/);
});
test('normal label stays byte-identical as first label of a commanded package',()=>{
 const h=setup(),row={...h.tool.currentQueue()[0],warehouseInboundOrder:'RMAB044-260902-0002'};
 const normal=h.tool.packageLabels(row,false),commanded=h.tool.packageLabels({...row,commandRaw:'换箱'},false);
 assert.equal(commanded.slice(0,normal.length),normal);assert.equal((normal.match(/<article/g)||[]).length,1);assert.match(commanded.slice(normal.length),/pas-command-label/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createB044PutAwayService, normalizeRows } from '../src/modules/b044-put-away/put-away-service.js';
import { createPickingListService } from '../src/modules/picking-lists/picking-list-service.js';
import { createFeishuAttachmentService } from '../src/services/feishu-attachment-service.js';
import { createPackageActivityService, PACKAGE_ACTION_TYPES as A } from '../src/services/package-activity-service.js';
import { generateDetailXlsx } from '../src/services/excel-service.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const XLSX = require('../../vendor/xlsx.full.min.js');
const config = { appToken: 'base', packageTableId: 'packages', pickingListTableId: 'lists', warehouseTimeZone: 'America/Toronto' };
const source = trackingNumber => ({ trackingNumber, arrivalDate: '2026-09-05', inboundSku: 'ABC', warehouseInboundOrder: 'RMAB044-1', excelRow: 2 });
const packageRecord = (sku, status = 'Active', location = 'A-2') => ({ record_id: `rec-${sku}`, fields: { SKU: sku, STATUS: status, LOCATION: location, 'CLIENT ID': 'B044', 'DATE OF RECEIVED': 123, NOTE: 'old history' } });
function fixture(packages = [packageRecord('A')]) {
  const data = new Map(packages.map(r => [r.record_id, structuredClone(r)])); const events = []; const memory = new Map();
  const storage = { async get(k) { return structuredClone(memory.get(k)); }, async put(k, v) { memory.set(k, structuredClone(v)); } };
  const records = {
    async listFields() { return [{ field_name: 'PART USED', type: 1 }, { field_name: 'STATUS', type: 3, property: { options: ['Active', 'Processing', 'Processed'].map(name => ({ name })) } }]; },
    async listRecords({ tableId }) { events.push('list-' + tableId); return [...data.values()].filter(r => tableId === 'packages' ? r.record_id.startsWith('rec-') : r.record_id.startsWith('pl-')).map(r => structuredClone(r)); },
    async getRecord({ recordId }) { return structuredClone(data.get(recordId) || {}); },
    async createRecord({ fields }) { events.push('master'); const count = events.filter(e => e === 'master').length; const record = { record_id: count === 1 ? 'pl-master' : `pl-master-${count}`, fields }; data.set(record.record_id, structuredClone(record)); return record; },
    async updateRecord({ recordId, fields }) { events.push({ recordId, fields }); Object.assign(data.get(recordId).fields, fields); return structuredClone(data.get(recordId)); }
  };
  const pickingLists = createPickingListService(config, records);
  const service = () => createB044PutAwayService(config, records, pickingLists, storage, { now: () => Date.parse('2026-09-05T20:21:00Z') });
  const input = { requestId: 'request-1234567890', rows: packages.map(r => source(r.fields.SKU)), sourceFile: 'source.xlsx', totalSourceRows: packages.length };
  return { data, events, storage, memory, records, pickingLists, service, input };
}
test('prepare exact normalized matching classifies Active, blocked, missing and ambiguous without writes', async () => {
  const f = fixture([packageRecord('A'), packageRecord('B', 'Processing'), packageRecord('D'), { ...packageRecord('D'), record_id: 'rec-duplicate' }]);
  const result = await f.service().prepare({ rows: [' a ', 'B', 'C', 'D', 'ZZ'].map(source) });
  assert.deepEqual(result.packages.map(r => r.eligibility), ['ELIGIBLE', 'BLOCKED_STATUS', 'NOT_FOUND', 'AMBIGUOUS', 'NOT_FOUND']);
  assert.equal(result.exceptions[0].reason, 'STATUS Processing'); assert.equal(result.exceptions[1].reason, 'NOT FOUND IN MKITE PACKAGE CLASS'); assert.match(result.exceptions[2].reason, /MULTIPLE/);
  assert.deepEqual(f.events, ['list-packages']); assert.equal(f.memory.size, 0);
});
test('server derives Final SKU and rejects invalid/duplicate source identifiers', () => {
  assert.equal(normalizeRows([{ ...source('A'), finalSku: 'FORGED' }])[0].finalSku, 'B044-ABC');
  assert.throws(() => normalizeRows([source('A'), source(' a ')]), /Duplicate/); assert.throws(() => normalizeRows([{ ...source('A'), warehouseInboundOrder: 'BAD' }]), /Unsupported/);
});
test('master text precedes Processing, updates only STATUS/NOTE and uses natural ordering', async () => {
  const f = fixture([packageRecord('A', 'Active', 'A-10'), packageRecord('B', 'Active', 'A-2')]); const result = await f.service().create(f.input);
  assert.equal(result.operational, true); assert.equal(result.pickingListNumber, 'B044-PL-20260905-0001'); assert.deepEqual(result.packages.map(r => r.trackingNumber), ['B', 'A']);
  assert.equal(typeof f.data.get('pl-master').fields['PICKING LIST DETAIL'], 'string'); assert.ok(f.events.indexOf('master') < f.events.findIndex(e => e.fields));
  for (const event of f.events.filter(e => e.fields)) { assert.deepEqual(Object.keys(event.fields).sort(), ['NOTE', 'STATUS']); assert.equal(event.fields.STATUS, 'Processing'); assert.equal(event.fields.NOTE, 'old history\n2026/09/05 16:21 - B044 SCAN PUT AWAY TOOL: PL NUMBER: B044-PL-20260905-0001 - CREATED'); }
  assert.deepEqual(Object.keys(f.data.get('pl-master').fields).sort(), ['PICKING LIST DETAIL', 'PICKING LIST NUMBER']);
  assert.equal((await f.service().create(f.input)).pickingListRecordId, result.pickingListRecordId); assert.equal(f.events.filter(e => e === 'master').length, 1);
});
for (const phase of ['master']) test(`${phase} failure blocks scanning and leaves packages Active`, async () => {
  const f = fixture(); f.records.createRecord = async () => { throw new Error('create failed'); };
  const result = await f.service().create(f.input); assert.equal(result.operational, false); assert.equal(result.phase, 'blocked'); assert.equal(f.data.get('rec-A').fields.STATUS, 'Active');
  await f.service().create(f.input); assert.equal(f.events.filter(e => e.fields).length, 0);
});
test('partial assignment reports successes/failures and retries same master safely', async () => {
  const f = fixture([packageRecord('A'), packageRecord('B')]); const update = f.records.updateRecord; let broken = true;
  f.records.updateRecord = async args => { if (args.recordId === 'rec-B' && broken) throw new Error('failed'); return update(args); };
  const first = await f.service().create(f.input); assert.equal(first.operational, false); assert.deepEqual(first.succeeded, ['rec-A']); assert.equal(first.failed[0].packageRecordId, 'rec-B');
  broken = false; const second = await f.service().create(f.input); assert.equal(second.operational, true); assert.equal(f.events.filter(e => e === 'master').length, 1); assert.equal(f.data.get('rec-A').fields.NOTE.split('CREATED').length, 2);
});
test('bounded assignment chunks stay blocked until the final chunk', async () => {
  const f = fixture(Array.from({ length: 10 }, (_, i) => packageRecord(String(i)))); const first = await f.service().create(f.input); assert.equal(first.operational, false); assert.equal(first.pendingCount, 2);
  assert.equal((await f.service().create(f.input)).operational, true); assert.equal(f.events.filter(e => e === 'master').length, 1);
});
test('completion validates server snapshot, exact tracking confirmation, status and immutable detail', async () => {
  const f = fixture(); const pl = await f.service().create(f.input); const detail = structuredClone(f.data.get('pl-master'));
  const input = { pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: 'rec-A', trackingNumber: 'A', confirmationTracking: 'A' };
  for (const changes of [{ confirmationTracking: 'B044-ABC' }, { confirmationTracking: 'OTHER' }, { confirmationTracking: 'PREFIX-A-SUFFIX' }, { confirmationTracking: '' }, { confirmationTracking: undefined, expectedFinalSku: 'B044-ABC', confirmationSku: 'B044-ABC' }, { packageRecordId: 'rec-other' }, { pickingListRecordId: 'other' }]) await assert.rejects(f.service().complete({ ...input, ...changes }));
  assert.equal(f.data.get('rec-A').fields.STATUS, 'Processing');
  const done = await f.service().complete(input); assert.equal(done.pickingListComplete, true); assert.equal(f.data.get('rec-A').fields.STATUS, 'Processed'); assert.match(f.data.get('rec-A').fields.NOTE, / - DONE PUTTING AWAY$/);
  const note = f.data.get('rec-A').fields.NOTE; await f.service().complete(input); assert.equal(f.data.get('rec-A').fields.NOTE, note); assert.ok(f.data.get('pl-master').fields['PICKING LIST DETAIL'].startsWith(detail.fields['PICKING LIST DETAIL'])); assert.equal(f.data.get('pl-master').fields['PICKING LIST DETAIL'].match(/COMPLETION:/g).length, 1);
});
test('missing STATUS field returns schema error before mutation', async () => {
  const f = fixture(); f.records.listFields = async () => []; await assert.rejects(f.service().create(f.input), e => e.code === 'PACKAGE_STATUS_SCHEMA_ERROR'); assert.equal(f.events.length, 0);
});
test('lost update acknowledgement is recovered by rereading status and exact PL NOTE', async () => {
  const f = fixture(); const update = f.records.updateRecord; let once = true;
  f.records.updateRecord = async args => { const result = await update(args); if (once) { once = false; throw new Error('lost acknowledgement'); } return result; };
  assert.equal((await f.service().create(f.input)).operational, false); assert.equal((await f.service().create(f.input)).operational, true); assert.equal(f.events.filter(e => e.fields).length, 1);
});
test('creation request cannot be reused for different rows', async () => {
  const f = fixture(); await f.service().create(f.input); await assert.rejects(f.service().create({ ...f.input, rows: [source('B')] }), e => e.code === 'REQUEST_ID_CONFLICT');
});
test('generic number collision retries and generic XLSX supports arbitrary columns and literal text', async () => {
  const values = ['CLASH', 'NEXT']; const service = createPickingListService(config, { listRecords: async () => [{ fields: { 'PICKING LIST NUMBER': 'OTHER-PL-20260905-CLASH' } }] }, { randomId: () => values.shift() });
  assert.equal(await service.nextNumber('OTHER', '20260905'), 'OTHER-PL-20260905-NEXT');
  const bytes = generateDetailXlsx({ columns: [{ key: 'text', title: '自由文本' }, { key: 'code', title: 'Code' }], rows: [{ text: '=1+1 & <test>', code: '00123' }] });
  const sheet = XLSX.read(bytes, { type: 'array' }).Sheets['Picking List']; assert.equal(sheet.A2.v, '=1+1 & <test>'); assert.equal(sheet.A2.f, undefined); assert.equal(sheet.B2.v, '00123');
});
test('official attachment multipart upload returns file token and preserves byte size', async () => {
  const bytes = generateDetailXlsx({ columns: [{ key: 'x', title: 'X' }], rows: [{ x: 'value' }] });
  const service = createFeishuAttachmentService({ getTenantAccessToken: async () => 'test-token' }, { fetchImpl: async (url, init) => {
    assert.equal(url, 'https://open.feishu.cn/open-apis/drive/v1/medias/upload_all'); assert.equal(init.headers['Content-Type'], undefined); assert.equal(init.body.get('parent_type'), 'bitable_file'); assert.equal(init.body.get('parent_node'), 'base'); assert.equal(init.body.get('file').size, bytes.length); assert.equal(init.body.get('size'), String(bytes.length));
    return Response.json({ code: 0, data: { file_token: 'token' } });
  } }); assert.equal(await service.upload({ appToken: 'base', fileName: 'detail.xlsx', bytes }), 'token');
});
test('B044 actions retain future audit context and exact 24-hour NOTE formats', () => {
  const activity = createPackageActivityService(); const details = { pickingListNumber: 'B044-PL-20260905-0001', packageRecordId: 'rec-A', clientId: 'B044', sku: 'A', toolId: 'b044.put-away-scan', fromStatus: 'Processing', toStatus: 'Processed' };
  const action = activity.createAction(A.B044_PUTAWAY_COMPLETED, details, '2026-09-05T21:00:00Z'); assert.equal(action.packageRecordId, 'rec-A'); assert.equal(action.toStatus, 'Processed'); assert.equal(activity.formatActivityLine(action), '2026/09/05 17:00 - B044 SCAN PUT AWAY TOOL: PL NUMBER: B044-PL-20260905-0001 - DONE PUTTING AWAY');
});

test('default PL numbers use four digits, skip existing numbers and block exhausted dates', async () => {
  const existing = ['0001', '0003'].map(n => ({ fields: { 'PICKING LIST NUMBER': `B044-PL-20260905-${n}` } }));
  const records = { listRecords: async () => existing };
  const service = createPickingListService(config, records, {});
  assert.equal(await service.nextNumber('B044', '20260905'), 'B044-PL-20260905-0002');
  assert.equal(await service.nextNumber('B044', '20260906'), 'B044-PL-20260906-0001');
  existing.splice(0, existing.length, ...Array.from({ length: 9999 }, (_, i) => ({ fields: { 'PICKING LIST NUMBER': `B044-PL-20260905-${String(i + 1).padStart(4, '0')}` } })));
  await assert.rejects(service.nextNumber('B044', '20260905'), e => e.code === 'PL_NUMBER_COLLISION');
});

test('unconfirmed text persistence cannot transition packages', async () => {
  const f = fixture(); const create = f.records.createRecord;
  f.records.createRecord = async args => create({ ...args, fields: { ...args.fields, 'PICKING LIST DETAIL': [] } });
  const result = await f.service().create(f.input);
  assert.equal(result.phase, 'blocked'); assert.equal(f.data.get('rec-A').fields.STATUS, 'Active');
});

test('completion rejects changed record identity, SKU, status or PL ownership before writes', async () => {
  for (const change of [{ STATUS: 'Active' }, { STATUS: 'Inactive' }, { SKU: 'OTHER' }, { NOTE: 'another picking list' }]) {
    const f = fixture(); const pl = await f.service().create(f.input);
    Object.assign(f.data.get('rec-A').fields, change);
    const before = structuredClone(f.data.get('rec-A'));
    await assert.rejects(f.service().complete({ pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: 'rec-A', trackingNumber: 'A', confirmationTracking: 'A' }), e => e.code === 'PACKAGE_CHANGED');
    assert.deepEqual(f.data.get('rec-A'), before);
  }
});

test('B044 detail text preserves domain snapshot and sorted sequence', async () => {
  const f = fixture(); await f.service().create(f.input);
  const detail = f.data.get('pl-master').fields['PICKING LIST DETAIL'];
  assert.match(detail, /PL NUMBER: B044-PL-20260905-0001/);
  assert.match(detail, /CREATED: 2026\/09\/05 16:21/);
  assert.match(detail, /STATUS: CREATED/);
  assert.match(detail, /\[001\]\nPACKAGE ID: rec-A\nSKU: A\nLOCATION: A-2\nPUT AWAY SKU: B044-ABC\nWAREHOUSE ORDER: RMAB044-1/);
});

test('missing Picking List table configuration blocks generic persistence', async () => {
  const service = createPickingListService({ ...config, pickingListTableId: '' }, {}, {});
  await assert.rejects(service.nextNumber('B044', '20260905'), e => e.code === 'PICKING_LIST_NOT_CONFIGURED');
  await assert.rejects(service.persist({}, {}), e => e.code === 'PICKING_LIST_NOT_CONFIGURED');
});

test('attachment rejection or missing token cannot report upload success', async () => {
  for (const payload of [{ code: 1 }, { code: 0, data: {} }]) {
    const attachments = createFeishuAttachmentService({ getTenantAccessToken: async () => 'token' }, { fetchImpl: async () => Response.json(payload) });
    await assert.rejects(attachments.upload({ appToken: 'base', fileName: 'test.xlsx', bytes: new Uint8Array([1]) }));
  }
});

test('malformed B044 input is rejected as validation failure', async () => {
  const f = fixture();
  for (const method of ['prepare', 'create', 'complete']) for (const input of [null, [], 'text']) await assert.rejects(f.service()[method](input), e => e.code === 'INVALID_INPUT');
});

test('full cancellation rechecks all packages, preserves master/history and only rolls back owned Processing packages', async () => {
  const f = fixture([packageRecord('A'), packageRecord('B')]);
  const unrelated = packageRecord('UNRELATED', 'Processing'); f.data.set(unrelated.record_id, structuredClone(unrelated));
  const pl = await f.service().create(f.input); const originalDetail = f.data.get('pl-master').fields['PICKING LIST DETAIL'];
  const before = new Map(['rec-A', 'rec-B'].map(id => [id, structuredClone(f.data.get(id).fields)]));
  f.events.length = 0;
  const input = { requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber };
  const result = await f.service().cancel(input);
  assert.equal(result.phase, 'cancelled'); assert.equal(result.operational, false);
  assert.equal(f.events[0], 'list-packages');
  for (const id of ['rec-A', 'rec-B']) {
    const fields = f.data.get(id).fields;
    assert.equal(fields.STATUS, 'Active');
    assert.equal(fields.NOTE, before.get(id).NOTE + '\n2026/09/05 16:21 - B044 SCAN PUT AWAY TOOL: PL NUMBER: B044-PL-20260905-0001 - CANCELLED');
    for (const key of ['SKU', 'CLIENT ID', 'LOCATION', 'DATE OF RECEIVED']) assert.equal(fields[key], before.get(id)[key]);
  }
  assert.deepEqual(f.data.get(unrelated.record_id), unrelated);
  assert.equal(f.data.get('pl-master').fields['PICKING LIST DETAIL'], originalDetail + '\n\nSTATUS: CANCELLED\nCANCELLED: 2026/09/05 16:21\nProcessed packages retained: 0\nProcessing packages returned to Active: 2\nSkipped/unexpected status packages: 0');
  const mutations = f.events.filter(e => e.fields).length;
  await f.service().cancel(input); assert.equal(f.events.filter(e => e.fields).length, mutations);
  assert.equal((await f.service().create(f.input)).phase, 'cancelled');
  await assert.rejects(f.service().complete({ pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId }), e => e.code === 'PL_NOT_OPERATIONAL');
});

test('any completed package blocks cancellation without rollback or master writes', async () => {
  const f = fixture(['A','B'].map(sku => packageRecord(sku))); const pl = await f.service().create(f.input);
  await f.service().complete({ pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId:'rec-A',trackingNumber:'A',confirmationTracking:'A' });
  const before = structuredClone(f.data);
  await assert.rejects(f.service().cancel({ requestId:f.input.requestId,pickingListNumber:pl.pickingListNumber }), e => e.code === 'CANCEL_PROCESSED_BLOCKED');
  assert.deepEqual(f.data,before); assert.equal(f.data.get('rec-B').fields.STATUS,'Processing');
});

test('unexpected assigned statuses are preserved and reported as skipped', async () => {
  const f = fixture(['A', 'B', 'C'].map(sku => packageRecord(sku))); const pl = await f.service().create(f.input);
  f.data.get('rec-A').fields.STATUS = 'Disposal'; f.data.get('rec-B').fields.STATUS = 'Active';
  const before = structuredClone(f.data);
  const result = await f.service().cancel({ requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber });
  assert.equal(result.skipped, 2); assert.equal(result.processingReturnedToActive, 1);
  for (const id of ['rec-A', 'rec-B']) assert.deepEqual(f.data.get(id), before.get(id));
  assert.match(f.data.get('pl-master').fields['PICKING LIST DETAIL'], /Skipped\/unexpected status packages: 2/);
});

test('changed identity, reservation or ownership blocks cancellation without mutations', async () => {
  for (const change of ['sku', 'reservation', 'note']) {
    const f = fixture(); const pl = await f.service().create(f.input);
    if (change === 'sku') f.data.get('rec-A').fields.SKU = 'OTHER';
    if (change === 'status') f.data.get('rec-A').fields.STATUS = 'Active';
    if (change === 'reservation') f.memory.set('reserved:rec-A', 'another-request');
    if (change === 'note') f.data.get('rec-A').fields.NOTE += '\n2026/09/05 16:22 - B044 SCAN PUT AWAY TOOL: PL NUMBER: OTHER - CREATED';
    f.events.length = 0;
    await assert.rejects(f.service().cancel({ requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber }), e => e.code === 'PACKAGE_STATE_CONFLICT');
    assert.equal(f.events.filter(e => e.fields).length, 0);
  }
});

test('cancellation resumes lost rollback acknowledgement without duplicate notes', async () => {
  const f = fixture(); const pl = await f.service().create(f.input);
  const update = f.records.updateRecord; let once = true;
  f.records.updateRecord = async args => { const record = await update(args); if (once) { once = false; throw new Error('lost response'); } return record; };
  const input = { requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber };
  await assert.rejects(f.service().cancel(input));
  assert.equal(f.memory.get(`job:${f.input.requestId}`).phase, 'cancelling');
  assert.equal((await f.service().cancel(input)).phase, 'cancelled');
  assert.equal(f.data.get('rec-A').fields.NOTE.match(/ - CANCELLED/g).length, 1);
});

test('full cancellation advances bounded chunks and can resume a master update failure', async () => {
  const f = fixture(Array.from({ length: 10 }, (_, i) => packageRecord(String(i))));
  await f.service().create(f.input); const pl = await f.service().create(f.input);
  const input = { requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber };
  const first = await f.service().cancel(input); assert.equal(first.phase, 'cancelling'); assert.equal(first.cancelPendingCount, 2);
  const update = f.records.updateRecord; let broken = true;
  f.records.updateRecord = async args => { if (args.recordId === 'pl-master' && broken) throw new Error('master failure'); return update(args); };
  await assert.rejects(f.service().cancel(input)); broken = false;
  assert.equal((await f.service().cancel(input)).phase, 'cancelled');
  assert.equal(f.events.filter(e => e.fields?.STATUS === 'Active').length, 10);
});

test('generic text persistence accepts segmented text rereads and retains caller-specific format', async () => {
  let saved;
  const service = createPickingListService(config, {
    async createRecord({ fields }) { saved = fields; return { record_id: 'master' }; },
    async getRecord() { return { fields: Object.fromEntries(Object.entries(saved).map(([key, text]) => [key, [{ type: 'text', text }]])) }; }
  });
  await service.persist({ pickingListNumber: 'OTHER-PL', detailText: 'Other workflow detail\n001' });
  assert.deepEqual(saved, { 'PICKING LIST NUMBER': 'OTHER-PL', 'PICKING LIST DETAIL': 'Other workflow detail\n001' });
});

test('cancelled reservations allow new generation while duplicate old cancellation cannot affect the new PL', async () => {
  const f = fixture(); const first = await f.service().create(f.input);
  const input = { requestId: f.input.requestId, pickingListNumber: first.pickingListNumber };
  await f.service().cancel(input);
  const second = await f.service().create({ ...f.input, requestId: 'new-generation-123456789' });
  assert.equal(second.operational, true); assert.notEqual(second.pickingListNumber, first.pickingListNumber);
  assert.ok(f.data.has('pl-master')); assert.ok(f.data.has('pl-master-2'));
  await f.service().cancel(input); assert.equal(f.data.get('rec-A').fields.STATUS, 'Processing');
  assert.equal(f.memory.get('reserved:rec-A'), 'new-generation-123456789');
});

const statusFields = (names, type = 3) => [{ field_name: 'STATUS', type, property: { options: names.map(name => ({ name })) } }];

test('prepare uses exactly Active and never reads lifecycle option metadata or writes', async () => {
  const statuses = ['Active', 'Processing', 'Processed', 'Disposal', 'Other', 'active', ' Active '];
  const f = fixture(statuses.map((status, index) => packageRecord(String(index), status)));
  f.records.listFields = async () => { throw new Error('prepare must not inspect options'); };
  const prepared = await f.service().prepare(f.input);
  assert.deepEqual(prepared.packages.map(row => row.eligibility), ['ELIGIBLE', ...Array(6).fill('BLOCKED_STATUS')]);
  assert.deepEqual(prepared.exceptions.slice(0, 3).map(row => row.reason), ['STATUS Processing', 'STATUS Processed', 'STATUS Disposal']);
  assert.deepEqual(f.events, ['list-packages']); assert.equal(f.memory.size, 0);
});

test('six Active packages generate with only Processing available, without requiring Processed', async () => {
  const f = fixture(Array.from({ length: 6 }, (_, i) => packageRecord(String(i))));
  f.records.listFields = async () => statusFields(['Processing']);
  const pl = await f.service().create(f.input);
  assert.equal(pl.operational, true); assert.equal(pl.packages.length, 6);
  for (const row of pl.packages) assert.equal(f.data.get(row.packageRecordId).fields.STATUS, 'Processing');
});

test('missing Processing blocks generation specifically, before persistence or package changes', async () => {
  const f = fixture(); f.records.listFields = async () => statusFields(['Active', 'Processed']);
  await assert.rejects(f.service().create(f.input), error => error.code === 'PROCESSING_STATUS_NOT_AVAILABLE' && !error.message.includes('Processed'));
  assert.equal(f.events.length, 0); assert.equal(f.memory.size, 0);
});

test('completion requires only Processed and cancellation requires only Active', async () => {
  for (const operation of ['complete', 'cancel']) {
    const f = fixture(); f.records.listFields = async () => statusFields(['Active', 'Processing']);
    const pl = await f.service().create(f.input);
    const completion = { pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: 'rec-A', trackingNumber: 'A', confirmationTracking: 'A' };
    const input = operation === 'complete' ? completion : { requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber };
    const target = operation === 'complete' ? 'Processed' : 'Active';
    f.records.listFields = async () => statusFields(['Processing']); f.events.length = 0;
    await assert.rejects(f.service()[operation](input), error => error.code === `${target.toUpperCase()}_STATUS_NOT_AVAILABLE`);
    assert.equal(f.events.filter(event => event.fields).length, 0);
    assert.equal(f.data.get('rec-A').fields.STATUS, 'Processing');
    f.records.listFields = async () => statusFields([target]);
    await f.service()[operation](input); assert.equal(f.data.get('rec-A').fields.STATUS, target);
  }
});

test('correct target options do not bypass single-select field type protection', async () => {
  const f = fixture(); f.records.listFields = async () => statusFields(['Processing'], 1);
  await assert.rejects(f.service().create(f.input), error => error.code === 'PACKAGE_STATUS_SCHEMA_ERROR');
  assert.equal(f.events.length, 0);
});

test('shared Final SKU cannot confirm packages; exact pending In-House tracking is required', async () => {
  const f = fixture([packageRecord('TRACK-A'), packageRecord('TRACK-B')]); const pl = await f.service().create(f.input);
  assert.equal(pl.packages[0].finalSku, pl.packages[1].finalSku);
  const input = { pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: 'rec-TRACK-A', trackingNumber: 'TRACK-A' };
  f.events.length = 0;
  for (const confirmationTracking of ['B044-ABC', 'TRACK-B', 'TRACK', 'prefix TRACK-A suffix', '']) {
    await assert.rejects(f.service().complete({ ...input, confirmationTracking }), error => error.code === 'WRONG_PACKAGE_CONFIRMATION');
    assert.equal(f.data.get('rec-TRACK-A').fields.STATUS, 'Processing');
    assert.equal(f.data.get('rec-TRACK-B').fields.STATUS, 'Processing');
  }
  assert.equal(f.events.filter(event => event.fields).length, 0);
  const result = await f.service().complete({ ...input, trackingNumber: ' track-a ', confirmationTracking: ' track-a ' });
  assert.equal(result.status, 'Processed'); assert.equal(result.completed, 1);
  assert.equal(f.data.get('rec-TRACK-B').fields.STATUS, 'Processing');
  const note = f.data.get('rec-TRACK-A').fields.NOTE;
  assert.match(note, / - DONE PUTTING AWAY$/);
  await f.service().complete({ ...input, confirmationTracking: 'TRACK-A' });
  assert.equal(f.data.get('rec-TRACK-A').fields.NOTE, note);
  await assert.rejects(f.service().cancel({ requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber }), e => e.code === 'CANCEL_PROCESSED_BLOCKED');
  assert.equal(f.data.get('rec-TRACK-A').fields.NOTE, note);
});

test('all-completed cancellation is blocked without writes', async () => {
  const f = fixture(); const pl = await f.service().create(f.input);
  await f.service().complete({ pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: 'rec-A', trackingNumber: 'A', confirmationTracking: 'A' });
  const before = structuredClone(f.data.get('rec-A')); f.events.length = 0;
  await assert.rejects(f.service().cancel({ requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber }), e => e.code === 'CANCEL_PROCESSED_BLOCKED');
  assert.deepEqual(f.data.get('rec-A'), before);
  assert.equal(f.events.filter(e => e.fields && e.recordId.startsWith('rec-')).length, 0);
});

for (const [stored, query, matchType] of [
  ['ABC123', ' abc123 ', 'EXACT'],
  ['1ZR09J502020269428', '2020269428', 'PARTIAL'],
  ['875539379028', 'ABC875539379028XYZ', 'PARTIAL'],
  ...['ABC/123', 'A@B044', 'SKU-01_ABC', '123/456@XYZ', 'ABC/123@B044', 'A\\B.# +C'].flatMap(sku => [[sku, sku, 'EXACT'], [sku, `XX${sku}YY`, 'PARTIAL']]),
  ['ABC/123@B044', '123@B044', 'PARTIAL'],
  ['123456', 123456, 'EXACT']
]) test(`Excel matching preserves identifier ${JSON.stringify(query)} (${matchType})`, async () => {
  const f = fixture([packageRecord(stored)]);
  const result = await f.service().prepare({ rows: [source(query)] });
  assert.equal(result.eligible.length, 1); assert.equal(result.exceptions.length, 0);
  assert.equal(result.eligible[0].matchType, matchType);
  assert.equal(result.eligible[0].trackingNumber, stored);
  assert.equal(result.eligible[0].sourceTrackingNumber, String(query).trim());
});

test('exact priority and Active filtering never select an ambiguous or blocked identity', async () => {
  for (const [packages, expected, type] of [
    [[packageRecord('ABC123'), packageRecord('XXABC123YY')], 'ELIGIBLE', 'EXACT'],
    [[packageRecord('ABC123'), { ...packageRecord('abc123', 'Processed'), record_id: 'rec-old' }], 'ELIGIBLE', 'EXACT'],
    [[packageRecord('ABC123'), packageRecord('abc123')], 'AMBIGUOUS', 'EXACT'],
    [[packageRecord('XXABC123'), packageRecord('ABC123YY')], 'AMBIGUOUS', 'PARTIAL'],
    [[packageRecord('XXABC123'), packageRecord('ABC123YY', 'Processed')], 'ELIGIBLE', 'PARTIAL'],
    [[packageRecord('ABC123', 'Processed'), packageRecord('XXABC123')], 'BLOCKED_STATUS', 'EXACT'],
    ...['Processing', 'Processed', 'Disposal', 'Future', 'active', ' Active '].map(status => [[packageRecord('XXABC123', status)], 'BLOCKED_STATUS', 'PARTIAL']),
    [[packageRecord('UNRELATED'), packageRecord('')], 'NOT_FOUND', 'NONE']
  ]) {
    const f = fixture(packages), result = await f.service().prepare({ rows: [source('ABC123')] });
    assert.equal(result.packages[0].eligibility, expected); assert.equal(result.packages[0].matchType, type);
    assert.equal(result.eligible.length, expected === 'ELIGIBLE' ? 1 : 0);
    if (expected !== 'ELIGIBLE') assert.equal(result.exceptions[0].packageRecordId, '');
  }
});

test('partial package enters operational PL with stored identity; exceptions stay out and confirmation stays exact', async () => {
  const f = fixture([packageRecord('875539379028'), packageRecord('XXAMB'), packageRecord('AMBYY'), packageRecord('XXBLOCK', 'Processing')]);
  const input = { ...f.input, rows: ['ABC875539379028XYZ', 'AMB', 'MISSING', 'BLOCK'].map(source) };
  const pl = await f.service().create(input);
  assert.equal(pl.operational, true); assert.equal(pl.packages.length, 1);
  assert.equal(pl.packages[0].trackingNumber, '875539379028');
  assert.deepEqual(pl.exceptions.map(row => row.eligibility), ['AMBIGUOUS', 'NOT_FOUND', 'BLOCKED_STATUS']);
  assert.match(pl.exceptions[0].reason, /AMBIGUOUS PARTIAL MATCH/);
  assert.equal(f.data.get('rec-XXAMB').fields.STATUS, 'Active');
  assert.equal(f.data.get('rec-AMBYY').fields.STATUS, 'Active');
  const complete = { pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: pl.packages[0].packageRecordId, trackingNumber: '875539379028' };
  await assert.rejects(f.service().complete({ ...complete, confirmationTracking: 'ABC875539379028XYZ' }), error => error.code === 'WRONG_PACKAGE_CONFIRMATION');
  assert.equal((await f.service().complete({ ...complete, confirmationTracking: '875539379028' })).pickingListComplete, true);
});

test('different Excel identifiers resolving to one package are exceptions before PL assignment', async () => {
  const f = fixture([packageRecord('ABC123')]);
  const input = { ...f.input, rows: ['ABC123', 'XXABC123YY'].map(source) };
  const prepared = await f.service().prepare(input);
  assert.equal(prepared.eligible.length, 0); assert.equal(prepared.exceptions.length, 2);
  await assert.rejects(f.service().create(input), error => error.code === 'NO_ELIGIBLE_PACKAGES');
  assert.equal(f.data.get('rec-ABC123').fields.STATUS, 'Active');
});

for(const simplified of [false,true])test(`command snapshot survives PL creation, retry and strict confirmation (${simplified?'AI':'fallback'})`,async()=>{
 const f=fixture();const commandRaw='  原始说明 M8LS-14-BS\n无说明书需上报  ';
 f.input.rows[0]={...f.input.rows[0],commandRaw,commandDisplay:simplified?'原始说明 M8LS-14-BS\n无说明书需上报':'',commandAiStatus:simplified?'SIMPLIFIED':'FAILED',commandReference:simplified?'REF-1':''};
 const pl=await f.service().create(f.input);assert.equal(pl.operational,true);const row=pl.packages[0];assert.equal(row.commanded,true);assert.equal(row.commandRaw,commandRaw);assert.equal(row.commandDisplay,simplified?f.input.rows[0].commandDisplay:commandRaw);
 const detail=f.data.get('pl-master').fields['PICKING LIST DETAIL'];const snapshot=JSON.parse(detail.split('COMMAND SNAPSHOT: ')[1].split('\n')[0]);assert.equal(snapshot.commandRaw,commandRaw);assert.equal(snapshot.commandDisplay,row.commandDisplay);
 assert.equal((await f.service().create(f.input)).packages[0].commandRaw,commandRaw);
 await assert.rejects(f.service().complete({pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId,packageRecordId:row.packageRecordId,trackingNumber:row.trackingNumber,confirmationTracking:'WRAP'+row.trackingNumber}),e=>e.code==='WRONG_PACKAGE_CONFIRMATION');
 assert.equal((await f.service().complete({pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId,packageRecordId:row.packageRecordId,trackingNumber:row.trackingNumber,confirmationTracking:row.trackingNumber,partsReady:true,parts:[]})).pickingListComplete,true);
 assert.ok(f.events.filter(e=>e.fields&&e.recordId===row.packageRecordId).every(e=>Object.keys(e.fields).every(k=>['STATUS','NOTE'].includes(k))));
});

function commandCompletionFixture() {
  const f = fixture(); f.input.rows[0].commandRaw = '补说明书 CARTON-330-226-328 M8LS*14 FD-B044-260908-0001';
  return f;
}
const completionInput = pl => ({ pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId,packageRecordId:'rec-A',trackingNumber:'A',confirmationTracking:'A',partsReady:true,parts:[{sku:'M8LS*14',quantity:2}] });

test('possible parts never persist; actual usage writes only after Processed and exactly once', async () => {
  const f = commandCompletionFixture(), pl = await f.service().create(f.input), input = completionInput(pl);
  assert.equal(f.data.get('pl-master').fields['PART USED'],undefined);
  await assert.rejects(f.service().complete({...input,partsReady:false}), e => e.code==='PARTS_NOT_READY');
  await assert.rejects(f.service().complete({...input,confirmationTracking:'WRAP-A'}), e => e.code==='WRONG_PACKAGE_CONFIRMATION');
  assert.equal(f.data.get('rec-A').fields.STATUS,'Processing');assert.equal(f.data.get('pl-master').fields['PART USED'],undefined);
  const update = f.records.updateRecord;
  f.records.updateRecord = async args => { if(args.fields['PART USED'])assert.equal(f.data.get('rec-A').fields.STATUS,'Processed');return update(args); };
  await f.service().complete(input);
  const saved = JSON.parse(f.data.get('pl-master').fields['PART USED']);
  assert.equal(saved.version,1);assert.equal(saved.packages[0].packageRecordId,'rec-A');assert.deepEqual(saved.packages[0].parts,input.parts);assert.equal(saved.packages[0].status,'CONFIRMED');
  assert.doesNotMatch(f.data.get('pl-master').fields['PART USED'],/CARTON|说明书|FD-B044/);
  const before = structuredClone(f.data), writes = f.events.filter(e=>e.fields).length;
  await f.service().complete({...input,parts:[{sku:'FORGED',quantity:50}]});
  assert.deepEqual(f.data,before);assert.equal(f.events.filter(e=>e.fields).length,writes);
});
for (const point of ['package-lost','master-before','master-lost','checkpoint']) test(`completion recovers ${point} with immutable intent and no duplicate usage/NOTE`, async () => {
  const f=commandCompletionFixture(),pl=await f.service().create(f.input),input=completionInput(pl);
  const update=f.records.updateRecord,put=f.storage.put;let once=true;
  f.records.updateRecord=async args=>{
    if(once&&point==='master-before'&&args.fields['PART USED']){once=false;throw Error('failed');}
    const result=await update(args);
    if(once&&((point==='package-lost'&&args.fields.STATUS==='Processed')||(point==='master-lost'&&args.fields['PART USED']))){once=false;throw Error('lost');}
    return result;
  };
  f.storage.put=async(k,v)=>{if(once&&point==='checkpoint'&&v.rows?.[0]?.completedAt){once=false;throw Error('checkpoint');}return put(k,v);};
  await assert.rejects(f.service().complete(input));
  await assert.rejects(f.service().complete({...input,parts:[{sku:'DIFFERENT',quantity:1}]}),e=>e.code==='COMPLETION_REQUEST_CONFLICT');
  await assert.rejects(f.service().cancel({requestId:f.input.requestId,pickingListNumber:pl.pickingListNumber}),e=>e.code==='CANCEL_PROCESSED_BLOCKED');
  assert.equal((await f.service().complete(input)).status,'Processed');
  const saved=JSON.parse(f.data.get('pl-master').fields['PART USED']);assert.equal(saved.packages.length,1);assert.deepEqual(saved.packages[0].parts,input.parts);
  assert.equal(f.data.get('rec-A').fields.NOTE.match(/DONE PUTTING AWAY/g).length,1);
  assert.equal(f.data.get('pl-master').fields['PICKING LIST DETAIL'].match(/COMPLETION:/g).length,1);
});
test('missing PART USED Text schema fails before Processed; retry after schema repair succeeds',async()=>{
  const f=commandCompletionFixture(),pl=await f.service().create(f.input),input=completionInput(pl);
  const fields=f.records.listFields;f.records.listFields=async()=>statusFields(['Processed']);
  await assert.rejects(f.service().complete(input),e=>e.code==='PART_USED_SCHEMA_ERROR');
  assert.equal(f.data.get('rec-A').fields.STATUS,'Processing');assert.equal(f.data.get('pl-master').fields['PART USED'],undefined);
  f.records.listFields=fields;await f.service().complete(input);
});
test('malformed existing PART USED blocks safely before package transition',async()=>{
  const f=commandCompletionFixture(),pl=await f.service().create(f.input);
  f.data.get('pl-master').fields['PART USED']='unrecognized history';
  await assert.rejects(f.service().complete(completionInput(pl)),e=>e.code==='PART_USED_FORMAT_ERROR');assert.equal(f.data.get('rec-A').fields.STATUS,'Processing');
});
test('command list can cancel before final scan without any PART USED writes',async()=>{
  const f=commandCompletionFixture(),pl=await f.service().create(f.input);
  await f.service().cancel({requestId:f.input.requestId,pickingListNumber:pl.pickingListNumber});
  assert.equal(f.data.get('rec-A').fields.STATUS,'Active');assert.equal(f.data.get('pl-master').fields['PART USED'],undefined);
});
test('multiple commanded packages merge actual usage without overwriting earlier confirmation',async()=>{
 const f=fixture([packageRecord('A'),packageRecord('B')]);f.input.rows.forEach(r=>r.commandRaw='说明书');const pl=await f.service().create(f.input);
 for(const tracking of ['A','B'])await f.service().complete({...completionInput(pl),trackingNumber:tracking,confirmationTracking:tracking,packageRecordId:`rec-${tracking}`});
 const usage=globalThis.MkitePickingParts.parse(f.data.get('pl-master').fields['PART USED']);assert.equal(usage.packages.length,2);assert.deepEqual(globalThis.MkitePickingParts.aggregate(usage.packages.map(p=>p.parts)),[{sku:'M8LS*14',quantity:4}]);
});
test('a failed package write still in Processing may cancel; pending intent cannot later confirm usage',async()=>{
 const f=commandCompletionFixture(),pl=await f.service().create(f.input),update=f.records.updateRecord;
 f.records.updateRecord=async args=>{if(args.fields.STATUS==='Processed')throw Error('not written');return update(args);};
 await assert.rejects(f.service().complete(completionInput(pl)));assert.equal(f.data.get('rec-A').fields.STATUS,'Processing');
 await f.service().cancel({requestId:f.input.requestId,pickingListNumber:pl.pickingListNumber});assert.equal(f.data.get('pl-master').fields['PART USED'],undefined);assert.equal(f.memory.get(`job:${f.input.requestId}`).rows[0].completionIntent,undefined);
 await assert.rejects(f.service().complete(completionInput(pl)),e=>e.code==='PL_NOT_OPERATIONAL');
});
test('invalid actual parts reject before any transition',async()=>{
 for(const parts of [[{sku:'P',quantity:0}],[{sku:'P',quantity:1.5}],[{sku:'P',quantity:1},{sku:'P',quantity:1}],[{sku:'',quantity:1}]]){
  const f=commandCompletionFixture(),pl=await f.service().create(f.input);await assert.rejects(f.service().complete({...completionInput(pl),parts}),e=>e.code==='INVALID_PARTS');assert.equal(f.data.get('rec-A').fields.STATUS,'Processing');
 }
});

test('TEST001 command confirmation uses stored tracking, rejects Final SKU, and persists parts once',async()=>{
 const f=fixture([packageRecord('TEST001')]);f.input.rows[0].inboundSku='A-L24V100-100-BASIC-BT-8-A160-CA';f.input.rows[0].commandRaw='补说明书';
 const pl=await f.service().create(f.input),row=pl.packages[0],input={...completionInput(pl),packageRecordId:row.packageRecordId,trackingNumber:row.trackingNumber};
 assert.equal(row.finalSku,'B044-A-L24V100-100-BASIC-BT-8-A160-CA');
 for(const confirmationTracking of [row.finalSku,'WRONG','WRAP-TEST001','TEST','']){
  await assert.rejects(f.service().complete({...input,confirmationTracking,expectedFinalSku:confirmationTracking,finalSku:confirmationTracking}),e=>e.code==='WRONG_PACKAGE_CONFIRMATION');
  assert.equal(f.data.get(row.packageRecordId).fields.STATUS,'Processing');assert.equal(f.data.get('pl-master').fields['PART USED'],undefined);
 }
 await assert.rejects(f.service().complete({...input,confirmationTracking:undefined,confirmationSku:'TEST001'}),e=>e.code==='WRONG_PACKAGE_CONFIRMATION');
 assert.equal((await f.service().complete({...input,confirmationTracking:' test001 '})).status,'Processed');
 await f.service().complete({...input,confirmationTracking:'TEST001'});
 const usage=JSON.parse(f.data.get('pl-master').fields['PART USED']);assert.equal(usage.packages.length,1);assert.equal(usage.packages[0].parts[0].quantity,2);
});

test('PART USED acknowledgement requires exact master write and verified versioned JSON',async()=>{
 const f=commandCompletionFixture(),pl=await f.service().create(f.input),input=completionInput(pl),update=f.records.updateRecord;
 let attempted=false;
 f.records.updateRecord=async args=>{if(Object.hasOwn(args.fields,'PART USED')){attempted=true;assert.equal(args.recordId,pl.pickingListRecordId);assert.equal(JSON.parse(args.fields['PART USED']).version,1);return {}; }return update(args);};
 await assert.rejects(f.service().complete(input),e=>e.code==='PL_PERSISTENCE_UNCONFIRMED');
 assert.equal(attempted,true);assert.equal(f.data.get('rec-A').fields.STATUS,'Processed');assert.equal(f.memory.get(`job:${f.input.requestId}`).rows[0].completedAt,undefined);
 f.records.updateRecord=update;assert.equal((await f.service().complete(input)).partsPersisted,true);
 assert.equal(JSON.parse(f.data.get('pl-master').fields['PART USED']).packages.length,1);
 // A cached completion must reread/reconcile missing usage, not claim it was saved.
 f.data.get('pl-master').fields['PART USED']='';
 assert.equal((await f.service().complete(input)).partsPersisted,true);
 assert.equal(JSON.parse(f.data.get('pl-master').fields['PART USED']).packages.length,1);
});

test('TEST005 second tracking scan confirms arbitrary actual parts and retries once',async()=>{
 const f=commandCompletionFixture();f.input.rows[0].trackingNumber='TEST005';f.data.get('rec-A').fields.SKU='TEST005';
 const pl=await f.service().create(f.input),input={...completionInput(pl),trackingNumber:'TEST005',confirmationTracking:'TEST005',parts:[{sku:'PART-A',quantity:1},{sku:'PART-B',quantity:2}]};
 await assert.rejects(f.service().complete({...input,confirmationTracking:pl.packages[0].finalSku}),e=>e.code==='WRONG_PACKAGE_CONFIRMATION');
 const result=await f.service().complete(input);assert.equal(result.partsPersisted,true);assert.equal(f.data.get('rec-A').fields.STATUS,'Processed');
 await f.service().complete(input);const usage=JSON.parse(f.data.get('pl-master').fields['PART USED']);assert.equal(usage.packages.length,1);assert.equal(usage.packages[0].trackingNumber,'TEST005');assert.equal(usage.packages[0].status,'CONFIRMED');assert.deepEqual(usage.packages[0].parts,input.parts);
});

test('read-only reconciliation reports Processed with unconfirmed parts then verified retry',async()=>{
 const f=commandCompletionFixture(),pl=await f.service().create(f.input),input=completionInput(pl),update=f.records.updateRecord;
 f.records.updateRecord=async args=>{if(args.fields['PART USED'])throw Error('save unavailable');return update(args);};
 await assert.rejects(f.service().complete(input));const before=structuredClone(f.events);
 const pending=await f.service().reconcile(input);assert.equal(pending.packages[0].packageStatus,'Processed');assert.equal(pending.packages[0].partsPersisted,false);assert.equal(pending.packages[0].completedAt,null);assert.equal(pending.packages[0].reconciliationRequired,true);assert.deepEqual(f.events,before);
 await assert.rejects(f.service().cancel({pickingListNumber:pl.pickingListNumber,requestId:f.input.requestId}),e=>e.code==='CANCEL_PROCESSED_BLOCKED');
 f.records.updateRecord=update;await f.service().complete(input);await f.service().complete(input);
 const resolved=await f.service().reconcile(input);assert.equal(resolved.packages[0].partsPersisted,true);assert.equal(resolved.packages[0].reconciliationRequired,false);assert.ok(resolved.packages[0].completedAt);assert.equal(JSON.parse(f.data.get('pl-master').fields['PART USED']).packages.length,1);
});

test('reconciliation uses persisted identity without requestId or durable job and never writes',async()=>{
 const f=fixture([packageRecord('A'),packageRecord('B')]);f.input.rows=[source('A'),source('B')];f.input.rows[0].commandRaw='补说明书';
 const pl=await f.service().create(f.input);f.data.get('rec-A').fields.STATUS='Processed';
 const identity={pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId};
 for(const legacy of [false,true]){
  if(legacy)f.memory.clear();
  const before=structuredClone(f.data),memory=structuredClone(f.memory);
  for(const input of [identity,{pickingListNumber:pl.pickingListNumber}]){
   const result=await f.service().reconcile(input);assert.equal(result.completedCount,1);assert.equal(result.remainingCount,1);assert.equal(result.totalCount,2);assert.equal(result.packages[0].partsPersisted,false);assert.equal(result.packages[0].reconciliationRequired,true);
  }
  assert.deepEqual(f.data,before);assert.deepEqual(f.memory,memory);
 }
 await assert.rejects(f.service().reconcile({...identity,pickingListNumber:'WRONG'}),e=>e.code==='PL_MASTER_CHANGED');
 f.data.set('pl-duplicate',{record_id:'pl-duplicate',fields:structuredClone(f.data.get('pl-master').fields)});
 await assert.rejects(f.service().reconcile({pickingListNumber:pl.pickingListNumber}),e=>e.code==='PL_IDENTITY_UNRESOLVED');
});

test('admin broken legacy recovery audits only assigned packages and enables normal cancellation',async()=>{
 const f=commandCompletionFixture(),pl=await f.service().create(f.input),identity={pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId};
 await assert.rejects(f.service().adminRecover(identity),e=>e.code==='ADMIN_RECOVERY_BLOCKED');
 const update=f.records.updateRecord;f.records.updateRecord=async args=>{if(args.fields['PART USED'])throw Error('lost parts save');return update(args);};
 await assert.rejects(f.service().complete(completionInput(pl)));f.records.updateRecord=update;
 const job=f.memory.get(`job:${f.input.requestId}`);delete job.rows[0].completionIntent;
 f.data.set('rec-unrelated',packageRecord('unrelated','Processed'));const unrelated=structuredClone(f.data.get('rec-unrelated'));
 const before=structuredClone(f.data);assert.equal((await f.service().adminRecover(identity)).eligible,true);assert.deepEqual(f.data,before);
 const recovered=await f.service().adminRecover({...identity,confirm:true,confirmPickingListNumber:pl.pickingListNumber});assert.equal(recovered.rows[0].packageStatus,'Processing');assert.equal(recovered.rows[0].completionIntent,undefined);assert.equal(f.data.get('pl-master').fields['PART USED'],undefined);assert.match(f.data.get('rec-A').fields.NOTE,/ADMIN RECOVERY:/);assert.match(f.data.get('rec-A').fields.NOTE,/old history/);assert.match(f.data.get('pl-master').fields['PICKING LIST DETAIL'],/ADMIN RECOVERY:/);assert.deepEqual(f.data.get('rec-unrelated'),unrelated);
 await f.service().adminRecover({...identity,confirm:true,confirmPickingListNumber:pl.pickingListNumber});assert.equal(f.data.get('rec-A').fields.NOTE.match(/ADMIN RECOVERY:/g).length,1);
 assert.equal((await f.service().cancel({pickingListNumber:pl.pickingListNumber,requestId:f.input.requestId})).phase,'cancelled');
});
test('admin recovery refuses valid usage and ambiguous package ownership without writes',async()=>{
 const f=commandCompletionFixture(),pl=await f.service().create(f.input),identity={pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId,confirm:true,confirmPickingListNumber:pl.pickingListNumber};
 await f.service().complete(completionInput(pl));const before=structuredClone(f.data);await assert.rejects(f.service().adminRecover(identity));assert.deepEqual(f.data,before);
 f.data.get('pl-master').fields['PART USED']='';delete f.memory.get(`job:${f.input.requestId}`).rows[0].completedAt;f.data.get('rec-A').fields.NOTE+='\n - B044 SCAN PUT AWAY TOOL: PL NUMBER: OTHER - CREATED';const conflict=structuredClone(f.data);await assert.rejects(f.service().adminRecover(identity));assert.deepEqual(f.data,conflict);
});

test('admin recovery lost acknowledgement resumes immutable plan without duplicate audit',async()=>{
 const f=commandCompletionFixture(),pl=await f.service().create(f.input),identity={pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId,confirm:true,confirmPickingListNumber:pl.pickingListNumber};
 const update=f.records.updateRecord;f.records.updateRecord=async args=>{if(args.fields['PART USED'])throw Error('failed');return update(args);};await assert.rejects(f.service().complete(completionInput(pl)));
 let once=true;f.records.updateRecord=async args=>{const result=await update(args);if(once&&args.fields.STATUS==='Processing'){once=false;throw Error('lost');}return result;};
 await assert.rejects(f.service().adminRecover(identity));assert.equal((await f.service().create(f.input)).operational,false);
 await f.service().adminRecover(identity);assert.equal(f.data.get('rec-A').fields.STATUS,'Processing');assert.equal(f.data.get('rec-A').fields.NOTE.match(/ADMIN RECOVERY:/g).length,1);assert.equal(f.data.get('pl-master').fields['PICKING LIST DETAIL'].match(/ADMIN RECOVERY:/g).length,1);
});

test('cancellation uses current TEST006/TEST009 status despite historical completion and parts intent',async()=>{
 const f=fixture([packageRecord('TEST006'),packageRecord('TEST009')]);f.input.rows=[source('TEST006'),source('TEST009')];f.input.rows[0].commandRaw='补说明书';
 const pl=await f.service().create(f.input),job=f.memory.get(`job:${f.input.requestId}`);
 for(const row of job.rows){row.completedAt='2026-09-10T12:00:00Z';row.packageStatus='Processed';row.completionIntent={confirmedAt:row.completedAt,parts:[]};const r=f.data.get(row.packageRecordId);r.fields.NOTE+='\nold - B044 SCAN PUT AWAY TOOL: PL NUMBER: '+pl.pickingListNumber+' - DONE PUTTING AWAY';}
 const result=await f.service().reconcile({pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId});assert.equal(result.assignedCount,2);assert.equal(result.completedCount,0);assert.equal(result.processingCount,2);assert.equal(result.remainingCount,2);assert.equal(result.cancellationAllowed,true);assert.ok(result.packages.every(r=>r.currentStatus==='Processing'&&r.historicalCompletionExists&&!r.completedAt));
 const cancelled=await f.service().cancel({requestId:f.input.requestId,pickingListNumber:pl.pickingListNumber});assert.equal(cancelled.phase,'cancelled');
 for(const id of ['rec-TEST006','rec-TEST009']){assert.equal(f.data.get(id).fields.STATUS,'Active');assert.match(f.data.get(id).fields.NOTE,/DONE PUTTING AWAY/);}
 assert.equal(f.memory.get(`job:${f.input.requestId}`).rows[0].completedAt,'2026-09-10T12:00:00Z');
});

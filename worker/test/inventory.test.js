import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryService } from '../src/modules/inventory/inventory-service.js';
import { createFeishuRecordService } from '../src/services/feishu-record-service.js';
import { createInventoryController } from '../src/modules/inventory/inventory-controller.js';
import { handleRequest } from '../src/index.js';
const config = { appToken: 'base', packageTableId: 'packages', warehouseTimeZone: 'America/Toronto' };
const row = (sku, status = 'Active', date = '2026-09-07T23:59:00-04:00') => ({ record_id: sku, fields: { SKU: sku, STATUS: status, 'CLIENT ID': 'B044', LOCATION: '66-U1-21', 'DATE OF RECEIVED': Date.parse(date), NOTE: '2026/09/05 16:17 - RECEIVED\n2026/09/07 17:29 - B044 SCAN PUT AWAY TOOL: PL NUMBER: PL-002 - CREATED' } });
const rows = [row('ABC/123@B044'), row('LONG269428', 'Processed', '2026-09-01T00:00:00-04:00'), row('OTHER', 'Future', '2026-08-31T23:59:00-04:00')];
const service = createInventoryService(config, { listRecords: async args => { assert.deepEqual(args, { appToken: 'base', tableId: 'packages' }); return rows; } });
for (const [name, query, count, mode] of [
  ['exact punctuation', { sku: ' abc/123@b044 ' }, 1, 'EXACT'],
  ['partial SKU', { sku: '269428' }, 1, 'PARTIAL'],
  ['location contains', { location: '66-U1' }, 3],
  ['client exact', { clientId: ' b044 ' }, 3],
  ['client not partial', { clientId: 'B04' }, 0],
  ['status exact', { status: 'Processed' }, 1],
  ['status not partial', { status: 'Process' }, 0],
  ['from only', { receivedFrom: '2026-09-01' }, 2],
  ['to only', { receivedTo: '2026-08-31' }, 1],
  ['inclusive range', { receivedFrom: '2026-09-01', receivedTo: '2026-09-07' }, 2],
  ['NOTE contains', { note: 'PL-002' }, 3],
  ['AND combination', { clientId: 'B044', location: '66-U1', status: 'Processed', receivedFrom: '2026-09-01', receivedTo: '2026-09-07', note: 'PL-002' }, 1]
]) test(`inventory ${name}`, async () => { const result = await service.search(query); assert.equal(result.summary.found, count); if (mode) assert.equal(result.matchMode, mode); });
test('exact takes precedence over partial', async () => { const s = createInventoryService(config, { listRecords: async () => [row('ABC'), row('ABC-LONG')] }); assert.deepEqual((await s.search({ sku: 'ABC' })).results.map(r => r.sku), ['ABC']); });
test('empty and invalid date filters fail before any read', async () => {
  const s = createInventoryService(config, { listRecords() { throw Error('must not read'); } });
  for (const query of [{ mode: 'batch', skus: '\n' }]) await assert.rejects(s.search(query), e => e.code === 'INVENTORY_SEARCH_REQUIRED');
  for (const query of [{ receivedFrom: '2026-09-07', receivedTo: '2026-09-01' }, { receivedFrom: '2026-02-30' }]) await assert.rejects(s.search(query), e => e.code === 'INVALID_DATE_RANGE');
});
test('unknown statuses and last activity preserved', async () => { const r = await service.search({ status: 'Future' }); assert.equal(r.summary.found, 1); assert.equal(r.summary.active, 0); assert.match(r.results[0].lastActivity, /PL-002 - CREATED$/); });
test('batch is exact only, blanks ignored, duplicates counted, missing preserved', async () => {
  const r = await service.search({ mode: 'batch', skus: 'ABC/123@B044\n\n abc/123@b044 \n269428\nMISSING' });
  assert.equal(r.batch.input, 4); assert.equal(r.batch.duplicateInput, 1); assert.equal(r.batch.found, 1); assert.deepEqual(r.batch.notFound, ['269428', 'MISSING']);
});
test('Feishu pagination reads later matches using GET without projections or writes', async () => {
  let calls = 0;
  const records = createFeishuRecordService({ getTenantAccessToken: async () => 'private' }, { fetchImpl: async (url, init) => {
    assert.equal(init.method, 'GET'); assert.ok(!url.includes('field_names')); calls++;
    if (calls === 2) assert.match(url, /page_token=next/);
    return { ok: true, status: 200, json: async () => ({ code: 0, data: calls === 1 ? { items: [row('OTHER')], has_more: true, page_token: 'next' } : { items: [row('TARGET')], has_more: false } }) };
  } });
  assert.equal((await createInventoryService(config, records).search({ sku: 'TARGET' })).summary.found, 1); assert.equal(calls, 2);
});
test('explicit limit reports full match count without returning whole table', async () => {
  const s = createInventoryService(config, { listRecords: async () => Array.from({ length: 510 }, (_, i) => row(String(i))) });
  const r = await s.search({ status: 'Active' }); assert.equal(r.results.length, 50); assert.equal(r.pagination.totalMatched, 510); assert.equal(r.pagination.hasNext, true); assert.equal(r.summary.active, 510);
});
test('controller failure is safe and read-only route rejects mutation methods', async () => {
  const request = new Request('https://api.example/api/inventory/search', { method: 'POST' });
  const controller = createInventoryController({ search: async () => { throw Error('private token'); } });
  const response = await controller.search({}, 'test', request, {}); assert.equal(response.status, 502); assert.doesNotMatch(await response.text(), /private token/);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await handleRequest(new Request(request.url, { method }), {})).status, 405);
});
test('registered inventory POST validates empty search and retains localhost CORS without Feishu calls', async () => {
  const env = { ALLOWED_ORIGINS: 'http://localhost:5501', FEISHU_APP_ID: 'app', FEISHU_APP_SECRET: 'secret', FEISHU_BASE_APP_TOKEN: 'base', FEISHU_PACKAGE_TABLE_ID: 'packages', FEISHU_CLIENT_TABLE_ID: 'clients' };
  const request = new Request('https://api.example/api/inventory/search', { method: 'POST', headers: { Origin: 'http://localhost:5501', 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'batch', skus: '' }) });
  const response = await handleRequest(request, env);
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'INVENTORY_SEARCH_REQUIRED'); assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5501');
});
test('empty browsing and filtered pagination retain totals across every page', async () => {
  const s = createInventoryService(config, { listRecords: async () => Array.from({ length: 137 }, (_, i) => row(String(i + 1), i < 80 ? 'Processed' : 'Active')) });
  const first = await s.search({});
  assert.equal(first.results.length, 50); assert.equal(first.results[0].sku, '1');
  assert.deepEqual(first.pagination, { page: 1, pageSize: 50, returnedCount: 50, totalMatched: 137, totalPages: 3, hasPrevious: false, hasNext: true });
  const second = await s.search({ page: 2 }); assert.equal(second.results[0].sku, '51'); assert.equal(second.results.at(-1).sku, '100'); assert.deepEqual(second.summary, first.summary);
  const last = await s.search({ page: 3 }); assert.equal(last.results.length, 37); assert.equal(last.pagination.hasNext, false); assert.equal(last.pagination.hasPrevious, true);
  const filtered = await s.search({ status: 'Processed', page: 2 }); assert.equal(filtered.results.length, 30); assert.equal(filtered.summary.processed, 80); assert.equal(filtered.pagination.totalMatched, 80);
});

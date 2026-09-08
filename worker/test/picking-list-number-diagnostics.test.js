import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickingListService, PickingListNumberLookupError } from '../src/modules/picking-lists/picking-list-service.js';
import { createFeishuRecordService } from '../src/services/feishu-record-service.js';
const config = { appToken: 'base', pickingListTableId: 'table' };

for (const [name, numbers, expected] of [
  ['empty table', [], '0001'],
  ['existing sequences', ['B044-PL-20260907-0001', 'B044-PL-20260907-0002'], '0003'],
  ['previous dates', ['B044-PL-20260906-0001'], '0001'],
  ['unrelated formats', ['OTHER-PL-20260907-0001', 'unrelated'], '0001'],
  ['malformed numbers', [null, {}, 42, 'B044-PL-bad', [{ unexpected: true }]], '0001']
]) test(`allocation success unchanged: ${name}`, async () => {
  const records = createFeishuRecordService({ getTenantAccessToken: async () => 'test' }, { fetchImpl: async (url, init) => {
    assert.equal(init.method, 'GET');
    assert.equal(url, 'https://open.feishu.cn/open-apis/bitable/v1/apps/base/tables/table/records?page_size=500&field_names=%5B%22PICKING+LIST+NUMBER%22%5D');
    return Response.json({ code: 0, data: { items: numbers.map(number => ({ fields: { 'PICKING LIST NUMBER': number } })), has_more: false } });
  } });
  assert.equal(await createPickingListService(config, records).nextNumber('B044', '20260907'), `B044-PL-20260907-${expected}`);
});

test('allocator wraps downstream lookup failure without preserving raw payloads', async () => {
  const records = createFeishuRecordService({ getTenantAccessToken: async () => 'PRIVATE TOKEN' }, { fetchImpl: async () => Response.json({ code: 1254045, msg: 'PRIVATE DATA' }, { status: 400 }) });
  await assert.rejects(createPickingListService(config, records).nextNumber('B044', '20260907'), error => {
    assert.ok(error instanceof PickingListNumberLookupError);
    assert.equal(error.code, 'PICKING_LIST_NUMBER_LOOKUP_FAILED');
    assert.equal(error.diagnostics.downstreamHttpStatus, 400);
    assert.equal(error.diagnostics.feishuCode, 1254045);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /PRIVATE/); return true;
  });
});

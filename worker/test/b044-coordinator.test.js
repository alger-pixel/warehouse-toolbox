import test from 'node:test';
import assert from 'node:assert/strict';
import { B044PutAwayCoordinator } from '../src/modules/b044-put-away/put-away-coordinator.js';
import { handleRequest } from '../src/index.js';

function fixture(t, { missingProcessing = false } = {}) {
  const memory = new Map(), events = [], logs = [];
  const storage = { async get(key) { return structuredClone(memory.get(key)); }, async put(key, value) { memory.set(key, structuredClone(value)); } };
  const packages = Array.from({ length: 6 }, (_, i) => ({ record_id: `rec-${i}`, fields: { SKU: `TRACK-${String(i).padStart(3, '0')}`, STATUS: 'Active', LOCATION: 'A1', NOTE: '' } }));
  const masters = [];
  const env = { FEISHU_APP_ID: crypto.randomUUID(), FEISHU_APP_SECRET: 'PRIVATE-SECRET', FEISHU_BASE_APP_TOKEN: 'base', FEISHU_PACKAGE_TABLE_ID: 'packages', FEISHU_CLIENT_TABLE_ID: 'clients', FEISHU_PICKING_LIST_TABLE_ID: 'lists', ALLOWED_ORIGINS: 'http://localhost:5501' };
  let schemaMissing = missingProcessing, failMaster = false, interruptUpdate = false, lookupFailure = null;
  t.mock.method(console, 'log', line => logs.push(JSON.parse(line)));
  t.mock.method(console, 'error', line => logs.push(JSON.parse(line)));
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const path = new URL(url).pathname;
    const ok = data => Response.json({ code: 0, data });
    if (path.endsWith('/tenant_access_token/internal')) return Response.json({ code: 0, tenant_access_token: 'PRIVATE-TOKEN', expire: 7200 });
    if (path.endsWith('/fields')) { events.push('schema'); return ok({ items: [{ field_name: 'STATUS', type: 3, property: { options: (schemaMissing ? ['Active', 'Processed'] : ['Active', 'Processing', 'Processed']).map(name => ({ name })) } }] }); }
    if (path.endsWith('/upload_all')) { events.push('upload');  return ok({ file_token: 'PRIVATE-FILE-TOKEN' }); }
    const list = path.includes('/tables/lists/') ? masters : packages;
    if (path.endsWith('/records')) {
      if (init.method === 'GET') { events.push(list === masters ? 'list-masters' : 'list-packages'); if (list === masters && lookupFailure) return lookupFailure(); return ok({ items: list }); }
      events.push('persist-master'); if (failMaster) return Response.json({ code: 1 }); const record = { record_id: 'master-1', fields: JSON.parse(init.body).fields }; list.push(record); return ok({ record });
    }
    const record = list.find(r => r.record_id === path.split('/').at(-1));
    assert.ok(record, 'unexpected Feishu request');
    if (init.method === 'PUT') {
      events.push('update'); Object.assign(record.fields, JSON.parse(init.body).fields);
      if (interruptUpdate) { interruptUpdate = false; throw new Error('PRIVATE-NETWORK-DATA'); }
    } else events.push(list === masters ? 'reread-master' : 'reread-package');
    return ok({ record });
  });
  const coordinator = new B044PutAwayCoordinator({ storage }, env);
  env.B044_PUT_AWAY = { idFromName: name => name, get: () => coordinator };
  const rows = Array.from({ length: 20 }, (_, i) => ({ trackingNumber: `TRACK-${String(i).padStart(3, '0')}`, arrivalDate: '2026-09-07', inboundSku: 'LABEL', warehouseInboundOrder: 'RMAB044-1' }));
  const input = { requestId: 'operation-123456789', rows };
  const send = (body = input, endpoint = 'create-picking-list') => handleRequest(new Request(`https://api.example/api/b044/put-away/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5501' }, body: JSON.stringify(body) }), env);
  return { memory, storage, events, logs, packages, masters, input, send, setLookupFailure: value => { lookupFailure = value; }, fixSchema: () => { schemaMissing = false; }, failMaster: () => { failMaster = true; }, interruptUpdate: () => { interruptUpdate = true; } };
}

test('prepare 6 eligible / 14 exceptions then missing Processing 409 occurs before allocation or persistence; same ID succeeds after schema correction', async t => {
  const f = fixture(t, { missingProcessing: true });
  const prepared = await (await f.send({ rows: f.input.rows }, 'prepare')).json();
  assert.equal(prepared.data.eligible.length, 6); assert.equal(prepared.data.exceptions.length, 14);
  f.events.length = 0;
  const response = await f.send(), body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.error.code, 'PROCESSING_STATUS_NOT_AVAILABLE');
  assert.equal(body.error.stage, 'CHECK_PACKAGE_SCHEMA'); assert.equal(body.error.operationState, 'new');
  assert.deepEqual(f.events, ['schema']); assert.equal(f.memory.size, 0); assert.equal(f.masters.length, 0);
  const log = f.logs.find(e => e.event === 'picking_list_conflict');
  assert.equal(log.requestId, body.requestId); assert.equal(log.stage, body.error.stage);
  assert.doesNotMatch(JSON.stringify(f.logs), /TRACK-|PRIVATE-|NOTE|LABEL/);
  f.fixSchema(); assert.equal((await (await f.send()).json()).data.operational, true);
  assert.equal(f.masters.length, 1); assert.equal(f.events.filter(e => e === 'upload').length, 0);
});

test('coordinator serializes duplicate clicks; interrupted assignment resumes without duplicate upload, master, update or note', async t => {
  const f = fixture(t); f.interruptUpdate();
  const [first, second] = await Promise.all([f.send(), f.send()]);
  assert.equal((await first.json()).data.operational, false); assert.equal((await second.json()).data.operational, true);
  assert.equal(f.masters.length, 1); assert.equal(f.events.filter(e => e === 'upload').length, 0);
  assert.equal(f.events.filter(e => e === 'update').length, 6);
  for (const r of f.packages) assert.equal(r.fields.NOTE.match(/ - CREATED/g).length, 1);
  assert.equal((await (await f.send()).json()).data.operational, true); assert.equal(f.masters.length, 1);
});

test('fingerprint conflict reports existing operation state without another Feishu call', async t => {
  const f = fixture(t); await f.send(); f.events.length = 0;
  const response = await f.send({ ...f.input, rows: f.input.rows.slice(1) }), body = await response.json();
  assert.equal(response.status, 409); assert.equal(body.error.code, 'REQUEST_ID_CONFLICT');
  assert.equal(body.error.stage, 'VALIDATE_SOURCE'); assert.equal(body.error.operationState, 'operational');
  assert.deepEqual(f.events, []);
});

test('uncertain persistence stays blocked, same ID does not upload twice, different ID hits reservation 409', async t => {
  const f = fixture(t); f.failMaster();
  const first = await f.send(), body = await first.json();
  assert.equal(first.status, 200); assert.equal(body.data.phase, 'blocked'); assert.equal(body.data.error.code, 'PICKING_LIST_PERSISTENCE_FAILED');
  assert.equal(f.masters.length, 0); assert.ok(f.packages.every(r => r.fields.STATUS === 'Active'));
  const event = f.logs.find(e => e.event === 'picking_list_not_operational'); assert.equal(event.stage, 'PERSIST_MASTER');
  assert.equal((await (await f.send()).json()).data.phase, 'blocked');
  assert.equal(f.events.filter(e => e === 'upload').length, 0);
  const other = await f.send({ ...f.input, requestId: 'another-operation-1234' });
  const conflict = await other.json(); assert.equal(other.status, 409); assert.equal(conflict.error.code, 'PACKAGE_RESERVED');
  assert.equal(conflict.error.stage, 'CHECK_PACKAGE_RESERVATIONS');
});

test('persisting checkpoint remains protected and does not restart external persistence', async t => {
  const f = fixture(t); await f.send();
  const key = `job:${f.input.requestId}`, job = f.memory.get(key); job.phase = 'persisting';
  f.events.length = 0;
  const response = await f.send(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.data.operational, false);
  assert.equal(body.data.error.code, 'PICKING_LIST_RESUME_REQUIRED'); assert.deepEqual(f.events, []);
});

test('completed PL is returned on retry and cannot be recreated with a new operation ID', async t => {
  const f = fixture(t); const pl = (await (await f.send()).json()).data;
  for (const row of pl.packages) {
    const response = await f.send({ pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: row.packageRecordId, trackingNumber: row.trackingNumber, confirmationTracking: row.trackingNumber }, 'complete-package');
    assert.equal(response.status, 200);
  }
  const resumed = (await (await f.send()).json()).data;
  assert.ok(resumed.packages.every(r => r.completedAt)); assert.equal(f.masters.length, 1);
  const recreated = await f.send({ ...f.input, requestId: 'new-operation-123456' });
  assert.equal(recreated.status, 409); assert.equal((await recreated.json()).error.code, 'NO_ELIGIBLE_PACKAGES');
  assert.equal(f.events.filter(e => e === 'upload').length, 0);
});

test('unexpected storage error with code is not mislabeled as a domain conflict or exposed', async t => {
  const f = fixture(t);
  f.storage.get = async () => { throw Object.assign(new Error('PRIVATE-STORAGE-DATA'), { code: 'PRIVATE-RUNTIME-CODE' }); };
  const response = await f.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.error.code, 'B044_OPERATION_FAILED');
  assert.equal(body.error.stage, 'LOAD_OPERATION'); assert.doesNotMatch(JSON.stringify([body, f.logs]), /PRIVATE-/);
});

test('coordinator serializes cancellation before completion and duplicate cancels are safe', async t => {
  const f = fixture(t); const pl = (await (await f.send()).json()).data;
  const row = pl.packages[0];
  const input = { requestId: f.input.requestId, pickingListNumber: pl.pickingListNumber };
  const [cancelled, completion] = await Promise.all([
    f.send(input, 'cancel-picking-list'),
    f.send({ pickingListNumber: pl.pickingListNumber, pickingListRecordId: pl.pickingListRecordId, packageRecordId: row.packageRecordId, trackingNumber: row.trackingNumber, confirmationTracking: row.trackingNumber }, 'complete-package')
  ]);
  assert.equal(cancelled.status, 200); assert.equal((await cancelled.json()).data.phase, 'cancelled');
  assert.equal(completion.status, 409); assert.equal((await completion.json()).error.code, 'PL_NOT_OPERATIONAL');
  const updates = f.events.filter(e => e === 'update').length;
  assert.equal((await (await f.send(input, 'cancel-picking-list')).json()).data.phase, 'cancelled');
  assert.equal(f.events.filter(e => e === 'update').length, updates);
  assert.equal(f.masters.length, 1); assert.equal(f.events.filter(e => e === 'upload').length, 0);
});

for (const [type, failure, expectedCode, expectedStatus] of [
  ['FEISHU_API_ERROR', () => Response.json({ code: 1254045, msg: 'PRIVATE RESPONSE', NOTE: 'PRIVATE NOTE', Authorization: 'PRIVATE TOKEN' }, { status: 400 }), 1254045, 400],
  ['NETWORK_ERROR', () => { throw new Error('PRIVATE NETWORK DATA'); }, 'NETWORK_ERROR', undefined],
  ['RESPONSE_PARSE_ERROR', () => new Response('PRIVATE INVALID JSON', { status: 502 }), 'RESPONSE_PARSE_ERROR', 502]
]) test(`coordinator logs safe allocator diagnostics and same operation retries: ${type}`, async t => {
  const f = fixture(t); f.setLookupFailure(failure);
  const response = await f.send(), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.error.code, 'PICKING_LIST_NUMBER_LOOKUP_FAILED');
  assert.equal(body.error.stage, 'ALLOCATE_PL_NUMBER'); assert.equal(body.error.retryable, true);
  assert.match(body.error.message, /Unable to read Picking List records/);
  assert.equal(body.error.downstreamHttpStatus, undefined); assert.equal(body.error.feishuCode, undefined);
  const log = f.logs.find(event => event.event === 'picking_list_number_lookup_failed');
  assert.equal(log.requestId, body.requestId); assert.equal(log.downstreamCode, expectedCode);
  assert.equal(log.downstreamHttpStatus, expectedStatus); assert.equal(log.failureType, type);
  assert.equal(log.tableRole, 'PICKING_LIST_CLASS'); assert.equal(log.action, 'listRecords');
  assert.equal(log.feishuCode, type === 'FEISHU_API_ERROR' ? 1254045 : undefined);
  assert.doesNotMatch(JSON.stringify([f.logs, body]), /PRIVATE|TRACK-|Authorization|NOTE/);
  assert.equal(f.memory.size, 0); assert.equal(f.masters.length, 0);
  assert.ok(f.packages.every(record => record.fields.STATUS === 'Active'));
  f.setLookupFailure(null);
  assert.equal((await (await f.send()).json()).data.operational, true);
  assert.equal(f.masters.length, 1);
});

test('public reconcile endpoint dispatches read-only lookup without creation requestId',async t=>{
 const f=fixture(t),pl=(await (await f.send()).json()).data;
 f.packages[0].fields.STATUS='Processed';const before=structuredClone(f.memory);f.events.length=0;
 const response=await f.send({pickingListNumber:pl.pickingListNumber,pickingListRecordId:pl.pickingListRecordId},'reconcile'),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.data.completedCount,1);assert.equal(body.data.remainingCount,5);assert.equal(f.events.includes('update'),false);assert.deepEqual(f.memory,before);
});

test('admin recovery denies absent/wrong key at public and coordinator boundaries',async t=>{
 const f=fixture(t);
 const missing=await f.send({},'admin-recover');assert.equal(missing.status,401);assert.equal(f.events.length,0);
 const coordinator=new B044PutAwayCoordinator({storage:f.storage},{USER_MANAGEMENT_ADMIN_KEY:'a'.repeat(32)});
 for(const key of ['', 'wrong']){const response=await coordinator.fetch(new Request('https://b044.internal/admin-recover',{method:'POST',headers:{Authorization:'Bearer '+key},body:'{}'}));assert.equal(response.status,401);}
});

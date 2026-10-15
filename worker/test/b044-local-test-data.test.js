import test from 'node:test';
import assert from 'node:assert/strict';
import { b044LocalTestConfig, createB044LocalPartUsedService, createB044LocalTestRecordService, isB044LocalTestMode } from '../src/modules/b044-put-away/local-test-data.js';
import { createB044PutAwayService, normalizeRows } from '../src/modules/b044-put-away/put-away-service.js';
import { createPickingListService } from '../src/modules/picking-lists/picking-list-service.js';
import { B044PutAwayCoordinator } from '../src/modules/b044-put-away/put-away-coordinator.js';

const safeEnv = { B044_LOCAL_TEST_DATA:'enabled', FEISHU_DATA_ENVIRONMENT:'local-test', WORKER_RUNTIME_ENVIRONMENT:'development', WAREHOUSE_TIME_ZONE:'America/Toronto' };
const sourceRows = count => Array.from({length:count},(_,index)=>({trackingNumber:`ALGER-TEST-${index+1}`,arrivalDate:'2026-10-15',inboundSku:`TEST-SKU-${index+1}`,warehouseInboundOrder:`RMAB044-LOCAL-${index+1}`,excelRow:index+2,...(index===0?{commandRaw:'LOCAL TEST COMMAND'}:{})}));
function memoryStorage(){const memory=new Map();return{memory,async get(key){return structuredClone(memory.get(key));},async put(key,value){memory.set(key,structuredClone(value));},async delete(key){memory.delete(key);},async deleteAll(){memory.clear();}};}

test('B044 local test mode requires the exact server-side environment combination', () => {
  assert.equal(isB044LocalTestMode(safeEnv), true);
  for (const change of [{B044_LOCAL_TEST_DATA:'off'},{FEISHU_DATA_ENVIRONMENT:'production'},{WORKER_RUNTIME_ENVIRONMENT:'production'}]) assert.equal(isB044LocalTestMode({...safeEnv,...change}), false);
});

test('arbitrary normalized Excel identities seed stable Active local records with test history only', async () => {
  const storage=memoryStorage(),config=b044LocalTestConfig(safeEnv),records=createB044LocalTestRecordService(storage,config),rows=normalizeRows(sourceRows(8));
  await records.seedPackages(rows);await records.seedPackages(rows);
  const packages=await records.listRecords({tableId:config.packageTableId});
  assert.equal(packages.length,8);assert.ok(packages.every(row=>row.fields.STATUS==='Active'));assert.ok(packages.every(row=>row.record_id.startsWith('local-b044-package-')));assert.ok(packages.every(row=>/TEST HISTORY ONLY/.test(row.fields.NOTE)));
  assert.ok(packages.some(row=>/DONE PUTTING AWAY/.test(row.fields.NOTE)));assert.ok(packages.some(row=>/RECONCILED/.test(row.fields.NOTE)));
  assert.equal([...storage.memory.keys()].some(key=>key.includes('reserved:')),false);
  await assert.rejects(records.createRecord({tableId:config.packageTableId,fields:{}}),/only creates Picking List masters/);
  await assert.rejects(records.listRecords({tableId:'production-table-id'}),/unknown table/);
});

test('real B044 service generates, protects reservations, cancels, regenerates, and completes using local stores', async () => {
  const storage=memoryStorage(),config=b044LocalTestConfig(safeEnv),records=createB044LocalTestRecordService(storage,config),rows=sourceRows(8);await records.seedPackages(normalizeRows(rows));
  const pickingLists=createPickingListService(config,records),service=createB044PutAwayService(config,records,pickingLists,storage,{now:()=>Date.parse('2026-10-15T16:00:00Z'),pickingListPrefix:'B044-TEST',partUsed:createB044LocalPartUsedService(storage)});
  const first=await service.create({requestId:'local-generation-one',rows,sourceFile:'alger-test.xlsx',totalSourceRows:8});
  assert.equal(first.operational,true);assert.match(first.pickingListNumber,/^B044-TEST-PL-20261015-0001$/);assert.equal(first.succeeded.length,8);
  let packages=await records.listRecords({tableId:config.packageTableId});assert.ok(packages.every(row=>row.fields.STATUS==='Processing'));assert.ok(packages.every(row=>row.fields.NOTE.endsWith(`PL NUMBER: ${first.pickingListNumber} - CREATED`)));assert.ok(first.packages.every(row=>storage.memory.get(`reserved:${row.packageRecordId}`)==='local-generation-one'));
  for(const row of packages)await records.updateRecord({tableId:config.packageTableId,recordId:row.record_id,fields:{STATUS:'Active'}});
  await assert.rejects(service.create({requestId:'local-competing-attempt',rows}),error=>error.code==='PACKAGE_RESERVED');
  for(const row of packages)await records.updateRecord({tableId:config.packageTableId,recordId:row.record_id,fields:{STATUS:'Processing'}});
  const cancelled=await service.cancel({requestId:'local-generation-one',pickingListNumber:first.pickingListNumber});assert.equal(cancelled.phase,'cancelled');
  packages=await records.listRecords({tableId:config.packageTableId});assert.ok(packages.every(row=>row.fields.STATUS==='Active'));assert.ok(packages.every(row=>row.fields.NOTE.endsWith(`PL NUMBER: ${first.pickingListNumber} - CANCELLED`)));assert.ok(first.packages.every(row=>!storage.memory.has(`reserved:${row.packageRecordId}`)));
  const second=await service.create({requestId:'local-generation-two',rows,sourceFile:'alger-test.xlsx',totalSourceRows:8});assert.equal(second.operational,true);assert.match(second.pickingListNumber,/^B044-TEST-PL-20261015-0002$/);
  const row=second.packages.find(packageRow=>packageRow.commandRaw),done=await service.complete({pickingListNumber:second.pickingListNumber,pickingListRecordId:second.pickingListRecordId,packageRecordId:row.packageRecordId,trackingNumber:row.trackingNumber,confirmationTracking:row.trackingNumber,partsReady:true,parts:[{sku:'LOCAL-PART-1',quantity:2}]});
  assert.equal(done.status,'Processed');assert.equal(done.partsPersisted,true);assert.equal((await records.getRecord({tableId:config.packageTableId,recordId:row.packageRecordId})).fields.STATUS,'Processed');assert.equal(storage.memory.has(`reserved:${row.packageRecordId}`),false);assert.ok(storage.memory.has(`local-test-part-used:B044:${second.requestId}:${row.packageRecordId}:LOCAL-PART-1`));
});

test('local Part Used and reset remain inside the B044 local Durable Object', async () => {
  const storage=memoryStorage(),partUsed=createB044LocalPartUsedService(storage),entry={idempotencyKey:'B044:local:PART-1',partSku:'PART-1',quantity:2};
  await partUsed.recordPartUsage(entry);await partUsed.recordPartUsage(entry);assert.deepEqual(storage.memory.get('local-test-part-used:B044:local:PART-1'),entry);
  storage.memory.set('reserved:test','owner');const coordinator=new B044PutAwayCoordinator({storage},safeEnv),response=await coordinator.fetch(new Request('https://b044.internal/local-test/reset',{method:'POST',body:'{}'}));
  assert.equal(response.status,200);assert.equal(storage.memory.size,0);assert.deepEqual((await response.json()).data,{reset:true,scope:'B044_LOCAL_TEST_ONLY'});
});

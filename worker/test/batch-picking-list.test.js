import test from 'node:test';
import assert from 'node:assert/strict';
import { createPickingSearchService, parsePickingList, handlePickingSearch } from '../src/modules/batch-picking-lists/search-service.js';
import { formatB044Detail } from '../src/modules/b044-put-away/put-away-detail.js';
import { handleRequest } from '../src/index.js';
function record(i=1, overrides={}) {
 const rows=['A','B'].map((s,j)=>({sequence:j+1,packageRecordId:`rec-${i}-${s}`,trackingNumber:`TRACK/${i}${s}`,finalSku:'B044-ABC',currentLocation:'A1',warehouseInboundOrder:'RMAB044-1',commandRaw:'说明书 M8LS*14'}));
 const completedAt='2026-09-10T12:00:00Z';
 const detail=formatB044Detail({pickingListNumber:`PL-${i}`,createdAt:completedAt,rows},'America/Toronto')+rows.map(r=>'\nCOMPLETION: '+JSON.stringify({packageRecordId:r.packageRecordId,trackingNumber:r.trackingNumber,completedAt})).join('');
 return {record_id:`pl-${i}`,fields:{'PICKING LIST NUMBER':`PL-${i}`,'PICKING LIST DETAIL':detail,'PART USED':JSON.stringify({version:1,packages:rows.map(r=>({packageRecordId:r.packageRecordId,trackingNumber:r.trackingNumber,finalSku:r.finalSku,requestId:`request:${r.packageRecordId}`,status:'CONFIRMED',confirmedAt:completedAt,parts:[{sku:'M8LS*14',quantity:1}]}))}),...overrides}};
}
function fixture(rows=[record()]) { let reads=0; const service=createPickingSearchService({appToken:'base',pickingListTableId:'pl'},{listRecords:async()=>{reads++;return structuredClone(rows);},getRecord:async({recordId})=>structuredClone(rows.find(r=>r.record_id===recordId)||{})});return {service,reads:()=>reads}; }
test('parser preserves traceability and aggregates confirmed usage, never estimated materials',()=>{
 const row=parsePickingList(record());assert.equal(row.total,2);assert.equal(row.processed,2);assert.equal(row.status,'Completed');assert.deepEqual(row.partSummary,[{sku:'M8LS*14',quantity:2}]);assert.equal(row.packages[0].actualParts[0].quantity,1);assert.equal(row.commandCount,2);assert.equal(row.warehouse,'MKS66');assert.equal(row.clientId,'B044');assert.equal(row.createdDate,'2026-09-10');
});
test('unconfirmed, mismatched and malformed usage never contributes to totals',()=>{
 for(const kind of ['temporary','mismatch','malformed','noCompletion']) {
  const r=record(),usage=JSON.parse(r.fields['PART USED']);
  if(kind==='temporary')usage.packages.forEach(p=>p.status='TEMPORARY');
  if(kind==='mismatch')usage.packages.forEach(p=>p.packageRecordId='other'+p.packageRecordId);
  r.fields['PART USED']=kind==='malformed'?'bad JSON':JSON.stringify(usage);
  if(kind==='noCompletion')r.fields['PICKING LIST DETAIL']=r.fields['PICKING LIST DETAIL'].split('\nCOMPLETION:')[0];
  assert.deepEqual(parsePickingList(r).partSummary,[]);
 }
});
test('legacy text, segmented Feishu text, unknown formats and cancellation are safe',()=>{
 const r=record();r.fields['PICKING LIST DETAIL']=r.fields['PICKING LIST DETAIL'].split('\nCOMPLETION:')[0].replace(/PACKAGE ID: [^\n]+\n/g,'');delete r.fields['PART USED'];
 assert.equal(parsePickingList(r).status,'Completion unverified');assert.equal(parsePickingList(r).processed,0);
 r.fields['PICKING LIST DETAIL']=[{text:r.fields['PICKING LIST DETAIL']+'\nSTATUS: CANCELLED\nCANCELLED: 2026/09/11 10:00'}];assert.equal(parsePickingList(r).status,'Cancelled');
 assert.equal(parsePickingList({fields:{'PICKING LIST DETAIL':'unrecognized'}}).status,'Completion unverified');
});
test('ordinary browsing pages at 50 with full-set summary and no package payloads',async()=>{
 const f=fixture(Array.from({length:61},(_,i)=>record(i)));const a=await f.service.search();assert.equal(a.results.length,50);assert.equal(a.pagination.totalMatched,61);assert.equal(a.summary.processed,122);assert.equal(a.summary.partsQuantity,122);assert.equal(a.pagination.hasPrevious,false);assert.equal(a.pagination.hasNext,true);assert.equal(a.results[0].packages,undefined);
 const b=await f.service.search({page:2});assert.equal(b.results.length,11);assert.equal(b.pagination.hasPrevious,true);assert.equal(b.pagination.hasNext,false);assert.equal(b.pagination.totalPages,2);
});
test('all filters combine with AND; literal tracking and SKU punctuation is retained',async()=>{
 const f=fixture([record(1),record(2)]);
 const query={pickingListNumber:'PL-1',createdFrom:'2026-09-10',createdTo:'2026-09-10',warehouse:'MKS66',clientId:'B044',trackingNumber:'track/1',partSku:'m8ls*14',hasCommand:'yes',status:'Completed'};
 assert.equal((await f.service.search(query)).summary.found,1);
 for(const [key,value] of Object.entries({pickingListNumber:'NONE',createdFrom:'2026-09-11',createdTo:'2026-09-09',warehouse:'OTHER',clientId:'OTHER',trackingNumber:'TRACK/2',partSku:'说明书',hasCommand:'no',status:'Cancelled'})) {
  const q={...query,[key]:value};if(key==='createdFrom')delete q.createdTo;if(key==='createdTo')delete q.createdFrom;
  assert.equal((await f.service.search(q)).summary.found,0,key);
 }
});
test('detail returns full read-only record, errors are controlled and invalid inputs avoid reads',async()=>{
 const f=fixture();assert.equal((await f.service.detail({recordId:'pl-1'})).packages.length,2);
 for(const input of [{page:0},{createdFrom:'2026-02-30'},{createdFrom:'2026-10-01',createdTo:'2026-01-01'},{hasCommand:'invalid'}])await assert.rejects(f.service.search(input));assert.equal(f.reads(),0);
 await assert.rejects(f.service.detail({recordId:'missing'}));
 const response=await handlePickingSearch('search',{search:async()=>{throw Error('private detail');}},{},'id',new Request('http://localhost/api/picking-lists/search'),{});assert.equal(response.status,502);assert.doesNotMatch(await response.text(),/private detail/);
});
test('export retrieves all filtered pages and rejects over-limit results without partial output',async()=>{
 const f=fixture(Array.from({length:61},(_,i)=>record(i)));const result=await f.service.search({export:true});assert.equal(result.results.length,61);assert.equal(result.results[60].packages.length,2);
 await assert.rejects(fixture(Array.from({length:1001},(_,i)=>record(i))).service.search({export:true}),/maximum is 1000/);
});
test('search and detail routes accept POST only',async()=>{
 for(const action of ['search','detail'])assert.equal((await handleRequest(new Request(`http://localhost/api/picking-lists/${action}`),{})).status,405);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWarehouseInventoryLookupService, MAX_PAGES } from '../src/modules/inventory-lookup/inventory-service.js';
import { DEFAULT_API_URL } from '../src/modules/inventory-lookup/inventory-client.js';
import { handleRequest } from '../src/index.js';
const env = { MKITE_WAREHOUSE_API_KEY: 'mock-worker-secret', ALLOWED_ORIGINS: 'http://localhost:5501' };
const item = (id, warehouseCode = 'MKS66') => ({ inventoryId:id, locationCode:'LOCATION-'+id, warehouseId:53, warehouseCode, productId:85530, availableQuantity:'1', lockedQuantity:'0', inventoryQuantity:'4', sourceFields:{secret:'private'}, preferredLocation:'untrusted' });
const pageResponse = (items, total=items.length, page=1) => Response.json({code:0,message:'success',data:{page,pageSize:200,total,items}});
const service = fetchImpl => createWarehouseInventoryLookupService(env,{fetchImpl});
test('SKU and env secret sent only upstream; allowlisted rows retain order and numeric quantities',async()=>{
 const rows=[item(2),item(1,'OTHER'),item(3)];let calls=0;
 const result=await service(async(url,init)=>{calls++;assert.equal(url,DEFAULT_API_URL);assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers['X-API-Key'],env.MKITE_WAREHOUSE_API_KEY);assert.deepEqual(JSON.parse(init.body),{product_sku:'AbC /+_-.* 123',page:1,pageSize:200});return pageResponse(rows);}).lookup({sku:'  AbC /+_-.* 123  '});
 assert.equal(calls,1);assert.equal(result.sku,'AbC /+_-.* 123');assert.equal(result.total,3);assert.deepEqual(result.locations.map(r=>r.inventoryId),['2','1','3']);
 assert.equal(result.locations[0].availableQuantity,1);assert.equal(result.locations[0].lockedQuantity,0);assert.equal(result.locations[0].inventoryQuantity,4);assert.equal(result.locations[0].warehouseId,'53');
 assert.doesNotMatch(JSON.stringify(result),/mock-worker-secret|sourceFields|preferredLocation|recommendedLocation|primaryLocation|private/);
});
test('warehouse filtering is exact after trimming and never combines rows',async()=>{
 const result=await service(async()=>pageResponse([item(1),item(2,' MKS66 '),item(3,'MKS660'),item(4,'mks66')])).lookup({sku:'X',warehouseCode:' MKS66 '});assert.equal(result.total,2);assert.deepEqual(result.locations.map(r=>r.availableQuantity),[1,1]);
 assert.equal((await service(async()=>pageResponse([item(1)])).lookup({sku:'X',warehouseCode:'NONE'})).total,0);
});
test('warehouseCodes filters exact trimmed deduplicated codes and preserves response order',async()=>{
 const rows=[item(1,'TO20'),item(2,'OTHER'),item(3,' MKS66 '),item(4,'TO20')];
 const result=await service(async()=>pageResponse(rows)).lookup({sku:'X',warehouseCodes:[' MKS66 ','TO20','TO20',' ']});
 assert.equal(result.total,3);assert.deepEqual(result.locations.map(row=>row.inventoryId),['1','3','4']);
 assert.deepEqual((await service(async()=>pageResponse(rows)).lookup({sku:'X',warehouseCodes:[]})).locations,[]);
 assert.equal((await service(async()=>pageResponse(rows)).lookup({sku:'X'})).total,4);
});
for(const value of ['bad','',null,undefined,true,{},'0x10','Infinity','9007199254740993'])test(`unsafe quantity ${String(value)} is null, never zero`,async()=>{
 const result=await service(async()=>pageResponse([{...item(1),availableQuantity:value}])).lookup({sku:'X'});assert.equal(result.locations[0].availableQuantity,null);
});
test('zero rows is a successful empty response',async()=>{assert.deepEqual(await service(async()=>pageResponse([])).lookup({sku:'X'}),{ok:true,sku:'X',total:0,locations:[]});});
test('pagination collects beyond 200 before filtering',async()=>{
 const calls=[];const result=await service(async(url,init)=>{const {page}=JSON.parse(init.body);calls.push(page);return pageResponse(page===1?Array.from({length:200},(_,i)=>item(i,'OTHER')):[item(200)],201,page);}).lookup({sku:'X',warehouseCode:'MKS66'});
 assert.deepEqual(calls,[1,2]);assert.equal(result.total,1);assert.equal(result.locations[0].inventoryId,'200');
});
test('page cap returns controlled error without partial output',async()=>{
 let calls=0;await assert.rejects(service(async(url,init)=>{const {page}=JSON.parse(init.body);calls++;return pageResponse([item(page)],26,page);}).lookup({sku:'X'}),e=>e.code==='WAREHOUSE_API_PAGINATION_LIMIT');assert.equal(calls,MAX_PAGES);
});
for(const [status,code] of [[401,'WAREHOUSE_API_UNAUTHORIZED'],[429,'WAREHOUSE_API_RATE_LIMITED'],[502,'WAREHOUSE_API_UNAVAILABLE'],[400,'WAREHOUSE_API_FAILED']])test(`HTTP ${status} sanitized`,async()=>{
 await assert.rejects(service(async()=>new Response(env.MKITE_WAREHOUSE_API_KEY,{status})).lookup({sku:'X'}),e=>e.code===code&&!e.message.includes(env.MKITE_WAREHOUSE_API_KEY));
});
test('network failure sanitized',async()=>{await assert.rejects(service(async()=>{throw Error(env.MKITE_WAREHOUSE_API_KEY);}).lookup({sku:'X'}),e=>e.code==='WAREHOUSE_API_UNAVAILABLE'&&!e.message.includes(env.MKITE_WAREHOUSE_API_KEY));});
for(const bodyDelay of [false,true])test(`timeout covers ${bodyDelay?'body parsing':'fetch'} and aborts`,async()=>{
 let signal;const client=createWarehouseInventoryLookupService(env,{timeoutMs:5,fetchImpl:async(url,init)=>{signal=init.signal;return bodyDelay?{ok:true,json:()=>new Promise(()=>{})}:new Promise(()=>{});}});
 await assert.rejects(client.lookup({sku:'X'}),e=>e.code==='WAREHOUSE_API_TIMEOUT');assert.equal(signal.aborted,true);
});
for(const [body,code] of [['not JSON','WAREHOUSE_API_INVALID_RESPONSE'],[{code:9,message:env.MKITE_WAREHOUSE_API_KEY},'WAREHOUSE_API_FAILED'],[{code:0,data:{items:{}}},'WAREHOUSE_API_INVALID_RESPONSE'],[{code:0,data:{page:1,pageSize:200,total:1,items:[null]}},'WAREHOUSE_API_INVALID_RESPONSE']])test(`invalid upstream ${JSON.stringify(body)}`,async()=>{
 await assert.rejects(service(async()=>new Response(typeof body==='string'?body:JSON.stringify(body))).lookup({sku:'X'}),e=>e.code===code&&!e.message.includes(env.MKITE_WAREHOUSE_API_KEY));
});
for(const mode of ['empty','repeated','changed-total','wrong-page'])test(`inconsistent pagination ${mode} fails closed`,async()=>{
 await assert.rejects(service(async(url,init)=>{const {page}=JSON.parse(init.body);return page===1?pageResponse([item(1)],3):pageResponse(mode==='empty'?[]:[item(mode==='repeated'?1:2)],mode==='changed-total'?4:3,mode==='wrong-page'?1:page);}).lookup({sku:'X'}),e=>e.code==='WAREHOUSE_API_INVALID_RESPONSE');
});
test('missing secret and unsafe URL fail before fetch',async()=>{
 for(const config of [{},{MKITE_WAREHOUSE_API_KEY:' '},{...env,MKITE_WAREHOUSE_API_URL:'http://unsafe.example'},{...env,MKITE_WAREHOUSE_API_URL:'https://user:password@example.com'}])await assert.rejects(createWarehouseInventoryLookupService(config,{fetchImpl:()=>assert.fail('fetch forbidden')}).lookup({sku:'X'}),e=>e.code==='WAREHOUSE_API_NOT_CONFIGURED');
});
test('invalid inputs rejected before upstream',async()=>{
 const s=service(()=>assert.fail('fetch forbidden'));for(const input of [null,[],{}, {sku:''},{sku:'   '},{sku:42},{sku:'X',warehouseCode:42},{sku:'X',warehouseCodes:'MKS66'},{sku:'X',warehouseCodes:['MKS66',42]}])await assert.rejects(s.lookup(input),e=>e.status===400);
});
test('route uses existing origin, method and JSON policies with no Feishu calls',async t=>{
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.equal(url,DEFAULT_API_URL);assert.equal(init.method,'POST');return pageResponse([item(1)]);});
 const req=(method='POST',origin='http://localhost:5501',body='{"sku":"X"}')=>new Request('http://127.0.0.1:8787/api/inventory/lookup',{method,headers:{Origin:origin,'Content-Type':'application/json'},...(['POST'].includes(method)?{body}:{})});
 const good=await handleRequest(req(),env);assert.equal(good.status,200);assert.equal(good.headers.get('Access-Control-Allow-Origin'),'http://localhost:5501');assert.equal((await good.json()).locations.length,1);
 assert.equal((await handleRequest(req('POST','https://blocked.example'),env)).status,403);
 assert.equal((await handleRequest(req('OPTIONS'),env)).status,204);assert.equal((await handleRequest(req('GET'),env)).status,405);
 assert.equal((await handleRequest(req('POST','http://localhost:5501','bad'),env)).status,400);
 assert.equal((await handleRequest(req('POST','http://localhost:5501','x'.repeat(17000)),env)).status,413);
 const missing=await handleRequest(req(),{ALLOWED_ORIGINS:env.ALLOWED_ORIGINS});assert.equal(missing.status,503);assert.equal((await missing.json()).error.code,'WAREHOUSE_API_NOT_CONFIGURED');
});

test('workerd-compatible manual redirects trim configuration and reject redirect responses without following',async()=>{
 let calls=0;const s=createWarehouseInventoryLookupService({MKITE_WAREHOUSE_API_KEY:'  mock-secret \n',MKITE_WAREHOUSE_API_URL:'  '+DEFAULT_API_URL+'  '},{fetchImpl:async(url,init)=>{
  calls++;assert.equal(url,DEFAULT_API_URL);assert.equal(init.redirect,'manual');assert.equal(init.headers['X-API-Key'],'mock-secret');assert.equal(init.signal.aborted,false);return new Response(null,{status:302,headers:{Location:'https://untrusted.example'}});
 }});
 await assert.rejects(s.lookup({sku:'X'}),e=>e.code==='WAREHOUSE_API_FAILED');assert.equal(calls,1);
});
test('default timeout is 10000 milliseconds and does not abort a normal delayed request',async t=>{
 const {REQUEST_TIMEOUT_MS}=await import('../src/modules/inventory-lookup/inventory-client.js');assert.equal(REQUEST_TIMEOUT_MS,10000);
 const original=globalThis.setTimeout;const delays=[];t.mock.method(globalThis,'setTimeout',(fn,ms,...args)=>{delays.push(ms);return original(fn,ms,...args);});
 const result=await service(async(url,init)=>{assert.equal(init.signal.aborted,false);await new Promise(resolve=>original(resolve,30));assert.equal(init.signal.aborted,false);return pageResponse([item(1)]);}).lookup({sku:'X'});
 assert.equal(result.total,1);assert.deepEqual(delays,[10000]);
});

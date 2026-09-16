const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const flush=()=>new Promise(r=>setImmediate(r));
function setup(options={}){const calls=[],pending=[],window={MkiteApiClient:{post:(path,body)=>{calls.push({path,body});return new Promise((resolve,reject)=>pending.push({resolve,reject}));}}};vm.runInNewContext(fs.readFileSync('js/services/inventory-location-lookup.js','utf8'),{window});return {window,calls,pending,cache:window.MkiteInventoryLocations.create(options)};}
const reply=(sku,locations=[])=>({ok:true,data:{sku,total:locations.length,locations}});
test('trimmed exact SKU keys reuse pending, success and errors without polling',async()=>{
 const h=setup();for(const sku of ['',null,42])h.cache.ensure(sku);assert.equal(h.calls.length,0);
 h.cache.ensure(' Part/A ');h.cache.ensure('Part/A');assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.warehouseCode,'MKS66');h.pending[0].resolve(reply('Part/A'));await flush();h.cache.ensure('Part/A');assert.equal(h.cache.get('Part/A').total,0);assert.equal(h.calls.length,1);
 h.cache.ensure('part/a');h.pending[1].reject(Error('private'));await flush();h.cache.ensure('part/a');assert.equal(h.calls.length,2);assert.equal(h.cache.get('part/a').state,'error');assert.doesNotMatch(JSON.stringify(h.cache.get('part/a')),/private/);
});
test('normalizes minimal result, preserves order, null and all locations',async()=>{
 const h=setup();h.cache.ensure('P');h.pending[0].resolve(reply('P',[{locationCode:'Z',warehouseCode:' MKS66 ',availableQuantity:0,sourceFields:{private:1}},{locationCode:'A',warehouseCode:'MKS66',availableQuantity:null}]));await flush();const result=h.cache.get('P');assert.equal(result.sku,'P');assert.equal(result.total,2);assert.equal(result.locations[0].warehouseCode,'MKS66');assert.equal(result.locations[0].availableQuantity,0);assert.equal(result.locations[1].availableQuantity,null);assert.equal(result.locations[0].sourceFields,undefined);
});
test('optional warehouseCodes request preserves allowed mixed-warehouse rows',async()=>{
 const h=setup({warehouseCodes:[' MKS66 ','TO20','TO20',' ']});h.cache.ensure('P');assert.deepEqual(structuredClone(h.calls[0].body),{sku:'P',warehouseCodes:['MKS66','TO20']});
 h.pending[0].resolve(reply('P',[{locationCode:'T',warehouseCode:'TO20',availableQuantity:1},{locationCode:'M',warehouseCode:'MKS66',availableQuantity:2}]));await flush();
 assert.deepEqual(h.cache.get('P').locations.map(row=>row.warehouseCode),['TO20','MKS66']);
});
for(const data of [{sku:'OTHER',total:0,locations:[]},{sku:'P',total:1,locations:[]},{sku:'P',total:1,locations:[null]},{sku:'P',total:1,locations:[{locationCode:'L',warehouseCode:'OTHER'}]}])test(`invalid contract is controlled ${JSON.stringify(data)}`,async()=>{const h=setup();h.cache.ensure('P');h.pending[0].resolve({ok:true,data});await flush();assert.equal(h.cache.get('P').state,'error');});
test('concurrency bounded even with invalid settings and callback exceptions never stall queue',async()=>{
 for(const concurrency of [999,NaN]){const h=setup({concurrency,onChange(){throw Error('detached UI');}});for(let i=0;i<7;i++)h.cache.ensure('P'+i);assert.equal(h.calls.length,4);h.pending[0].resolve(reply('P0'));await flush();assert.equal(h.calls.length,5);h.cache.dispose();h.pending[1].reject(Error('offline'));await flush();assert.equal(h.calls.length,5);assert.equal(h.cache.get('P1'),undefined);}
});
test('both tools use shared inventory request implementation and frontend has no upstream secret references',()=>{
 for(const path of ['js/client-tools/tineco-toc/tineco-toc.js','js/client-tools/b044/put-away-scan.js']){const source=fs.readFileSync(path,'utf8');assert.match(source,/MkiteInventoryLocations/);assert.doesNotMatch(source,/\/api\/inventory\/lookup|MKITE_WAREHOUSE_API_KEY|tool\.mkite\.cn/);}
 const source=fs.readFileSync('js/services/inventory-location-lookup.js','utf8');assert.match(source,/MkiteApiClient.post/);assert.doesNotMatch(source,/fetch\(|localStorage|MKITE_WAREHOUSE_API_KEY|X-API-Key|tool\.mkite\.cn/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const production = 'https://mkite-secure-api.mkite-api.workers.dev';
function setup(origin) {
  const calls = [];
  const window = { location: {origin,hostname:origin&&origin!=='null'?new URL(origin).hostname:''}, fetch: async (url, init) => {calls.push({url,init});return {ok:true,json:async()=>({ok:true,data:[]})};} };
  for (const name of ['api-config','api-client']) vm.runInNewContext(fs.readFileSync(`js/services/${name}.js`,'utf8'),{window});
  return {window,calls};
}
for (const origin of ['http://127.0.0.1:5501','http://localhost:5501']) {
  test(`${origin} sends all User Management requests to localhost, preserving authorization`,async()=>{
    const {window,calls}=setup(origin);
    for (const action of ['list','tools','get','create','update']) await window.MkiteApiClient.post(`/api/users/${action}`,{}, {authorization:'Bearer test-only'});
    for (const c of calls) { assert.ok(c.url.startsWith('http://127.0.0.1:8787/api/users/'));assert.equal(c.init.headers.Authorization,'Bearer test-only'); }
    assert.equal(window.MkiteApiConfig.baseUrl,'http://127.0.0.1:8787');
  });
  test(`${origin} routes every operational API to the local Worker`,async()=>{
    const {window,calls}=setup(origin);
    for (const path of ['/api/receiving','/api/b044/put-away/prepare','/api/tineco-toc/begin','/api/inventory/search','/api/ai/simplify-command']) await window.MkiteApiClient.post(path,{});
    for (const c of calls) assert.ok(c.url.startsWith('http://127.0.0.1:8787/'));
  });
}
test('production and other origins never opt into the local Worker',async()=>{
  for (const origin of ['https://alger-pixel.github.io','http://localhost.example:5501','null',undefined]) {
    const {window,calls}=setup(origin);await window.MkiteApiClient.post('/api/users/list',{});assert.equal(calls[0].url,`${production}/api/users/list`);
  }
});
test('production guard blocks a captured client from using a localhost API override',async()=>{
  const {window,calls}=setup('https://alger-pixel.github.io');const captured=window.MkiteApiClient;
  await captured.post('/api/users/list',{});
  window.MkiteApiConfig=Object.freeze({...window.MkiteApiConfig,baseUrl:'http://127.0.0.1:8787'});
  const response=await captured.post('/api/users/list',{});
  assert.equal(calls[0].url,`${production}/api/users/list`);assert.equal(calls.length,1);assert.equal(response.ok,false);assert.equal(response.error.code,'API_CONFIGURATION_ERROR');assert.equal(response.error.message,'Production API configuration is invalid.');
});
test('local failure never retries against production',async()=>{
  const {window,calls}=setup('http://localhost:5501');window.fetch=async url=>{calls.push({url});throw new Error('offline');};
  const response=await window.MkiteApiClient.post('/api/users/list',{});assert.equal(response.ok,false);assert.equal(response.error.code,'CONNECTION_ERROR');assert.equal(response.error.message,'Local Worker is not running on port 8787.');assert.equal(calls.length,2);assert.equal(calls[0].url,'http://127.0.0.1:8787/api/users/list');assert.equal(calls[1].url,'http://127.0.0.1:8787/api/health');
});
test('reachable local Worker reports a CORS or browser connection-policy failure accurately',async()=>{
  const {window,calls}=setup('http://127.0.0.1:5501');let attempt=0;window.fetch=async(url,init)=>{calls.push({url,init});if(attempt++===0)throw new TypeError('Failed to fetch');return {type:'opaque'};};
  const response=await window.MkiteApiClient.get('/api/sops');assert.equal(response.ok,false);assert.equal(response.error.code,'API_CONNECTION_ERROR');assert.match(response.error.message,/blocked by CORS or another browser connection policy/);assert.equal(calls[1].url,'http://127.0.0.1:8787/api/health');assert.equal(calls[1].init.mode,'no-cors');
});
test('SOP configuration and Feishu failures keep their controlled Worker errors',async()=>{
  for(const error of [{code:'SOP_NOT_CONFIGURED',message:'SOP CLASS table is not configured.'},{code:'SOP_REQUEST_FAILED',message:'Unable to complete the SOP request.'}]){const {window}=setup('http://127.0.0.1:5501');window.fetch=async()=>({ok:false,status:503,json:async()=>({ok:false,error})});const response=await window.MkiteApiClient.get('/api/sops');assert.equal(response.error.code,error.code);assert.equal(response.error.message,error.message);assert.doesNotMatch(response.error.message,/not running/);}
});
test('HTML versions config and client scripts together',()=>{
  const html=fs.readFileSync('index.html','utf8');for(const file of ['api-config','api-client'])assert.ok(html.includes(`${file}.js?v=api-environment-guard-2`));
});

for(const origin of ['http://localhost:5502','https://localhost:5501','http://127.0.0.1:9000'])test(`hostname determines local base: ${origin}`,()=>{assert.equal(setup(origin).window.MkiteApiConfig.baseUrl,'http://127.0.0.1:8787');});
test('shared resolver identifies environments and rejects local bases on production hosts',()=>{
 const local=setup('http://localhost:5501').window,loopback=setup('http://127.0.0.1:5501').window,prod=setup('https://alger-pixel.github.io').window;
 assert.equal(local.MkiteApiEnvironment.resolveApiBase('localhost'),'http://127.0.0.1:8787');assert.equal(loopback.MkiteApiConfig.environment,'LOCAL');assert.equal(prod.MkiteApiEnvironment.resolveApiBase('alger-pixel.github.io'),production);assert.equal(prod.MkiteApiConfig.environment,'PRODUCTION');
 assert.throws(()=>prod.MkiteApiEnvironment.assertSafeApiBase('alger-pixel.github.io','http://localhost:8787'),/Production API configuration is invalid/);
});
test('Settings exposes only the compact shared API environment indicator',()=>{const source=fs.readFileSync('js/app.js','utf8');assert.match(source,/API: \$\{escapeHtml\(api\.environment\)\}/);assert.match(source,/new URL\(api\.baseUrl\)\.host/);assert.doesNotMatch(source,/MKITE_WAREHOUSE_API_KEY|X-API-Key/);});
test('inventory helper sends through shared config on local and production hosts',async()=>{
 for(const origin of ['http://localhost:5501','http://127.0.0.1:5501','https://alger-pixel.github.io']){
  const {window,calls}=setup(origin);window.fetch=async(url,init)=>{calls.push({url,init});return {ok:true,json:async()=>({ok:true,sku:'P',total:0,locations:[]})};};
  vm.runInNewContext(fs.readFileSync('js/services/inventory-location-lookup.js','utf8'),{window});const cache=window.MkiteInventoryLocations.create();cache.ensure('P');await new Promise(r=>setImmediate(r));
  assert.equal(calls[0].url,`${origin.includes('github.io')?production:'http://127.0.0.1:8787'}/api/inventory/lookup`);assert.equal(cache.get('P').state,'ready');cache.dispose();
 }
 for(const file of ['js/client-tools/tineco-toc/tineco-toc.js','js/client-tools/b044/put-away-scan.js'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/mkite-secure-api\.mkite-api\.workers\.dev|http:\/\/127\.0\.0\.1:8787/);
});

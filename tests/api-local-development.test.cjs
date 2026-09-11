const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const production = 'https://mkite-secure-api.mkite-api.workers.dev';
function setup(origin) {
  const calls = [];
  const window = { location: {origin}, fetch: async (url, init) => {calls.push({url,init});return {ok:true,json:async()=>({ok:true,data:[]})};} };
  for (const name of ['api-config','api-client']) vm.runInNewContext(fs.readFileSync(`js/services/${name}.js`,'utf8'),{window});
  return {window,calls};
}
for (const origin of ['http://127.0.0.1:5501','http://localhost:5501']) {
  test(`${origin} sends all User Management requests to localhost, preserving authorization`,async()=>{
    const {window,calls}=setup(origin);
    for (const action of ['list','tools','get','create','update']) await window.MkiteApiClient.post(`/api/users/${action}`,{}, {authorization:'Bearer test-only'});
    for (const c of calls) { assert.ok(c.url.startsWith('http://localhost:8787/api/users/'));assert.equal(c.init.headers.Authorization,'Bearer test-only'); }
    assert.equal(window.MkiteApiConfig.baseUrl,production);
  });
  test(`${origin} leaves operational API targets unchanged`,async()=>{
    const {window,calls}=setup(origin);
    for (const path of ['/api/receiving','/api/b044/put-away/prepare','/api/tineco-toc/begin','/api/inventory/search','/api/ai/simplify-command']) await window.MkiteApiClient.post(path,{});
    for (const c of calls) assert.ok(c.url.startsWith(production));
  });
}
test('production and other origins never opt into the local Worker',async()=>{
  for (const origin of ['https://alger-pixel.github.io','http://localhost:5502','https://localhost:5501','http://localhost.example:5501','null',undefined]) {
    const {window,calls}=setup(origin);await window.MkiteApiClient.post('/api/users/list',{});assert.equal(calls[0].url,`${production}/api/users/list`);
  }
});
test('API client reads current configuration even when its object has been captured',async()=>{
  const {window,calls}=setup('https://alger-pixel.github.io');const captured=window.MkiteApiClient;
  await captured.post('/api/users/list',{});
  window.MkiteApiConfig=Object.freeze({...window.MkiteApiConfig,baseUrl:'http://localhost:8787'});
  await captured.post('/api/users/list',{});
  assert.equal(calls[0].url,`${production}/api/users/list`);assert.equal(calls[1].url,'http://localhost:8787/api/users/list');
});
test('local failure never retries against production',async()=>{
  const {window,calls}=setup('http://localhost:5501');window.fetch=async url=>{calls.push({url});throw new Error('offline');};
  const response=await window.MkiteApiClient.post('/api/users/list',{});assert.equal(response.ok,false);assert.equal(calls.length,1);assert.equal(calls[0].url,'http://localhost:8787/api/users/list');
});
test('HTML versions config and client scripts together',()=>{
  const html=fs.readFileSync('index.html','utf8');for(const file of ['api-config','api-client'])assert.ok(html.includes(`${file}.js?v=user-management-local-1`));
});

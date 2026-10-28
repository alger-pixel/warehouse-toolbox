import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';
import { isMutationRequest,shouldBlockProductionMutation } from '../src/security/mutation-guard.js';

const origin='http://127.0.0.1:5501';
const base={ALLOWED_ORIGINS:origin,FEISHU_DATA_ENVIRONMENT:'production',WORKER_RUNTIME_ENVIRONMENT:'development'};
const configured={...base,FEISHU_APP_ID:'app',FEISHU_APP_SECRET:'secret',FEISHU_BASE_APP_TOKEN:'base',FEISHU_PACKAGE_TABLE_ID:'packages',FEISHU_CLIENT_TABLE_ID:'clients',FEISHU_PICKING_LIST_TABLE_ID:'lists',FEISHU_TINECO_TOC_UNIT_TABLE_ID:'tineco'};
const request=(path,body={})=>new Request(`http://127.0.0.1:8787${path}`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
const productionRequest=(path,body={})=>{const value=request(path,body);Object.defineProperty(value,'cf',{value:{colo:'YYZ'}});return value;};

test('local runtime blocks production-data mutation routes before any coordinator runs',async()=>{
 for(const path of ['/api/b044/put-away/create-picking-list','/api/b044/put-away/cancel-picking-list','/api/b044/put-away/reconcile/execute','/api/tineco-toc/begin','/api/receiving','/api/location-move','/api/clients','/api/users/create','/api/operation-news']){
  const response=await handleRequest(request(path),configured),payload=await response.json();
  assert.equal(response.status,403,path);assert.equal(payload.error.code,'LOCAL_PRODUCTION_MUTATION_BLOCKED',path);
 }
 const statusRequest=new Request('http://127.0.0.1:8787/api/operation-news/NEWS-20261026-AAAAAA/status',{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),statusResponse=await handleRequest(statusRequest,configured);assert.equal(statusResponse.status,403);assert.equal((await statusResponse.json()).error.code,'LOCAL_PRODUCTION_MUTATION_BLOCKED');
});

test('read-only B044 diagnosis remains available in local runtime against production data',async()=>{
 let called=false;const env={...configured,B044_PUT_AWAY:{idFromName:name=>name,get:()=>({fetch:async()=>{called=true;return Response.json({ok:true,data:{phase:'operational'}});}})}};
 const response=await handleRequest(request('/api/b044/put-away/reconcile/diagnose'),env);
 assert.equal(response.status,200);assert.equal(called,true);
});

test('production Cloudflare runtime preserves authorized production mutation behavior',async()=>{
 let b044=false,tineco=false;const env={...configured,WORKER_RUNTIME_ENVIRONMENT:'production',PRODUCTION_MUTATION_AUTHORIZATION:'test-only-production-authorization',B044_PUT_AWAY:{idFromName:name=>name,get:()=>({fetch:async()=>{b044=true;return Response.json({ok:true,data:{phase:'operational'}});}})},TINECO_TOC:{idFromName:name=>name,get:()=>({fetch:async()=>{tineco=true;return Response.json({ok:true,data:{phase:'draft'}});}})}};
 assert.equal((await handleRequest(productionRequest('/api/b044/put-away/create-picking-list'),env)).status,200);
 assert.equal((await handleRequest(productionRequest('/api/tineco-toc/begin'),env)).status,200);
 assert.equal(b044,true);assert.equal(tineco,true);
});

test('production-shaped requests still fail closed when the deployment-only authorization secret is absent',async()=>{
 const response=await handleRequest(productionRequest('/api/b044/put-away/create-picking-list'),{...configured,WORKER_RUNTIME_ENVIRONMENT:'production'});
 assert.equal(response.status,403);assert.equal((await response.json()).error.code,'LOCAL_PRODUCTION_MUTATION_BLOCKED');
});

test('local test target permits only B044 mutations and cannot be activated by request headers',async()=>{
 let called=false;const binding={idFromName:name=>name,get:()=>({fetch:async()=>{called=true;return Response.json({ok:true,data:{phase:'operational'}});}})},local={...configured,FEISHU_DATA_ENVIRONMENT:'local-test',WORKER_RUNTIME_ENVIRONMENT:'development',B044_LOCAL_TEST_DATA:'enabled',B044_PUT_AWAY:binding};
 assert.equal((await handleRequest(request('/api/b044/put-away/create-picking-list'),local)).status,200);assert.equal(called,true);
 const other=await handleRequest(request('/api/receiving'),local);assert.equal(other.status,403);assert.equal((await other.json()).error.code,'LOCAL_PRODUCTION_MUTATION_BLOCKED');
 const headerRequest=request('/api/b044/put-away/create-picking-list');headerRequest.headers.set('X-B044-Local-Test-Data','enabled');
 const blocked=await handleRequest(headerRequest,configured);assert.equal(blocked.status,403);assert.equal((await blocked.json()).error.code,'LOCAL_PRODUCTION_MUTATION_BLOCKED');
});

test('production runtime cannot activate B044 local test data mode',async()=>{
 let called=false;const env={...configured,FEISHU_DATA_ENVIRONMENT:'local-test',WORKER_RUNTIME_ENVIRONMENT:'production',B044_LOCAL_TEST_DATA:'enabled',B044_PUT_AWAY:{idFromName:name=>name,get:()=>({fetch:async()=>{called=true;return Response.json({ok:true});}})}};
 const response=await handleRequest(productionRequest('/api/b044/put-away/create-picking-list'),env),payload=await response.json();
 assert.equal(response.status,403);assert.equal(payload.error.code,'LOCAL_PRODUCTION_MUTATION_BLOCKED');assert.equal(called,false);
});

test('controlled Operation News authorization is local-only, server-configured and route-scoped',()=>{
 const authorization='a'.repeat(64),local={...configured,OPERATION_NEWS_LOCAL_E2E:'enabled',OPERATION_NEWS_LOCAL_E2E_AUTHORIZATION:authorization},collection={name:'operation-news',action:'collection'},status={name:'operation-news',action:'status'};
 assert.equal(shouldBlockProductionMutation(request('/api/operation-news'),local,'operation-news',collection),false);
 const patch=new Request('http://127.0.0.1:8787/api/operation-news/NEWS-20261026-AAAAAA/status',{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(shouldBlockProductionMutation(patch,local,'operation-news',status),false);
 assert.equal(shouldBlockProductionMutation(request('/api/receiving'),local,'receive','receive'),true);
 for(const unsafe of [{...local,OPERATION_NEWS_LOCAL_E2E:'disabled'},{...local,OPERATION_NEWS_LOCAL_E2E_AUTHORIZATION:''},{...local,OPERATION_NEWS_LOCAL_E2E_AUTHORIZATION:'wrong-authorization'},{...local,WORKER_RUNTIME_ENVIRONMENT:'production'}])assert.equal(shouldBlockProductionMutation(request('/api/operation-news'),unsafe,'operation-news',collection),true);
 const browser=request('/api/operation-news');browser.headers.set('X-Operation-News-Local-E2E','enabled');assert.equal(shouldBlockProductionMutation(browser,configured,'operation-news',collection),true);
});

test('mutation classification covers shared operational writers and retains explicit read-only POST routes',()=>{
 for(const route of ['b044-create','b044-cancel','b044-reconcile-execute','tineco-begin','receive','location-move','client-create','users-create','sops-create','part-used-report-create','operation-news'])assert.equal(isMutationRequest(route,null,'POST'),true,route);
 assert.equal(isMutationRequest('operation-news',null,'PATCH'),true);
 for(const route of ['b044-prepare','b044-recover','b044-reconcile','b044-reconcile-diagnose','picking-search','inventory-lookup','tineco-inventory','users-list'])assert.equal(isMutationRequest(route,null,'POST'),false,route);
 assert.equal(isMutationRequest('projects',{action:null},'POST'),true);assert.equal(isMutationRequest('cases',{action:null},'POST'),true);assert.equal(isMutationRequest('projects',{action:null},'GET'),false);
});

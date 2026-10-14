import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaseAssignmentService,operationalCategories} from '../src/modules/cases/case-options-service.js';
import {handleRequest} from '../src/index.js';

const secret='test-only-case-administration-key-0001';
const origins=['http://127.0.0.1:5501','https://example.github.io'];
const category={record_id:'private-category-id',fields:{'CASE CATEGORY ID':'CC-MKS66-001','CLIENT ID':'TINECO','MAIN CATEGORY':'Receiving','CASE CATEGORY NAME':'Receive','WAREHOUSE ID':'MKS66',STATUS:'Active','DEFAULT PRIORITY':'Normal','DEFAULT INSTRUCTION':'Inspect.','REQUIRE COMPLETION PHOTO':'No','SORT ORDER':1,NOTE:'private admin note','CREATED BY':'private audit'}};
const worker=(id,overrides={})=>({record_id:'private-user-id',fields:{'USER ID':id,'DISPLAY NAME':'Worker '+id,STATUS:'Active','WAREHOUSE ACCESS':'MKS66','IS ADMIN':'',ACCOUNT:'private account','PASSWORD HASH':'private password','CLIENT ACCESS':'private client','ACCESSIBLE TOOL IDS':'private tools',...overrides}});
const env={FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'private-app-secret',FEISHU_BASE_APP_TOKEN:'base',FEISHU_PACKAGE_TABLE_ID:'packages',FEISHU_CLIENT_TABLE_ID:'clients',FEISHU_CASE_CATEGORY_TABLE_ID:'categories',FEISHU_USER_TABLE_ID:'users',ALLOWED_ORIGINS:origins.join(',')};

test('minimal assignment projection reads only required fields and preserves active admin warehouse eligibility',async()=>{
 const calls=[],rows=[worker('U-1'),worker('U-2',{STATUS:'Disabled'}),worker('U-3',{'WAREHOUSE ACCESS':'MKS159'}),worker('U-4',{'IS ADMIN':'Admin','WAREHOUSE ACCESS':''})];
 const service=createCaseAssignmentService({appToken:'base',userTableId:'users',caseCategoryTableId:'categories'},{listRecords:async args=>{calls.push(args);return args.tableId==='users'?rows:[category];}});
 const {workers}=await service.list();assert.deepEqual(workers.map(row=>row.userId),['U-1','U-3','U-4']);assert.deepEqual(workers[2].warehouses,['MKS66']);
 assert.deepEqual(Object.keys(workers[0]),['userId','displayName','status','warehouses']);assert.deepEqual(calls[0].fieldNames,['USER ID','DISPLAY NAME','STATUS','IS ADMIN','WAREHOUSE ACCESS']);assert.doesNotMatch(JSON.stringify(workers),/private|account|isAdmin|password|tool|client|record_id/);
});

test('assignment identity conflicts remain operational errors',async()=>{
 const service=createCaseAssignmentService({userTableId:'users',caseCategoryTableId:'categories'},{listRecords:async({tableId})=>tableId==='users'?[worker('U-1'),worker('U-1')]:[]});
 await assert.rejects(service.list(),error=>error.code==='CASE_ASSIGNMENT_DATA_CONFLICT');
});

test('operational category projection excludes inactive categories and administration fields',()=>{
 const result=operationalCategories({categories:[{categoryId:'A',status:'Active',note:'private',createdBy:'private',recordId:'private'},{categoryId:'B',status:'Inactive'}]});assert.equal(result.categories.length,1);assert.equal(result.categories[0].categoryId,'A');assert.doesNotMatch(JSON.stringify(result),/private|note|recordId|createdBy/);
});

test('real Worker operational routes load without any admin key at localhost and production origins; methods cannot mutate',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{
  calls.push({url:String(url),init});if(String(url).includes('tenant_access_token'))return Response.json({code:0,tenant_access_token:'private-token',expire:7200});
  return Response.json({code:0,data:{items:String(url).includes('/tables/users/')?[worker('U-1'),worker('U-2',{STATUS:'Disabled'})]:[category],has_more:false}});
 };
 try{for(const origin of origins){for(const [path,key] of [['categories','categories'],['assignment-options','workers']]){
  const response=await handleRequest(new Request(`https://worker.example/api/cases/${path}`,{headers:{Origin:origin}}),env),payload=await response.json();assert.equal(response.status,200);assert.equal(payload.data[key].length,1);assert.doesNotMatch(JSON.stringify(payload),/private|password|account|isAdmin|toolIds|admin key/);
  for(const method of ['POST','PUT','DELETE'])assert.equal((await handleRequest(new Request(`https://worker.example/api/cases/${path}`,{method,headers:{Origin:origin},body:'{}'}),env)).status,405);
 }}assert.ok(calls.some(call=>call.url.includes('/tables/users/')));}finally{globalThis.fetch=original;}
});

test('Settings category reads, create, update, delete and User Management administration stay locked without authorization',async()=>{
 for(const configured of [env,{...env,USER_MANAGEMENT_ADMIN_KEY:secret}]){
  for(const [method,path] of [['GET','/api/case-categories'],['GET','/api/case-categories/CC-MKS66-001'],['POST','/api/case-categories'],['PUT','/api/case-categories/CC-MKS66-001'],['DELETE','/api/case-categories/CC-MKS66-001']]){
   const response=await handleRequest(new Request('https://worker.example'+path,{method,...(method==='GET'?{}:{body:'{}'})}),configured);assert.equal(response.status,401);assert.equal((await response.json()).error.code,'ADMIN_KEY_REQUIRED');
  }
  for(const action of ['get','tools','create','update']){const response=await handleRequest(new Request(`https://worker.example/api/users/${action}`,{method:'POST',body:'{}'}),configured);assert.ok([401,503].includes(response.status));}
 }
});

test('valid administration key unlocks category reads; wrong key cannot unlock Settings',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async url=>String(url).includes('tenant_access_token')?Response.json({code:0,tenant_access_token:'private-token',expire:7200}):Response.json({code:0,data:{items:[category],has_more:false}});
 try{for(const key of [secret,'wrong-key-but-long-enough-for-the-form']){const response=await handleRequest(new Request('https://worker.example/api/case-categories',{headers:{Authorization:`Bearer ${key}`}}),{...env,USER_MANAGEMENT_ADMIN_KEY:secret});assert.equal(response.status,key===secret?200:401);if(key===secret)assert.equal((await response.json()).data.categories[0].note,'private admin note');}}finally{globalThis.fetch=original;}
});

test('operational read failures retain their message and receive an operational server error classification',async()=>{
 const {caseRouteFor,handleCases}=await import('../src/modules/cases/case-controller.js');
 const request=new Request('https://worker.example/api/cases/assignment-options');
 const response=await handleCases(request,env,'id',caseRouteFor(new URL(request.url).pathname),{optionsService:{list:async()=>{throw Error('Feishu record list failed');}}});
 const payload=await response.json();assert.equal(response.status,502);assert.equal(payload.error.code,'CASE_OPTIONS_READ_FAILED');assert.equal(payload.error.message,'Feishu record list failed');assert.equal(payload.error.retryable,true);
});

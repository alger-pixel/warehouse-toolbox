const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const importFile=file=>import(pathToFileURL(path.resolve(file)).href);
const administrationKey='fixture-only-administration-key-32-chars';
// Minimal DOM adapter: exercise the module's public init + delegated events and
// rendered output, without replacing its API client or Worker response handling.
function dom() {
 const nodes=new Map(),listeners=new Map();
 const node=selector=>{
  if(!nodes.has(selector))nodes.set(selector,{value:'',innerHTML:'',textContent:'',disabled:false,hidden:false,classList:{toggle(){}},scrollIntoView(){}});
  return nodes.get(selector);
 };
 node('[data-um-status]').textContent='Administration access required.';
 node('[data-um-content]').hidden=true;node('[data-um-add]').disabled=true;
 const root={querySelector:node,querySelectorAll(selector){return selector==='[data-um-mutation]'?['[data-um-add]','[data-um-connect]','[data-um-refresh]','[data-um-lock]','[data-um-edit]'].map(node):[];},addEventListener:(type,handler)=>listeners.set(type,handler),removeEventListener:type=>listeners.delete(type)};
 return {root,node,change(){listeners.get('change')({target:{matches:selector=>selector==='[data-um-tool-filter]'}});},submit(){let prevented=false;listeners.get('submit')({target:{matches:selector=>selector==='[data-um-unlock]'},preventDefault(){prevented=true;}});assert.equal(prevented,true);},click(selector,dataset={}){listeners.get('click')({target:{closest:query=>query===selector?{dataset}:null}});}};
}
async function setup(empty=false) {
 const {handleRequest}=await importFile('worker/src/index.js');
 const {UserManagementCoordinator}=await importFile('worker/src/modules/users/user-coordinator.js');
 const {resetTokenCacheForTests}=await importFile('worker/src/services/feishu-auth-service.js');resetTokenCacheForTests();
 const rows=empty?[]:[{record_id:'user-record',fields:{'USER ID':'U-0001',ACCOUNT:'ALGER','DISPLAY NAME':'ALGER',STATUS:'Active','IS ADMIN':'Admin','WAREHOUSE ACCESS':'MKS66','CLIENT ACCESS':'B044|TINECO-TOC','ACCESSIBLE TOOL IDS':'CT-MKS66-B044-0001','PASSWORD HASH':'must-not-reach-browser'}}];
 const registryWindow={};vm.runInNewContext(fs.readFileSync('js/client-tools-registry.js','utf8'),{window:registryWindow});
 const tools=registryWindow.MkiteClientToolRegistry.all().map(t=>({record_id:t.toolId,fields:{'TOOL ID':t.toolId,'TOOL NAME':t.name,WAREHOUSE:t.warehouse,'CLIENT ID':t.clientId,STATUS:'Active'}}));
 const originalFetch=global.fetch;
 global.fetch=async url=>{
   if(String(url).includes('/auth/v3/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'fixture-token',expire:7200});
   assert.match(String(url),/^https:\/\/open.feishu.cn\/open-apis\/bitable\/v1\/apps\/fixture-base\/tables\/(users|tools)\/records\?/);
   return Response.json({code:0,data:{items:String(url).includes('/users/')?rows:tools,has_more:false}});
 };
 const env={USER_MANAGEMENT_ADMIN_KEY:administrationKey,FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture',FEISHU_BASE_APP_TOKEN:'fixture-base',FEISHU_USER_TABLE_ID:'users',FEISHU_TOOL_TABLE_ID:'tools',FEISHU_PACKAGE_TABLE_ID:'unused',FEISHU_CLIENT_TABLE_ID:'unused',ALLOWED_ORIGINS:'http://127.0.0.1:5501'};
 const coordinator=new UserManagementCoordinator({storage:{}},env);
 env.USER_MANAGEMENT={idFromName:name=>name,get:()=>coordinator};
 const envelopes=[],calls=[],ui=dom();
 const window={location:{origin:'http://127.0.0.1:5501'},fetch:async(url,options)=>{
   calls.push({url,authorization:options.headers.Authorization});
   const response=await handleRequest(new Request(url,options),env);
   assert.equal(response.status,200);envelopes.push(await response.clone().json());return response;
 }};
 for(const file of ['js/services/api-config.js','js/services/api-client.js','js/settings/user-management.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,structuredClone});
 window.MkiteUserManagement.init({root:ui.root});
 return {...ui,window,envelopes,calls,restore(){window.MkiteUserManagement.cleanup();global.fetch=originalFetch;resetTokenCacheForTests();}};
}
async function loaded(h) {
 for(let i=0;i<100;i++){if(h.node('[data-um-status]').textContent.includes('users loaded.'))return;await new Promise(r=>setTimeout(r,5));}
 assert.fail(h.node('[data-um-status]').textContent);
}
test('correct key + actual Worker envelopes unlock and render ALGER with Add/Edit available',async()=>{
 const h=await setup();try{
  h.node('[data-um-key]').value=administrationKey;h.submit();
  assert.match(h.node('[data-um-status]').textContent,/Loading/);assert.equal(h.node('[data-um-key]').value,'');
  await loaded(h);
  assert.equal(h.envelopes.length,2);for(const envelope of h.envelopes){assert.equal(envelope.ok,true);assert.ok(Array.isArray(envelope.data));assert.deepEqual(Object.keys(envelope).sort(),['data','ok']);assert.ok(!JSON.stringify(envelope).includes('PASSWORD HASH'));assert.ok(!JSON.stringify(envelope).includes('must-not-reach-browser'));}
  const user=h.envelopes.find(e=>e.data[0]?.userId).data[0];assert.equal(user.userId,'U-0001');assert.equal(user.account,'ALGER');assert.equal(user.status,'Active');assert.equal(user.isAdmin,true);
  assert.equal(h.envelopes.find(e=>e.data[0]?.toolId).data.length,3);
  assert.equal(h.node('[data-um-content]').hidden,false);assert.equal(h.node('[data-um-unlock]').hidden,true);assert.doesNotMatch(h.node('[data-um-status]').textContent,/Administration access required/);
  assert.match(h.node('[data-um-list]').innerHTML,/U-0001/);assert.match(h.node('[data-um-list]').innerHTML,/ALGER/);assert.match(h.node('[data-um-list]').innerHTML,/data-um-edit="U-0001"/);assert.equal(h.node('[data-um-add]').disabled,false);assert.equal(h.node('[data-um-edit]').disabled,false);
  h.click('[data-um-edit]',{umEdit:'U-0001'});assert.match(h.node('[data-um-editor]').innerHTML,/Edit User/);assert.match(h.node('[data-um-editor]').innerHTML,/value="ALGER"/);
  assert.match(h.node('[data-um-editor]').innerHTML,/All Warehouses/);assert.match(h.node('[data-um-editor]').innerHTML,/All Clients/);
  h.node('[data-um-tool-filter="warehouse"]').value='MKS66';h.node('[data-um-tool-filter="clientId"]').value='TINECO-TOC';h.change();
  assert.match(h.node('[data-um-available]').innerHTML,/TINECO TOC Batch Inventory/);assert.doesNotMatch(h.node('[data-um-available]').innerHTML,/Put Away Scan/);assert.match(h.node('[data-um-assigned]').innerHTML,/CT-MKS66-B044-0001/);
  h.node('[data-um-tool-filter="warehouse"]').value='not-a-warehouse';h.change();assert.match(h.node('[data-um-available]').innerHTML,/No tools/);assert.match(h.node('[data-um-assigned]').innerHTML,/CT-MKS66-B044-0001/);
  h.node('[data-um-tool-filter="warehouse"]').value='';h.node('[data-um-tool-filter="clientId"]').value='';h.change();assert.match(h.node('[data-um-available]').innerHTML,/TINECO TOC/);

  h.click('[data-um-cancel]');h.click('[data-um-add]');assert.match(h.node('[data-um-editor]').innerHTML,/Add User/);
  h.click('[data-um-refresh]');await loaded(h);assert.equal(h.calls.length,4);for(const call of h.calls){assert.equal(call.authorization,`Bearer ${administrationKey}`);assert.ok(call.url.startsWith('http://localhost:8787/api/users/'));}
 }finally{h.restore();}
});
test('empty Worker users array is a loaded empty list, not a locked screen',async()=>{
 const h=await setup(true);try{h.node('[data-um-key]').value=administrationKey;h.submit();await loaded(h);assert.match(h.node('[data-um-list]').innerHTML,/No users found/);assert.equal(h.node('[data-um-content]').hidden,false);assert.equal(h.node('[data-um-add]').disabled,false);assert.match(h.node('[data-um-status]').textContent,/0 users loaded/);}finally{h.restore();}
});
test('shared Live Server settings exclude Worker runtime files without disabling frontend reload',()=>{
 const settings=JSON.parse(fs.readFileSync('.vscode/settings.json','utf8'));
 assert.equal(settings['liveServer.settings.port'],5501);
 const ignored=settings['liveServer.settings.ignoreFiles'];
 for(const file of ['worker/.wrangler/state/v3/do/namespace/user.sqlite-wal','worker/.wrangler/state/v3/do/namespace/user.sqlite-shm','.wrangler/state/v3/trace.sqlite','worker/src/index.js'])assert.ok(ignored.some(pattern=>path.matchesGlob(file,pattern)),file);
 for(const file of ['index.html','js/settings/user-management.js','css/user-management.css'])assert.ok(!ignored.some(pattern=>path.matchesGlob(file,pattern)),file);
 assert.match(fs.readFileSync('.gitignore','utf8'),/!\.vscode\/settings.json/);
});

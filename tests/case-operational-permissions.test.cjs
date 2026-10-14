const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const category={categoryId:'CC-MKS66-001',categoryName:'Receiving',mainCategory:'Receiving',warehouseId:'MKS66',status:'Active',defaultPriority:'Normal',defaultInstruction:'Inspect.',mandatoryQuestions:{questions:[]},issueOptions:{issues:[]}};
const workers=[{userId:'U-0001',displayName:'Worker',status:'Active',warehouses:['MKS66']}];
function setup(origin,failure){
 const nodes=new Map();function node(selector){if(!nodes.has(selector))nodes.set(selector,{value:'',innerHTML:'',textContent:'',hidden:true,disabled:false,handlers:{},classList:{add(){}},setAttribute(){},removeAttribute(){},focus(){},remove(){this.removed=true;},addEventListener(type,handler){this.handlers[type]=handler;},removeEventListener(){},querySelector:node,querySelectorAll:()=>[]});return nodes.get(selector);}
 const calls=[],root=node('root'),fields={warehouseId:'MKS66',mainCategory:'Receiving',actor:'OPERATOR',priority:'Normal',caseTitle:'Test Case',caseInstruction:'Inspect.',dueAt:'',note:''};
 const window={location:{origin,hostname:new URL(origin).hostname},fetch:async(url,init)=>{
  const path=new URL(url).pathname;calls.push({url,path,init});const error=failure?.path===path?failure.message:null;
  return {ok:!error,status:error?503:200,json:async()=>error?{ok:false,error:{code:'OPERATIONAL_READ_FAILED',message:error}}:{ok:true,data:path.endsWith('/categories')?{categories:[category]}:path.endsWith('/assignment-options')?{workers}:{caseId:'MKS66-20261013-CASE-001',status:'Assigned',assignedUsers:[{userId:'U-0001',displayName:'Worker'}]}}};
 },localStorage:{setItem(){throw Error('Operational storage must not store credentials');}},sessionStorage:{setItem(){throw Error('Operational storage must not store credentials');}}};
 const sandbox={window,document:{addEventListener(){},removeEventListener(){}},crypto:{randomUUID:()=> 'case-request-operational-0001'},structuredClone,FormData:class{[Symbol.iterator](){return Object.entries(fields)[Symbol.iterator]();}}};
 for(const path of ['js/services/api-config.js','js/services/api-client.js','js/cases/create-case.js'])vm.runInNewContext(fs.readFileSync(path,'utf8'),sandbox);
 window.MkiteCreateCase.init({root});return {window,node,fields,calls,click(selector,dataset){root.handlers.click({target:{closest:query=>query===selector?{dataset}:null}});}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const origin of ['http://127.0.0.1:5501','https://example.github.io'])test(`Create Case loads and submits operational requests without credentials at ${origin}`,async()=>{
 const h=setup(origin);await flush();assert.equal(h.node('[data-case-workspace]').hidden,false);assert.equal(h.node('[data-case-load]').removed,true);
 assert.match(h.node('[data-case-workspace]').innerHTML,/Select warehouse[\s\S]*MKS66/);
 h.node('[data-case-form]').handlers.change({target:{name:'warehouseId'}});h.click('[data-category-id]',{categoryId:category.categoryId});h.click('[data-worker-id]',{workerId:'U-0001'});
 assert.match(h.node('[data-worker-chips]').innerHTML,/Worker/);assert.match(h.node('[data-selected-category]').innerHTML,/Receiving/);
 await h.node('[data-case-form]').handlers.submit({preventDefault(){}});assert.match(h.node('[data-case-workspace]').innerHTML,/CASE CREATED SUCCESSFULLY/);
 assert.deepEqual(h.calls.map(call=>[call.init.method,call.path]),[['GET','/api/cases/categories'],['GET','/api/cases/assignment-options'],['POST','/api/cases']]);
 for(const call of h.calls){assert.equal(call.init.headers.Authorization,undefined);assert.ok(call.url.startsWith(h.window.MkiteApiConfig.baseUrl));assert.doesNotMatch(call.url,/\/api\/users\//);}
 assert.deepEqual(JSON.parse(h.calls[2].init.body).assignedUserIds,['U-0001']);h.window.MkiteCreateCase.cleanup();
});
for(const [path,message] of [['/api/cases/categories','Unable to read maintained categories.'],['/api/cases/assignment-options','Unable to read assignment workers.']])test('Create Case displays the actual operational error from '+path,async()=>{
 const h=setup('http://127.0.0.1:5501',{path,message});await flush();assert.equal(h.node('[data-case-load]').textContent,message);assert.equal(h.node('[data-case-workspace]').hidden,true);h.window.MkiteCreateCase.cleanup();
});
test('Settings remains locked until its authenticated category read succeeds',async()=>{
 const nodes=new Map();const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{value:'',hidden:selector==='[data-cc-workspace]',disabled:selector==='[data-cc-add]',textContent:'',innerHTML:'',addEventListener(){},querySelector:node});return nodes.get(selector);};
 const calls=[],key='test-only-category-administration-key';const window={MkiteApiClient:{get:async(path,options)=>{calls.push({path,options});return options.authorization===`Bearer ${key}`?{ok:true,data:{categories:[]}}:{ok:false,error:{message:'Enter the Settings administration key.'}};}}};
 vm.runInNewContext(fs.readFileSync('js/settings/case-category.js','utf8'),{window,structuredClone,FormData:class{[Symbol.iterator](){return [][Symbol.iterator]();}},crypto:{randomUUID:()=> 'request-test-1234567890'}});
 window.MkiteCaseCategoryManagement.init({root:{querySelector:node}});assert.equal(calls.length,0);assert.equal(node('[data-cc-workspace]').hidden,true);assert.equal(node('[data-cc-add]').disabled,true);
 node('[data-cc-key]').value='wrong-key-at-least-thirty-two-characters';await node('[data-cc-unlock]').onsubmit({preventDefault(){}});assert.equal(node('[data-cc-workspace]').hidden,true);
 node('[data-cc-key]').value=key;await node('[data-cc-unlock]').onsubmit({preventDefault(){}});assert.equal(node('[data-cc-workspace]').hidden,false);assert.equal(node('[data-cc-add]').disabled,false);assert.equal(calls[1].path,'/api/case-categories');window.MkiteCaseCategoryManagement.cleanup();
});

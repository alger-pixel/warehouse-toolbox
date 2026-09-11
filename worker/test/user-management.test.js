import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createUserService, publicUser, parseAccess, isActiveAdmin, hasToolAccess } from '../src/modules/users/user-service.js';
import { hashPassword } from '../src/modules/users/password.js';
import { handleRequest } from '../src/index.js';
import { UserManagementCoordinator } from '../src/modules/users/user-coordinator.js';
const adminKey='test-only-administration-key-32-characters';
const schema=['USER ID','ACCOUNT','DISPLAY NAME','PASSWORD HASH','STATUS','IS ADMIN','WAREHOUSE ACCESS','CLIENT ACCESS','ACCESSIBLE TOOL IDS','CREATED DATE','UPDATED DATE','LAST LOGIN'];
function fixture(options={}) {
  const rows=[{record_id:'r1',fields:{'USER ID':'U-0001',ACCOUNT:'ALGER','DISPLAY NAME':'ALGER','PASSWORD HASH':'','STATUS':'Active','IS ADMIN':'Admin','WAREHOUSE ACCESS':'MKS66','CLIENT ACCESS':'B044|TINECO-TOC','ACCESSIBLE TOOL IDS':'CT-MKS66-B044-0001','CREATED DATE':100,'UPDATED DATE':200,'LAST LOGIN':150}}];
  const catalog=[{record_id:'t1',fields:{'TOOL ID':'CT-MKS66-B044-0001','TOOL NAME':'Put Away Scan',WAREHOUSE:'MKS66','CLIENT ID':'B044',STATUS:'Active'}},{record_id:'t2',fields:{'TOOL ID':'FUTURE-TOOL','TOOL NAME':'Future tool',WAREHOUSE:'MKS159','CLIENT ID':'NEW',STATUS:'Active'}}];
  const writes=[],data=new Map(); let hashCalls=0;
  const storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v)),delete:async k=>data.delete(k)};
  const records={listFields:async()=>schema.map(field_name=>({field_name})),listRecords:async({tableId})=>structuredClone(tableId==='users'?rows:catalog),createRecord:async({fields})=>{writes.push(structuredClone(fields));rows.push({record_id:'r'+(rows.length+1),fields:structuredClone(fields)});},updateRecord:async({recordId,fields})=>{writes.push(structuredClone(fields));Object.assign(rows.find(r=>r.record_id===recordId).fields,structuredClone(fields));}};
  const service=createUserService({appToken:'base',userTableId:'users',toolTableId:'tools',managementSecret:adminKey},records,storage,{now:()=>1000,hash:async()=>{hashCalls++;return 'scrypt$test-only-hash';},...options});
  return {rows,catalog,writes,data,records,storage,service,hashCalls:()=>hashCalls};
}
const createBody=(overrides={})=>({requestId:crypto.randomUUID(),account:'Bob',displayName:'Bob',status:'Active',isAdmin:false,warehouses:['MKS66'],clients:['B044'],toolIds:['CT-MKS66-B044-0001'],password:'a sufficiently long password1',...overrides});
const editBody=(f,overrides={})=>({...publicUser(f.rows[0]),requestId:crypto.randomUUID(),password:'',...overrides});

test('USER CLASS whitelist parsing and pipe normalization never expose the hash',async()=>{
  const f=fixture();f.rows[0].fields['PASSWORD HASH']='private hash';f.rows[0].fields.UNRELATED='private field';f.rows[0].fields['CLIENT ACCESS']=' B044 |TINECO-TOC|B044||';
  const user=(await f.service.list())[0];assert.deepEqual(user.clients,['B044','TINECO-TOC']);assert.equal(user.isAdmin,true);assert.ok(!JSON.stringify(user).includes('private'));assert.ok(!JSON.stringify(await f.service.get({userId:'U-0001'})).includes('PASSWORD HASH'));assert.deepEqual(parseAccess([{text:' A | B |A '}]),['A','B']);
  assert.equal(isActiveAdmin({...user,status:'Disabled'}),false);assert.equal(publicUser({fields:{'IS ADMIN':'admin'}}).isAdmin,false);
});
test('scrypt hash has unique salt and agrees with Node standard scrypt implementation',async()=>{
  const password='long password with 中文 and spaces';const a=await hashPassword(password),b=await hashPassword(password);
  assert.notEqual(a,b);assert.match(a,/^scrypt\$v=1\$N=32768,r=8,p=3\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  const [, , , salt, derived]=a.split('$');assert.equal(scryptSync(password,Buffer.from(salt,'hex'),32,{N:32768,r:8,p:3,maxmem:40*1024*1024}).toString('hex'),derived);
});
test('create hashes before persistence, assigns next ID and serializes deduplicated stable access IDs',async()=>{
  const f=fixture(),body=createBody({account:' Bob ',warehouses:[' MKS66 ','MKS66'],clients:[' B044 ','B044'],toolIds:['CT-MKS66-B044-0001','CT-MKS66-B044-0001']});
  const user=await f.service.create(body);assert.equal(user.userId,'U-0002');assert.equal(user.account,'Bob');assert.equal(f.writes[0]['PASSWORD HASH'],'scrypt$test-only-hash');assert.equal(f.writes[0]['WAREHOUSE ACCESS'],'MKS66');assert.equal(f.writes[0]['CLIENT ACCESS'],'B044');assert.equal(f.writes[0]['ACCESSIBLE TOOL IDS'],'CT-MKS66-B044-0001');assert.equal(f.writes[0]['CREATED DATE'],1000);assert.equal(f.writes[0]['UPDATED DATE'],1000);assert.ok(!('LAST LOGIN' in f.writes[0]));assert.ok(!JSON.stringify(f.writes).includes(body.password));assert.ok(!JSON.stringify([...f.data]).includes(body.password));assert.ok(!JSON.stringify(user).includes('scrypt'));
  await f.service.create(body);assert.equal(f.writes.length,1);assert.equal(f.hashCalls(),1);
});
test('account uniqueness is case insensitive and server rejects malformed input',async()=>{
  for(const bad of [{account:' alger '},{account:''},{displayName:''},{status:'active'},{isAdmin:'Admin'},{warehouses:'MKS66'},{clients:['B044|BAD']},{password:''},{password:'short'},{userId:'U-0001'}]){const f=fixture();await assert.rejects(f.service.create(createBody(bad)));assert.equal(f.writes.length,0);}
});
test('nonexistent, inactive and out-of-scope tools rejected; dynamic TOOL CLASS future records accepted',async()=>{
  const f=fixture();assert.equal((await f.service.tools())[1].toolId,'FUTURE-TOOL');
  await assert.rejects(f.service.create(createBody({toolIds:['invalid']})),/Assigned tools/);
  await assert.rejects(f.service.create(createBody({toolIds:['FUTURE-TOOL']})),/selected warehouse/);
  f.catalog[0].fields.STATUS='Disabled';await assert.rejects(f.service.create(createBody()),/Active/);
  const user=await f.service.create(createBody({warehouses:['MKS159'],clients:['NEW'],toolIds:['FUTURE-TOOL']}));assert.deepEqual(user.toolIds,['FUTURE-TOOL']);
});
test('last Active Admin cannot be disabled or demoted, but password can be set without old password',async()=>{
  const f=fixture();await assert.rejects(f.service.update(editBody(f,{status:'Disabled'})),/final Active Admin/);await assert.rejects(f.service.update(editBody(f,{isAdmin:false})),/final Active Admin/);assert.equal(f.writes.length,0);
  const user=await f.service.update(editBody(f,{password:'a brand new admin password1'}));assert.equal(user.userId,'U-0001');assert.equal(user.isAdmin,true);assert.equal(f.rows[0].fields['PASSWORD HASH'],'scrypt$test-only-hash');
});
test('blank edit preserves hash, created date and last login, updates timestamp only',async()=>{
  const f=fixture();f.rows[0].fields['PASSWORD HASH']='existing';await f.service.update(editBody(f,{displayName:'Alger Updated'}));
  assert.equal(f.rows[0].fields['PASSWORD HASH'],'existing');assert.equal(f.hashCalls(),0);assert.equal(f.rows[0].fields['CREATED DATE'],100);assert.equal(f.rows[0].fields['LAST LOGIN'],150);assert.equal(f.rows[0].fields['UPDATED DATE'],1000);for(const name of ['PASSWORD HASH','CREATED DATE','LAST LOGIN','USER ID'])assert.ok(!(name in f.writes[0]));
});
test('admin full-access override supports future tools and a second admin permits demotion',async()=>{
  const f=fixture();const second=await f.service.create(createBody({isAdmin:true,warehouses:[],clients:[],toolIds:[]}));assert.equal(hasToolAccess(second,{toolId:'NOT-YET-CREATED',warehouse:'NEW',clientId:'NEW'}),true);assert.equal(hasToolAccess({...second,status:'Disabled'},{toolId:'X'}),false);
  await f.service.update(editBody(f,{isAdmin:false}));assert.equal(f.rows[0].fields['IS ADMIN'],null);
});
test('duplicates in Feishu block edits and high-water IDs are never reused',async()=>{
  const f=fixture();await f.storage.put('lastUserNumber',9);assert.equal((await f.service.create(createBody())).userId,'U-0010');f.rows.push(structuredClone(f.rows[0]));await assert.rejects(f.service.create(createBody({account:'Other'})),/duplicate identities/);
});
test('uncertain create reconciles without duplicate writes or repeated password hashing',async()=>{
  const f=fixture(),create=f.records.createRecord;f.records.createRecord=async args=>{await create(args);throw new Error('response lost');};const body=createBody();await assert.rejects(f.service.create(body));const result=await f.service.create(body);assert.equal(result.userId,'U-0002');assert.equal(f.rows.length,2);assert.equal(f.writes.length,1);assert.equal(f.hashCalls(),1);
});
test('unconfirmed write without a record fails closed across coordinator restart',async()=>{
  const f=fixture();f.records.createRecord=async()=>{throw new Error('offline');};const body=createBody();await assert.rejects(f.service.create(body));await assert.rejects(f.service.create(body),/previous user write/);await assert.rejects(f.service.update(editBody(f)),/previous user write/);assert.equal(f.data.get('lastUserNumber'),2);assert.ok(!JSON.stringify([...f.data]).includes(body.password));
});
test('saved operation cannot be reused with changed inputs',async()=>{
 const f=fixture(),body=createBody();await f.service.create(body);await assert.rejects(f.service.create({...body,account:'changed'}),/different edit/);
});
test('coordinator serializes simultaneous operations',async()=>{
  const c=new UserManagementCoordinator({},{});let active=0,max=0;c.handle=async()=>{active++;max=Math.max(active,max);await new Promise(r=>setTimeout(r,5));active--;};await Promise.all([c.fetch({}),c.fetch({}),c.fetch({})]);assert.equal(max,1);
});
test('new administrative routes require a key; existing health access stays open',async()=>{
  const request=(action,key)=>new Request(`https://test/api/users/${action}`,{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},body:'{}'});
  for(const action of ['list','get','tools','create','update']){assert.equal((await handleRequest(request(action),{USER_MANAGEMENT_ADMIN_KEY:adminKey})).status,401);assert.equal((await handleRequest(request(action,'wrong'),{USER_MANAGEMENT_ADMIN_KEY:adminKey})).status,401);}
  assert.equal((await handleRequest(request('list'),{})).status,503);assert.equal((await handleRequest(request('list',adminKey),{USER_MANAGEMENT_ADMIN_KEY:adminKey})).status,503);assert.equal((await handleRequest(new Request('https://test/api/health'),{})).status,200);
});
test('authenticated controller returns whitelist only and no secret logs',async()=>{
 const f=fixture(),logs=[],oldLog=console.log,oldError=console.error;console.log=(...args)=>logs.push(args);console.error=(...args)=>logs.push(args);
 try{const env={USER_MANAGEMENT_ADMIN_KEY:adminKey,FEISHU_USER_TABLE_ID:'users',FEISHU_TOOL_TABLE_ID:'tools',USER_MANAGEMENT:{idFromName:name=>name,get:()=>({fetch:async()=>Response.json({ok:true,data:await f.service.list()})})}};
 const result=await handleRequest(new Request('https://test/api/users/list',{method:'POST',headers:{Authorization:`Bearer ${adminKey}`},body:'{}'}),env);const body=await result.text();assert.ok(!body.includes('PASSWORD HASH'));assert.ok(!JSON.stringify(logs).includes(adminKey));assert.equal(result.headers.get('Cache-Control'),'no-store');}finally{console.log=oldLog;console.error=oldError;}
});
test('concurrent creates share serialized uniqueness and ID allocation',async()=>{
 const f=fixture(),coordinator=new UserManagementCoordinator({},{});coordinator.handle=body=>f.service.create(body);
 const results=await Promise.allSettled([coordinator.fetch(createBody({account:'Same'})),coordinator.fetch(createBody({account:'same'})),coordinator.fetch(createBody({account:'Different'}))]);
 assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[2].status,'fulfilled');assert.deepEqual(f.rows.map(r=>r.fields['USER ID']),['U-0001','U-0002','U-0003']);
});
test('simultaneous demotions never remove both active admins',async()=>{
 const f=fixture();await f.service.create(createBody({isAdmin:true}));const coordinator=new UserManagementCoordinator({},{});coordinator.handle=body=>f.service.update(body);
 const results=await Promise.allSettled(f.rows.map(r=>coordinator.fetch({...publicUser(r),requestId:crypto.randomUUID(),isAdmin:false,password:''})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.rows.filter(r=>isActiveAdmin(publicUser(r))).length,1);
});
test('missing USER CLASS binding is controlled and table with no admin cannot save a normal user',async()=>{
 const f=fixture();await assert.rejects(createUserService({toolTableId:'tools'},f.records,f.storage).list(),/Configure USER CLASS/);
 f.rows.length=0;await assert.rejects(f.service.create(createBody()),/At least one Active Admin/);assert.equal(f.writes.length,0);
});
test('create and password reset both enforce six characters with a letter and number',async()=>{
 for(const password of ['mkite66','user123','Alger2026','abc123','ABC123']){
  const f=fixture();await f.service.create(createBody({password}));await f.service.update(editBody(f,{password}));assert.equal(f.hashCalls(),2);assert.ok(!JSON.stringify(f.writes).includes(password));
 }
 for(const password of ['123456','abcdef','abc','abc12','a1'+'x'.repeat(1024)]){
  const f=fixture();await assert.rejects(f.service.create(createBody({password})),/at least 6 characters/);await assert.rejects(f.service.update(editBody(f,{password})),/at least 6 characters/);assert.equal(f.writes.length,0);assert.equal(f.hashCalls(),0);
 }
});

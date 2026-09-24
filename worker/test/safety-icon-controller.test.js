import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSafetyIcons } from '../src/modules/safety-icons/safety-icon-controller.js';
import { createFeishuAttachmentService } from '../src/services/feishu-attachment-service.js';

const trustedOrigins=['http://localhost:5501','http://127.0.0.1:5501','https://alger-pixel.github.io'];
const env={ALLOWED_ORIGINS:trustedOrigins.join(',')};
const request=(origin=trustedOrigins[0])=>new Request('https://worker.example/api/safety-icons',{headers:{Origin:origin}});

test('list and image reads do not require the maintenance key',async()=>{
  const list=await handleSafetyIcons('safety-icons-list',{}, {list:async()=>({icons:[{recordId:'rec1'}]})},'req1',request(),env);
  assert.equal(list.status,200);assert.deepEqual((await list.json()).data.icons,[{recordId:'rec1'}]);
  const image=await handleSafetyIcons('safety-icons-image',{recordId:'rec1'},{image:async()=>new Response('png',{headers:{'Content-Type':'image/png'}})},'req2',request(),env);
  assert.equal(image.status,200);assert.equal(image.headers.get('Content-Type'),'image/png');assert.equal(await image.text(),'png');
});

test('create and update use the interim trusted-origin authorization hook without an admin key',async()=>{
  const service={create:async body=>body,update:async(recordId,body)=>({recordId,...body})};
  for(const origin of trustedOrigins){
    const created=await handleSafetyIcons('safety-icons-create',{note:'Lift'},service,'req4',request(origin),env);
    assert.equal(created.status,200);assert.equal((await created.json()).data.note,'Lift');
    const updated=await handleSafetyIcons('safety-icons-update',{recordId:'rec1',note:'Updated'},service,'req5',request(origin),env);
    assert.equal(updated.status,200);assert.equal((await updated.json()).data.recordId,'rec1');
  }
  const denied=await handleSafetyIcons('safety-icons-create',{note:'Lift'},service,'req3',request('https://untrusted.example'),env);
  assert.equal(denied.status,403);const payload=await denied.json();assert.equal(payload.error.code,'TRUSTED_ORIGIN_REQUIRED');assert.doesNotMatch(JSON.stringify(payload),/Feishu|secret|token/i);
});

test('unexpected upstream errors are sanitized',async()=>{
  const response=await handleSafetyIcons('safety-icons-list',{}, {list:async()=>{throw new Error('secret upstream payload');}},'req6',request(),env);
  assert.equal(response.status,502);const payload=await response.json();assert.equal(payload.error.code,'SAFETY_ICON_REQUEST_FAILED');assert.doesNotMatch(JSON.stringify(payload),/secret upstream payload/);
});

test('invalid upstream content type is controlled and cannot expose Feishu JSON',async()=>{
  const response=await handleSafetyIcons('safety-icons-image',{recordId:'rec1'},{image:async()=>Response.json({token:'private-token'})},'req7',request(),env);
  assert.equal(response.status,400);const payload=await response.json();assert.equal(payload.error.code,'UNSUPPORTED_SAFETY_ICON_IMAGE');assert.doesNotMatch(JSON.stringify(payload),/private-token/);
});

test('attachment proxy follows a signed redirect without forwarding its bearer token',async()=>{
  const calls=[];
  const service=createFeishuAttachmentService({getTenantAccessToken:async()=> 'tenant-secret'},{fetchImpl:async(url,init={})=>{
    calls.push({url:String(url),init});
    if(calls.length===1)return new Response(null,{status:302,headers:{Location:'https://download.example/signed'}});
    return new Response('image-bytes',{headers:{'Content-Type':'image/png'}});
  }});
  const response=await service.download('private-token');
  assert.equal(await response.text(),'image-bytes');assert.match(calls[0].url,/\/medias\/private-token\/download$/);assert.equal(calls[0].init.headers.Authorization,'Bearer tenant-secret');assert.equal(calls[0].init.redirect,'manual');assert.equal(calls[1].url,'https://download.example/signed');assert.equal(calls[1].init.headers,undefined);
});

test('Feishu media permission and attachment-token mismatch errors remain server-side',async()=>{
  for(const response of [
    Response.json({code:99991672,msg:'permission details containing a private token'},{status:400}),
    Response.json({code:1061002,msg:'attachment token mismatch containing a private token'},{status:400})
  ]){
    const service=createFeishuAttachmentService({getTenantAccessToken:async()=> 'tenant-secret'},{fetchImpl:async()=>response.clone()});
    await assert.rejects(service.download('private-token'),error=>error.name==='FeishuRecordError'&&!String(error.message).includes('private-token'));
  }
});

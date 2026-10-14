import test from 'node:test';import assert from 'node:assert/strict';
import {createCaseService} from '../src/modules/cases/case-service.js';
import {handleCases,caseRouteFor} from '../src/modules/cases/case-controller.js';
import {createFeishuAttachmentService} from '../src/services/feishu-attachment-service.js';
const caseId='MKS66-20261007-CASE-002';
const env={FEISHU_CASE_CLASS_TABLE_ID:'cases',ALLOWED_ORIGINS:'http://127.0.0.1:5501,https://alger-pixel.github.io'};
function fixture(type){const downloads=[],bytes=Uint8Array.from([0,255,137,80,78,71,13,10]),row={record_id:'historic-record',fields:{'CASE ID':caseId,STATUS:'Completed','CASE ATTACHMENTS':[{file_token:'private-reference-token',name:'reference.png',type}],'REPORT ASSETS':[{file_token:'private-report-token',name:'persisted-report.png',type}],'REPORT DATA':JSON.stringify({schemaVersion:1,revision:1,reports:[{reportId:'RPT-001',assets:[{assetId:'case-report-old-uuid',fileName:'persisted-report.png',mimeType:type}]}]})}};
 const attachments=createFeishuAttachmentService({getTenantAccessToken:async()=> 'private-tenant-token'},{fetchImpl:async(url,init)=>{downloads.push({url,init});return new Response(bytes,{headers:{'Content-Type':type}});}});
 const records={listRecords:async()=>[structuredClone(row)],createRecord(){throw Error('No media read writes');},updateRecord(){throw Error('No media read writes');}};
 return {service:createCaseService({appToken:'base',caseClassTableId:'cases'},records,attachments,null),downloads,bytes,row};}
for(const type of ['image/png','image/jpeg'])for(const origin of ['http://127.0.0.1:5501','https://alger-pixel.github.io'])test(`historical reference and report proxy stream ${type} bytes without admin authorization from ${origin}`,async()=>{
 const f=fixture(type),before=structuredClone(f.row),dto=await f.service.get(caseId);assert.doesNotMatch(JSON.stringify(dto),/private-|file_token/);
 for(const assetId of ['ref-1','case-report-old-uuid'])for(const headers of [{Origin:origin},{Referer:origin+'/warehouse-toolbox/'}]){
  const url=`https://worker.example/api/cases/${caseId}/assets/${assetId}`,response=await handleCases(new Request(url,{headers}),env,'id',caseRouteFor(new URL(url).pathname),{readService:f.service});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),type);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.notEqual(response.headers.get('Access-Control-Allow-Origin'),'*');if(headers.Origin)assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
 }
 assert.deepEqual(f.row,before);assert.equal(f.downloads.length,4);assert.ok(f.downloads.every(request=>request.url.startsWith('https://open.feishu.cn/open-apis/drive/v1/medias/')&&request.init.headers.Authorization==='Bearer private-tenant-token'));
});
test('missing media returns controlled 404 and untrusted or missing origins remain rejected',async()=>{
 const f=fixture('image/png'),url=`https://worker.example/api/cases/${caseId}/assets/missing`,route=caseRouteFor(new URL(url).pathname);
 let response=await handleCases(new Request(url,{headers:{Origin:'https://alger-pixel.github.io'}}),env,'id',route,{readService:f.service});assert.equal(response.status,404);assert.equal((await response.json()).error.code,'CASE_ASSET_NOT_FOUND');assert.equal(f.downloads.length,0);
 for(const headers of [{},{Origin:'https://untrusted.example'},{Referer:'https://untrusted.example/path'}]){response=await handleCases(new Request(url,{headers}),env,'id',route,{readService:f.service});assert.equal(response.status,403);assert.equal((await response.json()).error.code,'TRUSTED_ORIGIN_REQUIRED');}assert.equal(f.downloads.length,0);
});

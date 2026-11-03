import test from 'node:test';
import assert from 'node:assert/strict';
import {DOWNLOAD_FIELDS as F,DOWNLOAD_FIELD_NAMES,DOWNLOAD_FIELD_TYPES,DOWNLOAD_FILE_TYPES,DOWNLOAD_STATUSES} from '../src/modules/download-center/download-center-fields.js';
import {createDownloadCenterService,DOWNLOAD_FILE_MAX_BYTES,XLSX_MIME} from '../src/modules/download-center/download-center-service.js';
import {downloadCenterRouteFor,handleDownloadCenter} from '../src/modules/download-center/download-center-controller.js';

const ID='DL-20261028-A7K3Q9',bytes=Uint8Array.from([80,75,3,4,1,2,3,4]);
const fields=DOWNLOAD_FIELD_NAMES.map(field_name=>({field_name,type:DOWNLOAD_FIELD_TYPES[field_name],...([F.status,F.fileType].includes(field_name)?{property:{options:(field_name===F.status?DOWNLOAD_STATUSES:DOWNLOAD_FILE_TYPES).map(name=>({name}))}}:{})}));
function row(status='READY',extra={}){return {record_id:'rec-private',fields:{[F.id]:ID,[F.fileName]:'safe.xlsx',[F.attachment]:[{file_token:'PRIVATE-TOKEN',name:'safe.xlsx',type:XLSX_MIME,size:bytes.length}],[F.fileType]:'XLSX',[F.fileSize]:bytes.length,[F.toolId]:'CT-MKS66-TEST',[F.toolName]:'Test Tool',[F.function]:'Export Excel',[F.sourceRoute]:'#tool/test',[F.createdBy]:'Operator',[F.createdAt]:Date.parse('2026-10-28T12:00:00Z'),[F.status]:status,[F.readyAt]:Date.parse('2026-10-28T12:01:00Z'),...extra}};}
function fixture(rows=[row()],upstream=new Response(bytes,{headers:{'Content-Type':XLSX_MIME,'Content-Length':String(bytes.length)}})){
 const downloads=[];
 const records={async listFields(){return fields;},async searchRecords(){return {items:rows,hasMore:false,pageToken:null};}};
 const attachments={async download(token){downloads.push(token);if(upstream instanceof Error)throw upstream;return upstream.clone();}};
 return {downloads,service:createDownloadCenterService({appToken:'base',downloadCenterTableId:'table'},records,{attachments})};
}
const rejects=(service,code)=>assert.rejects(()=>service.file(ID),error=>error.code===code);

test('READY XLSX resolves only its authoritative token and validates bytes',async()=>{const f=fixture(),file=await f.service.file(ID);assert.deepEqual([...file.bytes],[...bytes]);assert.equal(file.fileName,'safe.xlsx');assert.equal(file.mimeType,XLSX_MIME);assert.deepEqual(f.downloads,['PRIVATE-TOKEN']);});

test('non-READY states never retrieve attachment bytes',async()=>{for(const [status,code]of [['PROCESSING','DOWNLOAD_NOT_READY'],['FAILED','DOWNLOAD_NOT_READY'],['ARCHIVED','DOWNLOAD_ARCHIVED']]){const f=fixture([row(status)]);await rejects(f.service,code);assert.equal(f.downloads.length,0);}});

test('missing and multiple attachments fail closed',async()=>{await rejects(fixture([row('READY',{[F.attachment]:[]})]).service,'DOWNLOAD_ATTACHMENT_MISSING');await rejects(fixture([row('READY',{[F.attachment]:[row().fields[F.attachment][0],{file_token:'OTHER',name:'safe.xlsx',type:XLSX_MIME,size:bytes.length}]})]).service,'DOWNLOAD_ATTACHMENT_AMBIGUOUS');});

test('malformed, missing and ambiguous logical identities fail before download',async()=>{await assert.rejects(()=>fixture().service.file('bad'),error=>error.code==='INVALID_DOWNLOAD_ID');await rejects(fixture([]).service,'DOWNLOAD_NOT_FOUND');await rejects(fixture([row(),row()]).service,'DOWNLOAD_AMBIGUOUS');await rejects(fixture([row('READY',{[F.function]:''})]).service,'DOWNLOAD_SCHEMA_MISMATCH');});

test('filename, extension, metadata MIME and upstream MIME mismatches fail closed',async()=>{for(const extra of [{[F.fileName]:'../safe.xlsx'},{[F.fileName]:'safe.csv'},{[F.attachment]:[{file_token:'PRIVATE',name:'other.xlsx',type:XLSX_MIME,size:bytes.length}]},{[F.attachment]:[{file_token:'PRIVATE',name:'safe.xlsx',type:'text/html',size:bytes.length}]}])await rejects(fixture([row('READY',extra)]).service,'DOWNLOAD_FILE_TYPE_MISMATCH');await rejects(fixture([row()],new Response(bytes,{headers:{'Content-Type':'text/html'}})).service,'DOWNLOAD_FILE_TYPE_MISMATCH');});

test('record, attachment, declared and actual sizes must agree within 20 MiB',async()=>{await rejects(fixture([row('READY',{[F.fileSize]:bytes.length+1})]).service,'DOWNLOAD_FILE_SIZE_MISMATCH');await rejects(fixture([row('READY',{[F.fileSize]:DOWNLOAD_FILE_MAX_BYTES+1,[F.attachment]:[{file_token:'PRIVATE',name:'safe.xlsx',type:XLSX_MIME,size:DOWNLOAD_FILE_MAX_BYTES+1}]})]).service,'DOWNLOAD_FILE_TOO_LARGE');await rejects(fixture([row()],new Response(bytes,{headers:{'Content-Type':XLSX_MIME,'Content-Length':String(bytes.length+1)}})).service,'DOWNLOAD_FILE_SIZE_MISMATCH');await rejects(fixture([row()],new Response(bytes.slice(0,-1),{headers:{'Content-Type':XLSX_MIME}})).service,'DOWNLOAD_FILE_SIZE_MISMATCH');});

test('unexpected content and upstream failures are sanitized',async()=>{await rejects(fixture([row()],new Response(Uint8Array.from([60,104,116,109,108,62,1,2]),{headers:{'Content-Type':'application/octet-stream'}})).service,'DOWNLOAD_FILE_TYPE_MISMATCH');await rejects(fixture([row()],new Error('private Feishu failure')).service,'DOWNLOAD_UPSTREAM_FAILED');});

test('controller returns secure attachment headers, CORS, and no private identity',async()=>{const f=fixture(),request=new Request(`https://worker/api/download-center/${ID}/file`,{headers:{Origin:'http://127.0.0.1:5501'}}),response=await handleDownloadCenter(request,{ALLOWED_ORIGINS:'http://127.0.0.1:5501'},'request-id',downloadCenterRouteFor(new URL(request.url).pathname),{service:f.service});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),XLSX_MIME);assert.match(response.headers.get('Content-Disposition'),/^attachment; filename="safe\.xlsx"/);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5501');assert.doesNotMatch(JSON.stringify([...response.headers]),/PRIVATE-TOKEN|file_token|record_id|feishu/i);});

test('query parameters cannot choose token, filename, MIME or size',async()=>{const f=fixture(),request=new Request(`https://worker/api/download-center/${ID}/file?file_token=OTHER&filename=evil.html&type=text/html&size=1`),response=await handleDownloadCenter(request,{},'request-id',downloadCenterRouteFor(new URL(request.url).pathname),{service:f.service});assert.equal(response.status,200);assert.deepEqual(f.downloads,['PRIVATE-TOKEN']);assert.match(response.headers.get('Content-Disposition'),/safe\.xlsx/);assert.equal(response.headers.get('Content-Type'),XLSX_MIME);assert.equal(response.headers.get('Content-Length'),String(bytes.length));});

test('file route remains GET-only',async()=>{const route=downloadCenterRouteFor(`/api/download-center/${ID}/file`),response=await handleDownloadCenter(new Request(`https://worker/api/download-center/${ID}/file`,{method:'POST'}),{},'request-id',route,{service:{file:async()=>assert.fail()}});assert.equal(response.status,405);assert.equal((await response.json()).error.code,'METHOD_NOT_ALLOWED');});

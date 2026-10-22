import test from 'node:test';
import assert from 'node:assert/strict';
import { createTinecoSnEnrichmentService, SN_LOOKUP_CONCURRENCY } from '../src/modules/tineco-inventory/sn-enrichment-service.js';

const env={MKITE_TINECO_API_URL:'https://tool.example/api/tineco',MKITE_WAREHOUSE_API_KEY:'worker-secret'};
const payload=records=>({code:200,data:{code:200,message:'ok',data:{current:1,size:20,total:records.length,records}}});
const options=fetchImpl=>({fetchImpl,sleep:async()=>{},random:()=>.5});
function memoryKv(){const data=new Map(),puts=[];return{data,puts,async get(key){return data.get(key)??null;},async put(key,value,settings){data.set(key,value);puts.push({key,value,settings});}};}
const cachedSuccess=(sn,stamp,model='Cached Model',state='Cached State')=>JSON.stringify({schemaVersion:1,kind:'tineco-sn',sn,outcome:'SUCCESS',productName:model,stateName:state,modelFetchedAt:stamp,statusFetchedAt:stamp,lastSuccessfulFetchAt:stamp});

test('SN lookup sends the documented Worker-only request and exact-matches one record for both fields',async()=>{
 let call;const service=createTinecoSnEnrichmentService(env,options(async(url,init)=>{call={url,init};return Response.json(payload([{newSnNo:'OTHER',productName:'Wrong model',stateName:'Wrong status'},{newSnNo:' SN-1 ',productName:' Model One ',stateName:' In Stock '} ]));}));
 const result=await service.lookup(' SN-1 ');assert.equal(result.status,'SUCCESS');assert.equal(result.model,'Model One');assert.equal(result.icssStatus,'In Stock');assert.equal(result.source,'upstream');assert.equal(result.retries,0);assert.equal(call.url,env.MKITE_TINECO_API_URL);assert.equal(call.init.method,'POST');assert.equal(call.init.redirect,'manual');assert.equal(call.init.headers['X-API-Key'],'worker-secret');assert.deepEqual(JSON.parse(call.init.body),{newSnNo:'SN-1',pageNo:1,pageSize:20,sorts:[],timeZone:'Asia/Shanghai'});assert.doesNotMatch(JSON.stringify(result),/secret|X-API-Key/);
});

test('valid no-match and missing fields remain distinct successful outcomes',async()=>{
 const replies=[payload([{newSnNo:'OTHER'}]),payload([{newSnNo:'SN-2',stateName:'Released'}]),payload([{newSnNo:'SN-3',productName:'Model Three'}])];let index=0;
 const service=createTinecoSnEnrichmentService(env,options(async()=>Response.json(replies[index++])));
 assert.equal((await service.lookup('SN-1')).status,'NO_MATCH');const second=await service.lookup('SN-2'),third=await service.lookup('SN-3');assert.equal(second.model,null);assert.equal(second.icssStatus,'Released');assert.equal(third.model,'Model Three');assert.equal(third.icssStatus,null);
});

test('blank SN and incomplete configuration never call upstream',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return Response.json(payload([]));};
 assert.equal((await createTinecoSnEnrichmentService(env,options(fetchImpl)).lookup('  ')).status,'NO_MATCH');const failed=await createTinecoSnEnrichmentService({...env,MKITE_TINECO_API_URL:''},options(fetchImpl)).lookup('SN');assert.equal(failed.status,'LOOKUP_FAILED');assert.equal(failed.reason,'config_error');assert.equal(calls,0);
});

test('deduplication and bounded concurrency isolate exhausted transient failures',async()=>{
 let active=0,maximum=0,calls=0;const fetchImpl=async(url,init)=>{calls++;active++;maximum=Math.max(maximum,active);const sn=JSON.parse(init.body).newSnNo;await new Promise(resolve=>setTimeout(resolve,1));active--;if(sn==='SN-4')throw Error('offline');return Response.json(payload([{newSnNo:sn,productName:`Model ${sn}`,stateName:`State ${sn}`} ]));};
 const rows=[...Array.from({length:12},(_,i)=>({SN:`SN-${i}`})),{SN:'SN-1'},{SN:' SN-1 '},{SN:''}],{enrichment,diagnostic}=await createTinecoSnEnrichmentService(env,{...options(fetchImpl),concurrency:99}).enrich(rows);
 assert.equal(calls,14);assert.equal(enrichment.size,12);assert.ok(maximum<=SN_LOOKUP_CONCURRENCY);assert.equal(enrichment.get('SN-4').status,'LOOKUP_FAILED');assert.equal(enrichment.get('SN-5').status,'SUCCESS');assert.equal(diagnostic.lookupFailed,1);assert.equal(diagnostic.upstreamRetried,2);
});

test('transient HTTP failure retries and recovers while permanent failures do not retry',async()=>{
 let calls=0;const recovered=await createTinecoSnEnrichmentService(env,options(async()=>++calls===1?new Response('',{status:429}):Response.json(payload([{newSnNo:'SN-1',productName:'Recovered'}])))).lookup('SN-1');assert.equal(calls,2);assert.equal(recovered.status,'SUCCESS');assert.equal(recovered.retries,1);
 for(const status of [400,401,403,302]){calls=0;const failed=await createTinecoSnEnrichmentService(env,options(async()=>{calls++;return new Response('',{status});})).lookup('SN-1');assert.equal(failed.status,'LOOKUP_FAILED');assert.equal(calls,1);}
});

test('malformed and exhausted transient responses become sanitized lookup failures',async()=>{
 for(const response of [new Response('',{status:500}),Response.json({code:200,data:{}}),new Response('bad',{status:200,headers:{'Content-Type':'application/json'}})]){
  let calls=0;const result=await createTinecoSnEnrichmentService(env,options(async()=>{calls++;return response.clone();})).lookup('SN-1');assert.equal(result.status,'LOOKUP_FAILED');assert.equal(calls,3);assert.doesNotMatch(JSON.stringify(result),/worker-secret/);
 }
});

test('fresh success and NO_MATCH cache hits make zero upstream requests',async()=>{const kv=memoryKv(),now=Date.parse('2026-10-21T12:00:00Z'),service=createTinecoSnEnrichmentService(env,{...options(async()=>assert.fail('upstream forbidden')),cacheBinding:kv,now:()=>now});const {tinecoSnCacheKey}=await import('../src/modules/cache/enrichment-cache.js');kv.data.set(await tinecoSnCacheKey('SN-CACHED'),cachedSuccess('SN-CACHED',new Date(now).toISOString()));kv.data.set(await tinecoSnCacheKey('SN-NONE'),JSON.stringify({schemaVersion:1,kind:'tineco-sn',sn:'SN-NONE',outcome:'NO_MATCH',fetchedAt:new Date(now).toISOString()}));assert.equal((await service.lookup('SN-CACHED')).source,'fresh-cache');assert.equal((await service.lookup('SN-CACHED')).model,'Cached Model');assert.equal((await service.lookup('SN-NONE')).source,'negative-cache');});

test('stale ICSS performs one logical refresh and updates MODEL and status together',async()=>{const kv=memoryKv(),now=Date.parse('2026-10-21T12:00:00Z'),{tinecoSnCacheKey}=await import('../src/modules/cache/enrichment-cache.js'),key=await tinecoSnCacheKey('SN-STALE');kv.data.set(key,cachedSuccess('SN-STALE',new Date(now-11*60*1000).toISOString()));let calls=0;const service=createTinecoSnEnrichmentService(env,{...options(async()=>{calls++;return Response.json(payload([{newSnNo:'SN-STALE',productName:'New Model',stateName:'New State'}]));}),cacheBinding:kv,now:()=>now});const value=await service.lookup('SN-STALE');assert.equal(calls,1);assert.equal(value.source,'refreshed-cache');assert.equal(value.model,'New Model');assert.equal(value.icssStatus,'New State');const stored=JSON.parse(kv.data.get(key));assert.equal(stored.productName,'New Model');assert.equal(stored.stateName,'New State');assert.equal(stored.modelFetchedAt,stored.statusFetchedAt);});

for(const failure of ['rate-limited','timeout','502'])test(`stale cache survives ${failure} refresh failure without overwrite`,async()=>{const kv=memoryKv(),now=Date.parse('2026-10-21T12:00:00Z'),{tinecoSnCacheKey}=await import('../src/modules/cache/enrichment-cache.js'),key=await tinecoSnCacheKey(`SN-${failure}`),before=cachedSuccess(`SN-${failure}`,new Date(now-11*60*1000).toISOString());kv.data.set(key,before);const fetchImpl=failure==='timeout'?async()=>{throw Error('offline');}:async()=>new Response('',{status:failure==='502'?502:429});const value=await createTinecoSnEnrichmentService(env,{...options(fetchImpl),cacheBinding:kv,now:()=>now}).lookup(`SN-${failure}`);assert.equal(value.source,'stale-cache');assert.equal(value.refreshFailed,true);assert.equal(value.model,'Cached Model');assert.equal(value.icssStatus,'Cached State');assert.equal(kv.data.get(key),before);});

test('maximum stale windows preserve MODEL independently when ICSS is too old',async()=>{const kv=memoryKv(),now=Date.parse('2026-10-21T12:00:00Z'),{tinecoSnCacheKey}=await import('../src/modules/cache/enrichment-cache.js'),sn='SN-PARTIAL',key=await tinecoSnCacheKey(sn),entry=JSON.parse(cachedSuccess(sn,new Date(now-25*60*60*1000).toISOString()));entry.modelFetchedAt=new Date(now-31*24*60*60*1000).toISOString();kv.data.set(key,JSON.stringify(entry));const value=await createTinecoSnEnrichmentService(env,{...options(async()=>new Response('',{status:429})),cacheBinding:kv,now:()=>now}).lookup(sn);assert.equal(value.status,'SUCCESS');assert.equal(value.model,'Cached Model');assert.equal(value.modelStatus,'SUCCESS');assert.equal(value.icssStatus,null);assert.equal(value.icssStatusStatus,'LOOKUP_FAILED');});

test('cache miss writes success and NO_MATCH but never stores exhausted failure',async()=>{for(const [sn,response,status,puts] of [['SN-OK',Response.json(payload([{newSnNo:'SN-OK',productName:'M'}])),'SUCCESS',1],['SN-NONE',Response.json(payload([])),'NO_MATCH',1],['SN-FAIL',new Response('',{status:429}),'LOOKUP_FAILED',0]]){const kv=memoryKv(),value=await createTinecoSnEnrichmentService(env,{...options(async()=>response.clone()),cacheBinding:kv}).lookup(sn);assert.equal(value.status,status);assert.equal(kv.puts.length,puts);}});

test('cache read/write failures fall back upstream without losing enrichment',async()=>{const events=[],binding={get:async()=>{throw Error('read');},put:async()=>{throw Error('write');}},service=createTinecoSnEnrichmentService(env,{...options(async(url,init)=>Response.json(payload([{newSnNo:JSON.parse(init.body).newSnNo,productName:'Safe'}]))),cacheBinding:binding,onDiagnostic:value=>events.push(value)}),{enrichment,diagnostic}=await service.enrich([{SN:'SN'}]);assert.equal(enrichment.get('SN').model,'Safe');assert.equal(diagnostic.cacheReadFailed,1);assert.equal(diagnostic.cacheWriteFailed,1);});

test('same-isolate concurrent miss uses one upstream request',async()=>{const kv=memoryKv();let calls=0,release;const waiting=new Promise(resolve=>{release=resolve;});const service=createTinecoSnEnrichmentService(env,{...options(async()=>{calls++;await waiting;return Response.json(payload([{newSnNo:'SN-ONE',productName:'One'}]));}),cacheBinding:kv});const first=service.lookup('SN-ONE'),second=service.lookup('SN-ONE');for(let i=0;i<10&&!calls;i++)await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release();assert.equal((await first).model,'One');assert.equal((await second).model,'One');});

test('request circuit opens after three exhausted rate-limited logical lookups',async()=>{let calls=0;const {enrichment,diagnostic}=await createTinecoSnEnrichmentService(env,{...options(async()=>{calls++;return new Response('',{status:429});}),concurrency:3}).enrich(Array.from({length:8},(_,i)=>({SN:`RATE-${i}`})));assert.equal(calls,9);assert.equal(enrichment.size,8);assert.equal(diagnostic.circuitOpen,true);assert.equal(diagnostic.upstreamRequested,3);assert.equal(diagnostic.lookupFailed,8);});

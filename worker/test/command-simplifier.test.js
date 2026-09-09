import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandSimplifier,commandSchema} from '../src/modules/ai/command-simplifier-service.js';
import {handleRequest} from '../src/index.js';
const raw='补螺栓+补说明书\n入库前在同型号的三四类找说明书补上，若没有需告知，重分二类M8LS-14-BS\nFD-B044-260908-0001';
const structured={title:'补螺栓 / 补说明书',steps:['补螺栓','入库前同型号三四类找说明书补上，若没有需告知','重分二类M8LS-14-BS'],reference:'FD-B044-260908-0001',displayText:'补螺栓\n入库前同型号三四类找说明书补上，若没有需告知\n重分二类M8LS-14-BS'};
const env={OPENAI_API_KEY:'test-secret',OPENAI_COMMAND_MODEL:'configured-test-model'};
const response=value=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]})});
test('Responses API structured output sends only command data and accepts preserved codes',async()=>{
 let request;const service=createCommandSimplifier(env,{fetchImpl:async(url,init)=>{request={url,...init};return response(structured);}});
 const r=await service.simplify(raw),body=JSON.parse(request.body);assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(body.input,raw);assert.equal(body.model,env.OPENAI_COMMAND_MODEL);assert.equal(body.store,false);assert.deepEqual(body.text.format.schema,commandSchema);assert.equal(body.text.format.strict,true);assert.equal(r.commandAiStatus,'SIMPLIFIED');assert.match(r.commandDisplay,/M8LS-14-BS/);assert.equal(r.commandReference,'FD-B044-260908-0001');assert.doesNotMatch(JSON.stringify(r),/test-secret/);
});
for(const value of [{}, {...structured,steps:[1]}, {...structured,displayText:''},{...structured,displayText:'补螺栓'}, {...structured,reference:{bad:true}}])test('invalid or code-losing AI output falls back',async()=>{const r=await createCommandSimplifier(env,{fetchImpl:async()=>response(value)}).simplify(raw);assert.equal(r.commandDisplay,raw);assert.equal(r.commandAiSource,'RAW_FALLBACK');});
for(const kind of ['missing','network','rate','refusal','incomplete','malformed','timeout'])test(`${kind} is nonblocking raw fallback`,async()=>{
 let signal;const fetchImpl=async(_,init)=>{signal=init.signal;if(kind==='timeout')return new Promise(()=>{});if(kind==='network')throw Error('secret upstream error');if(kind==='rate')return {ok:false};if(kind==='malformed')return {ok:true,json:async()=>{throw Error('bad json');}};return {ok:true,json:async()=>({status:kind==='incomplete'?'incomplete':'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]})};};
 const r=await createCommandSimplifier(kind==='missing'?{}:env,{fetchImpl,timeoutMs:5}).simplify(raw);assert.equal(r.commandAiStatus,'FALLBACK');assert.equal(r.commandDisplay,raw);if(kind==='timeout')assert.equal(signal.aborted,true);
});
test('blank and oversized command never call OpenAI',async()=>{let calls=0;const s=createCommandSimplifier(env,{fetchImpl:async()=>{calls++;}});assert.equal((await s.simplify(' \n ')).commandAiStatus,'NOT_REQUIRED');assert.equal((await s.simplify('中'.repeat(6001))).commandAiStatus,'FALLBACK');assert.equal(calls,0);});
test('AI endpoint works without Feishu configuration and never returns configuration',async()=>{const response=await handleRequest(new Request('https://api.example/api/ai/simplify-command',{method:'POST',body:JSON.stringify({command:raw})}),{});assert.equal(response.status,200);const body=await response.json();assert.equal(body.data.commandDisplay,raw);assert.doesNotMatch(JSON.stringify(body),/OPENAI_API_KEY/);});

test('unauthorized upstream request preserves raw fallback without logging secrets or operational content',async t=>{
 const logs=[];t.mock.method(console,'log',(...args)=>logs.push(args));t.mock.method(console,'error',(...args)=>logs.push(args));
 t.mock.method(globalThis,'fetch',async()=>({ok:false,status:401,json:async()=>({error:{message:'test-secret '+raw}})}));
 const result=await handleRequest(new Request('https://api.example/api/ai/simplify-command',{method:'POST',body:JSON.stringify({command:raw,rows:[{private:'never forwarded'}]})}),env);
 const body=await result.json();assert.equal(body.data.commandAiStatus,'FALLBACK');assert.equal(body.data.commandDisplay,raw);
 const captured=JSON.stringify(logs);assert.ok(!captured.includes(raw));assert.ok(!captured.includes('test-secret'));assert.ok(!captured.includes('never forwarded'));
});
test('representative successful structure retains actions, reporting condition, timing, model and reference',async()=>{
 const result=await createCommandSimplifier(env,{fetchImpl:async()=>response(structured)}).simplify(raw);
 assert.equal(result.commandAiStatus,'SIMPLIFIED');
 const visible=result.commandDisplay+'\n'+result.commandReference;
 for(const token of ['螺栓','说明书','同型号','入库前','三四类','若没有需告知','二类','M8LS-14-BS','FD-B044-260908-0001'])assert.ok(visible.includes(token));
 assert.ok(Array.isArray(result.steps)&&result.steps.length>=3);
});

const diagnosticEnv={...env,OPENAI_COMMAND_DIAGNOSTICS:'true'};
for(const [status,code,type,category] of [[404,'model_not_found','invalid_request_error','MODEL_ACCESS'],[400,'invalid_json_schema','invalid_request_error','HTTP'],[401,'invalid_api_key','authentication_error','AUTHENTICATION'],[429,'insufficient_quota','insufficient_quota','RATE_OR_QUOTA']])test(`HTTP ${status} ${code} yields safe diagnostic fallback`,async()=>{
 const events=[];const s=createCommandSimplifier(diagnosticEnv,{onDiagnostic:d=>events.push(d),fetchImpl:async()=>({ok:false,status,json:async()=>({error:{code,type,message:raw+' '+env.OPENAI_API_KEY,param:raw}})})});
 const r=await s.simplify(raw),d=r.diagnostics;assert.equal(r.commandDisplay,raw);assert.equal(d.fallbackReason,'OPENAI_HTTP_ERROR');assert.equal(d.openaiStatus,status);assert.equal(d.openaiCode,code);assert.equal(d.openaiType,type);assert.equal(d.failureCategory,category);assert.equal(d.validationStage,'RESPONSE_JSON');assert.equal(d.timeout,false);assert.ok(d.openaiLatencyMs>=0);assert.equal(events.length,1);assert.doesNotMatch(JSON.stringify(d),/test-secret|补螺栓|M8LS|message|param/);
});
for(const [config,reason] of [[{OPENAI_COMMAND_MODEL:'gpt-5.6-luna'},'MISSING_API_KEY'],[{OPENAI_API_KEY:' '},'MISSING_API_KEY'],[{OPENAI_API_KEY:'test-secret'},'MISSING_MODEL']])test(`configuration diagnostics ${reason}`,async()=>{
 let calls=0;const result=await createCommandSimplifier({...config,OPENAI_COMMAND_DIAGNOSTICS:'true'},{fetchImpl:()=>{calls++;}}).simplify(raw);
 assert.equal(result.diagnostics.fallbackReason,reason);assert.equal(result.diagnostics.validationStage,'CONFIG');assert.equal(calls,0);
});
test('safe diagnostics are server-gated; caller debug fields cannot enable them',async()=>{
 const r=await handleRequest(new Request('https://api.example/api/ai/simplify-command',{method:'POST',body:JSON.stringify({command:raw,diagnostics:true,OPENAI_COMMAND_DIAGNOSTICS:'true'})}),{});
 assert.equal((await r.json()).data.diagnostics,undefined);
});
for(const [payload,reason,stage] of [
 [{status:'completed'},'OPENAI_OUTPUT_MISSING','OUTPUT_CONTENT'],
 [{status:'completed',output:[{type:'reasoning',summary:[]}]},'OPENAI_OUTPUT_TEXT_MISSING','OUTPUT_CONTENT'],
 [{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:raw}]}]},'OPENAI_REFUSAL','OUTPUT_CONTENT'],
 [{status:'incomplete',output:[]},'OPENAI_INCOMPLETE','RESPONSE_STATUS'],
 [{status:'failed',error:{code:'server_error',message:raw}},'OPENAI_RESPONSE_ERROR','RESPONSE_STATUS'],
 [{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'bad json'}]}]},'OPENAI_STRUCTURED_JSON_INVALID','STRUCTURED_JSON']
])test(`parser diagnoses ${reason}`,async()=>{const r=await createCommandSimplifier(diagnosticEnv,{fetchImpl:async()=>({ok:true,status:200,json:async()=>payload})}).simplify(raw);assert.equal(r.diagnostics.fallbackReason,reason);assert.equal(r.diagnostics.validationStage,stage);assert.equal(r.commandDisplay,raw);});
test('valid real Responses output ignores reasoning blocks and parses assistant output_text',async()=>{
 const events=[];const s=createCommandSimplifier(diagnosticEnv,{onDiagnostic:d=>events.push(d),fetchImpl:async()=>({ok:true,status:200,json:async()=>({id:'resp_fixture',object:'response',status:'completed',output:[{id:'rs_fixture',type:'reasoning',summary:[]},{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',annotations:[],text:JSON.stringify(structured)}]}]})})});
 const r=await s.simplify(raw);assert.equal(r.commandAiSource,'AI');assert.equal(r.diagnostics,undefined);assert.equal(events[0].validationStage,'COMPLETE');assert.equal(events[0].validationResult,'VALID');assert.equal(events[0].openaiStatus,200);
});
test('diagnostics distinguish malformed transport JSON, schema failure and missing literal tokens',async()=>{
 const malformed=await createCommandSimplifier(diagnosticEnv,{fetchImpl:async()=>({ok:true,status:200,json:async()=>{throw Error(raw);}})}).simplify(raw);assert.equal(malformed.diagnostics.fallbackReason,'OPENAI_RESPONSE_JSON_INVALID');
 for(const [value,result] of [[{},'STRUCTURE_INVALID'],[{...structured,displayText:'简化'},'LITERAL_TOKEN_MISSING']]){const r=await createCommandSimplifier(diagnosticEnv,{fetchImpl:async()=>response(value)}).simplify(raw);assert.equal(r.diagnostics.validationResult,result);assert.equal(r.diagnostics.fallbackReason,'OPENAI_VALIDATION_FAILED');}
});
test('timeout records elapsed time and a stable stage even if the upstream resolves late',async()=>{
 const events=[];let release;const r=await createCommandSimplifier(diagnosticEnv,{timeoutMs:5,onDiagnostic:d=>events.push(d),fetchImpl:()=>new Promise(resolve=>release=resolve)}).simplify(raw);
 assert.equal(r.diagnostics.timeout,true);assert.equal(r.diagnostics.fallbackReason,'OPENAI_TIMEOUT');assert.equal(r.diagnostics.validationStage,'REQUEST');assert.ok(r.diagnostics.openaiLatencyMs>=0);
 release(response(structured));await new Promise(resolve=>setImmediate(resolve));assert.equal(events.length,1);assert.equal(events[0].fallbackReason,'OPENAI_TIMEOUT');
});
test('unknown upstream code/type and caller request IDs cannot leak text or keys into diagnostics',async t=>{
 const logs=[];t.mock.method(console,'log',line=>logs.push(JSON.parse(line)));
 t.mock.method(globalThis,'fetch',async()=>({ok:false,status:400,json:async()=>({error:{code:env.OPENAI_API_KEY,type:raw,message:raw}})}));
 const response=await handleRequest(new Request('https://api.example/api/ai/simplify-command',{method:'POST',headers:{'X-Request-ID':'test-secret'},body:JSON.stringify({command:raw})}),diagnosticEnv);
 const r=await response.json();assert.equal(r.data.diagnostics.openaiCode,'OTHER');assert.equal(r.data.diagnostics.openaiType,'OTHER');assert.equal(logs[0].requestId,'REDACTED');
 assert.doesNotMatch(JSON.stringify(logs),/test-secret|补螺栓|M8LS|FD-B044/);assert.doesNotMatch(JSON.stringify(r.data.diagnostics),/test-secret|补螺栓/);
});
test('diagnostic logger failure cannot prevent raw fallback',async()=>{
 const r=await createCommandSimplifier({}, {onDiagnostic:()=>{throw Error('logger failure');}}).simplify(raw);assert.equal(r.commandAiSource,'RAW_FALLBACK');assert.equal(r.commandDisplay,raw);
});

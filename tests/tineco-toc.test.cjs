const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(saved=null) {
 const nodes=new Map();const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',value:'',textContent:'',focus(){},querySelector:node,querySelectorAll:()=>[],addEventListener(type,fn){this['on'+type]=fn;}});return nodes.get(selector);};
 let stored=saved;const calls=[];const window={crypto:{randomUUID:()=> 'visit-1234567890123456'},setInterval(){},clearInterval(){},confirm:()=>true,MkiteApiClient:{post:async(path,body)=>{calls.push({path,body});if(path.endsWith('/begin'))return {ok:true,data:{requestId:body.requestId,sn:body.sn,unitId:'TCU-20260908-0001',entry:1,phase:'draft',step:0,startedAt:Date.now(),data:{totalPartsUsed:'0'},repairLevels:['Level 1']}};return {ok:true,data:{...stored,pending:undefined,phase:path.endsWith('/cancel')?'cancelled':path.endsWith('/finish')?'saved':'draft',step:body.to??stored.step,data:body.data||stored.data,result:{sn:stored.sn,unitId:stored.unitId,entry:1,laborMinutes:1,repairResult:body.outcome}}};}}};
 vm.runInNewContext(fs.readFileSync('js/client-tools/tineco-toc/tineco-toc.js','utf8'),{window});
 const module=window.MkiteClientToolModules['tineco.toc'];const ctx={root:node('root'),warehouse:'MKS66',clientId:'TINECO-TOC',storage:{get:()=>stored,set:(_,v)=>stored=structuredClone(v),remove:()=>stored=null},toast:{show(){}},audio:{success(){}}};module.init(ctx);
 return {module,t:module._test,window,calls,node,ctx,get saved(){return stored;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('Tineco registry identity, directory filters and warehouse-aware route',()=>{
 const window={location:{hash:'#client/MKS66/TINECO-TOC/tool/tineco-toc'},addEventListener(){}};
 for(const path of ['js/client-tools-registry.js','js/router.js'])vm.runInNewContext(fs.readFileSync(path,'utf8'),{window});
 const r=window.MkiteClientToolRegistry;assert.equal(r.filter().length,3);assert.equal(r.filter({warehouse:'MKS66'}).length,3);assert.equal(r.filter({clientId:'TINECO-TOC'}).length,2);const tool=r.filter({query:'CT-MKS66-TINECO-TOC-0001'})[0];assert.equal(tool.name,'TINECO TOC');assert.equal(window.MkiteRouter.current().warehouse,'MKS66');assert.equal(r.get('TINECO-TOC','tineco-toc','MKS66'),tool);
});
test('serial start mandatory and opaque; exactly one SOP stage visible',async()=>{const h=setup();h.t.begin(' ');assert.equal(h.calls.length,0);h.t.begin(' ABC/123@T-_.# ');await flush();assert.equal(h.calls[0].body.sn,'ABC/123@T-_.#');assert.match(h.node('#tcu-app').innerHTML,/ISSUE FOUND/);assert.doesNotMatch(h.node('#tcu-app').innerHTML,/data-field="partUsedDetail"/);h.t.move(2);assert.equal(h.calls.length,1);h.module.cleanup();});
test('forward/back preserves draft, refresh restores stage and pending data',async()=>{const h=setup();h.t.begin('SN');await flush();h.t.getSession().data.preQcNote='keep';h.t.move(1);await flush();h.t.getSession().data.partUsedDetail='Filter';h.t.move(0);await flush();assert.equal(h.saved.data.partUsedDetail,'Filter');h.module.cleanup();h.module.init(h.ctx);assert.equal(h.t.getSession().data.preQcNote,'keep');h.module.cleanup();});
test('double submit suppressed, successful save is never restored as active',async()=>{const h=setup();h.t.begin('SN');await flush();h.t.finish('NFF');h.t.finish('NFF');await flush();assert.equal(h.calls.filter(c=>c.path.endsWith('/finish')).length,1);assert.match(h.node('#tcu-app').innerHTML,/REPAIR DATA SAVED/);h.module.cleanup();h.module.init(h.ctx);assert.equal(h.t.getSession().phase,'saved');assert.match(h.node('#tcu-app').innerHTML,/START NEXT UNIT/);h.module.cleanup();});
test('cancel draft invokes only cancel and removes local session',async()=>{const h=setup();h.t.begin('SN');await flush();await h.t.run('cancel',{requestId:h.saved.requestId});assert.equal(h.saved,null);assert.equal(h.calls.filter(c=>c.path.endsWith('/finish')).length,0);h.module.cleanup();});
test('failed save persists frozen request through refresh and retry',async()=>{const h=setup();h.t.begin('SN');await flush();h.window.MkiteApiClient.post=async()=>({ok:false,error:{code:'CONNECTION_ERROR',message:'Retry'}});h.t.finish('NFF');await flush();const original=structuredClone(h.saved.pending);assert.equal(original.action,'finish');h.module.cleanup();h.module.init(h.ctx);assert.deepEqual(h.saved.pending,original);assert.match(h.node('#tcu-app').innerHTML,/RETRY SAVE/);h.module.cleanup();});
test('real API helper unwraps successful HTTP 200 and clears operation lock while retaining authoritative visit',async()=>{
 const h=setup();let release;h.window.MkiteApiConfig={baseUrl:'https://api.example'};
 h.window.fetch=()=>new Promise(resolve=>release=resolve);
 vm.runInNewContext(fs.readFileSync('js/services/api-client.js','utf8'),{window:h.window});
 h.t.begin('SN');assert.equal(h.saved.pending.action,'begin');assert.match(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);
 const visit={requestId:h.saved.requestId,sn:'SN',unitId:'TCU-20260908-0009',entry:3,startedAt:123456789,step:0,phase:'draft',data:{totalPartsUsed:'0'},repairLevels:['Level 1']};
 release({ok:true,status:200,json:async()=>({ok:true,data:visit})});await flush();
 assert.equal(h.saved.pending,undefined);assert.equal(h.saved.unitId,visit.unitId);assert.equal(h.saved.entry,3);assert.equal(h.saved.startedAt,visit.startedAt);assert.equal(h.saved.step,0);assert.equal(h.saved.sn,'SN');
 assert.doesNotMatch(h.node('#tcu-app').innerHTML,/<fieldset disabled>|Starting visit|Pending operation/);assert.match(h.node('#tcu-app').innerHTML,/CONTINUE TO REPAIR/);h.module.cleanup();
});
test('refresh before begin response automatically recovers same identity and clears persisted lock',async()=>{
 const h=setup();let release;const normal=h.window.MkiteApiClient.post;h.window.MkiteApiClient.post=()=>new Promise(resolve=>release=resolve);
 h.t.begin('SN');const pending=structuredClone(h.saved.pending);h.module.cleanup();
 // Late success from the previous mount cannot touch the restored session.
 h.window.MkiteApiClient.post=normal;h.module.init(h.ctx);await flush();release({ok:true,data:{}});await flush();
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].body,pending.body);assert.equal(h.saved.requestId,pending.body.requestId);assert.equal(h.saved.pending,undefined);assert.equal(h.saved.phase,'draft');assert.doesNotMatch(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);h.module.cleanup();
});
test('true begin failure shows retry and cancel; retry reuses identity and unlocks',async()=>{
 const h=setup(),normal=h.window.MkiteApiClient.post;h.window.MkiteApiClient.post=async()=>({ok:false,error:{code:'CONNECTION_ERROR',message:'Connection lost'}});
 h.t.begin('SN');await flush();const pending=structuredClone(h.saved.pending);
 assert.match(h.node('#tcu-app').innerHTML,/UNABLE TO START REPAIR VISIT/);assert.match(h.node('#tcu-app').innerHTML,/RETRY START/);assert.match(h.node('#tcu-app').innerHTML,/id="tcu-cancel-start"/);assert.match(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);
 h.window.MkiteApiClient.post=normal;await h.t.run('begin',pending.body);assert.deepEqual(h.calls[0].body,pending.body);assert.equal(h.saved.pending,undefined);assert.doesNotMatch(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);h.module.cleanup();
});
test('malformed HTTP success retains recoverable start instead of enabling an invalid visit',async()=>{
 const h=setup();h.window.MkiteApiClient.post=async()=>({ok:true,data:{}});h.t.begin('SN');await flush();assert.equal(h.saved.pending.action,'begin');assert.match(h.node('#tcu-app').innerHTML,/INVALID_VISIT_RESPONSE/);assert.match(h.node('#tcu-app').innerHTML,/UNABLE TO START/);
 await h.node('#tcu-cancel-start').onclick();assert.equal(h.saved.pending.action,'begin');h.module.cleanup();
});
test('success explicitly removes stale pending metadata from returned active visit',async()=>{
 const h=setup(),normal=h.window.MkiteApiClient.post;h.window.MkiteApiClient.post=async(...args)=>{const response=await normal(...args);response.data.pending={action:'begin'};return response;};h.t.begin('SN');await flush();assert.equal(h.saved.pending,undefined);assert.doesNotMatch(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);h.module.cleanup();
});
test('exit outcomes remain visible and separated in every stage',async()=>{
 const h=setup();h.t.begin('SN');await flush();
 for(const [step,outcomes] of [[0,['NFF','Awaiting Parts']],[1,['Can Not Be Fixed']],[2,['Final QC Fail']]]){
   if(step){h.t.move(step);await flush();}
   const html=h.node('#tcu-app').innerHTML;
   assert.match(html,/class="tcu-main-action"/);assert.match(html,/class="tcu-exit-actions"/);assert.match(html,/EXIT — save outcome/);assert.match(html,/class="tcu-cancel-action"/);assert.doesNotMatch(html,/<details>/);
   for(const outcome of outcomes)assert.ok(html.includes(`data-outcome="${outcome}"`));
 }
 h.module.cleanup();
});
test('part Enter and Add preserve duplicate opaque items, removal updates list and count, payload stays compatible',async()=>{
 const h=setup();h.t.begin('SN');await flush();h.t.move(1);await flush();
 const enter=value=>h.node('#tcu-part-input').onkeydown({key:'Enter',target:{value},preventDefault(){}});
 enter(' ABC/123@part ');enter('ABC/123@part');
 h.node('#tcu-part-input').value='Filter#2';h.node('#tcu-add-part').onclick();
 assert.equal(h.saved.data.partUsedDetail,'ABC/123@part\nABC/123@part\nFilter#2');assert.equal(h.saved.data.totalPartsUsed,'3');
 assert.equal((h.node('#tcu-app').innerHTML.match(/data-remove-part=/g)||[]).length,3);
 h.t.removePart(1);assert.equal(h.saved.data.partUsedDetail,'ABC/123@part\nFilter#2');assert.equal(h.saved.data.totalPartsUsed,'2');assert.match(h.node('#tcu-app').innerHTML,/TOTAL PARTS USED: <strong>2/);
 h.t.getSession().data.repairLevel='Level 1';h.t.finish('Can Not Be Fixed');await flush();
 const payload=h.calls.at(-1).body.data;assert.equal(payload.partUsedDetail,'ABC/123@part\nFilter#2');assert.equal(payload.totalPartsUsed,'2');assert.equal(h.calls.at(-1).path,'/api/tineco-toc/finish');h.module.cleanup();
});
test('parts survive back navigation and refresh; empty list is zero',async()=>{
 const h=setup();h.t.begin('SN');await flush();h.t.move(1);await flush();h.t.addPart('Part');h.t.move(0);await flush();h.t.move(1);await flush();h.module.cleanup();h.module.init(h.ctx);assert.match(h.node('#tcu-app').innerHTML,/Part/);h.t.removePart(0);assert.equal(h.saved.data.totalPartsUsed,'0');assert.equal(h.saved.data.partUsedDetail,'');h.module.cleanup();
});
test('expanded saved summary displays visit and repair details safely',()=>{
 const h=setup({phase:'saved',result:{sn:'SN<1>',unitId:'TCU-20260908-0001',repairResult:'Completed',laborMinutes:12,entry:3},data:{totalPartsUsed:'2',partUsedDetail:'A\nB',repairLevel:'Level 2',trackingNumber:'TRACK/123'}});
 const html=h.node('#tcu-app').innerHTML;
 assert.match(html,/tcu-summary-grid/);for(const value of ['SN&lt;1&gt;','TCU-20260908-0001','Completed','LABOR MINUTES','RE-ENTRY','PARTS USED','REPAIR LEVEL','Level 2','TRACK/123','START NEXT UNIT'])assert.ok(html.includes(value));h.module.cleanup();
});
for(const step of [0,1,2])test(`Pending unit resumes directly at stage ${step+1} with cumulative context`,()=>{
 const h=setup({phase:'draft',requestId:'resume-1234567890123',recordId:'existing',unitId:'TCU-old',sn:'SN',entry:2,step,clientStatus:'Pending',previousLaborMinutes:15,startedAt:Date.now()-7*60000,resumed:true,data:{trackingNumber:'TRACK',issueFound:'Issue',partUsedDetail:'Motor\nFilter',totalPartsUsed:'2',repairLevel:'Level 1',finalQcNote:'old failure'}});
 const html=h.node('#tcu-app').innerHTML;assert.match(html,/EXISTING UNIT FOUND/);assert.ok(html.includes(`tcu-stage-${step}`));assert.match(html,/Previous Labor: 15 min/);assert.match(html,/Client Status: Pending/);
 if(step===1){assert.match(html,/Motor/);assert.match(html,/Filter/);h.t.addPart('Brush');h.t.removePart(0);assert.equal(h.saved.data.partUsedDetail,'Filter\nBrush');}
 if(step===2)assert.match(html,/old failure/);h.module.cleanup();
});
for(const status of ['Completed','Disposal'])test(`${status} response displays read-only state without active form`,async()=>{
 const h=setup();h.window.MkiteApiClient.post=async(_,body)=>({ok:true,data:{requestId:body.requestId,sn:body.sn,unitId:'TCU-existing',phase:status.toLowerCase(),clientStatus:status,previousLaborMinutes:23,result:{repairResult:'Completed'}}});h.t.begin('SN');await flush();const html=h.node('#tcu-app').innerHTML;assert.match(html,status==='Completed'?/UNIT ALREADY COMPLETED/:/UNIT MARKED FOR DISPOSAL/);assert.doesNotMatch(html,/<fieldset/);assert.match(html,/23/);h.module.cleanup();
});
test('next-step colors correspond to destination stage and Issue Found error unlocks editing',async()=>{
 const h=setup();h.t.begin('SN');await flush();assert.match(h.node('#tcu-app').innerHTML,/tcu-next-repair/);h.t.move(1);await flush();assert.match(h.node('#tcu-app').innerHTML,/tcu-next-final/);h.t.move(0);await flush();h.window.MkiteApiClient.post=async()=>({ok:false,error:{code:'ISSUE_FOUND_REQUIRED',message:'ISSUE FOUND is required.'}});h.t.move(1);await flush();assert.equal(h.saved.pending,undefined);assert.match(h.node('#tcu-app').innerHTML,/ISSUE_FOUND_REQUIRED/);assert.doesNotMatch(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);h.module.cleanup();
});
test('desktop scanner layout is responsive and retains autofocus and form submit',async()=>{
 const h=setup();let focused=false;
 h.module.cleanup();h.node('#tcu-sn').focus=()=>focused=true;h.module.init(h.ctx);
 assert.equal(focused,true);h.node('#tcu-sn').value='SN/desktop';let prevented=false;
 h.node('#tcu-start').onsubmit({preventDefault(){prevented=true;}});await flush();
 assert.equal(prevented,true);assert.equal(h.calls[0].body.sn,'SN/desktop');h.module.cleanup();
 const css=fs.readFileSync('css/client-tools/tineco-toc.css','utf8');
 assert.match(css,/\.tcu-app:has\(#tcu-start\).*width:100%/);
 assert.match(css,/#tcu-start #tcu-sn.*height:80px/);
 assert.match(css,/@media\(max-width:600px\).*#tcu-start.*min-width:0/);
});

const statusHtml=h=>h.node('#tcu-app').innerHTML.match(/<aside class="tcu-status[\s\S]*?<\/aside>/)?.[0]||'';
test('status moves from idle through pending history lookup to new unit without extra API calls',async()=>{
 const h=setup(),normal=h.window.MkiteApiClient.post;
 assert.match(statusHtml(h),/CURRENT STATUS/);assert.match(statusHtml(h),/Ready for SN/);
 assert.match(statusHtml(h),/Scan or enter a machine serial number to begin/);
 let release;h.window.MkiteApiClient.post=(...args)=>new Promise(resolve=>{release=async()=>resolve(await normal(...args));});
 h.t.begin('SN');assert.match(statusHtml(h),/Checking machine history\.\.\./);
 assert.match(statusHtml(h),/Looking for previous record, current step, labor, and parts/);
 assert.match(statusHtml(h),/tcu-status-spinner/);assert.match(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);
 await release();await flush();assert.match(statusHtml(h),/New Unit/);assert.match(statusHtml(h),/Pre-QC Ready/);
 assert.match(statusHtml(h),/#1/);assert.doesNotMatch(statusHtml(h),/spinner|Checking/);assert.equal(h.calls.length,1);h.module.cleanup();
});
for(const step of [0,1,2])test(`lookup status presents existing Pending summary for step ${step}`,async()=>{
 const h=setup(),normal=h.window.MkiteApiClient.post;
 h.window.MkiteApiClient.post=async(...args)=>{const r=await normal(...args);Object.assign(r.data,{resumed:true,step,entry:3,timesOfReEnter:3,previousLaborMinutes:27,clientStatus:'Pending',data:{partUsedDetail:'Motor\nFilter',totalPartsUsed:'2'}});return r;};
 h.t.begin('SN');await flush();const html=statusHtml(h);
 for(const value of ['Existing Unit Found','#3','Current Step',['Pre-QC','Repair','Final QC'][step],'Previous Labor','27 min','Parts Loaded','<dd>2</dd>'])assert.ok(html.includes(value),value);
 assert.doesNotMatch(html,/New Unit|Checking/);h.module.cleanup();
});
for(const phase of ['completed','disposal'])test(`${phase} lookup status has distinct presentation`,async()=>{
 const h=setup();h.window.MkiteApiClient.post=async(_,body)=>({ok:true,data:{requestId:body.requestId,phase,sn:body.sn}});
 h.t.begin('SN');await flush();const html=statusHtml(h);
 assert.ok(html.includes(`is-${phase}`));assert.match(html,phase==='completed'?/Unit Already Completed/:/Unit Marked for Disposal/);
 assert.match(html,phase==='completed'?/cannot be reopened/:/not available for normal TOC/);
 assert.doesNotMatch(h.node('#tcu-app').innerHTML,/<fieldset/);
 h.node('#tcu-next-unit').onclick();assert.match(statusHtml(h),/Ready for SN/);h.module.cleanup();
});
for(const code of ['DUPLICATE_SN_RECORDS','CONNECTION_ERROR'])test(`${code} status preserves retry and cancel and clears on success`,async()=>{
 const h=setup(),normal=h.window.MkiteApiClient.post;
 h.window.MkiteApiClient.post=async()=>({ok:false,error:{code,message:'Lookup failed'}});
 h.t.begin('SN');await flush();assert.match(statusHtml(h),code==='DUPLICATE_SN_RECORDS'?/Duplicate SN Conflict/:/Unable to Load Unit/);
 assert.match(statusHtml(h),code==='DUPLICATE_SN_RECORDS'?/Manual review is required/:/Retry the lookup or cancel/);
 assert.match(h.node('#tcu-app').innerHTML,/id="tcu-retry"/);assert.match(h.node('#tcu-app').innerHTML,/id="tcu-cancel-start"/);
 h.window.MkiteApiClient.post=normal;await h.t.run('begin',h.saved.pending.body);
 assert.match(statusHtml(h),/New Unit/);assert.doesNotMatch(statusHtml(h),/Conflict|Unable|Checking/);h.module.cleanup();
});
test('status layout stacks on tablet and honors reduced motion',()=>{
 const css=fs.readFileSync('css/client-tools/tineco-toc.css','utf8');
 assert.match(css,/grid-template-columns:minmax\(0,1.4fr\) minmax\(300px,1fr\)/);
 assert.match(css,/@media\(max-width:900px\)\s*\{[\s\S]*?\.tcu-workspace > \.tcu-status[^}]*grid-column:1; grid-row:1/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\).*animation:none/);
 const h=setup();assert.match(statusHtml(h),/role="status" aria-live="polite" aria-atomic="true"/);h.module.cleanup();
});

for(const [step,outcome] of [[0,'NFF'],[0,'Awaiting Parts'],[1,'Can Not Be Fixed'],[2,'Completed'],[2,'Final QC Fail']])test(`${outcome} shows live save status and locks mutations until authoritative success`,async()=>{
 const h=setup();h.t.begin('SN');await flush();
 for(let to=1;to<=step;to++){h.t.move(to);await flush();}
 const normal=h.window.MkiteApiClient.post;let release;h.window.MkiteApiClient.post=(...args)=>new Promise(resolve=>{release=async()=>resolve(await normal(...args));});
 h.t.finish(outcome);
 assert.match(statusHtml(h),/Saving to Lark\.\.\./);assert.match(statusHtml(h),/Updating the TINECO TO C UNIT CLASS record/);
 assert.ok(statusHtml(h).includes(outcome));assert.match(statusHtml(h),/tcu-status-spinner/);
 const html=h.node('#tcu-app').innerHTML;assert.match(html,/<fieldset disabled>[\s\S]*id="tcu-cancel"[\s\S]*<\/fieldset>/);
 assert.match(html,/id="tcu-retry" disabled/);assert.equal((html.match(/data-step="\d" disabled/g)||[]).length,3);
 assert.doesNotMatch(html,/tcu-success/);const pending=structuredClone(h.saved.pending);
 h.t.finish(outcome);h.t.move(step===0?1:step-1);h.t.addPart('unwanted');assert.deepEqual(h.saved.pending,pending);
 await release();await flush();assert.match(statusHtml(h),/Repair Data Saved/);
 assert.match(statusHtml(h),/successfully updated in Lark/);assert.match(h.node('#tcu-app').innerHTML,/tcu-summary-grid/);
 assert.equal(h.calls.filter(c=>c.path.endsWith('/finish')).length,1);h.module.cleanup();
});

test('failed save retains data and Keep Current Unit; retry preserves request and frozen labor time',async()=>{
 const h=setup();h.t.begin('SN');await flush();h.t.move(1);await flush();h.t.addPart('Motor');
 Object.assign(h.t.getSession().data,{preQcNote:'keep note',issueFound:'issue',repairLevel:'Level 1'});
 h.t.getSession().startedAt=Date.now()-600000;
 const normal=h.window.MkiteApiClient.post,requests=[];
 h.window.MkiteApiClient.post=async(path,body)=>{requests.push(structuredClone(body));throw new Error('Connection lost');};
 h.t.finish('Can Not Be Fixed');await flush();const retained=structuredClone(h.saved),labor=h.t.minutes();
 assert.match(statusHtml(h),/Unable to Save Repair Data/);assert.match(statusHtml(h),/not confirmed as saved/);
 assert.match(h.node('#tcu-app').innerHTML,/RETRY SAVE/);h.node('#tcu-keep-unit').onclick();assert.deepEqual(h.saved,retained);
 let release;h.window.MkiteApiClient.post=(path,body)=>{requests.push(structuredClone(body));return new Promise(resolve=>{release=async()=>resolve(await normal(path,body));});};
 h.node('#tcu-retry').onclick();assert.match(statusHtml(h),/Retrying Save/);assert.match(statusHtml(h),/is-recovering/);
 assert.deepEqual(h.saved.pending,retained.pending);assert.deepEqual(requests[1],requests[0]);assert.equal(h.t.minutes(),labor);
 for(const key of ['sn','unitId','entry','step','startedAt','data'])assert.deepEqual(h.saved[key],retained[key]);
 await release();await flush();assert.match(statusHtml(h),/Repair Data Saved/);h.module.cleanup();
});

test('refresh automatically recovers the frozen save; late previous response cannot replace recovered success',async()=>{
 const h=setup();h.t.begin('SN');await flush();const normal=h.window.MkiteApiClient.post;
 let oldRelease;h.window.MkiteApiClient.post=()=>new Promise(resolve=>oldRelease=resolve);
 h.t.finish('NFF');const retained=structuredClone(h.saved),labor=h.t.minutes();h.module.cleanup();
 let release,recoveryBody;h.window.MkiteApiClient.post=(path,body)=>{recoveryBody=structuredClone(body);return new Promise(resolve=>{release=async()=>resolve(await normal(path,body));});};
 h.module.init(h.ctx);assert.match(statusHtml(h),/Recovering Save/);assert.deepEqual(recoveryBody,retained.pending.body);
 assert.deepEqual(h.saved.pending,retained.pending);assert.equal(h.t.minutes(),labor);
 await release();await flush();assert.match(statusHtml(h),/Repair Data Saved/);assert.match(h.node('#tcu-app').innerHTML,/REPAIR DATA SAVED/);
 oldRelease({ok:false,error:{code:'CONNECTION_ERROR',message:'old failure'}});await flush();assert.match(statusHtml(h),/Repair Data Saved/);h.module.cleanup();
});

test('refresh recovery failure keeps pending save available for another retry',async()=>{
 const h=setup();h.t.begin('SN');await flush();h.window.MkiteApiClient.post=async()=>({ok:false,error:{code:'CONNECTION_ERROR',message:'unavailable'}});
 h.t.finish('Awaiting Parts');await flush();const pending=structuredClone(h.saved.pending);
 h.module.cleanup();h.module.init(h.ctx);assert.match(statusHtml(h),/Recovering Save/);await flush();
 assert.match(statusHtml(h),/Unable to Save Repair Data/);assert.deepEqual(h.saved.pending,pending);assert.match(h.node('#tcu-app').innerHTML,/RETRY SAVE/);h.module.cleanup();
});

for(const [from,to] of [[0,1],[1,2],[1,0],[2,1]])test(`step status ${from+1} to ${to+1} follows actual request then confirmed ready state`,async()=>{
 const h=setup();h.t.begin('SN');await flush();
 assert.match(statusHtml(h),/Pre-QC Ready/);assert.match(statusHtml(h),/Inspect the machine and record the issue found/);
 for(let step=1;step<=from;step++){h.t.move(step);await flush();}
 const normal=h.window.MkiteApiClient.post;let release;
 h.window.MkiteApiClient.post=(...args)=>new Promise(resolve=>{release=async()=>resolve(await normal(...args));});
 h.t.move(to);const name=['Pre-QC','Repair','Final QC'][to];
 assert.ok(statusHtml(h).includes(`${to<from?'Returning':'Switching'} to ${name}...`));
 assert.ok(statusHtml(h).includes(`Preparing the ${name} step.`));assert.doesNotMatch(statusHtml(h),/Ready|Lark|spinner/);
 assert.equal(h.saved.step,from);assert.equal(h.saved.pending.body.to,to);
 await release();await flush();assert.equal(h.saved.step,to);
 assert.ok(statusHtml(h).includes(`${name} Ready`));assert.ok(statusHtml(h).includes(`is-ready-${to}`));
 assert.ok(statusHtml(h).includes(['Inspect the machine and record the issue found.','Record parts used and continue repair work.','Perform final quality inspection and choose the outcome.'][to]));
 h.module.cleanup();
});
for(const step of [0,1,2])test(`resumed CURRENT STEP ${step+1} shows its ready title`,()=>{
 const h=setup({phase:'draft',step,resumed:true,entry:4,sn:'SN',unitId:'UNIT',startedAt:Date.now(),previousLaborMinutes:20,data:{partUsedDetail:'Filter'}});
 assert.ok(statusHtml(h).includes(`${['Pre-QC','Repair','Final QC'][step]} Ready`));assert.match(statusHtml(h),/Existing Unit Found/);
 assert.match(statusHtml(h),/Current Step/);assert.match(statusHtml(h),/20 min/);h.module.cleanup();
});
test('save and save failure override ready state and cannot be replaced by navigation',async()=>{
 const h=setup();h.t.begin('SN');await flush();let release;
 h.window.MkiteApiClient.post=()=>new Promise(resolve=>release=resolve);
 h.t.finish('NFF');h.t.move(1);assert.match(statusHtml(h),/Saving to Lark/);assert.doesNotMatch(statusHtml(h),/Ready|Switching/);
 release({ok:false,error:{code:'CONNECTION_ERROR',message:'Save not confirmed'}});await flush();h.t.move(1);
 assert.match(statusHtml(h),/Unable to Save Repair Data/);assert.doesNotMatch(statusHtml(h),/Ready|Switching/);h.module.cleanup();
});
for(const code of ['CONNECTION_ERROR','ISSUE_FOUND_REQUIRED'])test(`step error ${code} overrides ready state and retry can recover`,async()=>{
 const h=setup();h.t.begin('SN');await flush();const normal=h.window.MkiteApiClient.post;
 h.window.MkiteApiClient.post=async()=>({ok:false,error:{code,message:'Cannot continue'}});
 h.t.move(1);await flush();assert.match(statusHtml(h),/is-error/);assert.doesNotMatch(statusHtml(h),/Ready|Switching/);
 assert.equal(h.saved.step,0);h.window.MkiteApiClient.post=normal;
 if(h.saved.pending)await h.t.run(h.saved.pending.action,h.saved.pending.body);else{h.t.move(1);await flush();}
 assert.match(statusHtml(h),/Repair Ready/);h.module.cleanup();
});
test('invalid direct step jump leaves ready status and request count unchanged',async()=>{
 const h=setup();h.t.begin('SN');await flush();const calls=h.calls.length;
 h.t.move(2);assert.equal(h.calls.length,calls);assert.match(statusHtml(h),/Pre-QC Ready/);h.module.cleanup();
});

test('client-confirmed disposal is a Final QC exit and retains removed parts and note in save request',async()=>{
 const h=setup();h.t.begin('SN');await flush();assert.doesNotMatch(h.node('#tcu-app').innerHTML,/data-outcome="Client Confirmed Disposal"/);
 h.t.move(1);await flush();h.t.addPart('Motor');h.t.addPart('Filter');h.t.removePart(0);
 assert.doesNotMatch(h.node('#tcu-app').innerHTML,/data-outcome="Client Confirmed Disposal"/);
 h.t.move(2);await flush();assert.match(h.node('#tcu-app').innerHTML,/data-outcome="Client Confirmed Disposal">CLIENT CONFIRMED DISPOSAL/);
 h.t.getSession().data.finalQcNote='Client approved disposal';
 h.t.finish('Client Confirmed Disposal');assert.match(statusHtml(h),/Saving to Lark/);await flush();
 const input=h.calls.at(-1).body;assert.equal(input.outcome,'Client Confirmed Disposal');assert.equal(input.data.partUsedDetail,'Filter');assert.equal(input.data.finalQcNote,'Client approved disposal');h.module.cleanup();
});
test('missing disposal note unlocks the form for correction',async()=>{
 const h=setup();h.t.begin('SN');await flush();h.t.move(1);await flush();h.t.move(2);await flush();
 h.window.MkiteApiClient.post=async()=>({ok:false,error:{code:'DISPOSAL_NOTE_REQUIRED',message:'Write disposal details'}});
 h.t.finish('Client Confirmed Disposal');await flush();assert.equal(h.saved.pending,undefined);assert.equal(h.saved.step,2);
 assert.doesNotMatch(h.node('#tcu-app').innerHTML,/<fieldset disabled>/);assert.match(statusHtml(h),/Unable to Save Repair Data/);h.module.cleanup();
});

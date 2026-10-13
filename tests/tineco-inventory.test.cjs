const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const XLSX=require('../vendor/xlsx.full.min.js');
const columns=['UNIT ID','SN','TRACKING NUMBER','CLIENT ID','WAREHOUSE','REPAIR DATE','LATEST RE-ENTRY AT','TIMES OF RE-ENTER','CURRENT STEP','ISSUE FOUND','PRE-QC NOTE','PART USED DETAIL','TOTAL PARTS USED','LABOR MINUTES','REPAIR LEVEL','REPAIR RESULT','FINAL QC RESULT','FINAL QC NOTE','CLIENT STATUS'];
const rows=Array.from({length:123},(_,i)=>Object.fromEntries(columns.map(k=>[k,k==='SN'?`<SN-${i}>`:k==='CURRENT STEP'?String(i%3+1):`${k}-${i}`])));
function setup(){const nodes=new Map(),calls=[],lookups=[];let workbook,filename;
 const node=s=>{if(!nodes.has(s))nodes.set(s,{innerHTML:'',textContent:'',value:'',querySelector:node,querySelectorAll:()=>[],reset(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(s);};
 const window={XLSX:{...XLSX,writeFile:(b,f)=>{workbook=b;filename=f;}},MkiteApiClient:{post:async(path,body)=>{if(path==='/api/inventory/lookup'){lookups.push({path,body});return {ok:true,data:{sku:body.sku,total:1,locations:[{warehouseCode:'MKS66',locationCode:`LOC-${body.sku}`,availableQuantity:1}]}};}calls.push({path,body});const page=body.page||1;return {ok:true,data:{columns,options:{},exportLimit:5000,results:body.export?rows:rows.slice((page-1)*50,page*50),summary:{found:123,pending:41,completed:41,disposal:41,totalLaborMinutes:1230},pagination:{page,totalPages:3,totalMatched:123,hasPrevious:page>1,hasNext:page<3}}};}}};
 vm.runInNewContext(fs.readFileSync('js/client-tools/tineco-toc/inventory.js','utf8'),{window});const module=window.MkiteClientToolModules['tineco.inventory'];module.init({root:node('root')});return {window,module,t:module._test,node,calls,lookups,get workbook(){return workbook;},get filename(){return filename;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('new registry tool is warehouse-aware and directory includes both distinct Tineco themes',()=>{const window={};vm.runInNewContext(fs.readFileSync('js/client-tools-registry.js','utf8'),{window});const tools=window.MkiteClientToolRegistry.filter({clientId:'TINECO-TOC'});assert.equal(tools.length,2);const t=tools.find(t=>t.toolId==='CT-MKS66-TINECO-TOC-0002');assert.equal(t.warehouse,'MKS66');assert.equal(t.route,'tineco-toc-batch-inventory');assert.equal(t.cardTheme,'indigo');assert.equal(tools[0].cardTheme,'teal');assert.ok(fs.readFileSync('index.html','utf8').includes('js/client-tools/tineco-toc/inventory.js'));});
test('auto-load, table, server pagination, detail escaping, and clear reload',async()=>{const h=setup();assert.match(h.node('#tci-message').textContent,/Loading/);await flush();assert.equal(JSON.stringify(h.calls[0].body),JSON.stringify({page:1}));assert.match(h.node('#tci-results').innerHTML,/Showing 1–50 of 123/);assert.match(h.node('#tci-results').innerHTML,/EXPORT FILTERED RESULTS/);assert.match(h.node('#tci-results').innerHTML,/&lt;SN-0&gt;/);h.t.detail(0);assert.match(h.node('#tci-detail').innerHTML,/1 — Pre-QC/);assert.match(h.node('#tci-detail').innerHTML,/&lt;SN-0&gt;/);h.t.detail(1);assert.match(h.node('#tci-detail').innerHTML,/2 — Repair/);h.t.detail(2);assert.match(h.node('#tci-detail').innerHTML,/3 — Final QC/);await h.t.search({sn:'abc'},3);assert.match(h.node('#tci-results').innerHTML,/Showing 101–123 of 123/);h.node('[name="sn"]').value='abc';h.node('#tci-clear').onclick();await flush();assert.equal(h.node('[name="sn"]').value,'');assert.equal(h.calls.at(-1).body.page,1);assert.equal(h.calls.at(-1).body.sn,undefined);h.module.cleanup();});
test('filtered export retrieves every matching page and expected columns with dated filename',async()=>{const h=setup();await flush();await h.t.search({clientStatus:'Pending'});await h.t.exportFiltered();assert.equal(h.calls.at(-1).body.export,true);assert.equal(h.calls.at(-1).body.clientStatus,'Pending');const sheet=h.workbook.Sheets['TINECO Inventory'],exported=XLSX.utils.sheet_to_json(sheet);assert.equal(exported.length,123);const expected=columns.flatMap(k=>k==='TRACKING NUMBER'?[k,'LOCATION']:k==='LATEST RE-ENTRY AT'?['LATEST RE-ENTRY']:[k]);assert.deepEqual(Object.keys(exported[0]),[...expected,'LABOR MINUTES PER STEP','PRE-QC LABOR MINUTES','REPAIR LABOR MINUTES','FINAL QC LABOR MINUTES']);assert.equal(exported[0].LOCATION,'LOC-<SN-0>');assert.match(h.filename,/^TINECO_TOC_BATCH_INVENTORY_\d{4}-\d{2}-\d{2}\.xlsx$/);assert.equal(sheet.B2.t,'s');assert.equal(sheet.B2.f,undefined);h.module.cleanup();});

test('location lookup deduplicates SNs, collapses exact locations and preserves distinct bins',async()=>{const h=setup();await flush();const cache=new Map(),before=h.lookups.length;await h.t.resolveLocations([{SN:'DUP'},{SN:'DUP'},{SN:'OTHER'}],cache);assert.equal(h.lookups.length-before,2);const normalized=h.t.normalizeLocations('DUP',{ok:true,data:{sku:'DUP',locations:[{warehouseCode:'MKS66',locationCode:'A-01',availableQuantity:2},{warehouseCode:'MKS66',locationCode:'A-01',availableQuantity:3},{warehouseCode:'MKS66',locationCode:'B-02',availableQuantity:1},{warehouseCode:'OTHER',locationCode:'X',availableQuantity:9}]}});assert.equal(normalized.locations.length,2);assert.equal(normalized.locations[0].availableQuantity,5);cache.set('DUP',normalized);assert.equal(h.t.locationText('DUP',cache),'A-01\nB-02');h.module.cleanup();});

test('location lookup renders found, not-found and failure states',async()=>{const h=setup();await flush();const cache=new Map();h.window.MkiteApiClient.post=async(path,body)=>{if(body.sku==='ERR')throw Error('offline');return {ok:true,data:{sku:body.sku,locations:body.sku==='NONE'?[]:[{warehouseCode:'MKS66',locationCode:'RACK-7',availableQuantity:1}]}};};await h.t.resolveLocations([{SN:'ONE'},{SN:'NONE'},{SN:'ERR'}],cache);assert.equal(h.t.locationText('ONE',cache),'RACK-7');assert.equal(h.t.locationText('NONE',cache),'Not Found');assert.equal(h.t.locationText('ERR',cache),'Lookup Failed');h.module.cleanup();});

test('stale location response cannot commit after its result page is superseded',async()=>{const h=setup();await flush();let release;const waiting=new Promise(resolve=>{release=resolve;});h.window.MkiteApiClient.post=async()=>waiting;const cache=new Map();let active=true;const pending=h.t.resolveLocations([{SN:'OLD-PAGE'}],cache,{active:()=>active});active=false;release({ok:true,data:{sku:'OLD-PAGE',locations:[{warehouseCode:'MKS66',locationCode:'STALE',availableQuantity:1}]}});await pending;assert.equal(h.t.locationText('OLD-PAGE',cache),'Loading…');h.module.cleanup();});
test('export limit and incomplete responses show errors without producing partial workbooks',async()=>{for(const incomplete of [true,false]){const h=setup();await flush();h.window.MkiteApiClient.post=async()=>incomplete?{ok:true,data:{columns,results:rows.slice(0,50),pagination:{totalMatched:123}}}:{ok:false,error:{message:'Export is limited to 5000 filtered records.'}};await h.t.exportFiltered();assert.equal(h.workbook,undefined);assert.match(h.node('#tci-message').textContent,incomplete?/Incomplete/:/limited to 5000/);h.module.cleanup();}});
test('empty and failed searches provide clear operational messages',async()=>{const h=setup();await flush();const html=h.t.resultHtml({results:[],exportLimit:5000,summary:{found:0,pending:0,completed:0,disposal:0,totalLaborMinutes:0},pagination:{page:1,totalPages:1,totalMatched:0}});assert.match(html,/NO TINECO TOC UNITS FOUND/);h.window.MkiteApiClient.post=async()=>{throw Error('offline');};await h.t.search({});assert.match(h.node('#tci-message').textContent,/Unable to load TINECO TOC inventory/);h.module.cleanup();});

for(const [page,totalPages] of [[1,3],[3,3],[1,1]])test(`compact toolbar page ${page}/${totalPages} preserves disabled states and labels`,()=>{
 const h=setup(),html=h.t.resultHtml({results:rows.slice(0,8),exportLimit:5000,summary:{found:8,pending:8,completed:0,disposal:0,totalLaborMinutes:80},pagination:{page,totalPages,totalMatched:8,hasPrevious:page>1,hasNext:page<totalPages}});
 assert.match(html,/class="tci-result-toolbar"/);assert.match(html,/class="button tci-utility tci-export"/);assert.match(html,/aria-describedby="tci-export-help"/);
 assert.match(html,/All matching pages · maximum 5000 records/);assert.ok(html.includes(`Page ${page} of ${totalPages}`));
 assert.match(html,/← PREVIOUS/);assert.match(html,/NEXT →/);
 for(const [id,disabled] of [['previous',page===1],['next',page===totalPages]])assert.equal(/\bdisabled\b/.test(html.match(new RegExp(`<button[^>]*id="tci-${id}"[^>]*>`))[0]),disabled);
 h.module.cleanup();
});
test('toolbar click pagination and export retain active filters and all-result export',async()=>{
 const h=setup();await flush();await h.t.search({sn:'ABC'});
 const click=id=>h.node('#tci-results').onclick({target:{closest:s=>s===`#tci-${id}`?{}:null}});
 await click('next');assert.equal(h.calls.at(-1).body.page,2);assert.equal(h.calls.at(-1).body.sn,'ABC');
 await click('previous');assert.equal(h.calls.at(-1).body.page,1);
 const count=h.calls.length;await click('previous');assert.equal(h.calls.length,count);
 await click('export');assert.equal(h.calls.at(-1).body.export,true);assert.equal(h.calls.at(-1).body.sn,'ABC');assert.equal(XLSX.utils.sheet_to_json(h.workbook.Sheets['TINECO Inventory']).length,123);h.module.cleanup();
});
test('toolbar utility sizing and responsive wrapping are scoped to results',()=>{
 const css=fs.readFileSync('css/client-tools/tineco-inventory.css','utf8');assert.match(css,/\.tci-app \.tci-result-toolbar \.tci-utility \{ min-height:38px/);assert.match(css,/\.tci-pagination \{[^}]*flex-wrap:wrap/);assert.match(css,/@media\(max-width:600px\)\s*\{\s*\.tci-result-toolbar \{ grid-template-columns:minmax\(0,1fr\)/);
});

for(const [raw,expected] of [[' {"version":1,"preQc":6,"repair":18,"finalQc":4} ',[6,18,4]],['{"version":1,"preQc":0,"repair":0,"finalQc":0}',[0,0,0]],['',['','','']],[null,['','','']],['<broken JSON>',['','','']],['{"version":2,"preQc":6,"repair":18,"finalQc":4}',['','','']],['{"version":1,"preQc":-1,"repair":18,"finalQc":4}',['','','']],['{"version":1,"preQc":"6","repair":18,"finalQc":4}',['','','']]])test(`per-step raw and numeric export: ${raw}`,async()=>{
 const h=setup();await flush();const original=h.window.MkiteApiClient.post;
 h.window.MkiteApiClient.post=async(path,body)=>{const response=await original(path,body);response.data.results=response.data.results.map(r=>({...r,laborMinutesPerStep:raw,'LABOR MINUTES':'37'}));return response;};
 await h.t.exportFiltered();const sheet=h.workbook.Sheets['TINECO Inventory'],exported=XLSX.utils.sheet_to_json(sheet,{defval:''});
 assert.equal(exported.length,123);assert.equal(exported[0]['LABOR MINUTES'],'37');assert.equal(exported[0]['LABOR MINUTES PER STEP'],raw??'');
 assert.deepEqual(['PRE-QC LABOR MINUTES','REPAIR LABOR MINUTES','FINAL QC LABOR MINUTES'].map(k=>exported[0][k]),expected);
 assert.equal(exported[0].SN,rows[0].SN);h.module.cleanup();
});

for(const [raw,expected] of [
 ['{"version":1,"preQc":12,"repair":63,"finalQc":10}','Pre-QC: 12 min<br>Repair: 63 min<br>Final QC: 10 min'],
 ['{"version":1,"preQc":0,"repair":6,"finalQc":14}','Pre-QC: 0 min<br>Repair: 6 min<br>Final QC: 14 min'],
 ['', '—'],[undefined,'—'],['  ','—'],
 ['<script>alert(1)</script>','Unavailable'],
 ['{"version":2,"preQc":12,"repair":63,"finalQc":10}','Unavailable'],
 ['{"version":1,"preQc":-1,"repair":63,"finalQc":10}','Unavailable'],
 ['{"version":1,"preQc":1.5,"repair":63,"finalQc":10}','Unavailable'],
 ['{"version":1,"preQc":"12","repair":63,"finalQc":10}','Unavailable']
])test(`detail displays stored step labor safely: ${raw}`,async()=>{
 const h=setup();await flush();const original=h.window.MkiteApiClient.post;
 h.window.MkiteApiClient.post=async(path,body)=>{const response=await original(path,body);response.data.columns=[...columns,'LABOR MINUTES PER STEP','GENERAL NOTE'];response.data.results=response.data.results.map(r=>({...r,laborMinutesPerStep:raw,'LABOR MINUTES PER STEP':'raw column must not display','LABOR MINUTES':'100','GENERAL NOTE':'Saved <note>'}));return response;};
 await h.t.search();const reads=h.calls.length;h.t.detail(0);const html=h.node('#tci-detail').innerHTML;
 assert.ok(html.includes('<dt>LABOR MINUTES</dt><dd>100 min</dd>'));
 assert.ok(html.indexOf('<dt>LABOR MINUTES PER STEP</dt>')>html.indexOf('<dt>LABOR MINUTES</dt>'));
 if(expected.includes(' min'))for(const pair of expected.split('<br>')){const [label,value]=pair.split(': ');assert.ok(html.includes(`<dt>${label.toUpperCase()}</dt><dd>${value}</dd>`));}
 else assert.ok(html.includes(`<dt>LABOR MINUTES PER STEP</dt><dd>${expected}</dd>`));
 assert.equal((html.match(/<dt>LABOR MINUTES PER STEP<\/dt>/g)||[]).length,1);
 for(const field of [...columns,'GENERAL NOTE'])assert.ok(html.includes(`<dt>${field}</dt>`),field);
 assert.match(html,/Saved &lt;note&gt;/);assert.match(html,/&lt;SN-0&gt;/);assert.doesNotMatch(html,/<script>|raw column must not display|"version"/);
 assert.equal(h.calls.length,reads);assert.equal(h.node('#tci-detail').open,true);h.module.cleanup();
});

test('detail groups existing fields, escapes multiline text and keeps Close operational',async()=>{
 const h=setup();await flush();const original=h.window.MkiteApiClient.post;
 h.window.MkiteApiClient.post=async(path,body)=>{const response=await original(path,body);response.data.columns=[...columns,'GENERAL NOTE'];response.data.results=response.data.results.map(r=>({...r,'CLIENT STATUS':'Completed','FINAL QC RESULT':'Pass','GENERAL NOTE':'First line\n<script>bad()</script>\n'+'X'.repeat(600),'PART USED DETAIL':'Motor\nFilter'}));return response;};
 await h.t.search();const before=h.calls.length;h.t.detail(0);const html=h.node('#tci-detail').innerHTML;
 for(const [id,title,fields] of [
  ['identity','UNIT IDENTITY',['UNIT ID','SN','TRACKING NUMBER','CLIENT ID','WAREHOUSE','REPAIR DATE']],
  ['workflow','WORKFLOW STATUS',['CLIENT STATUS','CURRENT STEP','TIMES OF RE-ENTER']],
  ['notes','ISSUE / NOTES',['ISSUE FOUND','PRE-QC NOTE','GENERAL NOTE']],
  ['labor','PARTS &amp; LABOR',['PART USED DETAIL','TOTAL PARTS USED','LABOR MINUTES','LABOR MINUTES PER STEP']],
  ['qc','REPAIR / QC RESULT',['REPAIR LEVEL','REPAIR RESULT','FINAL QC RESULT','FINAL QC NOTE']]
 ]){
  const section=html.match(new RegExp(`<section[^>]*aria-labelledby="tci-section-${id}"[\\s\\S]*?</section>`))[0];
  assert.ok(section.includes(title));for(const field of fields)assert.ok(section.includes(`<dt>${field}</dt>`),field);
 }
 assert.match(html,/First line\n&lt;script&gt;bad\(\)&lt;\/script&gt;\nX{600}/);assert.match(html,/Motor\nFilter/);assert.doesNotMatch(html,/<script>/);
 assert.match(html,/tci-detail-badge is-completed">Completed/);assert.match(html,/tci-detail-badge is-completed">Pass/);
 assert.match(html,/<header class="tci-detail-header">.*READ-ONLY UNIT DETAIL.*id="tci-close".*CLOSE/);
 assert.equal(h.calls.length,before);h.node('#tci-close').onclick();assert.equal(h.node('#tci-detail').open,false);h.module.cleanup();
});
test('complete history renders newest-first repairs, immutable parts, returns and authoritative re-entry summary',()=>{const h=setup(),row={...rows[0],'TIMES OF RE-ENTER':'8','LATEST RE-ENTRY AT':'2026-10-09 10:20','CURRENT STEP':'3','CLIENT STATUS':'Pending','REPAIR DATE':'2026-10-09','LABOR MINUTES':'22','PART USED DETAIL':'CURRENT-A\nCURRENT-A','CLIENT RETURN COUNT':'2',clientReturnCount:2,generalNote:'Plain note\nNo invented timestamp',repairHistoryValid:true,clientReturnHistoryValid:true,repairHistory:{schemaVersion:1,repairs:[{repairId:'REP-001',visitNumber:1,entryNumber:2,completedAt:'2026-09-08T14:00:00.000Z',repairLevel:'Level 2',repairResult:'Completed',issueFound:'Issue one',preQcNote:'Note one',partsUsed:[{partSku:'OLD-A',quantity:1}],labor:{preQcMinutes:2,repairMinutes:3,finalQcMinutes:1,totalMinutes:6},finalQc:{result:'Pass',note:'Passed'},generalNotes:['Archived note'],followedByReturnId:'RET-001'},{repairId:'REP-002',visitNumber:2,entryNumber:5,completedAt:'2026-10-08T14:00:00.000Z',repairLevel:'Level 1',repairResult:'Completed',partsUsed:[{partSku:'BATTERY',quantity:2}],labor:{preQcMinutes:3,repairMinutes:7,finalQcMinutes:2,totalMinutes:12},finalQc:{result:'Pass',note:'Good'},followedByReturnId:'RET-002'}]},clientReturnHistory:{schemaVersion:1,returns:[{returnId:'RET-001',repairId:'REP-001',returnedAt:'2026-09-09T14:00:00.000Z',confirmedBy:'ALGER'},{returnId:'RET-002',repairId:'REP-002',returnedAt:'2026-10-09T14:00:00.000Z',previousCompletedAt:'2026-10-08T14:00:00.000Z',previousRepairResult:'Completed',previousLaborMinutes:18,confirmedBy:'JUSTIN'}]}},html=h.t.completeHistoryHtml(row),summary=h.t.historySummary(row);assert.deepEqual(structuredClone(summary),{repairs:2,returns:2,returnsStored:2,labor:22,parts:5});assert.ok(html.indexOf('REP-002')<html.indexOf('REP-001'));assert.ok(html.indexOf('RET-002')<html.indexOf('RET-001'));assert.match(html,/PARTS USED — HISTORICAL \/ READ ONLY/);assert.match(html,/BATTERY/);assert.match(html,/VISIT TOTAL/);assert.match(html,/CONFIRMED BY/);assert.match(html,/TOTAL RE-ENTRIES<\/dt><dd>8/);assert.match(html,/3 — Final QC/);assert.match(html,/Plain note\nNo invented timestamp/);assert.doesNotMatch(html,/remove|edit|decrement|data-remove|scan part|add part/i);h.module.cleanup();});
test('current completed visit stays in current state and contributes to lifetime parts without fabricating a REP entry',()=>{const h=setup(),row={...rows[0],'CLIENT STATUS':'Completed','REPAIR RESULT':'Completed','TIMES OF RE-ENTER':'4','REPAIR DATE':'2026-10-09','LABOR MINUTES':'20','PART USED DETAIL':'CURRENT-X\nCURRENT-X',clientReturnCount:1,repairHistory:{schemaVersion:1,repairs:[{repairId:'REP-001',entryNumber:2,completedAt:'2026-09-08T14:00:00.000Z',partsUsed:[{partSku:'OLD',quantity:3}],labor:{totalMinutes:8}}]},clientReturnHistory:{schemaVersion:1,returns:[]}},html=h.t.completeHistoryHtml(row);assert.equal(h.t.historySummary(row).parts,5);assert.equal((html.match(/class="tci-history-record"/g)||[]).length,1);assert.doesNotMatch(html,/REP-002/);h.module.cleanup();});
test('blank and malformed histories remain controlled empty read-only detail states',()=>{const h=setup();for(const row of [{...rows[0],repairHistory:{schemaVersion:1,repairs:[]},clientReturnHistory:{schemaVersion:1,returns:[]},repairHistoryValid:true,clientReturnHistoryValid:true},{...rows[0],repairHistory:{schemaVersion:1,repairs:[]},clientReturnHistory:{schemaVersion:1,returns:[]},repairHistoryValid:false,clientReturnHistoryValid:false}]){const html=h.t.completeHistoryHtml(row);assert.match(html,/No previous repair history/);assert.match(html,/No client returns recorded/);if(row.repairHistoryValid===false)assert.match(html,/legacy history data could not be displayed/);}h.module.cleanup();});
test('detail layout is scoped, wide and scrollable with responsive columns and safe wrapping',()=>{
 const css=fs.readFileSync('css/client-tools/tineco-inventory.css','utf8');
 assert.match(css,/#tci-detail \{[^}]*width:min\(1040px,[^}]*max-height:88dvh[^}]*margin:auto[^}]*overflow:auto/);
 assert.match(css,/#tci-detail \.tci-detail-grid \{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:1000px\) \{ #tci-detail \.tci-detail-grid \{ grid-template-columns:minmax\(0,1fr\)/);
 assert.match(css,/#tci-detail dd \{[^}]*white-space:pre-wrap[^}]*overflow-wrap:anywhere/);
 assert.match(css,/#tci-detail \.tci-step-labor>div \{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
 assert.match(css,/#tci-detail \.tci-complete-history\{[^}]*margin-top:22px/);assert.match(css,/#tci-detail \.tci-history-summary\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);assert.match(css,/@media\(max-width:820px\).*\.tci-history-summary\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);assert.match(css,/@media\(max-width:600px\).*\.tci-history-tabs button\{flex:1 1 135px\}/s);
});

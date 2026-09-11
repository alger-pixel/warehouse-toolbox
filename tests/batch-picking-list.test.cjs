const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const XLSX=require('../vendor/xlsx.full.min.js');
function fixture() {
 const nodes=new Map(),calls=[],clipboard=[];let written,copyError=false;
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',disabled:false,value:'',showModal(){this.open=true;},close(){this.open=false;},reset(){this.wasReset=true;}});return nodes.get(selector);};
 const root={querySelector:node,querySelectorAll:()=>[],addEventListener(type,fn){this[type]=fn;},removeEventListener(){}};
 const data={options:{warehouse:['MKS66'],clientId:['B044'],status:['Completed']},summary:{found:1,packages:2,processed:2,partsQuantity:2},exportLimit:1000,pagination:{page:1,pageSize:50,totalMatched:1,totalPages:1,hasPrevious:false,hasNext:false},results:[{recordId:'pl-1',pickingListNumber:'PL-1',total:2,processed:2,remaining:0,commandCount:1,hasParts:true,status:'Completed',packages:[{packageRecordId:'rec-1',trackingNumber:'A',finalSku:'B044-A',commandRaw:'<script>说明书</script>',actualParts:[{sku:'PART/A',quantity:2}]}],partSummary:[{sku:'PART/A',quantity:2}],warnings:[],completionNote:'Confirmed only'}]};
 const window={navigator:{clipboard:{writeText:async value=>{if(copyError)throw Error('denied');clipboard.push(value);}}},XLSX:{...XLSX,writeFile:(book,name)=>{written={book,name};}},MkiteApiClient:{post:async(path,body)=>{calls.push({path,body});return {ok:true,data:path.endsWith('/detail')?data.results[0]:data};}}};
 vm.runInNewContext(fs.readFileSync('js/in-house-tools/batch-picking-list.js','utf8'),{window,Intl,Date});
 const tool=window.MkiteInHouseTools.batchPickingList;return {window,tool,root,node,calls,data,clipboard,failCopy:()=>{copyError=true;},written:()=>written};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('registry, existing slug route, page markup and local assets are wired',()=>{
 const window={};vm.runInNewContext(fs.readFileSync('js/in-house-tools-registry.js','utf8'),{window});const tool=window.MkiteInHouseToolRegistry.get('batch-picking-list');assert.equal(tool.toolId,'batch-picking-list');assert.equal(tool.module,'batchPickingList');assert.equal(tool.sortOrder,4);assert.equal(tool.cardTheme,'batch-picking-list');assert.equal(tool.theme,'batch-inventory');
 const index=fs.readFileSync('index.html','utf8');assert.match(index,/js\/in-house-tools\/batch-picking-list.js/);assert.match(index,/css\/in-house-tools\/batch-picking-list.css/);
 const h=fixture();assert.match(h.tool.render(),/Picking List filters/);assert.match(h.tool.render(),/name="partSku"/);
 const routerWindow={location:{hash:'#in-house-tool/batch-picking-list'},addEventListener(){}};vm.runInNewContext(fs.readFileSync('js/router.js','utf8'),{window:routerWindow});assert.match(fs.readFileSync('js/router.js','utf8'),/in-house-tool/);
});
test('Batch Picking List card has a distinct accessible navy theme without changing its workspace theme',()=>{
 const registry=fs.readFileSync('js/in-house-tools-registry.js','utf8'),app=fs.readFileSync('js/app.js','utf8'),css=fs.readFileSync('css/in-house-tools/in-house-tools.css','utf8');
 assert.match(registry,/cardTheme: "batch-picking-list"/);assert.match(app,/tool\.cardTheme \|\| tool\.theme/);assert.match(css,/\[data-in-house-theme="batch-picking-list"\][^{]*\{[^}]*--current-in-house-color:#244a63[^}]*--current-in-house-text:#f8fbff/);assert.match(css,/background:#5f86a3/);assert.match(css,/rgba\(255,255,255,\.82\)/);
});
test('filters serialize together, load on init, detail renders safe command text and primary parts aggregate',async()=>{
 const h=fixture();h.tool.init({root:h.root});await settle();assert.equal(h.calls[0].body.page,1);assert.match(h.node('#bpl-results').innerHTML,/PL-1/);
 const form={elements:Object.fromEntries(['pickingListNumber','createdFrom','createdTo','warehouse','clientId','trackingNumber','partSku','hasCommand','status'].map(k=>[k,{value:k==='warehouse'?' MKS66 ':''}]))};
 assert.equal(h.tool._test.serialize(form).warehouse,'MKS66');await h.tool._test.search(h.tool._test.serialize(form));assert.equal(h.calls.at(-1).body.warehouse,'MKS66');
 await h.tool._test.detail('pl-1');const html=h.node('#bpl-detail').innerHTML;assert.equal(h.node('#bpl-detail').open,true);assert.match(html,/Parts Used Summary/);assert.match(html,/PART\/A/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);assert.ok(html.indexOf('Parts Used Summary')<html.indexOf('Package summary and usage traceability'));
});
test('export requests all filtered results and creates summary and traceability sheets',async()=>{
 const h=fixture();h.tool.init({root:h.root});await settle();await h.tool._test.search({clientId:'B044'});await h.tool._test.exportFiltered();assert.equal(h.calls.at(-1).body.export,true);assert.equal(h.calls.at(-1).body.clientId,'B044');
 const {book,name}=h.written();assert.deepEqual(book.SheetNames,['PICKING LISTS','PART USED SUMMARY','PACKAGE DETAIL']);assert.equal(XLSX.utils.sheet_to_json(book.Sheets['PART USED SUMMARY'])[0]['Total Qty Used'],2);assert.match(name,/^BATCH_PICKING_LIST_\d{4}-\d{2}-\d{2}\.xlsx$/);
 assert.throws(()=>h.tool._test.workbook({...h.data,pagination:{totalMatched:99}}),/Incomplete/);
});
test('pagination, clear, empty and error states',async()=>{
 const h=fixture();h.tool.init({root:h.root});await settle();let html=h.node('#bpl-results').innerHTML;assert.match(html,/id="bpl-previous" disabled/);assert.match(html,/id="bpl-next" disabled/);assert.match(html,/Page 1 of 1/);
 h.data.pagination={page:1,pageSize:50,totalMatched:51,totalPages:2,hasNext:true,hasPrevious:false};
 h.root.click({target:{closest:()=>({id:'bpl-next',dataset:{}})}});await settle();assert.equal(h.calls.at(-1).body.page,2);
 h.root.click({target:{closest:()=>({id:'bpl-clear',dataset:{}})}});await settle();assert.equal(h.calls.at(-1).body.page,1);assert.equal(h.node('#bpl-form').wasReset,true);
 h.data.results=[];h.data.pagination.totalMatched=0;await h.tool._test.search();assert.match(h.node('#bpl-results').innerHTML,/NO PICKING LISTS FOUND/);
 h.window.MkiteApiClient.post=async()=>({ok:false,error:{message:'Offline'}});await h.tool._test.search();assert.match(h.node('#bpl-message').textContent,/Unable to load Picking Lists/);assert.equal(h.node('#bpl-results').innerHTML,'');
});
test('single and all copy use only the displayed confirmed aggregate and report success',async()=>{
 const h=fixture();h.data.results[0].partSummary=[{sku:'PARTUSED',quantity:1},{sku:'M8LS-14-BS',quantity:2}];h.data.results[0].possibleParts=[{sku:'ESTIMATE-ONLY',quantity:9}];
 h.tool.init({root:h.root});await settle();await h.tool._test.detail('pl-1');
 const html=h.node('#bpl-detail').innerHTML;assert.match(html,/COPY ALL PARTS/);assert.match(html,/data-bpl-copy-part="0"/);assert.match(html,/data-bpl-copy-part="1"/);assert.doesNotMatch(html,/ESTIMATE-ONLY/);
 await h.tool._test.copyParts(0);assert.equal(h.clipboard[0],'PARTUSED ×1');assert.equal(h.node('#bpl-copy-feedback').textContent,'Copied');
 await h.tool._test.copyParts(1);assert.equal(h.clipboard[1],'M8LS-14-BS ×2');
 await h.tool._test.copyParts('all');assert.equal(h.clipboard[2],'PARTUSED ×1\nM8LS-14-BS ×2');
 assert.deepEqual(h.data.results[0].partSummary,[{sku:'PARTUSED',quantity:1},{sku:'M8LS-14-BS',quantity:2}]);
});
test('empty state has no copy actions, and copy failure preserves detail data',async()=>{
 const h=fixture();h.data.results[0].partSummary=[];let html=h.tool._test.detailHtml(h.data.results[0]);assert.match(html,/No confirmed actual parts used/);assert.doesNotMatch(html,/COPY ALL PARTS|data-bpl-copy-part/);
 h.data.results[0].partSummary=[{sku:'PARTUSED',quantity:1}];h.tool.init({root:h.root});await settle();await h.tool._test.detail('pl-1');const before=structuredClone(h.data.results[0]);h.failCopy();
 assert.equal(await h.tool._test.copyParts(0),false);assert.equal(h.clipboard.length,0);assert.match(h.node('#bpl-copy-feedback').textContent,/Unable to copy/);assert.deepEqual(h.data.results[0],before);
});
test('parts copy controls retain the responsive table wrapper without page overflow styles',()=>{
 const h=fixture(),html=h.tool._test.detailHtml(h.data.results[0]),css=fs.readFileSync('css/in-house-tools/batch-picking-list.css','utf8');
 assert.match(html,/inventory-table bpl-parts-table/);assert.match(css,/\.bpl-app[^}]*min-width:0/);assert.match(css,/\.bpl-parts-table td:first-child[^}]*overflow-wrap:anywhere/);assert.ok(css.includes('@media(max-width:540px)'));assert.match(css,/\.bpl-parts-heading \{ align-items:flex-start; flex-direction:column; \}/);
});

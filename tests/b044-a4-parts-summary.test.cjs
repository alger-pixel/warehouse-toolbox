const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){const window={};vm.runInNewContext(fs.readFileSync('js/shared/picking-parts.js','utf8'),{window});vm.runInNewContext(fs.readFileSync('vendor/JsBarcode.code128.min.js','utf8'),{window});vm.runInNewContext(fs.readFileSync('js/client-tools/b044/picking-workflow.js','utf8'),{window,document:{}});return window.MkiteB044Picking.a4Markup;}
const pl=packages=>({operational:true,pickingListNumber:'TEST-PL',packages,exceptions:[]});
const summary=html=>html.match(/<section class="possible-parts-summary">([\s\S]*?)<\/section>/)?.[1];
test('normal and blank-command PLs retain no summary',()=>{const render=fixture();assert.equal(summary(render(pl([{trackingNumber:'A'},{commandRaw:'  '}]))),undefined);});
test('command summary reuses raw deterministic estimates only, preserves literal identities and existing rows',()=>{
 const render=fixture(),raw='CARTON-405-250-295 M8LS*14 M8LS-14-BS 说明书 FD-B044-260908-0001';
 const data=pl([{sequence:1,trackingNumber:'A',commandRaw:raw,commandDisplay:'KEEP COMPLETE COMMAND TEXT',actualParts:[{sku:'ACTUAL-ONLY',quantity:99}]},{sequence:2,trackingNumber:'B',commandRaw:'CARTON-405-250-295 M8LS*14'}]);data.exceptions=[{commandRaw:'CARTON-999-999-999'}];data['PART USED']='unchanged';const before=structuredClone(data);
 const html=render(data),section=summary(html);assert.match(section,/POSSIBLE PARTS NEEDED SUMMARY/);assert.match(section,/<td>CARTON-405-250-295<\/td><td>2<\/td>/);assert.match(section,/<td>M8LS\*14<\/td><td>2<\/td>/);assert.match(section,/<td>M8LS-14-BS<\/td><td>1<\/td>/);assert.doesNotMatch(section,/FD-B044|ACTUAL-ONLY|CARTON-999/);assert.match(section,/Preparation estimate only\. Confirm actual parts during Part Used Scan\./);
 assert.match(html,/class="commanded"/);assert.match(html,/KEEP COMPLETE COMMAND TEXT/);assert.ok(html.indexOf('possible-parts-summary">')<html.indexOf('<th>CURRENT LOCATION'));assert.deepEqual(data,before);
});
test('command with no supported estimates still shows an explicit empty summary and preserves text',()=>{const html=fixture()(pl([{commandRaw:'请检查外箱'}]));assert.match(summary(html),/No recognizable parts/);assert.match(html,/请检查外箱/);});
test('large summary keeps every part in normal paginated flow with repeated headers and intact appendix/footer',()=>{
 const raw=Array.from({length:120},(_,i)=>`CARTON-${i+100}-250-295`).join('\n');const html=fixture()(pl([{sequence:1,commandRaw:raw}]));const section=summary(html);
 assert.equal((section.match(/<tr>/g)||[]).length,121);assert.match(html,/@page\{size:A4 portrait/);assert.match(html,/thead\{display:table-header-group\}/);assert.match(html,/tr\{break-inside:avoid\}/);assert.match(html,/possible-parts-summary\{[^}]*break-inside:auto/);assert.ok(html.includes(raw));assert.match(html,/PICKED BY/);assert.match(html,/FINISH TIME/);
 assert.doesNotMatch(section,/position:|height:|overflow:/);
});

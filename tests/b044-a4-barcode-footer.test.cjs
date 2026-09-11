const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){const window={};for(const path of ['vendor/JsBarcode.code128.min.js','js/shared/picking-parts.js','js/client-tools/b044/picking-workflow.js'])vm.runInNewContext(fs.readFileSync(path,'utf8'),{window,document:{}});return window;}
const model={pickingListNumber:'B044-PL-20260910-0002',operational:true,packages:[{sequence:1,trackingNumber:'TRACK-DIFFERENT',finalSku:'FINAL-DIFFERENT',commandRaw:'M8LS*14 补说明书'}],exceptions:[]};
test('A4 Code 128 encodes PL number exactly, with physical quiet zones and visible human text',()=>{
 const w=setup(),actual=w.JsBarcode;let input,encoded;w.JsBarcode=(target,value,options)=>{input=value;actual(target,value,options);encoded=target.encodings.map(e=>e.data).join('');};
 const html=w.MkiteB044Picking.a4Markup(model);assert.equal(input,model.pickingListNumber);assert.notEqual(input,model.packages[0].trackingNumber);assert.notEqual(input,model.packages[0].finalSku);
 const svg=html.match(/<svg[\s\S]*?<\/svg>/)[0],width=encoded.length+20;assert.match(svg,/height="12.7mm"/);assert.ok(svg.includes(`width="${(width*.254).toFixed(3)}mm"`));assert.match(svg,/fill="white"/);
 const bits=Array(width).fill('0');for(const match of svg.matchAll(/<rect x="(\d+)" y="0" width="(\d+)" height="50"\/>/g))bits.fill('1',Number(match[1]),Number(match[1])+Number(match[2]));assert.equal(bits.join(''),'0'.repeat(10)+encoded+'0'.repeat(10));
 assert.match(html,/<figcaption>B044-PL-20260910-0002<\/figcaption>/);assert.match(html,/<dt>PL NUMBER<\/dt><dd>B044-PL-20260910-0002/);assert.ok(html.indexOf('class="pl-barcode"')<html.indexOf('<h1>MKITE INTERNATIONAL'));
});
test('footer retains four handwriting fields in one compact row, without forced page break',()=>{
 const html=setup().MkiteB044Picking.a4Markup(model),footer=html.match(/<footer>[\s\S]*?<\/footer>/)[0];for(const label of ['PICKED BY','START TIME','FINISH TIME','SIGNATURE'])assert.ok(footer.includes(label));assert.equal((footer.match(/class="write-line"/g)||[]).length,4);
 assert.match(html,/footer\{margin-top:3mm;display:grid;grid-template-columns:1\.3fr 1fr 1fr 1\.5fr;gap:3mm;break-inside:avoid;break-before:auto;font-size:8pt/);assert.match(html,/height:6mm;border-bottom/);assert.doesNotMatch(footer,/position:fixed|page-break/);
 assert.match(html,/POSSIBLE PARTS NEEDED SUMMARY/);assert.match(html,/COMMANDED/);assert.match(html,/M8LS\*14 补说明书/);assert.match(html,/@page\{size:A4 portrait;margin:12mm/);
});
test('local barcode bundle loads before A4 generator, with no runtime CDN',()=>{const html=fs.readFileSync('index.html','utf8');assert.ok(html.indexOf('vendor/JsBarcode.code128.min.js')<html.indexOf('js/client-tools/b044/picking-workflow.js'));assert.doesNotMatch(html,/https?:[^"']*JsBarcode/);});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const caseId='MKS66-20261007-CASE-002',worker='https://mkite-secure-api.mkite-api.workers.dev';
function setup(origin){const window={location:{origin,hostname:new URL(origin).hostname},MkiteRouter:{navigate(){}}};for(const file of ['js/services/api-config.js','js/services/api-client.js','js/operating-dashboard.js','js/cases/search-case.js','js/cases/report-case.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),{window,URL,FormData,document:{}});return window;}
function record(reportAsset={assetId:'case-report-historical-uuid',fileName:'evidence.png',mimeType:'image/png'}){return {caseId,status:'Completed',priority:'Normal',warehouseId:'MKS66',assignedUsers:[],reportData:{reports:[{reportId:'RPT-001',type:'Completion',statusAfter:'Completed',assets:[reportAsset]}]},attachments:[{assetId:'ref-1',name:'reference.jpg',mimeType:'image/jpeg'}],questionSnapshot:{questions:[]},issueOptionsSnapshot:{issues:[]}};}
for(const origin of ['http://127.0.0.1:5501','https://alger-pixel.github.io'])test(`both historical Case image sources and previews use shared API resolution from ${origin}`,()=>{
 const window=setup(origin),html=window.MkiteOperatingDashboard._test.caseDetail(record()),base=origin.includes('github.io')?worker:origin;
 const urls=[...html.matchAll(/<img src="([^"]+)"/g)].map(match=>match[1]);assert.deepEqual(urls,[`${base}/api/cases/${caseId}/assets/case-report-historical-uuid`,`${base}/api/cases/${caseId}/assets/ref-1`]);
 assert.deepEqual([...html.matchAll(/data-preview="([^"]+)"/g)].map(match=>match[1]),urls);assert.match(html,/LATEST REPORT/);assert.match(html,/REFERENCE ATTACHMENTS/);
 if(origin.includes('github.io')){assert.doesNotMatch(urls.join(' '),/127\.0\.0\.1|localhost|github\.io|^\/api\//);}
 const detail=window.MkiteSearchCase._test.detail(record(),true);assert.ok(detail.includes(`href="${base}/api/cases/${caseId}/assets/ref-1"`));
});
test('legacy Case proxy URLs are rebuilt for production and raw/private URLs are not used',()=>{
 const window=setup('https://alger-pixel.github.io');
 for(const url of [`/api/cases/${caseId}/assets/report-old`,`http://127.0.0.1:8787/api/cases/${caseId}/assets/report-old`,`https://old-worker.example/api/cases/${caseId}/assets/report-old`]){
  const html=window.MkiteOperatingDashboard._test.caseDetail(record({url,fileName:'old.png'}));assert.ok(html.includes(`src="${worker}/api/cases/${caseId}/assets/report-old"`));assert.doesNotMatch(html,/127\.0\.0\.1|old-worker/);
 }
 const html=window.MkiteOperatingDashboard._test.caseDetail(record({assetId:'report-current',url:'https://private.feishu.example/signed-token',fileName:'old.png'}));assert.ok(html.includes(`/assets/report-current`));assert.doesNotMatch(html,/private\.feishu|signed-token/);
 for(const url of ['https://private.feishu.example/signed-token','/api/cases/ANOTHER-CASE/assets/ref-1']){const rejected=window.MkiteOperatingDashboard._test.caseDetail(record({url,fileName:'old.png'}));assert.doesNotMatch(rejected,/private\.feishu|ANOTHER-CASE/);}
});
test('local direct Worker configuration and path encoding use the same shared URL helper',()=>{
 const window=setup('http://127.0.0.1:5501');window.MkiteApiConfig={...window.MkiteApiConfig,baseUrl:'http://127.0.0.1:8787/'};
 assert.equal(window.MkiteApiClient.url(`/api/cases/${encodeURIComponent(caseId)}/assets/${encodeURIComponent('opaque/asset ?')}`),`http://127.0.0.1:8787/api/cases/${caseId}/assets/opaque%2Fasset%20%3F`);
});
test('production URL guard also rejects loopback media configuration before rendering',()=>{
 const window=setup('https://alger-pixel.github.io');for(const baseUrl of ['http://127.0.0.1:8787','http://localhost:8787']){window.MkiteApiConfig={...window.MkiteApiConfig,baseUrl};assert.throws(()=>window.MkiteOperatingDashboard._test.caseDetail(record()),/Production API configuration is invalid/);}
});
test('all Case attachment views use resolved Worker links and retain genuine error fallback with development diagnostics',()=>{
 for(const path of ['js/cases/report-case.js','js/cases/search-case.js']){const source=fs.readFileSync(path,'utf8');assert.match(source,/MkiteApiClient\.url\(`\/api\/cases/);assert.doesNotMatch(source,/href="\/api\/cases/);}
 const source=fs.readFileSync('js/operating-dashboard.js','utf8');assert.match(source,/img\.onerror=\(\)=>\{const url=img\.currentSrc\|\|img\.src;diagnoseMedia\(type,id,url\)/);assert.match(source,/console\?\.warn\('Report image unavailable'/);for(const cause of ["'media-decoding'","'http'","'network'"])assert.match(source,new RegExp(cause));assert.match(source,/textContent:'Image unavailable'/);
});
for(const origin of ['http://127.0.0.1:5501','https://alger-pixel.github.io'])test(`Project daily, 5S and final evidence use stable Worker asset URLs from ${origin}`,()=>{
 const window=setup(origin),base=origin.includes('github.io')?worker:origin,project={projectId:'P1',projectName:'Portable evidence',projectStatus:'In-Progress',dailyReportData:{reports:[{status:'Submitted',reportDate:'2026-10-14',productionEvidence:[{assetId:'daily-one',fileName:'daily.jpg',mimeType:'image/jpeg',url:'/api/projects/P1/assets/daily-one'}],fiveS:{workstationClean:{status:'Pass',evidence:[{assetId:'five-one',fileName:'five.png',mimeType:'image/png',url:'http://127.0.0.1:8787/api/projects/P1/assets/five-one'}]}}}]},finalReportData:{status:'Submitted',evidence:{finishedGoods:[{assetId:'final-one',fileName:'final.webp',mimeType:'image/webp',url:'https://old-worker.example/api/projects/P1/assets/final-one'}]}}};
 const html=window.MkiteOperatingDashboard._test.projectDetail(project),urls=[...html.matchAll(/<img src="([^"]+)"/g)].map(x=>x[1]);assert.deepEqual(urls,[`${base}/api/projects/P1/assets/daily-one`,`${base}/api/projects/P1/assets/five-one`,`${base}/api/projects/P1/assets/final-one`]);assert.doesNotMatch(urls.join(' '),/old-worker|127\.0\.0\.1:8787.*github/);
});

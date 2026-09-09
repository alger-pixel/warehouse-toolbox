const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const window = { location: { hash: '' }, addEventListener() {} };
for (const file of ['js/client-tools-registry.js','js/router.js']) vm.runInNewContext(fs.readFileSync(file,'utf8'), { window });
const registry = window.MkiteClientToolRegistry;
test('B044 immutable identity and both routes resolve to same runtime context', () => {
  for (const hash of ['#client/B044/tool/put-away-scan','#client/MKS66/B044/tool/put-away-scan']) {
    window.location.hash = hash; const route = window.MkiteRouter.current(); const tool = registry.get(route.clientId, route.toolId, route.warehouse);
    assert.equal(tool.toolId, 'CT-MKS66-B044-0001'); assert.equal(registry.context(tool).warehouse, 'MKS66'); assert.equal(registry.context(tool).clientId, 'B044');
  }
  window.MkiteRouter.navigate({ view:'client-tool', warehouse:'MKS66', clientId:'B044', toolId:'put-away-scan' }); assert.equal(window.location.hash,'#client/MKS66/B044/tool/put-away-scan');
  assert.equal(registry.get('B044','put-away-scan','MKS159'),null);
});
test('directory derives all active assignments and AND filters across warehouses', () => {
  const original = registry.all()[0]; const r = window.MkiteCreateClientToolRegistry([original, {...original, warehouse:'MKS159',toolId:'CT-MKS159-B044-0001',name:'Other Tool'}, {...original,clientId:'C001',toolId:'CT-MKS66-C001-0001'}, {...original,toolId:'inactive',status:'inactive'}]);
  assert.equal(r.filter().length,3); assert.equal(r.filter({warehouse:'MKS66'}).length,2); assert.equal(r.filter({clientId:'B044'}).length,2);
  assert.equal(r.filter({warehouse:'MKS159',clientId:'B044',query:'other'}).length,1); assert.equal(r.filter({query:'CT-MKS66-B044'}).length,1); assert.equal(r.filter({warehouse:'MKS66',query:'other'}).length,0);
  assert.throws(()=>window.MkiteCreateClientToolRegistry([original,original]), /CONFIGURATION_ERROR/);
});
test('cards and runtime expose identity without directory sync writes', () => {
  const app=fs.readFileSync('js/app.js','utf8'); assert.match(app,/Tool ID: \$\{escapeHtml\(tool.toolId\)/); assert.match(app,/Warehouse: \$\{escapeHtml\(tool.warehouse\)/); assert.match(app,/Client ID: \$\{escapeHtml\(tool.clientId\)/); assert.match(app,/clientToolContext: window.MkiteClientToolRegistry.context\(tool\)/); assert.doesNotMatch(app,/sync-registry/);
});
test('directory card renders tool identity and action without registry description', () => {
  const app = fs.readFileSync('js/app.js', 'utf8');
  const source = app.slice(app.indexOf('  function clientToolCard('), app.indexOf('  function renderInvalidClient('));
  const render = vm.runInNewContext(`${source}\nclientToolCard`, { escapeHtml: value => String(value ?? ''), icons: { warehouse: '' } });
  const tool = registry.all()[0], html = render(tool);
  for (const value of ['B044 - Put Away Scan', 'Tool ID: CT-MKS66-B044-0001', 'Warehouse: MKS66', 'Client ID: B044', 'OPEN TOOL']) assert.ok(html.includes(value), value);
  assert.equal(tool.name, 'Put Away Scan');
  assert.ok(tool.description.length > 0);
  assert.ok(!html.includes(tool.description));
  assert.match(html, /data-warehouse="MKS66"/);
  assert.match(html, /data-client-tool-id="put-away-scan"/);
});
test('directory filter panel Search applies inputs and Clear restores all active tools', () => {
  const app = fs.readFileSync('js/app.js', 'utf8');
  const source = app.slice(app.indexOf('  function renderClientTools()'), app.indexOf('  function renderInvalidClient('));
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, { value: '', innerHTML: '', handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } }); return nodes.get(id); } };
  const mainContent = { innerHTML: '' };
  vm.runInNewContext(`${source}\nrenderClientTools();`, { window, document, mainContent, escapeHtml: value => String(value ?? ''), icons: { warehouse: '' } });
  assert.match(mainContent.innerHTML, /Filter Tools/);
  assert.doesNotMatch(mainContent.innerHTML, /<img[^>]+mkite-logo/);
  assert.match(fs.readFileSync("css/client-tools/client-tools.css", "utf8"), /client-tools-hero-bg\.png/);
  for (const [label, count] of [['Warehouses',1],['Clients',2],['Tools',3]]) assert.ok(mainContent.innerHTML.includes(`<dt>${label}</dt><dd>${count}</dd>`));
  assert.match(mainContent.innerHTML, /directory-hero/);
  assert.equal(document.getElementById('directory-count').textContent, '3 tools found');
  assert.match(mainContent.innerHTML, /SEARCH TOOLS/);
  const results = document.getElementById('directory-results');
  assert.match(results.innerHTML, /B044 - Put Away Scan/);
  assert.match(results.innerHTML, /More tools coming soon/);
  assert.equal((results.innerHTML.match(/directory-tool-card/g) || []).length, 3);
  for (const tool of registry.filter()) {
    assert.ok(results.innerHTML.includes(tool.description));
    assert.ok(results.innerHTML.includes(`data-client-tool-id="${tool.route}"`));
    assert.ok(results.innerHTML.includes(`data-client-card-theme="${tool.cardTheme}"`));
  }
  document.getElementById('directory-header-query').value = 'Batch Inventory';
  document.getElementById('directory-header-query').oninput();
  assert.equal(document.getElementById('directory-count').textContent, '1 tool found');
  assert.match(results.innerHTML, /TINECO TOC Batch Inventory/);
  document.getElementById('directory-clear').handlers.click();
  assert.equal(document.getElementById('directory-header-query').value, '');
  const search = () => document.getElementById('directory-form').handlers.submit({ preventDefault() {} });
  for (const [id, mismatch, match] of [['directory-warehouse','MKS159','MKS66'], ['directory-client','C102','B044'], ['directory-query','Outbound','CT-MKS66-B044-0001']]) {
    document.getElementById(id).value = mismatch; search(); assert.match(results.innerHTML, /No tools found/);
    document.getElementById(id).value = match; search(); assert.match(results.innerHTML, /B044 - Put Away Scan/);
  }
  document.getElementById('directory-query').value = 'missing'; search();
  document.getElementById('directory-clear').handlers.click();
  for (const id of ['directory-warehouse','directory-client','directory-query']) assert.equal(document.getElementById(id).value, '');
  assert.match(results.innerHTML, /B044 - Put Away Scan/);
});
test('registry-driven card palette separates B044 blue and Tineco teal without changing workspace theme',()=>{
 const app=fs.readFileSync('js/app.js','utf8');
 const source=app.slice(app.indexOf('  function clientToolCard('),app.indexOf('  function renderInvalidClient('));
 const render=vm.runInNewContext(`${source}\nclientToolCard`,{escapeHtml:v=>String(v??''),icons:{warehouse:''}});
 for(const [clientId,slug,theme] of [['B044','put-away-scan','blue'],['TINECO-TOC','tineco-toc','teal']]){
   const tool=registry.get(clientId,slug,'MKS66'),html=render(tool);
   assert.equal(tool.cardTheme,theme);assert.equal(tool.theme,'blue');
   assert.ok(html.includes(`data-client-card-theme="${theme}"`));
   for(const value of [`${clientId} - ${tool.name}`,tool.toolId,'Warehouse: MKS66',`Client ID: ${clientId}`,'OPEN TOOL'])assert.ok(html.includes(value));
   assert.ok(!html.includes(tool.description));assert.ok(html.includes(`data-client-tool-id="${slug}"`));
 }
});
test('directory styles isolate desktop grid, mobile layout and dark surfaces', () => {
  const css = fs.readFileSync('css/client-tools/client-tools.css', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(css, /\.client-tool-grid[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width:900px\)[^\n]*\.client-directory \.client-tool-grid \{ grid-template-columns:1fr/);
  assert.match(css, /@media \(max-width:540px\)[^\n]*client-directory-filters \{ grid-template-columns:1fr/);
  assert.match(css, /\[data-theme="dark"\] \.app-shell:has\(\.client-directory\)/);
  assert.match(html, /directory-sidebar-logo[^>]*assets\/images\/mkite-logo.png/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /id="menu-button"/);
  assert.match(html, /Search tools, clients, or keywords/);
});

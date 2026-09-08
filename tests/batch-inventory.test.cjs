const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
const window = {}; vm.runInNewContext(fs.readFileSync('js/in-house-tools/batch-inventory.js', 'utf8'), { window });
const moduleTool = window.MkiteInHouseTools.batchInventory, t = moduleTool._test;
const data = { summary: { found: 1, active: 0, processing: 0, processed: 0, disposal: 0 }, matchMode: 'EXACT_BATCH', pagination: { page: 1, pageSize: 50, totalPages: 1, hasPrevious: false, hasNext: false, returnedCount: 1, totalMatched: 1 }, results: [{ sku: 'ABC/123@B044', status: 'Future', note: 'unknown <script>\n2026/09/07 17:29 - RECEIVED', lastActivity: 'RECEIVED' }], batch: { input: 3, found: 1, duplicateInput: 1, notFound: ['MISSING'] } };
test('inventory renders unknown statuses and missing batch inputs safely', () => { const html = t.resultHtml(data); assert.match(html, /Future/); assert.match(html, /NOT FOUND INPUTS/); assert.match(html, /MISSING/); assert.match(html, /ABC\/123@B044/); });
test('unknown NOTE lines remain visible and escaped in history', () => { const html = t.history(data.results[0].note); assert.match(html, /unknown &lt;script&gt;/); assert.match(html, /2026\/09\/07 17:29/); assert.ok(html.indexOf('RECEIVED') < html.indexOf('unknown')); });
test('Excel export uses only current returned rows plus explicit missing inputs', () => { const rows = t.exportRows(data); assert.equal(rows.length, 2); assert.equal(rows[0]['IN-HOUSE SKU'], 'ABC/123@B044'); assert.equal(rows[0].NOTE, data.results[0].note); assert.equal(rows[1].RESULT, 'NOT FOUND'); });
test('UI has seven inquiry filters and no Final SKU or mutation controls', () => { const html = moduleTool.render(); assert.equal((html.match(/name="/g) || []).length, 7); assert.doesNotMatch(html, /Final SKU|Delete|Move Package/); assert.match(html, /inventory-batch/); });
test('browser calls only server search with JSON and fetches the first 50 records on init', async () => {
  const nodes = new Map(), calls = []; const root = { querySelector: s => { if (!nodes.has(s)) nodes.set(s, { innerHTML: '', textContent: '' }); return nodes.get(s); } };
  window.MkiteApiClient = { post: async (path, body) => { calls.push({ path, body }); return { ok: true, data }; } };
  moduleTool.init({ root, toast: { show() {} } }); assert.equal(calls.length, 1); assert.equal(calls[0].body.page, 1); assert.equal(calls[0].body.pageSize, 50);
  await t.search({ sku: 'ABC/123@B044' }); assert.equal(calls.length, 2); assert.equal(calls[1].path, '/api/inventory/search'); assert.equal(calls[1].body.sku, 'ABC/123@B044'); moduleTool.cleanup();
});
test('registry exposes Batch Inventory through shared in-house navigation', () => {
  vm.runInNewContext(fs.readFileSync('js/in-house-tools-registry.js', 'utf8'), { window });
  assert.equal(window.MkiteInHouseToolRegistry.get('batch-inventory').module, 'batchInventory');
  assert.equal(window.MkiteInHouseToolRegistry.get('batch-inventory').theme, 'batch-inventory');
});
test('pagination buttons and current-page export are explicit', () => {
  assert.match(t.resultHtml(data), /id="inventory-previous" disabled/);
  assert.match(t.resultHtml(data), /id="inventory-next" disabled/);
  assert.match(t.resultHtml(data), /EXPORT CURRENT PAGE/);
  const next = { ...data, pagination: { ...data.pagination, totalMatched: 137, totalPages: 3, hasNext: true } };
  assert.match(t.resultHtml(next), /id="inventory-next" >Next/);
});
test('new searches reset page while navigation retains submitted filters', async () => {
  const nodes = new Map(), calls = [];
  const root = { querySelector: s => { if (!nodes.has(s)) nodes.set(s, { value: '', innerHTML: '', textContent: '' }); return nodes.get(s); } };
  window.MkiteApiClient = { post: async (path, body) => { calls.push(body); return { ok: true, data: { ...data, pagination: { ...data.pagination, page: body.page, hasNext: true } } }; } };
  moduleTool.init({ root, toast: { show() {} } }); await Promise.resolve(); await Promise.resolve();
  await t.search({ status: 'Processed' }, 2);
  root.querySelector('[name="status"]').value = 'Active';
  root.querySelector('#inventory-form').onsubmit({ preventDefault() {} });
  assert.equal(calls.at(-1).page, 1); assert.equal(calls.at(-1).status, 'Active'); moduleTool.cleanup();
});
test('one shared sidebar preserves route IDs and required order in all layouts', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const nav = [...html.matchAll(/class="nav-item[^>]*data-route="([^"]+)"[^>]*>.*?<span>([^<]+)<\/span>/g)];
  assert.deepEqual(nav.map(m => m[1]), ['dashboard', 'in-house-tools', 'client-tools', 'tools', 'settings']);
  assert.deepEqual(nav.map(m => m[2]), ['Dashboard', 'In House Tools', 'Client Tools', 'Assisting Tools', 'Settings']);
  const router = fs.readFileSync('js/router.js', 'utf8'); assert.match(router, /tools/); assert.match(router, /tool/);
});
test('legacy tools URLs still parse and navigate unchanged', () => {
  const w = { location: { hash: '#tools' }, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync('js/router.js', 'utf8'), { window: w });
  assert.equal(w.MkiteRouter.current().view, 'tools');
  w.location.hash = '#tool/example'; assert.equal(w.MkiteRouter.current().toolId, 'example');
  w.MkiteRouter.navigate({ view: 'tools' }); assert.equal(w.location.hash, '#tools');
});

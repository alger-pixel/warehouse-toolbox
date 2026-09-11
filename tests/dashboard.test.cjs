const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function renderDashboard() {
  const app = fs.readFileSync('js/app.js', 'utf8');
  const source = app.slice(app.indexOf('  function renderDashboard()'), app.indexOf('  function renderTools()'));
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value:'', innerHTML:'', classList:{ toggle() {} }, addEventListener() {}, focus() {} });
    return nodes.get(id);
  };
  const mainContent = { innerHTML:'' };
  const inHouse = [
    { id:'receiving', name:'Receiving', description:'Receive packages.', category:'Inbound Operations', status:'active', version:'v0.5', theme:'receiving', icon:'warehouse' },
    { id:'batch-picking-list', name:'Batch Picking List', description:'Review lists.', category:'Inventory Inquiry', status:'active', version:'v1', cardTheme:'batch-picking-list', icon:'warehouse' }
  ];
  const clientTools = [
    { clientId:'B044', status:'active' },
    { clientId:'TINECO-TOC', status:'active' },
    { clientId:'TINECO-TOC', status:'active' }
  ];
  const window = {
    MkiteInHouseToolRegistry:{ all:() => inHouse },
    MkiteClientToolRegistry:{ filter:() => clientTools },
    MkiteToolRegistry:{ search:() => [] }
  };
  const icons = new Proxy({}, { get:() => '<svg></svg>' });
  vm.runInNewContext(`${source}\nrenderDashboard();`, { window, document:{ getElementById:node }, mainContent, icons, escapeHtml:value => String(value ?? '') });
  return mainContent.innerHTML;
}

test('dashboard renders target shell sections with non-fabricated KPI values', () => {
  const html = renderDashboard();
  for (const text of ['Smart tools. Stronger operations.', 'Warehouse Tools', 'Higher<br>Efficiency', 'Packages Processed', 'Active Picking Lists', 'Active Users', 'Avg. Processing Time', 'In House Tools', 'Client Tools']) assert.ok(html.includes(text), text);
  assert.equal((html.match(/dashboard-kpi-value">—/g) || []).length, 4);
});

test('dashboard derives operational and grouped client cards from registries', () => {
  const html = renderDashboard();
  assert.match(html, /data-in-house-tool-id="receiving"/);
  assert.match(html, /data-in-house-tool-id="batch-picking-list"/);
  assert.equal((html.match(/data-client-group="B044"/g) || []).length, 1);
  assert.equal((html.match(/data-client-group="TINECO-TOC"/g) || []).length, 1);
  assert.match(html, /TINECO-TOC[\s\S]*Active/);
  assert.match(html, /More Clients/);
  assert.match(html, /data-route="client-tools"/);
});

test('dashboard geometry tokens and responsive grids remain scoped', () => {
  const variables = fs.readFileSync('css/variables.css','utf8');
  const components = fs.readFileSync('css/components.css','utf8');
  const responsive = fs.readFileSync('css/responsive.css','utf8');
  assert.match(variables, /--sidebar-width:\s*205px/);
  assert.match(variables, /--header-height:\s*56px/);
  assert.match(components, /\.dashboard-intro[^}]*height:282px/);
  assert.match(components, /\.dashboard-kpi[^}]*height:81px/);
  assert.match(components, /\.dashboard-tool-card[^}]*height:145px/);
  assert.match(components, /\.dashboard-client-card[^}]*height:104px/);
  assert.match(responsive, /\.dashboard-in-house-grid \{ grid-template-columns:1fr/);
  assert.match(responsive, /\.dashboard-client-grid \{ grid-template-columns:1fr/);
});

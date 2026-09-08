const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup() {
  const nodes = new Map(); const timers = new Map(); const requests = []; let timer = 0; let focused;
  function node(id) { if (!nodes.has(id)) nodes.set(id, { value: '', disabled: false, hidden: true, innerHTML: '', dataset: {}, handlers: {}, classList: { toggle() {} }, insertAdjacentHTML() {}, addEventListener(name, fn) { this.handlers[name] = fn; }, focus() { focused = id; } }); return nodes.get(id); }
  const root = { querySelector: node, addEventListener(name, fn) { this[name] = fn; } };
  const window = { setTimeout(fn, ms) { timers.set(++timer, { fn, ms }); return timer; }, clearTimeout(id) { timers.delete(id); }, MkiteReceivingService: { mode: () => 'live', searchClients(query) { return new Promise(resolve => requests.push({ query, resolve })); } } };
  vm.runInNewContext(fs.readFileSync('js/in-house-tools/receiving/receiving.js', 'utf8'), { window, document: {} });
  const service = window.MkiteReceivingService;
  service.findExactSku = async sku => { requests.push({ sku }); return { ok: true, found: false, records: [] }; };
  service.receivePackage = async values => { requests.push(values); return { ok: true, data: { ...values, recordId: 'new', receivedAt: new Date().toISOString() } }; };
  const tool = window.MkiteInHouseTools.receiving;
  const context = { root, storage: { get() {}, set() {} }, toast: { show() {} }, audio: { setEnabled() {}, success() {}, warning() {}, failure() {} } };
  tool.init(context);
  const flush = ms => { for (const [id, task] of [...timers]) if (task.ms === ms) { timers.delete(id); task.fn(); } };
  flush(0);
  return { node, root, tool, context, requests, flush, focus: () => focused,
    input(value) { node('#receiving-client').value = value; node('#receiving-client').handlers.input(); },
    enter() { node('#receiving-client').handlers.keydown({ key: 'Enter', preventDefault() {} }); },
    async reply(index, results) { requests[index].resolve({ ok: true, results }); await new Promise(setImmediate); flush(0); } };
}

for (const [value, expected] of [['b044', 'B044'], ['AbC123', 'ABC123'], ['NEWCLIENT99', 'NEWCLIENT99'], [' B044 ', 'B044'], [' ab-12_x ', 'AB-12_X']]) test(`immediate local Client ID entry: ${value}`, () => {
  const h = setup(); h.input(value); assert.equal(h.node('#receiving-client').value, value.toUpperCase()); h.enter();
  assert.equal(h.node('#receiving-client').value, expected); assert.equal(h.focus(), '#receiving-sku'); assert.equal(h.node('#receiving-sku').disabled, false); assert.equal(h.node('#receiving-location').disabled, true); h.flush(220); assert.equal(h.requests.length, 0);
});
test('blank Client ID blocks Enter and form submission without backend calls', () => {
  const h = setup(); h.input('   '); h.enter(); h.node('#receiving-form').handlers.submit({ preventDefault() {} });
  assert.match(h.node('#receiving-status').innerHTML, /CLIENT ID REQUIRED/); assert.equal(h.focus(), '#receiving-client'); assert.equal(h.node('#receiving-submit').disabled, true); assert.equal(h.requests.length, 0);
});
test('full scanner flow writes normalized ID and resets all inputs after success', async () => {
  const h = setup(); h.input('b044'); h.enter();
  const sku = h.node('#receiving-sku'); sku.value = 'ABC123'; sku.handlers.input(); sku.handlers.keydown({ key: 'Enter', preventDefault() {} }); assert.equal(h.focus(), '#receiving-location');
  const location = h.node('#receiving-location'); location.value = '66-A1-01'; location.handlers.input(); assert.equal(h.node('#receiving-submit').disabled, false);
  location.handlers.keydown({ key: 'Enter', preventDefault() {} }); await new Promise(setImmediate);
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].clientId, 'B044'); assert.equal(h.requests[1].sku, 'ABC123'); assert.equal(h.requests[1].location, '66-A1-01');
  h.flush(1300); h.flush(0); for (const id of ['client', 'sku', 'location']) assert.equal(h.node('#receiving-' + id).value, ''); assert.equal(h.focus(), '#receiving-client'); assert.equal(h.node('#receiving-sku').disabled, true); assert.doesNotMatch(h.node('#receiving-status').innerHTML, /Confirm Duplicate/);
});
test('editing Client ID clears downstream receipt values', () => {
  const h = setup(); h.input('B044'); h.enter(); h.node('#receiving-sku').value = 'SKU'; h.node('#receiving-location').value = 'LOC'; h.input('B045');
  assert.equal(h.node('#receiving-sku').value, ''); assert.equal(h.node('#receiving-location').value, ''); assert.equal(h.node('#receiving-submit').disabled, true);
});
test('Receiving service only posts normalized package data', async () => {
  const calls = []; const window = { MkiteApiConfig: { mode: 'live', endpoints: { receiving: '/api/receiving' } }, MkiteApiClient: { async post(url, data) { calls.push({ url, data }); return { ok: true, data }; } } };
  vm.runInNewContext(fs.readFileSync('js/in-house-tools/receiving/receiving-service.js', 'utf8'), { window });
  await window.MkiteReceivingService.receivePackage({ clientId: ' b044 ', sku: 'ABC123', location: '66-A1-01' });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/receiving'); assert.equal(calls[0].data.clientId, 'B044'); assert.equal(window.MkiteReceivingService.searchClients, undefined); assert.equal(window.MkiteReceivingService.createClient, undefined);
});

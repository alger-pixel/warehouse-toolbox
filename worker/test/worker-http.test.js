import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index.js";
import { createReceivingController } from "../src/modules/receiving/receiving-controller.js";
import { createClientController } from "../src/modules/clients/client-controller.js";

const ALLOWED_ORIGINS = ["https://alger-pixel.github.io", "http://127.0.0.1:5501", "http://localhost:5501"];
const env = { ALLOWED_ORIGINS: ALLOWED_ORIGINS.join(",") };

test('B044 endpoints enforce POST, preserve localhost CORS and forward mutations to coordinator', async () => {
  const configured = { ...env, FEISHU_APP_ID: 'app', FEISHU_APP_SECRET: 'secret', FEISHU_BASE_APP_TOKEN: 'base', FEISHU_PACKAGE_TABLE_ID: 'packages', FEISHU_CLIENT_TABLE_ID: 'clients', FEISHU_PICKING_LIST_TABLE_ID: 'lists' };
  for (const endpoint of ['prepare', 'create-picking-list', 'complete-package', 'cancel-picking-list']) {
    const url = `https://api.example/api/b044/put-away/${endpoint}`;
    assert.equal((await handleRequest(new Request(url), env)).status, 405);
    const headers = { Origin: 'http://localhost:5501', 'Content-Type': 'application/json' };
    assert.equal((await handleRequest(new Request(url, { method: 'OPTIONS', headers }), env)).status, 204);
    if (endpoint === 'prepare') continue;
    assert.equal((await handleRequest(new Request(url, { method: 'POST', headers, body: '{}' }), configured)).status, 503);
    const bindings = { ...configured, B044_PUT_AWAY: { idFromName: name => name, get: name => ({ async fetch(request) {
      assert.equal(name, 'base'); assert.equal(new URL(request.url).pathname, `/${endpoint}`);
      assert.deepEqual(await request.json(), { example: true }); return Response.json({ ok: true, data: { confirmed: true } });
    } }) } };
    const response = await handleRequest(new Request(url, { method: 'POST', headers, body: JSON.stringify({ example: true }) }), bindings);
    assert.equal(response.status, 200); assert.equal(response.headers.get('Access-Control-Allow-Origin'), headers.Origin);
    assert.equal((await response.json()).data.confirmed, true);
  }
});

test("health is safe and CORS is exact-origin", async () => {
  for (const origin of ALLOWED_ORIGINS) {
    const allowed = await handleRequest(new Request("https://api.example/api/health", { headers: { Origin: origin } }), env);
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get("Access-Control-Allow-Origin"), origin); assert.notEqual(allowed.headers.get("Access-Control-Allow-Origin"), "*"); assert.equal((await allowed.json()).feishuConfigured, false);
  }
  for (const origin of ["http://127.0.0.1:9999", "https://example.com"]) {
    const denied = await handleRequest(new Request("https://api.example/api/health", { headers: { Origin: origin } }), env);
    assert.equal(denied.status, 403); assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
  }
});

test("preflight and method boundaries are enforced", async () => {
  for (const origin of ALLOWED_ORIGINS) {
    const preflight = await handleRequest(new Request("https://api.example/api/receiving", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } }), env);
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin); assert.match(preflight.headers.get("Access-Control-Allow-Methods"), /POST/);
  }
  const wrongMethod = await handleRequest(new Request("https://api.example/api/receiving", { method: "GET" }), env);
  assert.equal(wrongMethod.status, 405);
});

test("temporary Receiving fields diagnostic route no longer exists", async () => {
  const response = await handleRequest(new Request("https://api.example/api/debug/receiving-fields", { method: "GET" }), env);
  assert.equal(response.status, 404); assert.equal((await response.json()).error.code, "NOT_FOUND");
});

test("location move routes enforce POST",async()=>{for(const path of ["/api/location-move/lookup","/api/location-move"]){const response=await handleRequest(new Request(`https://api.example${path}`,{method:"GET"}),env);assert.equal(response.status,405);}});

test("controller returns 409 and all records for a server-side duplicate", async () => {
  const existing = [{ recordId: "rec-one", sku: "SKU-1", location: "A", receivedAt: "2026-09-03T10:00:00Z", status: "Active" }];
  const controller = createReceivingController({ receive: async () => ({ duplicate: true, records: existing }) });
  const request = new Request("https://api.example/api/receiving", { method: "POST" });
  const response = await controller.receive({ clientId: "B044", sku: "SKU-1", location: "A", duplicateOverride: false }, "request-1", request, env);
  const payload = await response.json(); assert.equal(response.status, 409); assert.equal(payload.error.code, "DUPLICATE_SKU"); assert.deepEqual(payload.records, existing);
});

test("controller rejects invalid create input", async () => {
  const controller = createReceivingController({ receive: async () => { throw new Error("must not run"); } });
  const request = new Request("https://api.example/api/receiving", { method: "POST" });
  const response = await controller.receive({ sku: "", location: "A" }, "request-2", request, env);
  assert.equal(response.status, 400); assert.equal((await response.json()).error.code, "CLIENT_ID_REQUIRED");
});

test("Receiving create reports each missing required field specifically", async () => {
  const controller = createReceivingController({ receive: async () => { throw new Error("must not run"); } });
  const request = new Request("https://api.example/api/receiving", { method: "POST" });
  for (const [body, code] of [
    [{ sku: "SKU", location: "A" }, "CLIENT_ID_REQUIRED"],
    [{ clientId: "B044", location: "A" }, "SKU_REQUIRED"],
    [{ clientId: "B044", sku: "SKU" }, "LOCATION_REQUIRED"]
  ]) {
    const response = await controller.receive(body, "validation-test", request, env);
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, code);
  }
});

test("Client creation validates only a trimmed Client ID", async () => {
  let receivedValue = null;
  const controller = createClientController({
    create: async (clientId) => { receivedValue = clientId; return { created: true, recordId: "client-new", clientId }; }
  });
  const request = new Request("https://api.example/api/clients", { method: "POST" });
  const response = await controller.create({ clientId: " B077 " }, "client-create-test", request, env);
  assert.equal(response.status, 201);
  assert.equal(receivedValue, "B077");
  assert.deepEqual(await response.json(), { ok: true, created: true, recordId: "client-new", clientId: "B077" });
});

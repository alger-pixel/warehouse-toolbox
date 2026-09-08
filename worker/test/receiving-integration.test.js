import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index.js";
import { resetTokenCacheForTests } from "../src/services/feishu-auth-service.js";

const env = { FEISHU_APP_ID: "app", FEISHU_APP_SECRET: "placeholder", FEISHU_BASE_APP_TOKEN: "base", FEISHU_PACKAGE_TABLE_ID: "table", FEISHU_CLIENT_TABLE_ID: "clients", ALLOWED_ORIGINS: "https://alger-pixel.github.io,http://127.0.0.1:5501,http://localhost:5501" };
const headers = { Origin: "https://alger-pixel.github.io", "Content-Type": "application/json" };

test("Worker performs server duplicate check and authoritative field mapping", async () => {
  resetTokenCacheForTests(); const originalFetch = globalThis.fetch; let existing = false; let createCalls = 0; let clientCreateCalls = 0; let clientReads = 0; let createdFields; let createdClientFields; let updatedFields;
  globalThis.fetch = async (url, init) => {
    if (url.includes("tenant_access_token")) return new Response(JSON.stringify({ code: 0, tenant_access_token: "placeholder-token", expire: 7200 }), { status: 200 });
    if (url.includes("/tables/clients/records?") && init.method === "GET") { clientReads += 1; return new Response(JSON.stringify({ code: 0, data: { items: [{ record_id: "client-b044", fields: { "CLIENT ID": "B044" } }], has_more: false } }), { status: 200 }); }
    if (url.includes("/tables/table/records?") && init.method === "GET") return new Response(JSON.stringify({ code: 0, data: { items: existing ? [{ record_id: "old", fields: { "CLIENT ID": "B044", SKU: "ABC001234", LOCATION: "OLD", "DATE OF RECEIVED": 1_700_000_000_000, STATUS: "Active", NOTE: "2026/09/04 16:00 - RECEIVED" } }] : [], has_more: false } }), { status: 200 });
    if (url.endsWith("/records/old") && init.method === "GET") return new Response(JSON.stringify({code:0,data:{record:{record_id:"old",fields:{"CLIENT ID":"B044",SKU:"ABC001234",LOCATION:"OLD","DATE OF RECEIVED":1_700_000_000_000,STATUS:"Active",NOTE:"2026/09/04 16:00 - RECEIVED"}}}}),{status:200});
    if (url.endsWith("/records/old") && init.method === "PUT") { updatedFields=JSON.parse(init.body).fields;return new Response(JSON.stringify({code:0,data:{record:{record_id:"old",fields:updatedFields}}}),{status:200}); }
    if (url.endsWith("/tables/clients/records") && init.method === "POST") { clientCreateCalls += 1; createdClientFields = JSON.parse(init.body).fields; return new Response(JSON.stringify({ code: 0, data: { record: { record_id: "new-client" } } }), { status: 200 }); }
    if (url.endsWith("/tables/table/records") && init.method === "POST") { createCalls += 1; createdFields = JSON.parse(init.body).fields; return new Response(JSON.stringify({ code: 0, data: { record: { record_id: "new" } } }), { status: 200 }); }
    throw new Error("Unexpected URL");
  };
  try {
    const clientSearch = await handleRequest(new Request("https://api.example/api/clients/search", { method: "POST", headers, body: JSON.stringify({ query: "B04" }) }), env);
    const clientSearchPayload = await clientSearch.json();
    assert.equal(clientSearch.status, 200); assert.equal(clientSearchPayload.results[0].clientId, "B044"); assert.equal(clientSearchPayload.results[0].matchType, "startsWith");
    const existingClient = await handleRequest(new Request("https://api.example/api/clients", { method: "POST", headers, body: JSON.stringify({ clientId: "B044" }) }), env);
    assert.equal(existingClient.status, 200); assert.deepEqual(await existingClient.json(), { ok: true, created: false, recordId: "client-b044", clientId: "B044" });
    assert.equal(clientCreateCalls, 0); assert.equal(createCalls, 0);
    const newClient = await handleRequest(new Request("https://api.example/api/clients", { method: "POST", headers, body: JSON.stringify({ clientId: " B077 " }) }), env);
    assert.equal(newClient.status, 201); assert.deepEqual(await newClient.json(), { ok: true, created: true, recordId: "new-client", clientId: "B077" });
    assert.equal(clientCreateCalls, 1); assert.deepEqual(createdClientFields, { "CLIENT ID": "B077" }); assert.equal(createCalls, 0);
    const readsBeforeReceiving = clientReads;
    const lookup = await handleRequest(new Request("https://api.example/api/receiving/lookup", { method: "POST", headers: { ...headers, Origin: "http://localhost:5501" }, body: JSON.stringify({ sku: "DEMO" }) }), env);
    assert.equal(lookup.status, 200); assert.equal(lookup.headers.get("Access-Control-Allow-Origin"), "http://localhost:5501"); assert.deepEqual(await lookup.json(), { ok: true, found: false, records: [] });
    const request = new Request("https://api.example/api/receiving", { method: "POST", headers, body: JSON.stringify({ clientId: " b044 ", sku: "001234567890", location: "66-A1-01", duplicateOverride: false, receivedAt: "browser-value", status: "Disposal" }) });
    const response = await handleRequest(request, env); const payload = await response.json();
    assert.equal(response.status, 201); assert.equal(payload.status, "Active"); assert.equal(createCalls, 1); assert.deepEqual(Object.keys(createdFields).sort(), ["CLIENT ID", "DATE OF RECEIVED", "LOCATION", "NOTE", "SKU", "STATUS"]); assert.equal(createdFields["CLIENT ID"], "B044"); assert.equal(createdFields.SKU, "001234567890"); assert.equal(createdFields.STATUS, "Active"); assert.equal(typeof createdFields["DATE OF RECEIVED"], "number"); assert.match(createdFields.NOTE, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2} - RECEIVED$/);
    assert.equal(clientReads, readsBeforeReceiving); assert.equal(clientCreateCalls, 1);
    existing = true;
    const conflict = await handleRequest(new Request("https://api.example/api/receiving", { method: "POST", headers, body: JSON.stringify({ clientId: "B044", sku: "ABC001234", location: "NEW", duplicateOverride: false }) }), env);
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, "DUPLICATE_SKU"); assert.equal(createCalls, 1);
    const override = await handleRequest(new Request("https://api.example/api/receiving", { method: "POST", headers, body: JSON.stringify({ clientId: "B044", sku: "ABC001234", location: "NEW", duplicateOverride: true }) }), env);
    assert.equal(override.status, 201); assert.equal(createCalls, 2);
    const moveLookup=await handleRequest(new Request("https://api.example/api/location-move/lookup",{method:"POST",headers,body:JSON.stringify({sku:"abc001234",currentLocation:"old"})}),env);const moveLookupPayload=await moveLookup.json();assert.equal(moveLookup.status,200);assert.equal(moveLookupPayload.state,"READY_TO_MOVE");assert.equal(moveLookupPayload.package.recordId,"old");
    const moved=await handleRequest(new Request("https://api.example/api/location-move",{method:"POST",headers,body:JSON.stringify({sku:"ABC001234",recordId:"old",currentLocation:"OLD",destinationLocation:"NEW-LOCATION"})}),env);assert.equal(moved.status,200);assert.equal(updatedFields.LOCATION,"NEW-LOCATION");assert.match(updatedFields.NOTE,/^2026\/09\/04 16:00 - RECEIVED\n\d{4}\/\d{2}\/\d{2} \d{2}:\d{2} - MOVED BY SKU FROM: OLD TO: NEW-LOCATION$/);
  } finally { globalThis.fetch = originalFetch; }
});

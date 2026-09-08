import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuRecordService, FeishuRecordError } from "../src/services/feishu-record-service.js";

const auth = { getTenantAccessToken: async () => "test-token" };

for (const [label, fetchImpl, expected] of [
  ['API rejection', async () => Response.json({ code: 1254045, msg: 'PRIVATE RESPONSE BODY' }, { status: 400 }), { feishuCode: 1254045, httpStatus: 400, errorType: 'FEISHU_API_ERROR' }],
  ['network failure', async () => { throw new Error('PRIVATE NETWORK DETAILS'); }, { feishuCode: 'NETWORK_ERROR', httpStatus: undefined, errorType: 'NETWORK_ERROR' }],
  ['invalid JSON', async () => new Response('PRIVATE NON-JSON BODY', { status: 502 }), { feishuCode: 'RESPONSE_PARSE_ERROR', httpStatus: 502, errorType: 'RESPONSE_PARSE_ERROR' }],
  ['invalid JSON on HTTP 200', async () => new Response('PRIVATE NON-JSON BODY', { status: 200 }), { feishuCode: 'RESPONSE_PARSE_ERROR', httpStatus: 200, errorType: 'RESPONSE_PARSE_ERROR' }],
  ['unsafe upstream code', async () => Response.json({ code: 'PRIVATE TOKEN', msg: 'PRIVATE RESPONSE BODY' }, { status: 403 }), { feishuCode: 'UNKNOWN', httpStatus: 403, errorType: 'FEISHU_API_ERROR' }]
]) test(`record errors preserve safe metadata: ${label}`, async () => {
  const service = createFeishuRecordService(auth, { fetchImpl });
  await assert.rejects(service.listRecords({ appToken: 'base', tableId: 'table' }), error => {
    assert.ok(error instanceof FeishuRecordError);
    for (const [key, value] of Object.entries(expected)) assert.equal(error[key], value);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /PRIVATE|test-token/);
    assert.equal(error.cause, undefined); return true;
  });
});

test("record lookup uses the Bitable list endpoint with confirmed field projection", async () => {
  let captured;
  const service = createFeishuRecordService(auth, { fetchImpl: async (url, init) => { captured = { url, init }; return new Response(JSON.stringify({ code: 0, data: { items: [{ record_id: "record-1", fields: {} }], has_more: false } }), { status: 200 }); } });
  const fields = ["SKU", "LOCATION", "DATE OF RECEIVED", "STATUS"];
  const records = await service.listRecords({ appToken: "base", tableId: "table", fieldNames: fields });
  const url = new URL(captured.url);
  assert.equal(records.length, 1); assert.match(url.pathname, /\/records$/); assert.doesNotMatch(url.pathname, /\/search$/); assert.equal(captured.init.method, "GET"); assert.deepEqual(JSON.parse(url.searchParams.get("field_names")), fields); assert.ok(captured.init.headers.Authorization.startsWith("Bearer "));
});

test("record listing follows Feishu pagination until all records are read", async () => {
  const urls = [];
  const service = createFeishuRecordService(auth, { fetchImpl: async (url) => { urls.push(new URL(url)); const second = urls.length === 2; return new Response(JSON.stringify({ code: 0, data: { items: [{ record_id: second ? "record-2" : "record-1", fields: {} }], has_more: !second, page_token: second ? undefined : "next-page" } }), { status: 200 }); } });
  const records = await service.listRecords({ appToken: "base", tableId: "table", fieldNames: ["SKU"] });
  assert.deepEqual(records.map((record) => record.record_id), ["record-1", "record-2"]); assert.equal(urls[0].searchParams.get("page_token"), null); assert.equal(urls[1].searchParams.get("page_token"), "next-page");
});

test("record creation sends only the supplied fields and normalizes failure", async () => {
  let sent;
  const success = createFeishuRecordService(auth, { fetchImpl: async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ code: 0, data: { record: { record_id: "new-record" } } }), { status: 200 }); } });
  const fields = { SKU: "001", LOCATION: "A", "DATE OF RECEIVED": 123, STATUS: "Active" };
  assert.equal((await success.createRecord({ appToken: "base", tableId: "table", fields })).record_id, "new-record"); assert.deepEqual(sent, { fields });
  const failed = createFeishuRecordService(auth, { fetchImpl: async () => new Response(JSON.stringify({ code: 1254001, msg: "upstream detail" }), { status: 400 }) });
  await assert.rejects(failed.createRecord({ appToken: "base", tableId: "table", fields }), (error) => error instanceof FeishuRecordError && error.message === "Feishu record creation failed");
});

test("invalid Feishu list response is safely normalized", async () => {
  const failed = createFeishuRecordService(auth, { fetchImpl: async () => new Response(JSON.stringify({ code: 1254002, msg: "upstream detail" }), { status: 400 }) });
  await assert.rejects(failed.listRecords({ appToken: "base", tableId: "table", fieldNames: ["SKU"] }), (error) => error instanceof FeishuRecordError && error.operation === "record list" && !error.message.includes("upstream detail"));
});

test("record retrieval and update target one record and preserve supplied field scope", async () => {
  const fields={LOCATION:"66-U2-01",NOTE:"2026/09/04 16:00 - MOVED BY SKU FROM: 66-U3-01 TO: 66-U2-01"};
  const calls=[];const service=createFeishuRecordService(auth,{fetchImpl:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify({code:0,data:{record:{record_id:"rec-one",fields}}}),{status:200});}});
  await service.getRecord({appToken:"base",tableId:"table",recordId:"rec-one"});await service.updateRecord({appToken:"base",tableId:"table",recordId:"rec-one",fields});
  assert.match(calls[0].url,/\/records\/rec-one$/);assert.equal(calls[0].init.method,"GET");assert.equal(calls[1].init.method,"PUT");assert.deepEqual(JSON.parse(calls[1].init.body),{fields});
});

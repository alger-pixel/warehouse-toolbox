import test from "node:test";
import assert from "node:assert/strict";
import { createReceivingDomainService, receivingFields } from "../src/modules/receiving/receiving-service.js";
import { RECEIVING_FIELDS } from "../src/modules/receiving/receiving-fields.js";

const config = { appToken: "base-token", packageTableId: "table-id" };
function record(id, sku, location = "A-01") { return { record_id: id, fields: { [receivingFields.SKU]: sku, [receivingFields.LOCATION]: location, [receivingFields.RECEIVED_AT]: 1_788_364_800_000, [receivingFields.STATUS]: "Active", [receivingFields.NOTE]: "" } }; }

test("Receiving field mapping has one centralized source of truth", () => {
  assert.deepEqual(RECEIVING_FIELDS, { clientId:"CLIENT ID",sku: "SKU", location: "LOCATION", receivedAt: "DATE OF RECEIVED", status: "STATUS", note: "NOTE" });
  assert.equal(receivingFields.SKU, RECEIVING_FIELDS.sku); assert.equal(receivingFields.LOCATION, RECEIVING_FIELDS.location); assert.equal(receivingFields.RECEIVED_AT, RECEIVING_FIELDS.receivedAt); assert.equal(receivingFields.STATUS, RECEIVING_FIELDS.status); assert.equal(receivingFields.NOTE, RECEIVING_FIELDS.note);
});

test("returns all case-insensitive exact matches and rejects partial candidates", async () => {
  const records = { listRecords: async () => [record("one", "ABC123"), record("two", "abc123"), record("partial", "ABC1234")], createRecord: async () => { throw new Error("not used"); } };
  const result = await createReceivingDomainService(config, records).lookup(" AbC123 ");
  assert.equal(result.found, true); assert.deepEqual(result.records.map((item) => item.recordId), ["one", "two"]);
});

test("finds the existing DEMO record and returns no match for partial or absent SKUs", async () => {
  const records = { listRecords: async () => [record("demo-record", "DEMO"), record("other-record", "OTHER")], createRecord: async () => { throw new Error("not used"); } };
  const service = createReceivingDomainService(config, records);
  const exact = await service.lookup("DEMO");
  const normalized = await service.lookup(" demo ");
  const partial = await service.lookup("DEM");
  const absent = await service.lookup("MISSING");
  assert.equal(exact.found, true); assert.equal(exact.records[0].recordId, "demo-record");
  assert.equal(normalized.found, true); assert.equal(normalized.records[0].sku, "DEMO");
  assert.deepEqual(partial, { found: false, records: [] }); assert.deepEqual(absent, { found: false, records: [] });
});

test("maps exactly six fields with a server-authoritative RECEIVED note", async () => {
  let captured; const records = { listRecords: async () => [], createRecord: async (input) => { captured = input; return { record_id: "created" }; } };
  const service = createReceivingDomainService(config, records, { now: () => Date.parse("2026-09-04T20:00:00.000Z"),clientService:{exact:async()=>({recordId:"client"})} });
  const result = await service.receive({ clientId:"B044",sku: "001234567890", location: "66-A1-01", duplicateOverride: false, receivedAt: "untrusted", status: "Disposal" });
  assert.deepEqual(captured.fields, { "CLIENT ID":"B044",SKU: "001234567890", LOCATION: "66-A1-01", "DATE OF RECEIVED": Date.parse("2026-09-04T20:00:00.000Z"), STATUS: "Active", NOTE: "2026/09/04 16:00 - RECEIVED" });
  assert.equal(result.data.status, "Active"); assert.equal(result.data.recordId, "created");
  assert.equal(result.activity.actionType, "RECEIVED"); assert.equal(result.activity.toolId, "receiving");
});

test("accepts unknown Client IDs without consulting CLIENT CLASS", async () => {
  let creates = 0;
  const records = { listRecords: async () => [], createRecord: async () => { creates += 1; return { record_id: "new" }; } };
  const service = createReceivingDomainService(config, records, { clientService: { exact: async () => { throw new Error("CLIENT CLASS must not be queried"); } } });
  assert.equal((await service.receive({ clientId: " newclient99 ", sku: "SKU-1", location: "A", duplicateOverride: false })).data.clientId, "NEWCLIENT99");
  assert.equal(creates, 1);
});

test("blocks duplicates unless an explicit override is supplied", async () => {
  let creates = 0; const records = { listRecords: async () => [record("existing", "SKU-1")], createRecord: async () => { creates += 1; return { record_id: "new" }; } };
  const service = createReceivingDomainService(config, records,{clientService:{exact:async()=>({recordId:"client"})}});
  assert.equal((await service.receive({ clientId:"B044",sku: "SKU-1", location: "A", duplicateOverride: false })).duplicate, true); assert.equal(creates, 0);
  assert.equal((await service.receive({ clientId:"B044",sku: "SKU-1", location: "A", duplicateOverride: true })).data.duplicateOverride, true); assert.equal(creates, 1);
});

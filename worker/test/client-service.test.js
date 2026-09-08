import test from "node:test";
import assert from "node:assert/strict";
import { CLIENT_FIELDS } from "../src/modules/clients/client-fields.js";
import { createClientService } from "../src/modules/clients/client-service.js";

const config = { appToken: "base", clientTableId: "clients" };
const client = (recordId, clientId) => ({ record_id: recordId, fields: { [CLIENT_FIELDS.clientId]: clientId } });

test("Client ID field mapping is centralized and exact lookup is case-sensitive", async () => {
  assert.deepEqual(CLIENT_FIELDS, { clientId: "CLIENT ID" });
  const service = createClientService(config, { listRecords: async () => [client("one", "B044")] });
  assert.equal((await service.exact("B044")).recordId, "one");
  assert.equal(await service.exact("b044"), null);
});

test("client search ranks exact, prefix, contains, then case-insensitive suggestions", async () => {
  const service = createClientService(config, { listRecords: async () => [client("four", "XB044"), client("two", "B045"), client("one", "B044"), client("lower", "b044")] });
  const result = await service.search("B044");
  assert.deepEqual(result.results.map(({ clientId, matchType }) => ({ clientId, matchType })), [
    { clientId: "B044", matchType: "exact" },
    { clientId: "XB044", matchType: "contains" },
    { clientId: "b044", matchType: "fuzzy" }
  ]);
});

test("client creation rechecks existence and writes only CLIENT ID", async () => {
  let items = [client("existing", "B044")]; let captured = null;
  const records = {
    listRecords: async () => items,
    createRecord: async (input) => { captured = input; return { record_id: "created" }; }
  };
  const service = createClientService(config, records);
  assert.deepEqual(await service.create("B044"), { created: false, recordId: "existing", clientId: "B044" });
  assert.equal(captured, null);
  items = [];
  assert.deepEqual(await service.create("B077"), { created: true, recordId: "created", clientId: "B077" });
  assert.deepEqual(captured, { appToken: "base", tableId: "clients", fields: { "CLIENT ID": "B077" } });
});

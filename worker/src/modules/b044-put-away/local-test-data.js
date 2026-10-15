import { RECEIVING_FIELDS as F } from '../receiving/receiving-fields.js';

export const B044_LOCAL_TEST_MODE = 'enabled';
export const B044_LOCAL_PACKAGE_TABLE = 'local-b044-packages';
export const B044_LOCAL_PICKING_LIST_TABLE = 'local-b044-picking-lists';

export function isB044LocalTestMode(env) {
  return env?.B044_LOCAL_TEST_DATA === B044_LOCAL_TEST_MODE
    && env?.FEISHU_DATA_ENVIRONMENT === 'local-test'
    && env?.WORKER_RUNTIME_ENVIRONMENT === 'development';
}

export function b044LocalTestConfig(env) {
  if (!isB044LocalTestMode(env)) throw new Error('B044 local test data mode is not safely configured.');
  return {
    appToken: 'local-b044-test-data',
    packageTableId: B044_LOCAL_PACKAGE_TABLE,
    pickingListTableId: B044_LOCAL_PICKING_LIST_TABLE,
    warehouseTimeZone: env.WAREHOUSE_TIME_ZONE || 'America/Toronto'
  };
}

const clone = value => value == null ? value : structuredClone(value);
const indexKey = tableId => `local-test-record-index:${tableId}`;
const recordKey = (tableId, recordId) => `local-test-record:${tableId}:${recordId}`;
const stableId = value => {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return `local-b044-package-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};
const historyFor = index => {
  const number = String(index + 1).padStart(2, '0');
  if (index % 5 === 3) return `TEST HISTORY ONLY\nSTATUS: PARTIALLY COMPLETED / RECONCILED\n2026/10/01 09:00 - B044 SCAN PUT AWAY TOOL: PL NUMBER: B044-PL-LOCAL-HISTORY-${number} - CANCELLED`;
  if (index % 5 === 4) return 'TEST HISTORY ONLY\n2026/09/30 09:00 - B044 SCAN PUT AWAY TOOL: PL NUMBER: B044-PL-LOCAL-HISTORY-A - CREATED\n2026/10/01 09:00 - B044 SCAN PUT AWAY TOOL: PL NUMBER: B044-PL-LOCAL-HISTORY-B - CANCELLED';
  return `TEST HISTORY ONLY\n2026/10/01 09:00 - B044 SCAN PUT AWAY TOOL: PL NUMBER: B044-PL-LOCAL-HISTORY-${number} - ${['CREATED','CANCELLED','DONE PUTTING AWAY'][index % 3]}`;
};

export function createB044LocalTestRecordService(storage, config) {
  if (!storage || config.packageTableId !== B044_LOCAL_PACKAGE_TABLE || config.pickingListTableId !== B044_LOCAL_PICKING_LIST_TABLE) throw new Error('Invalid B044 local test repository configuration.');
  async function ensureSeeded() {
    if (await storage.get('local-test-records-seeded')) return;
    await storage.put(indexKey(config.packageTableId), []);
    await storage.put(indexKey(config.pickingListTableId), []);
    await storage.put('local-test-records-seeded', true);
  }
  const service = {
    async seedPackages(rows) {
      await ensureSeeded();
      if (!Array.isArray(rows)) throw new Error('Local test package seed requires normalized rows.');
      const ids = await storage.get(indexKey(config.packageTableId)) || [];
      for (const [index, row] of rows.entries()) {
        const trackingNumber = String(row?.trackingNumber || '').trim();
        if (!trackingNumber || !row?.clientId || !row?.inboundSku || !row?.arrivalDate) throw new Error('Local test package seed requires normal B044 package fields.');
        const recordId = stableId(trackingNumber.toUpperCase());
        if (await storage.get(recordKey(config.packageTableId, recordId))) continue;
        const record = { record_id:recordId, fields:{ [F.sku]:trackingNumber, [F.status]:'Active', [F.location]:`LOCAL-TEST-RACK-${String(index + 1).padStart(2,'0')}`, [F.clientId]:row.clientId, [F.receivedAt]:row.arrivalDate, [F.note]:historyFor(index), 'INBOUND SKU':row.inboundSku, 'WAREHOUSE INBOUND ORDER':row.warehouseInboundOrder } };
        ids.push(recordId); await storage.put(recordKey(config.packageTableId, recordId), record);
      }
      await storage.put(indexKey(config.packageTableId), ids);
    },
    async listFields({ tableId }) {
      await ensureSeeded();
      if (tableId === config.packageTableId) return [{ field_name: F.status, type: 3, property: { options: ['Active', 'Processing', 'Processed'].map(name => ({ name })) } }];
      if (tableId === config.pickingListTableId) return [{ field_name: 'PART USED', type: 1 }];
      throw new Error('Local test repository rejected an unknown table.');
    },
    async listRecords({ tableId }) {
      await ensureSeeded();
      if (![config.packageTableId, config.pickingListTableId].includes(tableId)) throw new Error('Local test repository rejected an unknown table.');
      const ids = await storage.get(indexKey(tableId)) || [];
      return Promise.all(ids.map(async id => clone(await storage.get(recordKey(tableId, id)))));
    },
    async getRecord({ tableId, recordId }) {
      await ensureSeeded();
      if (![config.packageTableId, config.pickingListTableId].includes(tableId)) throw new Error('Local test repository rejected an unknown table.');
      return clone(await storage.get(recordKey(tableId, recordId))) || {};
    },
    async createRecord({ tableId, fields }) {
      await ensureSeeded();
      if (tableId !== config.pickingListTableId) throw new Error('Local test repository only creates Picking List masters.');
      const ids = await storage.get(indexKey(tableId)) || [];
      const record = { record_id: `local-b044-pl-${String(ids.length + 1).padStart(4, '0')}`, fields: clone(fields) };
      ids.push(record.record_id);
      await storage.put(indexKey(tableId), ids);
      await storage.put(recordKey(tableId, record.record_id), record);
      return clone(record);
    },
    async updateRecord({ tableId, recordId, fields }) {
      await ensureSeeded();
      if (![config.packageTableId, config.pickingListTableId].includes(tableId)) throw new Error('Local test repository rejected an unknown table.');
      const record = await storage.get(recordKey(tableId, recordId));
      if (!record) throw new Error('Local test record not found.');
      Object.assign(record.fields, clone(fields));
      await storage.put(recordKey(tableId, recordId), record);
      return clone(record);
    }
  };
  return service;
}

export function createB044LocalPartUsedService(storage) {
  return { async recordPartUsage(entry) { const key=`local-test-part-used:${entry.idempotencyKey}`,existing=await storage.get(key);if(existing&&JSON.stringify(existing)!==JSON.stringify(entry))throw new Error('Local Part Used idempotency conflict.');if(!existing)await storage.put(key,clone(entry));return clone(entry); } };
}

import { normalizeSku } from "../../utils/validation.js";
import { createPackageActivityService, PACKAGE_ACTION_TYPES } from "../../services/package-activity-service.js";
import { RECEIVING_FIELDS } from "./receiving-fields.js";

function fieldText(value) { return value == null ? "" : String(value).trim(); }
function mapRecord(record) {
  const fields = record.fields || {}; const received = fields[RECEIVING_FIELDS.receivedAt];
  return { recordId: String(record.record_id || ""), sku: fieldText(fields[RECEIVING_FIELDS.sku]), location: fieldText(fields[RECEIVING_FIELDS.location]), receivedAt: typeof received === "number" ? new Date(received).toISOString() : fieldText(received), status: fieldText(fields[RECEIVING_FIELDS.status]) };
}

export function createReceivingDomainService(config, recordService, options = {}) {
  const now = options.now || (() => Date.now());
  const activityService = options.activityService || createPackageActivityService({ timeZone: config.warehouseTimeZone });
  async function findExactSku(sku) {
    const candidates = await recordService.listRecords({ appToken: config.appToken, tableId: config.packageTableId, fieldNames: Object.values(RECEIVING_FIELDS) });
    return candidates.map(mapRecord).filter((record) => normalizeSku(record.sku) === normalizeSku(sku));
  }
  return {
    async lookup(sku) { const records = await findExactSku(sku); return { found: records.length > 0, records }; },
    async receive({ clientId, sku, location, duplicateOverride }) {
      clientId = fieldText(clientId).toUpperCase();
      const duplicates = await findExactSku(sku);
      if (duplicates.length && !duplicateOverride) return { duplicate: true, records: duplicates };
      const receivedAtMs = now();
      const activity = activityService.createAction(PACKAGE_ACTION_TYPES.RECEIVED, { sku, clientId, toLocation: location, status: "Active", toolId: "receiving" }, receivedAtMs);
      const note = activityService.formatActivityLine(activity);
      const fields = { [RECEIVING_FIELDS.clientId]: clientId, [RECEIVING_FIELDS.sku]: sku, [RECEIVING_FIELDS.location]: location, [RECEIVING_FIELDS.receivedAt]: receivedAtMs, [RECEIVING_FIELDS.status]: "Active", [RECEIVING_FIELDS.note]: note };
      const record = await recordService.createRecord({ appToken: config.appToken, tableId: config.packageTableId, fields });
      return { duplicate: false, data: { recordId: String(record.record_id || ""), clientId, sku, location, receivedAt: new Date(receivedAtMs).toISOString(), status: "Active", duplicateOverride: Boolean(duplicateOverride) }, activity };
    }
  };
}

export const receivingFields = Object.freeze({ SKU: RECEIVING_FIELDS.sku, LOCATION: RECEIVING_FIELDS.location, RECEIVED_AT: RECEIVING_FIELDS.receivedAt, STATUS: RECEIVING_FIELDS.status, NOTE: RECEIVING_FIELDS.note });

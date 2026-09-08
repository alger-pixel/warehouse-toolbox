import { cleanText, normalizeSku } from "../../utils/validation.js";
import { createPackageActivityService, PackageActivityPersistenceError, PACKAGE_ACTION_TYPES } from "../../services/package-activity-service.js";
import { RECEIVING_FIELDS as FIELDS } from "../receiving/receiving-fields.js";

const normalizeLocation = (value) => cleanText(value).toLocaleUpperCase();
const isActive = (value) => cleanText(value) === "Active";
function mapRecord(record) {
  const fields = record.fields || {}; const received = fields[FIELDS.receivedAt];
  return { recordId: String(record.record_id || ""), clientId: cleanText(fields[FIELDS.clientId]), sku: cleanText(fields[FIELDS.sku]), currentLocation: cleanText(fields[FIELDS.location]), status: cleanText(fields[FIELDS.status]), receivedAt: typeof received === "number" ? new Date(received).toISOString() : cleanText(received), note: fields[FIELDS.note] == null ? "" : String(fields[FIELDS.note]) };
}

export function createLocationMoveService(config, records, options = {}) {
  const now = options.now || (() => Date.now());
  const activityService = options.activityService || createPackageActivityService({ timeZone: config.warehouseTimeZone });
  const recordArgs = { appToken: config.appToken, tableId: config.packageTableId };
  async function allPackages() { return (await records.listRecords({ ...recordArgs, fieldNames: Object.values(FIELDS) })).map(mapRecord); }
  return {
    async lookup({ sku, currentLocation }) {
      const packages = await allPackages(); const skuMatches = packages.filter((item) => normalizeSku(item.sku) === normalizeSku(sku));
      if (!skuMatches.length) return { state: "SKU_NOT_FOUND", records: [] };
      const locationMatches = skuMatches.filter((item) => normalizeLocation(item.currentLocation) === normalizeLocation(currentLocation));
      if (!locationMatches.length) return { state: "SKU_NOT_AT_LOCATION", records: [], knownLocations: [...new Set(skuMatches.map((item) => item.currentLocation).filter(Boolean))].slice(0, 5) };
      const active = locationMatches.filter((item) => isActive(item.status));
      if (!active.length) return { state: "PACKAGE_NOT_ACTIVE", records: locationMatches, statuses: [...new Set(locationMatches.map((item) => item.status || "Unknown"))] };
      if (active.length > 1) return { state: "MULTIPLE_ACTIVE_MATCHES", records: active };
      return { state: "READY_TO_MOVE", package: active[0], records: active };
    },
    async move({ sku, recordId, currentLocation, destinationLocation }) {
      const raw = await records.getRecord({ ...recordArgs, recordId }); const item = mapRecord(raw);
      if (normalizeSku(item.sku) !== normalizeSku(sku)) return { conflict: "PACKAGE_CHANGED" };
      if (normalizeLocation(item.currentLocation) !== normalizeLocation(currentLocation)) return { conflict: "LOCATION_CHANGED" };
      if (!isActive(item.status)) return { conflict: "PACKAGE_NOT_ACTIVE", status: item.status };
      if (normalizeLocation(destinationLocation) === normalizeLocation(currentLocation)) return { conflict: "SAME_LOCATION" };
      const movedAtMs = now();
      const activity = activityService.createAction(PACKAGE_ACTION_TYPES.MOVED_BY_SKU, { recordId, sku: item.sku, clientId: item.clientId, fromLocation: item.currentLocation, toLocation: destinationLocation, status: item.status, toolId: "move-location-by-sku" }, movedAtMs);
      const note = activityService.appendActivityNote(item.note, activityService.formatActivityLine(activity));
      const updateFields = { [FIELDS.location]: destinationLocation, [FIELDS.note]: note };
      const updatedRaw = await records.updateRecord({ ...recordArgs, recordId, fields: updateFields });
      let confirmed = mapRecord(updatedRaw);
      if (confirmed.currentLocation !== destinationLocation || confirmed.note !== note) {
        confirmed = mapRecord(await records.getRecord({ ...recordArgs, recordId }));
      }
      if (confirmed.currentLocation !== destinationLocation || confirmed.note !== note) throw new PackageActivityPersistenceError();
      return { data: { recordId, sku: item.sku, fromLocation: item.currentLocation, toLocation: destinationLocation, status: "Active", movedAt: new Date(movedAtMs).toISOString() }, activity };
    }
  };
}

export const locationMoveTest = { normalizeLocation, isActive, mapRecord };

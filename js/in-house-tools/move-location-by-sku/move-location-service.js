(function (window) {
  "use strict";
  const clean = (value) => String(value == null ? "" : value).trim();
  const normalize = (value) => clean(value).toLocaleUpperCase();
  const normalizePackage = (item) => ({ recordId: String(item.recordId || ""), sku: clean(item.sku), currentLocation: clean(item.currentLocation || item.location), status: clean(item.status), receivedAt: item.receivedAt ? String(item.receivedAt) : "" });
  window.MkiteLocationMoveService = {
    async lookup(input) {
      const sku = clean(input && input.sku); const currentLocation = clean(input && input.currentLocation);
      if (!sku || !currentLocation) return { ok: false, error: { code: "VALIDATION_ERROR", message: "SKU and current location are required.", retryable: false } };
      if (window.MkiteApiConfig.mode === "mock") return { ok: true, state: "READY_TO_MOVE", package: { recordId: "mock-location-record", sku, currentLocation, status: "Active", receivedAt: new Date().toISOString() }, records: [] };
      const result = await window.MkiteApiClient.post(window.MkiteApiConfig.endpoints.locationMoveLookup, { sku, currentLocation });
      if (!result.ok) return result; const data = result.data; return { ok: true, state: data.state, package: data.package ? normalizePackage(data.package) : null, records: (data.records || []).map(normalizePackage), statuses: data.statuses || [], knownLocations: data.knownLocations || [] };
    },
    async movePackage(input) {
      if (window.MkiteApiConfig.mode === "mock") return { ok: true, data: { recordId: input.recordId, sku: clean(input.sku), fromLocation: clean(input.currentLocation), toLocation: clean(input.destinationLocation), status: "Active", movedAt: new Date().toISOString() } };
      const result = await window.MkiteApiClient.post(window.MkiteApiConfig.endpoints.locationMove, input); return result.ok ? { ok: true, data: result.data } : result;
    },
    mode() { return window.MkiteApiConfig.mode; }, test: { clean, normalize, normalizePackage }
  };
}(window));

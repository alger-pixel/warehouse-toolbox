export function cleanText(value) { return typeof value === "string" ? value.trim() : ""; }
export function normalizeSku(value) { return cleanText(value).toLocaleUpperCase(); }
export function validLocation(value) { return typeof value === "string" && Boolean(value.trim()) && !/[\u0000-\u001F\u007F]/.test(value); }

export function validateLookupInput(body) {
  const sku = cleanText(body && body.sku);
  return sku ? { ok: true, value: { sku } } : { ok: false, message: "SKU is required." };
}

export function validateCreateInput(body) {
  const clientId=cleanText(body&&body.clientId).toUpperCase(); const sku = cleanText(body && body.sku); const location = cleanText(body && body.location);
  if (!clientId) return {ok:false,code:"CLIENT_ID_REQUIRED",message:"Client ID is required."};
  if (!sku) return {ok:false,code:"SKU_REQUIRED",message:"SKU is required."};
  if (!location) return {ok:false,code:"LOCATION_REQUIRED",message:"Location is required."};
  if (!validLocation(body.location)) return { ok: false, message: "Location contains unsupported control characters." };
  if (body.duplicateOverride !== undefined && typeof body.duplicateOverride !== "boolean") return { ok: false, message: "duplicateOverride must be a boolean." };
  return { ok: true, value: { clientId, sku, location, duplicateOverride: body.duplicateOverride === true } };
}

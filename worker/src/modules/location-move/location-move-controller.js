import { cleanText, validLocation } from "../../utils/validation.js";
import { errorResponse, json } from "../../utils/response.js";

function validate(body, moving) {
  const sku = cleanText(body && body.sku); const currentLocation = cleanText(body && body.currentLocation);
  if (!sku || !currentLocation || !validLocation(body.currentLocation)) return { ok: false, message: "SKU and a valid current location are required." };
  if (!moving) return { ok: true, value: { sku, currentLocation } };
  const recordId = cleanText(body.recordId); const destinationLocation = cleanText(body.destinationLocation);
  if (!recordId || !destinationLocation || !validLocation(body.destinationLocation)) return { ok: false, message: "Verified record and a valid destination location are required." };
  return { ok: true, value: { sku, currentLocation, recordId, destinationLocation } };
}
export function createLocationMoveController(service) {
  return {
    async lookup(body, requestId, request, env) { const valid = validate(body, false); if (!valid.ok) return errorResponse(400, "VALIDATION_ERROR", valid.message, false, requestId, request, env); return json({ ok: true, ...(await service.lookup(valid.value)) }, 200, request, env); },
    async move(body, requestId, request, env) {
      const valid = validate(body, true); if (!valid.ok) return errorResponse(400, "VALIDATION_ERROR", valid.message, false, requestId, request, env);
      const result = await service.move(valid.value); if (result.conflict) return errorResponse(409, result.conflict, "Package state changed. Verify again.", false, requestId, request, env, result.status ? { status: result.status } : {});
      return json({ ok: true, ...result.data }, 200, request, env);
    }
  };
}

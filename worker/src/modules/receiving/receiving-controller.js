import { validateCreateInput, validateLookupInput } from "../../utils/validation.js";
import { errorResponse, json } from "../../utils/response.js";

export function createReceivingController(service) {
  return {
    async lookup(body, requestId, request, env) {
      const validation = validateLookupInput(body);
      if (!validation.ok) return errorResponse(400, validation.code || "VALIDATION_ERROR", validation.message, false, requestId, request, env);
      const result = await service.lookup(validation.value.sku);
      return json({ ok: true, found: result.found, records: result.records }, 200, request, env);
    },
    async receive(body, requestId, request, env) {
      const validation = validateCreateInput(body);
      if (!validation.ok) return errorResponse(400, validation.code || "VALIDATION_ERROR", validation.message, false, requestId, request, env);
      const result = await service.receive(validation.value);
      if (result.duplicate) return errorResponse(409, "DUPLICATE_SKU", "SKU already exists.", false, requestId, request, env, { records: result.records });
      return json({ ok: true, ...result.data }, 201, request, env);
    }
  };
}

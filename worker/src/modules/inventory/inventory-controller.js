import { InventoryError } from './inventory-service.js';
import { json, errorResponse } from '../../utils/response.js';
export function createInventoryController(service) {
  return { async search(input, id, request, env) {
    try { return json({ ok: true, data: await service.search(input) }, 200, request, env); }
    catch (error) {
      if (error instanceof InventoryError) return errorResponse(400, error.code, error.message, false, id, request, env);
      console.error(JSON.stringify({ requestId: id, route: 'inventory-search', event: 'inventory_search_failed', httpStatus: error.httpStatus, feishuCode: error.feishuCode }));
      return errorResponse(502, 'INVENTORY_SEARCH_FAILED', 'Unable to search inventory.', true, id, request, env);
    }
  } };
}

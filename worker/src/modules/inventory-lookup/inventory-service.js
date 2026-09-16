import { createWarehouseInventoryClient, WarehouseLookupError, invalidResponse } from './inventory-client.js';
import { normalizeInventoryLocation } from './inventory-normalizer.js';
import { json, errorResponse } from '../../utils/response.js';
export const MAX_PAGES = 25;
export function createWarehouseInventoryLookupService(env, options = {}) {
  const client = createWarehouseInventoryClient(env, options);
  return { async lookup(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.sku !== 'string' || !input.sku.trim()) throw new WarehouseLookupError('INVALID_SKU', 'Provide a non-empty SKU string.', 400);
    if (input.warehouseCode !== undefined && typeof input.warehouseCode !== 'string') throw new WarehouseLookupError('INVALID_WAREHOUSE_CODE', 'Warehouse code must be a string.', 400);
    if (input.warehouseCodes !== undefined && (!Array.isArray(input.warehouseCodes) || input.warehouseCodes.some(code => typeof code !== 'string'))) throw new WarehouseLookupError('INVALID_WAREHOUSE_CODES', 'Warehouse codes must be an array of strings.', 400);
    const sku = input.sku.trim(), warehouse = input.warehouseCode?.trim();
    const warehouses = input.warehouseCodes === undefined ? null : new Set(input.warehouseCodes.map(code => code.trim()).filter(Boolean));
    const locations = [], seen = new Set(); let total;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await client.page(sku, page);
      if (total !== undefined && total !== data.total) throw invalidResponse();
      total = data.total;
      for (const item of data.items) {
        const location = normalizeInventoryLocation(item);
        // Repeated inventory identities signal unstable/repeated pagination, not a
        // reason to silently deduplicate or aggregate quantities.
        const identity = JSON.stringify([location.warehouseId, location.inventoryId]);
        if (seen.has(identity)) throw invalidResponse();
        seen.add(identity); locations.push(location);
      }
      if (locations.length > total || (!data.items.length && locations.length < total)) throw invalidResponse();
      if (locations.length === total) {
        const matching = warehouses ? locations.filter(row => warehouses.has(row.warehouseCode.trim())) : warehouse ? locations.filter(row => row.warehouseCode.trim() === warehouse) : locations;
        return { ok: true, sku, total: matching.length, locations: matching };
      }
    }
    throw new WarehouseLookupError('WAREHOUSE_API_PAGINATION_LIMIT', 'Warehouse inventory exceeds the lookup page limit. No partial results were returned.');
  } };
}
export async function handleInventoryLookup(input, env, id, request) {
  try { return json(await createWarehouseInventoryLookupService(env).lookup(input), 200, request, env); }
  catch (error) {
    const known = error instanceof WarehouseLookupError;
    return errorResponse(known ? error.status : 502, known ? error.code : 'WAREHOUSE_API_FAILED', known ? error.message : 'Warehouse inventory request failed.', known ? error.retryable : false, id, request, env);
  }
}

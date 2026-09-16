import { invalidResponse } from './inventory-client.js';
const TEXT_FIELDS = ['inventoryId','locationCode','warehouseId','warehouseCode','customerCode','productId','productCode','productTitle','inventoryStatus','locationType','locationTypeCode','aisle','layerNumber','referenceNumber','batchNumber','shelfTime','warehouseUpdatedAt'];
const QUANTITY_FIELDS = ['availableQuantity','lockedQuantity','inventoryQuantity'];
function quantity(value) {
  if (typeof value === 'string') {
    value = value.trim();
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
    value = Number(value);
  }
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
}
export function normalizeInventoryLocation(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalidResponse();
  const result = {};
  for (const field of TEXT_FIELDS) {
    const value = item[field];
    if (value != null && typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw invalidResponse();
    result[field] = value == null ? '' : String(value);
  }
  if (!result.inventoryId || !result.locationCode) throw invalidResponse();
  for (const field of QUANTITY_FIELDS) result[field] = quantity(item[field]);
  return result;
}

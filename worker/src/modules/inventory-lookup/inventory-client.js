export const DEFAULT_API_URL = 'https://tool.mkite.cn/api/v1/open/warehouse-inventory/locations';
export const PAGE_SIZE = 200;
export const REQUEST_TIMEOUT_MS = 10000;
export class WarehouseLookupError extends Error {
  constructor(code, message, status = 502, retryable = false) { super(message); Object.assign(this, { code, status, retryable }); }
}
export const invalidResponse = () => new WarehouseLookupError('WAREHOUSE_API_INVALID_RESPONSE', 'Warehouse inventory returned an invalid or inconsistent response.');
export function createWarehouseInventoryClient(env, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return { async page(sku, page) {
    const key = typeof env.MKITE_WAREHOUSE_API_KEY === 'string' ? env.MKITE_WAREHOUSE_API_KEY.trim() : '';
    if (typeof key !== 'string' || !key.trim()) throw new WarehouseLookupError('WAREHOUSE_API_NOT_CONFIGURED', 'Configure the Worker warehouse API secret.', 503);
    let url;
    try {
      url = new URL(typeof env.MKITE_WAREHOUSE_API_URL === 'string' && env.MKITE_WAREHOUSE_API_URL.trim() ? env.MKITE_WAREHOUSE_API_URL.trim() : DEFAULT_API_URL);
      if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error();
    } catch { throw new WarehouseLookupError('WAREHOUSE_API_NOT_CONFIGURED', 'Configure a valid HTTPS warehouse API URL.', 503); }
    const controller = new AbortController(); let timer;
    try {
      const work = (async () => {
        // workerd rejects redirect:"error" before I/O. Manual never forwards the
        // secret to a redirect target; non-2xx responses are rejected below.
        let response;
        try { response = await fetchImpl(url.href, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: JSON.stringify({ product_sku: sku, page, pageSize: PAGE_SIZE }) }); }
        catch { throw new WarehouseLookupError('WAREHOUSE_API_UNAVAILABLE', 'Warehouse inventory is unavailable.', 502, true); }
        if (!response.ok) {
          if (response.status === 401) throw new WarehouseLookupError('WAREHOUSE_API_UNAUTHORIZED', 'Warehouse inventory authentication failed.');
          if (response.status === 429) throw new WarehouseLookupError('WAREHOUSE_API_RATE_LIMITED', 'Warehouse inventory rate limit reached. Retry later.', 429, true);
          if (response.status >= 500) throw new WarehouseLookupError('WAREHOUSE_API_UNAVAILABLE', 'Warehouse inventory is unavailable.', 502, true);
          throw new WarehouseLookupError('WAREHOUSE_API_FAILED', 'Warehouse inventory request failed.');
        }
        let payload;
        try { payload = await response.json(); } catch { throw invalidResponse(); }
        if (!payload || typeof payload.code !== 'number') throw invalidResponse();
        if (payload.code !== 0) throw new WarehouseLookupError('WAREHOUSE_API_FAILED', 'Warehouse inventory request failed.');
        const data = payload.data;
        if (!data || data.page !== page || data.pageSize !== PAGE_SIZE || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items) || data.items.length > PAGE_SIZE) throw invalidResponse();
        return data;
      })();
      return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => {
        reject(new WarehouseLookupError('WAREHOUSE_API_TIMEOUT', 'Warehouse inventory request timed out.', 504, true)); controller.abort();
      }, timeoutMs); })]);
    } finally { clearTimeout(timer); }
  } };
}

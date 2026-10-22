import { retryAfterMs, withUpstreamRetry } from '../../utils/upstream-retry.js';

export const DEFAULT_API_URL = 'https://tool.mkite.cn/api/v1/open/warehouse-inventory/locations';
export const PAGE_SIZE = 200;
export const REQUEST_TIMEOUT_MS = 10000;
export class WarehouseLookupError extends Error {
  constructor(code, message, status = 502, retryable = false, classification = null, retryAfter = null) { super(message); Object.assign(this, { code, status, retryable, classification: classification || code.toLowerCase(), retryAfterMs: retryAfter }); }
}
export const invalidResponse = () => new WarehouseLookupError('WAREHOUSE_API_INVALID_RESPONSE', 'Warehouse inventory returned an invalid or inconsistent response.', 502, true, 'malformed_response');
const httpError = response => {
  const retryAfter = [429,503].includes(response.status) ? retryAfterMs(response.headers.get('Retry-After')) : null;
  if ([401,403].includes(response.status)) return new WarehouseLookupError('WAREHOUSE_API_UNAUTHORIZED', 'Warehouse inventory authentication failed.', 502, false, 'auth_error');
  if (response.status === 408) return new WarehouseLookupError('WAREHOUSE_API_TIMEOUT', 'Warehouse inventory request timed out.', 504, true, 'timeout');
  if (response.status === 429) return new WarehouseLookupError('WAREHOUSE_API_RATE_LIMITED', 'Warehouse inventory rate limit reached. Retry later.', 429, true, 'rate_limited', retryAfter);
  if ([500,502,503,504].includes(response.status)) return new WarehouseLookupError('WAREHOUSE_API_UNAVAILABLE', 'Warehouse inventory is unavailable.', 502, true, 'upstream_error', retryAfter);
  return new WarehouseLookupError('WAREHOUSE_API_FAILED', 'Warehouse inventory request failed.', 502, false, response.status === 400 ? 'bad_request' : 'http_error');
};

export function createWarehouseInventoryClient(env, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS, sleep, random, onDiagnostic = () => {} } = {}) {
  return { async page(sku, page) {
    const key = typeof env.MKITE_WAREHOUSE_API_KEY === 'string' ? env.MKITE_WAREHOUSE_API_KEY.trim() : '';
    if (!key) throw new WarehouseLookupError('WAREHOUSE_API_NOT_CONFIGURED', 'Configure the Worker warehouse API secret.', 503, false, 'config_error');
    let url;
    try { url = new URL(typeof env.MKITE_WAREHOUSE_API_URL === 'string' && env.MKITE_WAREHOUSE_API_URL.trim() ? env.MKITE_WAREHOUSE_API_URL.trim() : DEFAULT_API_URL); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error(); }
    catch { throw new WarehouseLookupError('WAREHOUSE_API_NOT_CONFIGURED', 'Configure a valid HTTPS warehouse API URL.', 503, false, 'config_error'); }
    let retries = 0;
    try {
      const data = await withUpstreamRetry(async () => {
        const controller = new AbortController(); let timer;
        try {
          const work = (async () => {
            let response;
            try { response = await fetchImpl(url.href, { method: 'POST', redirect: 'manual', signal: controller.signal, headers: { 'Content-Type': 'application/json', 'X-API-Key': key }, body: JSON.stringify({ product_sku: sku, page, pageSize: PAGE_SIZE }) }); }
            catch { throw new WarehouseLookupError('WAREHOUSE_API_UNAVAILABLE', 'Warehouse inventory is unavailable.', 502, true, controller.signal.aborted ? 'timeout' : 'network_error'); }
            if (!response.ok || response.status >= 300 && response.status < 400) throw httpError(response);
            let payload; try { payload = await response.json(); } catch { throw invalidResponse(); }
            if (!payload || typeof payload.code !== 'number') throw invalidResponse();
            if (payload.code !== 0) throw new WarehouseLookupError('WAREHOUSE_API_FAILED', 'Warehouse inventory request failed.', 502, false, 'upstream_rejection');
            const data = payload.data;
            if (!data || data.page !== page || data.pageSize !== PAGE_SIZE || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.items) || data.items.length > PAGE_SIZE) throw invalidResponse();
            return data;
          })();
          return await Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new WarehouseLookupError('WAREHOUSE_API_TIMEOUT', 'Warehouse inventory request timed out.', 504, true, 'timeout')); }, timeoutMs); })]);
        } finally { clearTimeout(timer); }
      }, { sleep, random, onRetry: () => { retries++; } });
      if (retries) onDiagnostic({ outcome: 'success', retries });
      return data;
    } catch (error) { onDiagnostic({ outcome: 'failed', retries, classification: error.classification || 'lookup_failed' }); throw error; }
  } };
}

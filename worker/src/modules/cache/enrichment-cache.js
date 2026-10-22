export const CACHE_SCHEMA_VERSION = 1;
export const MODEL_FRESH_MS = 30 * 24 * 60 * 60 * 1000;
export const STATUS_FRESH_MS = 10 * 60 * 1000;
export const NO_MATCH_FRESH_MS = 10 * 60 * 1000;
export const MODEL_MAX_STALE_MS = 90 * 24 * 60 * 60 * 1000;
export const STATUS_MAX_STALE_MS = 24 * 60 * 60 * 1000;
export const SUCCESS_RETENTION_SECONDS = 90 * 24 * 60 * 60;
export const NO_MATCH_RETENTION_SECONDS = 10 * 60;

export const normalizeSn = value => typeof value === 'string' ? value.trim() : '';
const isoTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableText = value => value === null || typeof value === 'string';
const age = (value, now) => isoTime(value) ? Math.max(0, now - Date.parse(value)) : Infinity;

export async function tinecoSnCacheKey(sn) {
  const normalized = normalizeSn(sn);
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `v1:tineco-sn:${[...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('')}`;
}

export function validSnCacheEntry(value, sn) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== CACHE_SCHEMA_VERSION || value.kind !== 'tineco-sn' || value.sn !== normalizeSn(sn)) return false;
  if (value.outcome === 'NO_MATCH') return isoTime(value.fetchedAt);
  return value.outcome === 'SUCCESS' && nullableText(value.productName) && nullableText(value.stateName) && isoTime(value.modelFetchedAt) && isoTime(value.statusFetchedAt) && isoTime(value.lastSuccessfulFetchAt);
}

export function snCacheFreshness(entry, now = Date.now()) {
  if (!entry) return { modelFresh:false, statusFresh:false, negativeFresh:false, modelUsable:false, statusUsable:false };
  if (entry.outcome === 'NO_MATCH') return { modelFresh:false, statusFresh:false, negativeFresh:age(entry.fetchedAt, now) <= NO_MATCH_FRESH_MS, modelUsable:false, statusUsable:false };
  const modelAge = age(entry.modelFetchedAt, now), statusAge = age(entry.statusFetchedAt, now);
  return { modelFresh:modelAge <= MODEL_FRESH_MS, statusFresh:statusAge <= STATUS_FRESH_MS, negativeFresh:false, modelUsable:modelAge <= MODEL_MAX_STALE_MS, statusUsable:statusAge <= STATUS_MAX_STALE_MS };
}

export function createEnrichmentCache(binding, { onDiagnostic = () => {} } = {}) {
  return {
    async getSn(sn) {
      if (!binding?.get) return null;
      const key = await tinecoSnCacheKey(sn);
      try {
        const raw = await binding.get(key);
        if (raw == null) return null;
        let parsed; try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { onDiagnostic('cacheInvalid'); return null; }
        if (!validSnCacheEntry(parsed, sn)) { onDiagnostic('cacheInvalid'); return null; }
        return { key, entry:parsed };
      } catch { onDiagnostic('cacheReadFailed'); return null; }
    },
    async putSnSuccess(sn, value, now = Date.now()) {
      const stamp = new Date(now).toISOString(), entry = { schemaVersion:CACHE_SCHEMA_VERSION, kind:'tineco-sn', sn:normalizeSn(sn), outcome:'SUCCESS', productName:value.model ?? null, stateName:value.icssStatus ?? null, modelFetchedAt:stamp, statusFetchedAt:stamp, lastSuccessfulFetchAt:stamp };
      if (!binding?.put) return entry;
      try { await binding.put(await tinecoSnCacheKey(sn), JSON.stringify(entry), { expirationTtl:SUCCESS_RETENTION_SECONDS }); }
      catch { onDiagnostic('cacheWriteFailed'); }
      return entry;
    },
    async putSnNoMatch(sn, now = Date.now()) {
      const entry = { schemaVersion:CACHE_SCHEMA_VERSION, kind:'tineco-sn', sn:normalizeSn(sn), outcome:'NO_MATCH', fetchedAt:new Date(now).toISOString() };
      if (!binding?.put) return entry;
      try { await binding.put(await tinecoSnCacheKey(sn), JSON.stringify(entry), { expirationTtl:NO_MATCH_RETENTION_SECONDS }); }
      catch { onDiagnostic('cacheWriteFailed'); }
      return entry;
    }
  };
}

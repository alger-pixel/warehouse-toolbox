import { retryAfterMs, withUpstreamRetry } from '../../utils/upstream-retry.js';
import { createEnrichmentCache, normalizeSn, snCacheFreshness, tinecoSnCacheKey } from '../cache/enrichment-cache.js';

export const SN_LOOKUP_CONCURRENCY = 3;
export const SN_LOOKUP_TIMEOUT_MS = 8000;
export const SN_RATE_LIMIT_CIRCUIT_THRESHOLD = 3;
const singleFlight = new Map();
const clean = value => typeof value === 'string' ? value.trim() : '';
const result = (status, reason = null, model = null, icssStatus = null, extra = {}) => ({ status, reason, model, icssStatus, modelStatus:status, icssStatusStatus:status, ...extra });
class SnLookupError extends Error { constructor(classification, retryable = false, retryAfter = null) { super('TINECO SN enrichment failed.'); Object.assign(this, { classification, retryable, retryAfterMs: retryAfter }); } }
const recordsFrom = payload => Array.isArray(payload?.data?.data?.records) ? payload.data.data.records : null;
const classificationFor = status => status === 408 ? ['timeout', true] : status === 429 ? ['rate_limited', true] : [500,502,503,504].includes(status) ? ['upstream_error', true] : [401,403].includes(status) ? ['auth_error', false] : status === 400 ? ['bad_request', false] : ['http_error', false];

export function createTinecoSnEnrichmentService(env, { fetchImpl = fetch, timeoutMs = SN_LOOKUP_TIMEOUT_MS, concurrency = SN_LOOKUP_CONCURRENCY, sleep, random, now = () => Date.now(), onDiagnostic = () => {}, cacheBinding = env?.TINECO_ENRICHMENT_CACHE } = {}) {
  const limit = Number.isSafeInteger(concurrency) && concurrency > 0 ? Math.min(concurrency, SN_LOOKUP_CONCURRENCY) : SN_LOOKUP_CONCURRENCY;
  let activeDiagnostic = null;
  const cache = createEnrichmentCache(cacheBinding, { onDiagnostic:event => { if (activeDiagnostic) activeDiagnostic[event]++; } });

  async function upstream(requestedSn) {
    const key = clean(env?.MKITE_WAREHOUSE_API_KEY), configuredUrl = clean(env?.MKITE_TINECO_API_URL);
    if (!key || !configuredUrl) return result('LOOKUP_FAILED', 'config_error');
    let url; try { url = new URL(configuredUrl); if (url.protocol !== 'https:' || url.username || url.password || url.hash) return result('LOOKUP_FAILED', 'config_error'); } catch { return result('LOOKUP_FAILED', 'config_error'); }
    let retries = 0;
    try {
      const value = await withUpstreamRetry(async () => {
        const controller = new AbortController(); let timer;
        try {
          const work = (async () => {
            let response;
            try { response = await fetchImpl(url.href, { method:'POST', redirect:'manual', signal:controller.signal, headers:{ 'Content-Type':'application/json', 'X-API-Key':key }, body:JSON.stringify({ newSnNo:requestedSn, pageNo:1, pageSize:20, sorts:[], timeZone:'Asia/Shanghai' }) }); }
            catch { throw new SnLookupError(controller.signal.aborted ? 'timeout' : 'network_error', true); }
            if (!response.ok || response.status >= 300 && response.status < 400) { const [classification,retryable] = classificationFor(response.status); throw new SnLookupError(classification, retryable, [429,503].includes(response.status) ? retryAfterMs(response.headers.get('Retry-After')) : null); }
            let payload; try { payload = await response.json(); } catch { throw new SnLookupError('malformed_response', true); }
            const records = recordsFrom(payload); if (!records) throw new SnLookupError('malformed_response', true);
            const match = records.find(record => clean(record?.newSnNo) === requestedSn);
            return match ? result('SUCCESS', null, clean(match.productName) || null, clean(match.stateName) || null) : result('NO_MATCH');
          })();
          return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new SnLookupError('timeout',true));},timeoutMs);})]);
        } finally { clearTimeout(timer); }
      }, { sleep, random, onRetry:() => { retries++; } });
      return { ...value, retries };
    } catch (error) { return { ...result('LOOKUP_FAILED', error.classification || 'lookup_failed'), retries, attempts:error.attempts || 1 }; }
  }

  async function refresh(sn, cacheKey) {
    if (singleFlight.has(cacheKey)) return singleFlight.get(cacheKey);
    const operation = (async () => {
      const value = await upstream(sn);
      if (value.status === 'SUCCESS') await cache.putSnSuccess(sn, value, now());
      else if (value.status === 'NO_MATCH') await cache.putSnNoMatch(sn, now());
      return value;
    })();
    singleFlight.set(cacheKey, operation);
    try { return await operation; } finally { if (singleFlight.get(cacheKey) === operation) singleFlight.delete(cacheKey); }
  }

  async function lookup(sn, { allowUpstream = true } = {}) {
    const requestedSn = normalizeSn(sn);
    if (!requestedSn) return result('NO_MATCH', null, null, null, { retries:0, source:'input' });
    const cached = await cache.getSn(requestedSn), freshness = snCacheFreshness(cached?.entry, now());
    if (cached?.entry.outcome === 'NO_MATCH' && freshness.negativeFresh) return result('NO_MATCH', null, null, null, { retries:0, source:'negative-cache' });
    if (cached?.entry.outcome === 'SUCCESS' && freshness.statusFresh && freshness.modelFresh) return result('SUCCESS', null, cached.entry.productName, cached.entry.stateName, { retries:0, source:'fresh-cache' });
    const stale = cached?.entry.outcome === 'SUCCESS' ? cached.entry : null;
    if (!allowUpstream) return staleResult(stale, freshness, 'circuit_open');
    const value = await refresh(requestedSn, cached?.key || await tinecoSnCacheKey(requestedSn));
    if (value.status !== 'LOOKUP_FAILED') return { ...value, source:cached ? 'refreshed-cache' : 'upstream' };
    return stale ? staleResult(stale, freshness, value.reason, value.retries) : { ...value, source:'upstream' };
  }

  function staleResult(entry, freshness, reason, retries = 0) {
    const model = freshness.modelUsable ? entry?.productName ?? null : null, icssStatus = freshness.statusUsable ? entry?.stateName ?? null : null;
    if (!freshness.modelUsable && !freshness.statusUsable) return result('LOOKUP_FAILED', reason, null, null, { retries, source:'upstream', refreshFailed:true });
    return { status:'SUCCESS', reason, model, icssStatus, modelStatus:freshness.modelUsable?'SUCCESS':'LOOKUP_FAILED', icssStatusStatus:freshness.statusUsable?'SUCCESS':'LOOKUP_FAILED', retries, source:'stale-cache', refreshFailed:true };
  }

  return { async enrich(rows) {
    const serials = [...new Set((Array.isArray(rows) ? rows : []).map(row => normalizeSn(row?.SN)).filter(Boolean))];
    const enrichment = new Map(), diagnostic={unique:serials.length,cacheHitFresh:0,cacheHitStale:0,cacheMiss:0,negativeHit:0,upstreamRequested:0,upstreamSuccess:0,upstreamNoMatch:0,upstreamRetried:0,staleServed:0,lookupFailed:0,cacheReadFailed:0,cacheWriteFailed:0,cacheInvalid:0,circuitOpen:false,reasons:{}};
    activeDiagnostic = diagnostic; let failFastReason = null, rateLimitedFailures = 0;
    function record(sn,value) {
      enrichment.set(sn,value);
      if (value.source === 'fresh-cache') diagnostic.cacheHitFresh++;
      else if (value.source === 'negative-cache') diagnostic.negativeHit++;
      else {
        if (value.source === 'stale-cache') { diagnostic.cacheHitStale++; diagnostic.staleServed++; }
        else diagnostic.cacheMiss++;
        if (!['fresh-cache','negative-cache'].includes(value.source) && value.reason !== 'circuit_open') diagnostic.upstreamRequested++;
      }
      diagnostic.upstreamRetried += value.retries || 0;
      if (['upstream','refreshed-cache'].includes(value.source) && value.status === 'SUCCESS') diagnostic.upstreamSuccess++;
      if (['upstream','refreshed-cache'].includes(value.source) && value.status === 'NO_MATCH') diagnostic.upstreamNoMatch++;
      if (value.status === 'LOOKUP_FAILED') { diagnostic.lookupFailed++; diagnostic.reasons[value.reason]=(diagnostic.reasons[value.reason]||0)+1; }
      if (value.reason === 'rate_limited' && value.source !== 'stale-cache') rateLimitedFailures++;
      if (['auth_error','config_error'].includes(value.reason)) failFastReason=value.reason;
    }
    try {
      for (let offset=0; offset<serials.length; offset+=limit) {
        const batch=serials.slice(offset,offset+limit),allowUpstream=!failFastReason&&rateLimitedFailures<SN_RATE_LIMIT_CIRCUIT_THRESHOLD;
        const values=await Promise.all(batch.map(sn=>lookup(sn,{allowUpstream})));
        batch.forEach((sn,index)=>record(sn,values[index]));
        if (rateLimitedFailures >= SN_RATE_LIMIT_CIRCUIT_THRESHOLD) diagnostic.circuitOpen=true;
      }
    }
    finally { activeDiagnostic = null; }
    onDiagnostic(diagnostic); return { enrichment, diagnostic };
  }, lookup };
}

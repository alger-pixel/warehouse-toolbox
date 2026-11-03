import { createEnrichmentCache, normalizeSn, tinecoLocationCacheKey } from '../cache/enrichment-cache.js';

export const LOCATION_LOOKUP_CONCURRENCY = 2;
export const LOCATION_RATE_LIMIT_CIRCUIT_THRESHOLD = 2;
const singleFlight = new Map();
const result = (status, locations = [], extra = {}) => ({ status, locations, ...extra });

export function createTinecoLocationEnrichmentService(warehouseInventory, env, { concurrency = LOCATION_LOOKUP_CONCURRENCY, now = () => Date.now(), onDiagnostic = () => {}, cacheBinding = env?.TINECO_ENRICHMENT_CACHE } = {}) {
  const limit = Number.isSafeInteger(concurrency) && concurrency > 0 ? Math.min(concurrency, LOCATION_LOOKUP_CONCURRENCY) : LOCATION_LOOKUP_CONCURRENCY;
  let activeDiagnostic = null;
  const cache = createEnrichmentCache(cacheBinding, { onDiagnostic:event => { if (activeDiagnostic) activeDiagnostic[event]++; } });

  async function upstream(sn) {
    try {
      const response = await warehouseInventory.lookup({ sku:sn, warehouseCode:'MKS66' },{ includeDiagnostic:true });
      const locations = [...new Set((response?.locations || []).map(row => String(row?.locationCode || '').trim()).filter(Boolean))];
      return result(locations.length ? 'RESOLVED' : 'LEGITIMATELY_EMPTY', locations, { source:'upstream', retries:response.retries || 0 });
    } catch (error) {
      return result(error?.retryable ? 'RETRYABLE_FAILURE' : 'TERMINAL_FAILURE', [], { source:'upstream', reason:error?.classification || 'lookup_failed', retries:Math.max(0,(error?.attempts || 1)-1) });
    }
  }

  async function lookup(value, { allowUpstream = true } = {}) {
    const sn = normalizeSn(value);
    if (!sn) return result('LEGITIMATELY_EMPTY', [], { source:'input', retries:0 });
    const cached = await cache.getLocation(sn, now());
    if (cached?.fresh) return result(cached.entry.outcome === 'SUCCESS' ? 'RESOLVED' : 'LEGITIMATELY_EMPTY', cached.entry.locations, { source:'fresh-cache', retries:0 });
    if(!allowUpstream)return cached?.entry?result(cached.entry.outcome==='SUCCESS'?'RESOLVED':'LEGITIMATELY_EMPTY',cached.entry.locations,{source:'stale-cache',retries:0,refreshFailed:true,reason:'circuit_open'}):result('RETRYABLE_FAILURE',[],{source:'circuit',retries:0,reason:'circuit_open'});
    const key = cached?.key || await tinecoLocationCacheKey(sn);
    if (singleFlight.has(key)) return singleFlight.get(key);
    const operation = (async () => {
      const value = await upstream(sn);
      if (['RESOLVED','LEGITIMATELY_EMPTY'].includes(value.status)) await cache.putLocation(sn, value.locations, now());
      if (!['RESOLVED','LEGITIMATELY_EMPTY'].includes(value.status)&&cached?.entry)return result(cached.entry.outcome==='SUCCESS'?'RESOLVED':'LEGITIMATELY_EMPTY',cached.entry.locations,{source:'stale-cache',retries:value.retries||0,refreshFailed:true,reason:value.reason});
      return value;
    })();
    singleFlight.set(key, operation);
    try { return await operation; } finally { if (singleFlight.get(key) === operation) singleFlight.delete(key); }
  }

  return { lookup, async enrich(rows) {
    const startedAt=Date.now();
    const serials = [...new Set((Array.isArray(rows) ? rows : []).map(row => normalizeSn(row?.SN)).filter(Boolean))];
    const enrichment = new Map(), diagnostic = { unique:serials.length, cacheHitFresh:0, cacheHitStale:0, staleServed:0, cacheMiss:0, upstreamRequested:0, upstreamSuccess:0, upstreamNoMatch:0, upstreamRetried:0, unresolved:0, cacheReadFailed:0, cacheWriteFailed:0, cacheInvalid:0, circuitOpen:false, reasons:{} };
    activeDiagnostic = diagnostic;let rateLimitedFailures=0;
    function record(sn,value){
        enrichment.set(sn,value);
        if (value.source === 'fresh-cache') diagnostic.cacheHitFresh++;
        else if(value.source === 'stale-cache'){diagnostic.cacheHitStale++;diagnostic.staleServed++;if(value.reason!=='circuit_open')diagnostic.upstreamRequested++;}
        else { diagnostic.cacheMiss++; if(value.source!=='circuit')diagnostic.upstreamRequested++; }
        if (value.status === 'RESOLVED') diagnostic.upstreamSuccess += value.source === 'upstream' ? 1 : 0;
        if (value.status === 'LEGITIMATELY_EMPTY') diagnostic.upstreamNoMatch += value.source === 'upstream' ? 1 : 0;
        diagnostic.upstreamRetried += value.retries || 0;
        if (!['RESOLVED','LEGITIMATELY_EMPTY'].includes(value.status)) { diagnostic.unresolved++; diagnostic.reasons[value.reason]=(diagnostic.reasons[value.reason]||0)+1; }
        if(value.reason==='rate_limited')rateLimitedFailures++;
    }
    try { for(let offset=0;offset<serials.length;offset+=limit){const batch=serials.slice(offset,offset+limit),allowUpstream=rateLimitedFailures<LOCATION_RATE_LIMIT_CIRCUIT_THRESHOLD,values=await Promise.all(batch.map(sn=>lookup(sn,{allowUpstream})));batch.forEach((sn,index)=>record(sn,values[index]));if(rateLimitedFailures>=LOCATION_RATE_LIMIT_CIRCUIT_THRESHOLD)diagnostic.circuitOpen=true;} }
    finally { activeDiagnostic = null; }
    diagnostic.durationMs=Date.now()-startedAt;onDiagnostic(diagnostic); return { enrichment, diagnostic };
  }};
}

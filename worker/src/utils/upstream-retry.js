export const MAX_UPSTREAM_ATTEMPTS = 3;
export const RETRY_AFTER_CAP_MS = 2000;
const BACKOFF_MS = [400, 1000];
const JITTER_MS = [100, 200];

export function retryAfterMs(value, { now = Date.now(), capMs = RETRY_AFTER_CAP_MS } = {}) {
  const raw = String(value || '').trim(); if (!raw) return null;
  const seconds = Number(raw), parsed = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(raw) - now);
  return Number.isFinite(parsed) ? Math.min(parsed, capMs) : null;
}

export function backoffMs(retryIndex, random = Math.random) {
  const index = Math.max(0, Math.min(BACKOFF_MS.length - 1, retryIndex));
  return Math.round(BACKOFF_MS[index] + (Math.max(0, Math.min(1, Number(random()) || 0)) * 2 - 1) * JITTER_MS[index]);
}

export async function withUpstreamRetry(operation, { attempts = MAX_UPSTREAM_ATTEMPTS, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random, onRetry = () => {} } = {}) {
  const total = Math.max(1, Math.min(MAX_UPSTREAM_ATTEMPTS, Number.isSafeInteger(attempts) ? attempts : MAX_UPSTREAM_ATTEMPTS));
  for (let attempt = 1; attempt <= total; attempt++) {
    try { return await operation(attempt); }
    catch (error) {
      if (!error?.retryable || attempt >= total) { error.attempts = attempt; throw error; }
      const delay = Number.isFinite(error.retryAfterMs) ? Math.min(Math.max(0, error.retryAfterMs), RETRY_AFTER_CAP_MS) : backoffMs(attempt - 1, random);
      onRetry({ attempt, delay, classification: error.classification || 'transient_error' }); await sleep(delay);
    }
  }
}

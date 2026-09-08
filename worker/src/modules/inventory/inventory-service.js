import { RECEIVING_FIELDS as F } from '../receiving/receiving-fields.js';
import { normalizeSku } from '../../utils/validation.js';
const text = value => Array.isArray(value) ? value.map(v => v.text || '').join('') : String(value ?? '').trim();
export class InventoryError extends Error { constructor(code, message) { super(message); this.code = code; } }
export function latestActivity(note) { return text(note).split(/\r?\n/).filter(line => line.trim()).at(-1)?.slice(0, 180) || ''; }
function dateKey(value, timezone) {
  if (value === '' || value == null) return '';
  const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function createInventoryService(config, records) {
  return { async search(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InventoryError('INVENTORY_SEARCH_REQUIRED', 'Enter at least one inventory filter.');
    const query = Object.fromEntries(['sku', 'clientId', 'location', 'status', 'receivedFrom', 'receivedTo', 'note'].map(key => [key, text(input[key])]));
    const batch = input.mode === 'batch';
    const lines = batch ? text(input.skus).split(/\r?\n/).map(v => v.trim()).filter(Boolean) : [];
    const unique = new Map(lines.map(v => [normalizeSku(v), v]));
    if (batch && !lines.length) throw new InventoryError('INVENTORY_SEARCH_REQUIRED', 'Enter at least one inventory filter.');
    if (lines.length > 500) throw new InventoryError('INVENTORY_BATCH_LIMIT', 'Paste at most 500 nonblank input lines.');
    for (const key of ['receivedFrom', 'receivedTo']) {
      const value = query[key];
      if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new InventoryError('INVALID_DATE_RANGE', 'Enter valid received dates.');
    }
    if (query.receivedFrom && query.receivedTo && query.receivedFrom > query.receivedTo) throw new InventoryError('INVALID_DATE_RANGE', 'Received From cannot be later than Received To.');
    const pageSize = input.pageSize === undefined ? 50 : Number(input.pageSize);
    const requestedPage = input.page === undefined ? 1 : Number(input.page);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 500 || !Number.isSafeInteger(requestedPage) || requestedPage < 1) throw new InventoryError('INVALID_PAGINATION', 'Use a positive page and a page size between 1 and 500.');
    // Reuse full pagination on the Worker. No fragile field projection or remote filter.
    const inventory = await records.listRecords({ appToken: config.appToken, tableId: config.packageTableId });
    let results = inventory.map(record => {
      const f = record.fields || {}, note = text(f[F.note]);
      return { recordId: record.record_id, sku: text(f[F.sku]), clientId: text(f[F.clientId]), location: text(f[F.location]), dateReceived: dateKey(f[F.receivedAt], config.warehouseTimeZone), status: text(f[F.status]), note, lastActivity: latestActivity(note) };
    });
    let matchMode = batch ? 'EXACT_BATCH' : 'FILTERS';
    if (batch) results = results.filter(r => unique.has(normalizeSku(r.sku)));
    else {
      results = results.filter(r => (!query.clientId || normalizeSku(r.clientId) === normalizeSku(query.clientId)) && (!query.location || normalizeSku(r.location).includes(normalizeSku(query.location))) && (!query.status || r.status === query.status) && (!query.note || normalizeSku(r.note).includes(normalizeSku(query.note))) && (!query.receivedFrom || (r.dateReceived && r.dateReceived >= query.receivedFrom)) && (!query.receivedTo || (r.dateReceived && r.dateReceived <= query.receivedTo)));
      if (query.sku) {
        const exact = results.filter(r => normalizeSku(r.sku) === normalizeSku(query.sku));
        matchMode = exact.length ? 'EXACT' : 'PARTIAL';
        results = exact.length ? exact : results.filter(r => normalizeSku(r.sku).includes(normalizeSku(query.sku)));
      }
    }
    const matched = new Set(results.map(r => normalizeSku(r.sku)));
    const summary = { found: results.length, active: 0, processing: 0, processed: 0, disposal: 0 };
    for (const r of results) if (['Active', 'Processing', 'Processed', 'Disposal'].includes(r.status)) summary[r.status.toLowerCase()]++;
    const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
    const page = Math.min(requestedPage, totalPages), offset = (page - 1) * pageSize;
    return { query, matchMode, summary, results: results.slice(offset, offset + pageSize), pagination: { page, pageSize, returnedCount: Math.min(pageSize, results.length - offset), totalMatched: results.length, totalPages, hasPrevious: page > 1, hasNext: page < totalPages }, ...(batch ? { batch: { input: lines.length, found: [...unique.keys()].filter(v => matched.has(v)).length, duplicateInput: lines.length - unique.size, notFound: [...unique].filter(([key]) => !matched.has(key)).map(([, value]) => value) } } : {}) };
  } };
}

import '../../../../js/shared/picking-parts.js';
import { json, errorResponse } from '../../utils/response.js';
const parts = globalThis.MkitePickingParts;
export const EXPORT_LIMIT = 1000;
const text = v => Array.isArray(v) ? v.map(p => p.text || '').join('') : String(v ?? '');
const norm = v => text(v).trim().toUpperCase();
export class PickingSearchError extends Error {}

export function parsePickingList(record) {
  const f = record.fields || {}, detail = text(f['PICKING LIST DETAIL']);
  const head = detail.split(/\n\[\d+\]/)[0];
  const field = (source, name) => source.split(/\r?\n/).find(l => l.startsWith(name + ': '))?.slice(name.length + 2) || '';
  const packages = detail.split(/\n\[\d+\]\r?\n/).slice(1).map(block => {
    let command = {};
    try { command = JSON.parse(field(block, 'COMMAND SNAPSHOT') || '{}'); } catch { /* Legacy text remains readable. */ }
    return { packageRecordId: field(block, 'PACKAGE ID'), trackingNumber: field(block, 'SKU'), finalSku: field(block, 'PUT AWAY SKU'), location: field(block, 'LOCATION'), commandRaw: typeof command.commandRaw === 'string' ? command.commandRaw : '', commandDisplay: typeof command.commandDisplay === 'string' ? command.commandDisplay : '', completedAt: '', actualParts: [] };
  });
  const warnings = [];
  for (const line of detail.split('\n').filter(l => l.startsWith('COMPLETION: '))) {
    try {
      const event = JSON.parse(line.slice(12));
      const matches = packages.filter(p => (!p.packageRecordId || p.packageRecordId === event.packageRecordId) && p.trackingNumber === event.trackingNumber);
      const row = matches.length === 1 ? matches[0] : null;
      if (row && typeof event.packageRecordId === 'string' && Number.isFinite(Date.parse(event.completedAt))) { row.packageRecordId = event.packageRecordId; row.completedAt = event.completedAt; }
    } catch { warnings.push('A completion entry could not be read.'); }
  }
  let usage = { packages: [] };
  try { usage = parts.parse(text(f['PART USED'])); } catch { warnings.push('PART USED format requires review; excluded from totals.'); }
  for (const entry of usage.packages) {
    const row = packages.find(p => p.packageRecordId === entry.packageRecordId && p.trackingNumber === entry.trackingNumber && p.completedAt === entry.confirmedAt);
    if (row) row.actualParts = entry.parts;
    else warnings.push('Usage without a matching confirmed completion was excluded.');
  }
  const cancelled = detail.split('\n').includes('STATUS: CANCELLED');
  const total = Number(field(head, 'PACKAGE COUNT')) || packages.length;
  const processed = packages.filter(p => p.completedAt).length;
  // Old text snapshots do not record completion: never infer current package status from creation.
  const status = cancelled ? 'Cancelled' : total && processed === total ? 'Completed' : processed ? 'Partially completed' : 'Completion unverified';
  const partSummary = parts.aggregate(packages.map(p => p.actualParts));
  const knownB044 = field(head, 'TOOL') === 'B044 SCAN PUT AWAY';
  return { recordId: record.record_id, pickingListNumber: text(f['PICKING LIST NUMBER']), createdAt: field(head, 'CREATED'), createdDate: field(head, 'CREATED').slice(0,10).replaceAll('/', '-'), warehouse: field(head, 'WAREHOUSE') || (knownB044 ? 'MKS66' : ''), clientId: field(head, 'CLIENT ID'), total, processed, remaining: total - processed, commandCount: packages.filter(p => p.commandRaw.trim()).length, hasParts: partSummary.length > 0, status, cancelledAt: field(detail, 'CANCELLED'), packages, partSummary, warnings: [...new Set(warnings)], completionNote: 'Counts reflect confirmed completion entries. Older lists may not contain completion history; remaining means not confirmed complete.' };
}
export function createPickingSearchService(config, records) {
  const args = { appToken: config.appToken, tableId: config.pickingListTableId };
  const check = () => { if (!args.tableId) throw new PickingSearchError('FEISHU_PICKING_LIST_TABLE_ID is not configured.'); };
  return {
    async detail(input = {}) {
      check();
      if (typeof input.recordId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.recordId)) throw new PickingSearchError('Select a Picking List.');
      const record = await records.getRecord({ ...args, recordId: input.recordId });
      if (!record.record_id) throw new PickingSearchError('Picking List not found.');
      return parsePickingList(record);
    },
    async search(input = {}) {
      check();
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PickingSearchError('Provide a filter object.');
      const query = Object.fromEntries(['pickingListNumber','createdFrom','createdTo','warehouse','clientId','trackingNumber','partSku','hasCommand','status'].map(k => [k, text(input[k]).trim()]));
      if (Object.values(query).some(v => v.length > 256)) throw new PickingSearchError('Filters must not exceed 256 characters.');
      for (const k of ['createdFrom','createdTo']) if (query[k] && (!/^\d{4}-\d{2}-\d{2}$/.test(query[k]) || !Number.isFinite(Date.parse(query[k])) || new Date(query[k]).toISOString().slice(0,10) !== query[k])) throw new PickingSearchError('Enter valid created dates.');
      if (query.createdFrom && query.createdTo && query.createdFrom > query.createdTo) throw new PickingSearchError('Created From cannot be later than Created To.');
      if (query.hasCommand && !['yes','no'].includes(query.hasCommand)) throw new PickingSearchError('Invalid Has Command filter.');
      if (!Number.isSafeInteger(input.page ?? 1) || (input.page ?? 1) < 1) throw new PickingSearchError('Invalid page number.');
      // Feishu is paginated by the existing record service, entirely within the Worker.
      const all = (await records.listRecords(args)).map(parsePickingList);
      const options = Object.fromEntries(['warehouse','clientId','status'].map(k => [k, [...new Set(all.map(r => r[k]).filter(Boolean))].sort()]));
      const contains = (v,q) => !q || norm(v).includes(norm(q));
      const filtered = all.filter(r => contains(r.pickingListNumber,query.pickingListNumber)
        && (!query.createdFrom || r.createdDate >= query.createdFrom)
        && (!query.createdTo || Boolean(r.createdDate) && r.createdDate <= query.createdTo)
        && (!query.warehouse || r.warehouse === query.warehouse)
        && (!query.clientId || r.clientId === query.clientId)
        && (!query.status || r.status === query.status)
        && (!query.hasCommand || (r.commandCount > 0) === (query.hasCommand === 'yes'))
        && (!query.trackingNumber || r.packages.some(p => contains(p.trackingNumber,query.trackingNumber)))
        && (!query.partSku || r.partSummary.some(p => contains(p.sku,query.partSku))))
        .sort((a,b) => b.createdAt.localeCompare(a.createdAt) || a.pickingListNumber.localeCompare(b.pickingListNumber) || a.recordId.localeCompare(b.recordId));
      if (input.export === true && filtered.length > EXPORT_LIMIT) throw new PickingSearchError(`Export maximum is ${EXPORT_LIMIT} Picking Lists. Narrow the filters; no partial export is returned.`);
      if (input.export === true && new TextEncoder().encode(JSON.stringify(filtered)).byteLength > 8000000) throw new PickingSearchError('Export exceeds the 8 MB safety limit. Narrow the filters; no partial export is returned.');
      const totalPages = Math.max(1,Math.ceil(filtered.length / 50)), page = Math.min(input.page || 1,totalPages);
      const summary = { found: filtered.length, packages: filtered.reduce((n,r) => n+r.total,0), processed: filtered.reduce((n,r) => n+r.processed,0), partsQuantity: filtered.reduce((n,r) => n+r.partSummary.reduce((m,p) => m+p.quantity,0),0) };
      return { options, summary, exportLimit: EXPORT_LIMIT, results: input.export === true ? filtered : filtered.slice((page-1)*50,page*50).map(({packages,partSummary,warnings,...r}) => r), pagination: { page, pageSize:50, totalMatched:filtered.length,totalPages,hasPrevious:page>1,hasNext:page<totalPages } };
    }
  };
}
export async function handlePickingSearch(action,service,input,id,request,env) {
  try { return json({ ok:true,data:await service[action](input) },200,request,env); }
  catch(e) { return errorResponse(e instanceof PickingSearchError ? 400 : 502,'PICKING_LIST_SEARCH_FAILED', e instanceof PickingSearchError ? e.message : 'Unable to load Picking Lists.', !(e instanceof PickingSearchError),id,request,env); }
}

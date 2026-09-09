import { cleanText, normalizeSku } from '../../utils/validation.js';
import { RECEIVING_FIELDS as F } from '../receiving/receiving-fields.js';
import { createPackageActivityService, PACKAGE_ACTION_TYPES as A } from '../../services/package-activity-service.js';
import { formatB044Detail, warehouseTimestamp } from './put-away-detail.js';
import { PickingListError } from '../picking-lists/picking-list-service.js';
export const MAX_ROWS = 500;
const fail = (code, message) => { throw new PickingListError(code, message); };
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function normalizeRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_ROWS) fail('INVALID_ROWS', `Provide 1–${MAX_ROWS} valid source rows per upload.`);
  const seen = new Set();
  return rows.map((raw, index) => {
    const row = {};
    for (const key of ['trackingNumber', 'arrivalDate', 'inboundSku', 'warehouseInboundOrder']) {
      row[key] = cleanText(key === 'trackingNumber' ? String(raw?.[key] ?? '') : raw?.[key]);
      if (!row[key] || row[key].length > 256 || /[\u0000-\u001f\u007f]/.test(row[key])) fail('INVALID_ROWS', `Invalid ${key} at row ${index + 1}.`);
    }
    const order = row.warehouseInboundOrder.match(/^(RMA|RV)([^-]+)-/i);
    if (!order || !order[2].trim()) fail('INVALID_ROWS', 'Unsupported warehouse order number.');
    row.clientId = order[2].trim().toUpperCase(); row.prefix = order[1].toUpperCase(); row.finalSku = `${row.clientId}-${row.inboundSku}`;
    row.normalizedTracking = normalizeSku(row.trackingNumber);
    if (seen.has(row.normalizedTracking)) fail('DUPLICATE_SOURCE_TRACKING', 'Duplicate source tracking numbers must be excluded before prepare.');
    seen.add(row.normalizedTracking); row.excelRow = Number.isInteger(raw.excelRow) && raw.excelRow > 0 ? raw.excelRow : index + 2; row.id = `row-${index + 1}`;
    return row;
  });
}
export function createB044PutAwayService(config, records, pickingLists, storage, options = {}) {
  const args = { appToken: config.appToken, tableId: config.packageTableId };
  const now = options.now || (() => Date.now());
  const activity = createPackageActivityService({ timeZone: config.warehouseTimeZone });
  function validateInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_INPUT', 'Provide a JSON object.');
  }
  async function prepare(input) {
    validateInput(input);
    const rows = normalizeRows(input.rows);
    const inventory = await records.listRecords({ ...args, fieldNames: Object.values(F) });
    const bySku = new Map();
    for (const record of inventory) { const key = normalizeSku(record.fields?.[F.sku]); if (!bySku.has(key)) bySku.set(key, []); bySku.get(key).push(record); }
    const classified = rows.map(row => {
      // Exact identities suppress partial fallback, including blocked exact identities.
      const exact = bySku.get(row.normalizedTracking) || [];
      const matches = exact.length ? exact : [...bySku.entries()]
        .filter(([sku]) => sku && (sku.includes(row.normalizedTracking) || row.normalizedTracking.includes(sku)))
        .flatMap(([, candidates]) => candidates);
      const active = matches.filter(record => record.fields?.[F.status] === 'Active');
      const matchType = exact.length ? 'EXACT' : matches.length ? 'PARTIAL' : 'NONE';
      const eligibility = !matches.length ? 'NOT_FOUND' : !active.length ? 'BLOCKED_STATUS' : active.length > 1 ? 'AMBIGUOUS' : 'ELIGIBLE';
      const record = eligibility === 'ELIGIBLE' ? active[0] : undefined;
      const fields = record?.fields || {};
      const packageStatus = record ? cleanText(fields[F.status]) : matches.map(r => cleanText(r.fields?.[F.status])).join(', ');
      // Operational identity must be the stored SKU, never the shortened/wrapped Excel query.
      // Keep the source value for auditing; downstream scan and lifecycle checks stay strict.
      return { ...row, sourceTrackingNumber: row.trackingNumber,
        ...(record ? { trackingNumber: cleanText(fields[F.sku]), normalizedTracking: normalizeSku(fields[F.sku]) } : {}),
        packageRecordId: record?.record_id || '', currentLocation: cleanText(fields[F.location]), packageStatus, eligibility, matchType,
        reason: eligibility === 'NOT_FOUND' ? 'NOT FOUND IN MKITE PACKAGE CLASS' : eligibility === 'AMBIGUOUS' ? `AMBIGUOUS ${matchType} MATCH — MULTIPLE ACTIVE PACKAGE RECORDS` : eligibility === 'BLOCKED_STATUS' ? `STATUS ${packageStatus || 'EMPTY'}` : '' };
    });
    // Different Excel queries can resolve to the same package. Do not assign it twice.
    const assignments = new Map();
    for (const row of classified.filter(row => row.eligibility === 'ELIGIBLE')) {
      if (!assignments.has(row.packageRecordId)) assignments.set(row.packageRecordId, []);
      assignments.get(row.packageRecordId).push(row);
    }
    for (const duplicates of assignments.values()) if (duplicates.length > 1) {
      for (const row of duplicates) Object.assign(row, { trackingNumber: row.sourceTrackingNumber, normalizedTracking: normalizeSku(row.sourceTrackingNumber), packageRecordId: '', eligibility: 'AMBIGUOUS', reason: 'MULTIPLE EXCEL ROWS MATCH THE SAME PACKAGE — MANUAL REVIEW REQUIRED' });
    }
    return { packages: classified, eligible: classified.filter(r => r.eligibility === 'ELIGIBLE'), exceptions: classified.filter(r => r.eligibility !== 'ELIGIBLE') };
  }
  async function validateStatusWrite(targetStatus) {
    options.onStage?.('CHECK_PACKAGE_SCHEMA');
    const fields = await records.listFields(args);
    const status = fields.find(f => f.field_name === F.status);
    if (status?.type !== 3) fail('PACKAGE_STATUS_SCHEMA_ERROR', 'PACKAGE CLASS STATUS must be a single-select field. No field options were changed.');
    if (!status.property?.options?.some(option => option.name === targetStatus)) fail(`${targetStatus.toUpperCase()}_STATUS_NOT_AVAILABLE`, `${targetStatus} is not available in PACKAGE CLASS STATUS. Configure this single-select value before retrying this operation.`);
  }
  function actionLine(row, pl, completed) {
    return activity.formatActivityLine(activity.createAction(completed ? A.B044_PUTAWAY_COMPLETED : A.B044_PUTAWAY_CREATED, { toolId: 'b044.put-away-scan', clientId: row.clientId, packageRecordId: row.packageRecordId, sku: row.trackingNumber, pickingListNumber: pl, fromStatus: completed ? 'Processing' : 'Active', toStatus: completed ? 'Processed' : 'Processing' }, now()));
  }
  function hasAction(note, pl, completed) { return String(note || '').split(/\r?\n/).some(line => line.endsWith(` - B044 SCAN PUT AWAY TOOL: PL NUMBER: ${pl} - ${completed ? 'DONE PUTTING AWAY' : 'CREATED'}`)); }
  async function transition(row, pl, completed) {
    const record = await records.getRecord({ ...args, recordId: row.packageRecordId }); const f = record.fields || {};
    if (record.record_id !== row.packageRecordId || normalizeSku(f[F.sku]) !== row.normalizedTracking) fail('PACKAGE_CHANGED', 'Package identity changed; operation blocked.');
    const target = completed ? 'Processed' : 'Processing', from = completed ? 'Processing' : 'Active';
    if (f[F.status] === target && hasAction(f[F.note], pl, completed)) return; // Recover an acknowledged or lost-response update without duplicate NOTE.
    if (f[F.status] !== from || (!completed && cleanText(f[F.location]) !== row.currentLocation) || (completed && !hasAction(f[F.note], pl, false))) fail('PACKAGE_CHANGED', `Package is no longer in the expected ${from} state/location for this Picking List.`);
    const note = activity.appendActivityNote(f[F.note], actionLine(row, pl, completed));
    await records.updateRecord({ ...args, recordId: row.packageRecordId, fields: { [F.status]: target, [F.note]: note } });
    const confirmed = await records.getRecord({ ...args, recordId: row.packageRecordId });
    if (confirmed.record_id !== row.packageRecordId || normalizeSku(confirmed.fields?.[F.sku]) !== row.normalizedTracking || confirmed.fields?.[F.status] !== target || confirmed.fields?.[F.note] !== note) fail('PACKAGE_UPDATE_UNCONFIRMED', 'Package identity, status and NOTE persistence were not all confirmed. Retry the same operation.');
  }
  function publicJob(job) {
    const error = job.error || (['blocked', 'persisting'].includes(job.phase) ? { code: 'PICKING_LIST_RESUME_REQUIRED', message: 'Previous persistence outcome requires inspection before resuming.', retryable: false } : job.failed?.length ? { code: 'PACKAGE_STATE_CONFLICT', message: 'Package assignment is incomplete. Retry the same operation after resolving the reported package failures.', retryable: true } : undefined);
    return { pickingListNumber: job.pickingListNumber, pickingListRecordId: job.pickingListRecordId, requestId: job.requestId, cancelledAt: job.cancelledAt, processedRetained: Object.values(job.cancelOutcomes || {}).filter(v => v === 'processedRetained').length, processingReturnedToActive: (job.cancelledIds || []).filter(id => !job.cancelOutcomes?.[id] || job.cancelOutcomes[id] === 'processingReturnedToActive').length, skipped: Object.values(job.cancelOutcomes || {}).filter(v => v === 'skipped').length, cancelPendingCount: job.phase === 'cancelling' ? job.rows.length - (job.cancelledIds || []).length : 0, createdAt: job.createdAt, metadata: job.metadata, operational: job.phase === 'operational', phase: job.phase, packages: job.rows || [], exceptions: job.exceptions || [], succeeded: job.succeeded || [], failed: job.failed || [], pendingCount: (job.rows || []).filter(r => !(job.succeeded || []).includes(r.packageRecordId)).length, message: job.message || '', error };
  }
  async function create(input) {
    options.onStage?.('VALIDATE_REQUEST');
    validateInput(input);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId || '')) fail('REQUEST_ID_REQUIRED', 'A stable creation request ID is required for safe retries.');
    const key = `job:${input.requestId}`;
    options.onStage?.('LOAD_OPERATION');
    let job = await storage.get(key);
    options.onStage?.('VALIDATE_SOURCE', { operationState: job?.phase || 'new' });
    const rows = normalizeRows(input.rows), fingerprint = JSON.stringify(rows);
    if (job && job.fingerprint !== fingerprint) fail('REQUEST_ID_CONFLICT', 'This creation request belongs to different source data.');
    if (job?.phase === 'blocked' || job?.phase === 'persisting') { options.onStage?.('RESUME_REQUIRES_INSPECTION'); return publicJob({ ...job, message: job.message || 'Creation outcome is uncertain. Scan is blocked; inspect Feishu and the creation request before proceeding.' }); }
    if (['operational', 'cancelling', 'cancelled'].includes(job?.phase)) { options.onStage?.('RETURN_EXISTING'); return publicJob(job); }
    await validateStatusWrite('Processing');
    if (!job) {
      options.onStage?.('RECHECK_ELIGIBILITY');
      const prepared = await prepare({ rows });
      options.onStage?.('CHECK_ELIGIBILITY', { eligibleCount: prepared.eligible.length });
      if (!prepared.eligible.length) fail('NO_ELIGIBLE_PACKAGES', 'No Active packages remain eligible. Refresh inventory matching.');
      options.onStage?.('CHECK_PACKAGE_RESERVATIONS');
      for (const row of prepared.eligible) {
        const owner = await storage.get(`reserved:${row.packageRecordId}`);
        if (owner && (await storage.get(`job:${owner}`))?.phase !== 'cancelled') fail('PACKAGE_RESERVED', 'A package already belongs to an in-progress or existing Picking List. Resume the original operation; do not create a new one.');
      }
      const createdAt = new Date(now()).toISOString();
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: config.warehouseTimeZone || 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(createdAt)).replaceAll('-', '');
      const pickingListNumber = await pickingLists.nextNumber('B044', date);
      const assigned = prepared.eligible.sort((a, b) => natural.compare(a.currentLocation, b.currentLocation) || natural.compare(a.trackingNumber, b.trackingNumber) || a.excelRow - b.excelRow).map((r, i) => ({ ...r, sequence: i + 1, pickingListNumber, createdAt }));
      job = { requestId: input.requestId, fingerprint, phase: 'persisting', pickingListNumber, createdAt, rows: assigned, exceptions: prepared.exceptions, succeeded: [], failed: [], metadata: { sourceFile: cleanText(input.sourceFile).slice(0, 256), totalSourceRows: Math.max(rows.length, Math.min(1000000, Number(input.totalSourceRows) || rows.length)), exceptionCount: prepared.exceptions.length } };
      // Reserve before external writes. Uncertain outcomes remain blocked rather than creating another PL.
      options.onStage?.('RESERVE_OPERATION', { operationState: 'persisting' });
      await storage.put(key, job);
      for (const row of assigned) await storage.put(`reserved:${row.packageRecordId}`, input.requestId);
      try {
        const master = await pickingLists.persist({ ...job, detailText: formatB044Detail(job, config.warehouseTimeZone) });
        Object.assign(job, master, { phase: 'assigning' });
        options.onStage?.('CHECKPOINT_MASTER', { operationState: 'assigning' });
        await storage.put(key, job); await storage.put(`pl:${pickingListNumber}`, key);
      } catch (error) {
        options.onStage?.(null, { operationState: 'blocked' });
        job.phase = 'blocked'; job.message = 'Picking List persistence failed or is unconfirmed. Packages were not assigned. Inspect Feishu before further creation.';
        job.error = { code: 'PICKING_LIST_PERSISTENCE_FAILED', message: job.message, retryable: false };
        await storage.put(key, job); return publicJob(job);
      }
    }
    job.failed = [];
    options.onStage?.('ASSIGN_PACKAGES', { operationState: 'assigning', eligibleCount: job.rows.length });
    // Bound each request; the same idempotent request advances the next chunk.
    for (const row of job.rows.filter(r => !job.succeeded.includes(r.packageRecordId)).slice(0, 8)) {
      try { await transition(row, job.pickingListNumber, false); job.succeeded.push(row.packageRecordId); }
      catch (error) { job.failed.push({ packageRecordId: row.packageRecordId, trackingNumber: row.trackingNumber, reason: error instanceof PickingListError ? error.message : 'Package update could not be confirmed. Retry the same operation.', code: error instanceof PickingListError ? error.code : 'FEISHU_ERROR' }); }
      await storage.put(key, job);
    }
    if (job.succeeded.length === job.rows.length) job.phase = 'operational';
    options.onStage?.('CHECKPOINT_ASSIGNMENT', { operationState: job.phase });
    await storage.put(key, job); return publicJob(job);
  }
  async function complete(input) {
    validateInput(input);
    const key = await storage.get(`pl:${cleanText(input.pickingListNumber)}`); const job = key && await storage.get(key);
    if (!job || job.phase !== 'operational' || input.pickingListRecordId !== job.pickingListRecordId) fail('PL_NOT_OPERATIONAL', 'Picking List is not operational.');
    const row = job.rows.find(r => r.packageRecordId === input.packageRecordId && r.normalizedTracking === normalizeSku(input.trackingNumber));
    if (!row) fail('PACKAGE_NOT_IN_PL', 'PACKAGE NOT IN THIS PICKING LIST');
    if (!cleanText(input.confirmationTracking) || normalizeSku(input.confirmationTracking) !== row.normalizedTracking) fail('WRONG_PACKAGE_CONFIRMATION', 'Scan the exact tracking number of the pending package to confirm printing.');
    await validateStatusWrite('Processed'); await transition(row, job.pickingListNumber, true);
    row.completedAt = row.completedAt || new Date(now()).toISOString();
    await storage.put(key, job);
    return { packageRecordId: row.packageRecordId, status: 'Processed', completedAt: row.completedAt, completed: job.rows.filter(r => r.completedAt).length, total: job.rows.length, pickingListComplete: job.rows.every(r => r.completedAt) };
  }
  async function cancel(input) {
    validateInput(input);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId || '')) fail('REQUEST_ID_REQUIRED', 'The original generation request ID is required.');
    const key = `job:${input.requestId}`, job = await storage.get(key);
    if (!job || job.pickingListNumber !== cleanText(input.pickingListNumber) || !job.pickingListRecordId) fail('PL_NOT_FOUND', 'Picking List does not match this operation.');
    if (job.phase === 'cancelled') return publicJob(job);
    if (!['operational', 'cancelling'].includes(job.phase)) fail('PL_NOT_OPERATIONAL', 'Finish or resolve generation before cancelling this Picking List.');
    await validateStatusWrite('Active');
    options.onStage?.('RECHECK_CANCEL_PACKAGES', { operationState: job.phase, eligibleCount: job.rows.length });
    // One paginated fresh inventory read checks the entire PL before any rollback.
    const inventory = await records.listRecords({ ...args, fieldNames: Object.values(F) });
    const byId = new Map(inventory.map(record => [record.record_id, record]));
    function verify(row, record) {
      const fields = record?.fields || {};
      if (record?.record_id !== row.packageRecordId || normalizeSku(fields[F.sku]) !== row.normalizedTracking) fail('PACKAGE_STATE_CONFLICT', 'An assigned package identity changed. Cancellation is blocked.');
      const lastAction = String(fields[F.note] || '').split(/\r?\n/).filter(line => line.includes(' - B044 SCAN PUT AWAY TOOL: PL NUMBER: ')).at(-1) || '';
      const suffix = ` - B044 SCAN PUT AWAY TOOL: PL NUMBER: ${job.pickingListNumber} - `;
      const rolledBack = job.phase === 'cancelling' && fields[F.status] === 'Active' && lastAction.endsWith(suffix + 'CANCELLED');
      if (rolledBack) return 'processingReturnedToActive';
      if (!['Processing', 'Processed'].includes(fields[F.status])) return 'skipped';
      if (!lastAction.endsWith(suffix + 'CREATED') && !(fields[F.status] === 'Processed' && lastAction.endsWith(suffix + 'DONE PUTTING AWAY'))) fail('PACKAGE_STATE_CONFLICT', 'An assigned package Picking List ownership changed. Cancellation is blocked.');
      return fields[F.status] === 'Processed' ? 'processedRetained' : 'rollback';
    }
    for (const row of job.rows) {
      if (await storage.get(`reserved:${row.packageRecordId}`) !== input.requestId) fail('PACKAGE_STATE_CONFLICT', 'Package reservation belongs to another operation.');
      verify(row, byId.get(row.packageRecordId));
    }
    job.phase = 'cancelling'; job.cancelledAt ||= new Date(now()).toISOString(); job.cancelledIds ||= []; job.cancelOutcomes ||= {};
    await storage.put(key, job); // Blocks all subsequent completion requests before rollback.
    options.onStage?.('ROLLBACK_PACKAGES', { operationState: job.phase });
    for (const row of job.rows.filter(row => !job.cancelledIds.includes(row.packageRecordId)).slice(0, 8)) {
      const current = await records.getRecord({ ...args, recordId: row.packageRecordId });
      const outcome = verify(row, current);
      if (outcome === 'rollback') {
        const action = activity.createAction(A.B044_PUTAWAY_CANCELLED, { toolId: 'b044.put-away-scan', clientId: row.clientId, packageRecordId: row.packageRecordId, sku: row.trackingNumber, pickingListNumber: job.pickingListNumber, fromStatus: 'Processing', toStatus: 'Active' }, job.cancelledAt);
        const note = activity.appendActivityNote(current.fields[F.note], activity.formatActivityLine(action));
        await records.updateRecord({ ...args, recordId: row.packageRecordId, fields: { [F.status]: 'Active', [F.note]: note } });
        const confirmed = await records.getRecord({ ...args, recordId: row.packageRecordId });
        if (verify(row, confirmed) !== 'processingReturnedToActive' || confirmed.fields[F.note] !== note) fail('PACKAGE_UPDATE_UNCONFIRMED', 'Cancellation update was not confirmed. Retry the same cancellation.');
      }
      job.cancelOutcomes[row.packageRecordId] = outcome === 'rollback' ? 'processingReturnedToActive' : outcome;
      job.cancelledIds.push(row.packageRecordId); await storage.put(key, job);
    }
    if (job.cancelledIds.length === job.rows.length) {
      options.onStage?.('CANCEL_MASTER');
      const summary = publicJob(job);
      await pickingLists.appendLifecycle(job, `STATUS: CANCELLED\nCANCELLED: ${warehouseTimestamp(job.cancelledAt, config.warehouseTimeZone)}\nProcessed packages retained: ${summary.processedRetained}\nProcessing packages returned to Active: ${summary.processingReturnedToActive}\nSkipped/unexpected status packages: ${summary.skipped}`);
      job.phase = 'cancelled'; job.error = undefined; job.message = 'PICKING LIST CANCELLED';
      await storage.put(key, job);
    }
    return publicJob(job);
  }
  return { prepare, create, complete, cancel };
}

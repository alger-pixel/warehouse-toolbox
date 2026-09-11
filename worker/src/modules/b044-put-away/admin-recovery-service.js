import { PickingListError } from '../picking-lists/picking-list-service.js';
import { warehouseTimestamp } from './put-away-detail.js';
import { normalizeSku } from '../../utils/validation.js';
import '../../../../js/shared/picking-parts.js';
const fail = message => { throw new PickingListError('ADMIN_RECOVERY_BLOCKED', message); };
const text = value => Array.isArray(value) ? value.map(p => p.text || '').join('') : String(value ?? '');
export async function recoverBrokenPickingList(input, config, records, storage, now) {
  const number = input.pickingListNumber;
  if (typeof number !== 'string' || !number || !input.pickingListRecordId) fail('Select a persisted Picking List.');
  const key = await storage.get(`pl:${number}`), job = key && await storage.get(key);
  if (!job || job.pickingListRecordId !== input.pickingListRecordId || job.pickingListNumber !== number) fail('Original assignment/reservation state is missing. Manual review required.');
  const pa = { appToken: config.appToken, tableId: config.packageTableId }, la = { appToken: config.appToken, tableId: config.pickingListTableId };
  const master = await records.getRecord({ ...la, recordId: job.pickingListRecordId });
  if (master.record_id !== job.pickingListRecordId || text(master.fields?.['PICKING LIST NUMBER']) !== number) fail('Picking List identity changed.');
  if (job.adminRecovery?.done && job.phase === 'operational') return { ...job, packages: job.rows, operational: true, recovered: true };
  if (!['operational','admin-recovering'].includes(job.phase)) fail('Only broken operational Picking Lists may be recovered.');
  let plan = job.adminRecovery;
  if (!plan) {
    let usage;
    try { usage = globalThis.MkitePickingParts.parse(text(master.fields['PART USED'])); } catch { fail('PART USED is ambiguous. Manual review required.'); }
    if (usage.packages.length) fail('Confirmed usage exists. Recovery will not erase valid or ambiguous history.');
    const schema = await records.listFields(pa);
    if (!schema.find(f => f.field_name === 'STATUS')?.property?.options?.some(o => o.name === 'Processing')) fail('Processing status is unavailable.');
    const affected = [], snapshots = [];
    for (const row of job.rows) {
      if (await storage.get(`reserved:${row.packageRecordId}`) !== job.requestId) fail('Package reservation belongs to another operation.');
      const record = await records.getRecord({ ...pa, recordId: row.packageRecordId });
      const note = text(record.fields?.NOTE), status = record.fields?.STATUS;
      const last = note.split(/\r?\n/).filter(l => l.includes(' - B044 SCAN PUT AWAY TOOL: PL NUMBER: ')).at(-1) || '';
      const suffix = ` - B044 SCAN PUT AWAY TOOL: PL NUMBER: ${number} - `;
      if (record.record_id !== row.packageRecordId || normalizeSku(record.fields?.SKU) !== row.normalizedTracking || !['Processing','Processed'].includes(status) || !last.endsWith(suffix + (status === 'Processed' ? 'DONE PUTTING AWAY' : 'CREATED'))) fail('Package ownership/status is ambiguous or belongs to another PL.');
      if (row.completedAt && row.completionIntent) fail('A fully confirmed completion exists. Recovery is restricted to incomplete test completions.');
      snapshots.push({ id: row.packageRecordId, tracking: row.normalizedTracking, status, note });
      if (status === 'Processed') {
        if (!row.commandRaw) fail('A normal Processed package is not a broken parts completion.');
        affected.push(row.packageRecordId);
      }
    }
    if (!affected.length) fail('Healthy Picking List: no incomplete Processed packages.');
    const stamp = warehouseTimestamp(new Date(now()).toISOString(), config.warehouseTimeZone);
    const detail = text(master.fields['PICKING LIST DETAIL']);
    const removed = [];
    const cleaned = detail.split('\n').filter(line => {
      if (!line.startsWith('COMPLETION: ')) return true;
      let entry; try { entry = JSON.parse(line.slice(12)); } catch { fail('Malformed completion history.'); }
      if (!affected.includes(entry.packageRecordId)) return true;
      removed.push(line); return false;
    }).join('\n');
    plan = { affected, snapshots, beforeDetail: detail, beforeParts: text(master.fields['PART USED']), afterDetail: cleaned + '\nADMIN RECOVERY: ' + stamp + ' Reverted broken B044 PL state for ' + number + '\nRECOVERY AUDIT: ' + JSON.stringify({ affected, removedCompletionMarkers: removed }), stamp };
  }
  if (input.confirm !== true) return { eligible: true, pickingListNumber: number, affectedCount: plan.affected.length };
  if (input.confirmPickingListNumber !== number) fail('Type the exact Picking List number to confirm administrative test recovery.');
  // Persist an immutable plan before external writes. Retrying accepts only before/after snapshots.
  if (!job.adminRecovery) { job.adminRecovery = plan; job.phase = 'admin-recovering'; await storage.put(key, job); }
  const afterNote = snap => snap.note + `\n${plan.stamp} ADMIN RECOVERY: Reverted broken B044 PL state for ${number}\n${plan.stamp} - B044 SCAN PUT AWAY TOOL: PL NUMBER: ${number} - CREATED`;
  // Check every record and master before resuming any mutation.
  for (const snap of plan.snapshots) {
    const r = await records.getRecord({ ...pa, recordId: snap.id });
    const affected = plan.affected.includes(snap.id);
    if (await storage.get(`reserved:${snap.id}`) !== job.requestId || r.record_id !== snap.id || normalizeSku(r.fields?.SKU) !== snap.tracking || !((r.fields.STATUS === snap.status && text(r.fields.NOTE) === snap.note) || (affected && r.fields.STATUS === 'Processing' && text(r.fields.NOTE) === afterNote(snap)))) fail('Package changed during recovery. Stop for manual review.');
  }
  if (![plan.beforeDetail,plan.afterDetail].includes(text(master.fields['PICKING LIST DETAIL'])) || text(master.fields['PART USED']) !== plan.beforeParts) fail('Picking List history changed during recovery.');
  for (const snap of plan.snapshots.filter(s => plan.affected.includes(s.id))) {
    const current = await records.getRecord({ ...pa, recordId: snap.id });
    if (current.record_id !== snap.id || normalizeSku(current.fields?.SKU) !== snap.tracking || !((current.fields.STATUS === snap.status && text(current.fields.NOTE) === snap.note) || (current.fields.STATUS === 'Processing' && text(current.fields.NOTE) === afterNote(snap)))) fail('Package changed before recovery write.');
    if (current.fields.STATUS !== 'Processing' || text(current.fields.NOTE) !== afterNote(snap)) await records.updateRecord({ ...pa, recordId: snap.id, fields: { STATUS: 'Processing', NOTE: afterNote(snap) } });
    const verified = await records.getRecord({ ...pa, recordId: snap.id });
    if (verified.fields.STATUS !== 'Processing' || text(verified.fields.NOTE) !== afterNote(snap)) fail('Package recovery not confirmed. Retry administrative recovery.');
  }
  const latestMaster = await records.getRecord({ ...la, recordId: job.pickingListRecordId });
  if (text(latestMaster.fields['PICKING LIST NUMBER']) !== number || ![plan.beforeDetail,plan.afterDetail].includes(text(latestMaster.fields['PICKING LIST DETAIL'])) || text(latestMaster.fields['PART USED']) !== plan.beforeParts) fail('Picking List changed before audit write.');
  if (text(latestMaster.fields['PICKING LIST DETAIL']) !== plan.afterDetail) await records.updateRecord({ ...la, recordId: job.pickingListRecordId, fields: { 'PICKING LIST DETAIL': plan.afterDetail } });
  const verified = await records.getRecord({ ...la, recordId: job.pickingListRecordId });
  if (text(verified.fields['PICKING LIST DETAIL']) !== plan.afterDetail || text(verified.fields['PART USED']) !== plan.beforeParts) fail('Recovery audit not confirmed. Retry administrative recovery.');
  for (const row of job.rows) {
    const current = await records.getRecord({ ...pa, recordId: row.packageRecordId });
    if (current.fields.STATUS !== 'Processing') fail('A package changed before recovery finished.');
    delete row.completedAt; delete row.completionIntent; delete row.actualParts;
    row.packageStatus = 'Processing'; row.reconciliationRequired = false; row.partsPersisted = false;
  }
  job.adminRecovery.done = true; job.phase = 'operational'; await storage.put(key, job);
  return { ...job, packages: job.rows, operational: true, recovered: true };
}

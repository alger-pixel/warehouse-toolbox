import '../../../../js/shared/picking-parts.js';
import { PICKING_LIST_FIELDS as F } from './picking-list-fields.js';
import { FeishuRecordError } from '../../services/feishu-record-service.js';
import { FeishuAuthError } from '../../services/feishu-auth-service.js';
export class PickingListError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export class PickingListNumberLookupError extends PickingListError {
  constructor(error) {
    super('PICKING_LIST_NUMBER_LOOKUP_FAILED', 'Unable to read Picking List records. Retry the same operation.');
    const metadata = { service: 'feishu-record-service', action: 'listRecords', tableRole: 'PICKING_LIST_CLASS' };
    if (error instanceof FeishuRecordError) {
      metadata.downstreamCode = error.feishuCode;
      metadata.failureType = error.errorType;
      if (typeof error.feishuCode === 'number') metadata.feishuCode = error.feishuCode;
      if (error.httpStatus !== undefined) metadata.downstreamHttpStatus = error.httpStatus;
    } else {
      metadata.failureType = error instanceof FeishuAuthError ? 'FEISHU_AUTH_ERROR' : 'UNEXPECTED_LOOKUP_ERROR';
    }
    this.diagnostics = Object.freeze(metadata);
  }
}
// Bitable reads may represent a text cell as text segments instead of a string.
function textValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(part => typeof part?.text === 'string')) return value.map(part => part.text).join('');
  return null;
}
export function createPickingListService(config, records, options = {}) {
  const args = { appToken: config.appToken, tableId: config.pickingListTableId };
  function configured() { if (!args.tableId) throw new PickingListError('PICKING_LIST_NOT_CONFIGURED', 'Set FEISHU_PICKING_LIST_TABLE_ID before creating Picking Lists.'); }
  return {
    async nextNumber(prefix, date) {
      options.onStage?.('ALLOCATE_PL_NUMBER');
      configured();
      let existing;
      try { existing = await records.listRecords({ ...args, fieldNames: [F.number] }); }
      catch (error) { throw new PickingListNumberLookupError(error); }
      const used = new Set(existing.map(r => (textValue(r.fields?.[F.number]) || '').trim()));
      for (let i = 1; i <= 9999; i++) {
        const suffix = options.randomId ? options.randomId() : String(i).padStart(4, '0');
        const number = `${prefix}-PL-${date}-${suffix}`;
        if (!used.has(number)) return number;
      }
      throw new PickingListError('PL_NUMBER_COLLISION', 'Unable to allocate a unique Picking List number.');
    },
    async persist(model) {
      configured();
      if (typeof model.detailText !== 'string' || !model.detailText.trim()) throw new PickingListError('INVALID_PL_DETAIL', 'Picking List detail text is required.');
      const fields = { [F.number]: model.pickingListNumber, [F.detail]: model.detailText };
      options.onStage?.('PERSIST_MASTER');
      const created = await records.createRecord({ ...args, fields });
      if (!created.record_id) throw new PickingListError('PL_PERSISTENCE_UNCONFIRMED', 'Picking List creation was not confirmed. Inspect Feishu before retrying.');
      options.onStage?.('REREAD_MASTER');
      const confirmed = await records.getRecord({ ...args, recordId: created.record_id });
      if (textValue(confirmed.fields?.[F.number]) !== model.pickingListNumber || textValue(confirmed.fields?.[F.detail]) !== model.detailText) throw new PickingListError('PL_PERSISTENCE_UNCONFIRMED', 'Picking List text persistence was not confirmed. Packages have not been assigned.');
      return { pickingListRecordId: created.record_id, pickingListNumber: model.pickingListNumber };
    },
    async completionFields(model, row, intent) {
      configured();
      options.onStage?.('BUILD_PART_USED', { operationState: 'reconciling' });
      if (row.commandRaw) {
        const schema = await records.listFields(args);
        if (schema.find(f => f.field_name === F.parts)?.type !== 1) throw new PickingListError('PART_USED_SCHEMA_ERROR', 'PICKING LIST CLASS requires PART USED as a Text field before completing commanded packages.');
      }
      const record = await records.getRecord({ ...args, recordId: model.pickingListRecordId });
      if (textValue(record.fields?.[F.number]) !== model.pickingListNumber || textValue(record.fields?.[F.detail]) === null) throw new PickingListError('PL_MASTER_CHANGED', 'Picking List master identity or detail changed.');
      const original = textValue(record.fields[F.detail]);
      const event = 'COMPLETION: ' + JSON.stringify({ packageRecordId: row.packageRecordId, trackingNumber: row.trackingNumber, completedAt: intent.confirmedAt });
      const fields = { [F.detail]: original.split('\n').includes(event) ? original : original + '\n' + event };
      if (row.commandRaw) {
        let usage;
        try {
          const value = record.fields[F.parts], stored = textValue(value);
          if (value != null && stored === null) throw new Error('Unexpected text value');
          usage = globalThis.MkitePickingParts.parse(stored);
        }
        catch { throw new PickingListError('PART_USED_FORMAT_ERROR', 'Existing PART USED cannot be safely merged. Manual review required.'); }
        const entry = { packageRecordId: row.packageRecordId, trackingNumber: row.trackingNumber, finalSku: row.finalSku, requestId: intent.requestId, status: 'CONFIRMED', confirmedAt: intent.confirmedAt, parts: intent.parts };
        const existing = usage.packages.find(p => p.packageRecordId === row.packageRecordId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(entry)) throw new PickingListError('PART_USED_CONFLICT', 'This package already has different confirmed usage.');
        if (!existing) usage.packages.push(entry);
        fields[F.parts] = JSON.stringify(usage);
      }
      if (Object.values(fields).some(v => v.length > 90000)) throw new PickingListError('PL_TEXT_LIMIT', 'Picking List text exceeds the safe 90,000 character limit. Manual review required.');
      options.onStage?.('PART_USED_BUILT', { partsPayloadExists: Object.hasOwn(fields, F.parts), plRecordFound: true });
      return fields;
    },
    async completionMatches(model, fields) {
      const record = await records.getRecord({ ...args, recordId: model.pickingListRecordId });
      if (textValue(record.fields?.[F.number]) !== model.pickingListNumber) throw new PickingListError('PL_MASTER_CHANGED', 'Picking List identity changed.');
      return Object.entries(fields).every(([key, value]) => textValue(record.fields?.[key]) === value);
    },
    async persistCompletion(model, fields) {
      // Called only after authoritative PACKAGE CLASS Processed acknowledgement.
      const current = await records.getRecord({ ...args, recordId: model.pickingListRecordId });
      if (textValue(current.fields?.[F.number]) !== model.pickingListNumber) throw new PickingListError('PL_MASTER_CHANGED', 'Picking List identity changed.');
      if (Object.entries(fields).some(([k,v]) => textValue(current.fields?.[k]) !== v)) {
        options.onStage?.('WRITE_PL_COMPLETION', { plUpdateAttempted: true });
        await records.updateRecord({ ...args, recordId: model.pickingListRecordId, fields });
      }
      options.onStage?.('VERIFY_PL_COMPLETION');
      const confirmed = await records.getRecord({ ...args, recordId: model.pickingListRecordId });
      if (Object.entries(fields).some(([k,v]) => textValue(confirmed.fields?.[k]) !== v)) throw new PickingListError('PL_PERSISTENCE_UNCONFIRMED', 'Completion / parts persistence not confirmed. Retry the same final scan.');
      options.onStage?.('PL_COMPLETION_CONFIRMED', { operationState: 'confirmed' });
    },
    async appendLifecycle(model, lifecycleText) {
      configured();
      const record = await records.getRecord({ ...args, recordId: model.pickingListRecordId });
      if (textValue(record.fields?.[F.number]) !== model.pickingListNumber || textValue(record.fields?.[F.detail]) === null) throw new PickingListError('PL_MASTER_CHANGED', 'Picking List master identity or detail type changed.');
      const original = textValue(record.fields[F.detail]);
      const detail = original.endsWith(lifecycleText) ? original : `${original}\n\n${lifecycleText}`;
      if (detail !== original) await records.updateRecord({ ...args, recordId: model.pickingListRecordId, fields: { [F.detail]: detail } });
      const confirmed = await records.getRecord({ ...args, recordId: model.pickingListRecordId });
      if (textValue(confirmed.fields?.[F.number]) !== model.pickingListNumber || textValue(confirmed.fields?.[F.detail]) !== detail) throw new PickingListError('PL_PERSISTENCE_UNCONFIRMED', 'Picking List lifecycle update was not confirmed. Retry the same cancellation.');
    }
  };
}

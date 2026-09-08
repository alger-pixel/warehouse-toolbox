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

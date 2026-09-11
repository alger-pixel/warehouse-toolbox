import { managementAuthorized } from '../users/user-controller.js';
import { getFeishuConfig } from '../../config/feishu-config.js';
import { createFeishuAuthService } from '../../services/feishu-auth-service.js';
import { createFeishuRecordService } from '../../services/feishu-record-service.js';
import { createPickingListService } from '../picking-lists/picking-list-service.js';
import { createB044PutAwayService } from './put-away-service.js';
import { PickingListError, PickingListNumberLookupError } from '../picking-lists/picking-list-service.js';
// One Durable Object per Base: serializes B044 assignments, identity allocation and completions.
// Durable checkpoints survive restarts; the promise queue only serializes live requests.
export class B044PutAwayCoordinator {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; this.tail = Promise.resolve(); }
  fetch(request) {
    const run = this.tail.then(() => this.handle(request));
    this.tail = run.catch(() => {}); return run;
  }
  async handle(request) {
    const recovery = new URL(request.url).pathname === '/admin-recover';
    if (recovery && !await managementAuthorized(request, this.env)) return Response.json({ ok: false, error: { code: 'ADMIN_KEY_REQUIRED', message: 'Administration authorization required.' } }, { status: 401 });
    const reconcile = new URL(request.url).pathname.endsWith('/reconcile');
    const complete = new URL(request.url).pathname.endsWith('complete-package');
    const cancel = new URL(request.url).pathname.endsWith('cancel-picking-list');
    // Correlation IDs are server-generated UUIDs, never arbitrary input in logs.
    const forwardedId = request.headers.get('X-Request-ID');
    const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forwardedId || '') ? forwardedId : crypto.randomUUID();
    const diagnostic = { route: recovery ? 'b044-admin-recover' : reconcile ? 'b044-reconcile' : complete ? 'b044-complete' : cancel ? 'b044-cancel' : 'b044-create', requestId, stage: 'CONFIGURE', operationState: 'unknown' };
    const onStage = (stage, metadata = {}) => {
      if (stage) diagnostic.stage = stage;
      for (const key of ['partsPayloadExists', 'plRecordFound', 'plUpdateAttempted']) if (typeof metadata[key] === 'boolean') diagnostic[key] = metadata[key];
      if (metadata.operationState) diagnostic.operationState = metadata.operationState;
      if (Number.isInteger(metadata.eligibleCount)) diagnostic.eligibleCount = metadata.eligibleCount;
    };
    try {
      const config = getFeishuConfig(this.env), auth = createFeishuAuthService(config), records = createFeishuRecordService(auth);
      const pickingLists = createPickingListService(config, records, { onStage });
      const service = createB044PutAwayService(config, records, pickingLists, this.ctx.storage, { onStage });
      onStage('READ_REQUEST');
      const input = await request.json();
      const data = await (recovery ? service.adminRecover(input) : reconcile ? service.reconcile(input) : complete ? service.complete(input) : cancel ? service.cancel(input) : service.create(input));
      if (data.error) Object.assign(data.error, { stage: diagnostic.stage, operationState: diagnostic.operationState });
      console.log(JSON.stringify({ ...diagnostic, event: data.operational === false ? 'picking_list_not_operational' : 'picking_list_result', code: data.error?.code || 'OK', status: 200 }));
      return Response.json({ ok: true, data, requestId });
    } catch (error) {
      const known = error instanceof PickingListError;
      const lookupFailure = error instanceof PickingListNumberLookupError;
      const conflict = known && !lookupFailure;
      const code = known ? error.code : 'B044_OPERATION_FAILED', status = conflict ? 409 : 502;
      console.error(JSON.stringify({ ...diagnostic, ...(lookupFailure ? error.diagnostics : {}), event: lookupFailure ? 'picking_list_number_lookup_failed' : conflict ? 'picking_list_conflict' : 'picking_list_failure', code, status }));
      return Response.json({ ok: false, requestId, error: { code, message: known ? error.message : 'Operation could not be confirmed. Retry the same request; do not start another Picking List.', retryable: !conflict, stage: diagnostic.stage, operationState: diagnostic.operationState } }, { status });
    }
  }
}

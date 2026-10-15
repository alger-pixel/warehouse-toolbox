import { managementAuthorized } from '../users/user-controller.js';
import { getFeishuConfig } from '../../config/feishu-config.js';
import { createFeishuAuthService } from '../../services/feishu-auth-service.js';
import { createFeishuRecordService } from '../../services/feishu-record-service.js';
import { createPickingListService } from '../picking-lists/picking-list-service.js';
import { createB044PutAwayService, normalizeRows } from './put-away-service.js';
import { PickingListError, PickingListNumberLookupError } from '../picking-lists/picking-list-service.js';
import { createPartUsedCoordinatorClient } from '../part-used/part-used-coordinator.js';
import { b044LocalTestConfig, createB044LocalPartUsedService, createB044LocalTestRecordService, isB044LocalTestMode } from './local-test-data.js';
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
    const pathname = new URL(request.url).pathname;
    const diagnoseReconciliation = pathname.endsWith('/reconcile/diagnose');
    const executeReconciliation = pathname.endsWith('/reconcile/execute');
    const reconcile = pathname.endsWith('/reconcile');
    const recover = new URL(request.url).pathname.endsWith('/recover');
    const start = new URL(request.url).pathname.endsWith('/start-process');
    const complete = new URL(request.url).pathname.endsWith('complete-package');
    const cancel = new URL(request.url).pathname.endsWith('cancel-picking-list');
    const prepare = pathname.endsWith('/prepare');
    const localTestReset = pathname.endsWith('/local-test/reset');
    // Correlation IDs are server-generated UUIDs, never arbitrary input in logs.
    const forwardedId = request.headers.get('X-Request-ID');
    const requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(forwardedId || '') ? forwardedId : crypto.randomUUID();
    const diagnostic = { route: recovery ? 'b044-admin-recover' : recover ? 'b044-recover' : diagnoseReconciliation ? 'b044-reconcile-diagnose' : executeReconciliation ? 'b044-reconcile-execute' : reconcile ? 'b044-reconcile' : start ? 'b044-start' : complete ? 'b044-complete' : cancel ? 'b044-cancel' : 'b044-create', requestId, stage: 'CONFIGURE', operationState: 'unknown' };
    const onStage = (stage, metadata = {}) => {
      if (stage) diagnostic.stage = stage;
      for (const key of ['partsPayloadExists', 'plRecordFound', 'plUpdateAttempted']) if (typeof metadata[key] === 'boolean') diagnostic[key] = metadata[key];
      if (metadata.operationState) diagnostic.operationState = metadata.operationState;
      if (Number.isInteger(metadata.eligibleCount)) diagnostic.eligibleCount = metadata.eligibleCount;
    };
    try {
      if (localTestReset) {
        if (!isB044LocalTestMode(this.env)) throw new Error('B044 local test reset is unavailable.');
        await this.ctx.storage.deleteAll();
        return Response.json({ ok:true, data:{ reset:true, scope:'B044_LOCAL_TEST_ONLY' }, requestId });
      }
      const localTest = isB044LocalTestMode(this.env);
      const config = localTest ? b044LocalTestConfig(this.env) : getFeishuConfig(this.env);
      const records = localTest ? createB044LocalTestRecordService(this.ctx.storage, config) : createFeishuRecordService(createFeishuAuthService(config));
      if (localTest && (prepare || pathname.endsWith('/create-picking-list'))) await records.seedPackages(normalizeRows((await request.clone().json()).rows));
      const pickingLists = createPickingListService(config, records, { onStage });
      const service = createB044PutAwayService(config, records, pickingLists, this.ctx.storage, { onStage, partUsed: localTest ? createB044LocalPartUsedService(this.ctx.storage) : createPartUsedCoordinatorClient(this.env), pickingListPrefix: localTest ? 'B044-TEST' : 'B044' });
      onStage('READ_REQUEST');
      const input = await request.json();
      const data = await (prepare ? service.prepare(input) : recovery ? service.adminRecover(input) : recover ? service.recover(input) : diagnoseReconciliation ? service.diagnoseReconciliation(input) : executeReconciliation ? service.reconcileStale(input) : reconcile ? service.reconcile(input) : start ? service.startProcess(input) : complete ? service.complete(input) : cancel ? service.cancel(input) : service.create(input));
      if (data.error) Object.assign(data.error, { stage: diagnostic.stage, operationState: diagnostic.operationState });
      console.log(JSON.stringify({ ...diagnostic, event: data.operational === false ? 'picking_list_not_operational' : 'picking_list_result', code: data.error?.code || 'OK', status: 200 }));
      return Response.json({ ok: true, data, requestId });
    } catch (error) {
      const known = error instanceof PickingListError;
      const lookupFailure = error instanceof PickingListNumberLookupError;
      const conflict = known && !lookupFailure;
      const code = known ? error.code : 'B044_OPERATION_FAILED', status = conflict ? 409 : 502;
      console.error(JSON.stringify({ ...diagnostic, ...(lookupFailure ? error.diagnostics : {}), event: lookupFailure ? 'picking_list_number_lookup_failed' : conflict ? 'picking_list_conflict' : 'picking_list_failure', code, status }));
      return Response.json({ ok: false, requestId, error: { code, message: known ? error.message : 'Operation could not be confirmed. Retry the same request; do not start another Picking List.', retryable: !conflict, stage: diagnostic.stage, operationState: diagnostic.operationState, ...(error.diagnosis ? { diagnosis: error.diagnosis } : {}) } }, { status });
    }
  }
}

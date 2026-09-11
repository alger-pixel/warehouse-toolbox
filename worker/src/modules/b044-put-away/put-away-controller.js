import { managementAuthorized } from '../users/user-controller.js';
import { createB044PutAwayService } from './put-away-service.js';
import { json, errorResponse } from '../../utils/response.js';
export async function handleB044(route, body, config, records, id, request, env) {
  if (route === 'b044-admin-recover' && !await managementAuthorized(request, env)) return errorResponse(401, 'ADMIN_KEY_REQUIRED', 'Administration authorization required.', false, id, request, env);
  if (route === 'b044-prepare') {
    try { return json({ ok: true, data: await createB044PutAwayService(config, records).prepare(body) }, 200, request, env); }
    catch (error) { if (error.code) return errorResponse(400, error.code, error.message, false, id, request, env); throw error; }
  }
  if (!config.pickingListTableId || !env.B044_PUT_AWAY) return errorResponse(503, 'PICKING_LIST_NOT_CONFIGURED', 'Configure FEISHU_PICKING_LIST_TABLE_ID and B044_PUT_AWAY Durable Object binding.', false, id, request, env);
  const stub = env.B044_PUT_AWAY.get(env.B044_PUT_AWAY.idFromName(config.appToken));
  const result = await stub.fetch(new Request(`https://b044.internal/${route === 'b044-admin-recover' ? 'admin-recover' : route === 'b044-reconcile' ? 'reconcile' : route === 'b044-complete' ? 'complete-package' : route === 'b044-cancel' ? 'cancel-picking-list' : 'create-picking-list'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-ID': id, ...(route === 'b044-admin-recover' ? { Authorization: request.headers.get('Authorization') } : {}) }, body: JSON.stringify(body) }));
  return json(await result.json(), result.status, request, env);
}

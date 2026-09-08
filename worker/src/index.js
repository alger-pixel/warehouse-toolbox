import { createInventoryService } from './modules/inventory/inventory-service.js';
import { createInventoryController } from './modules/inventory/inventory-controller.js';
import { handleB044 } from "./modules/b044-put-away/put-away-controller.js";
export { B044PutAwayCoordinator } from "./modules/b044-put-away/put-away-coordinator.js";
import { getFeishuConfig, isFeishuConfigured } from "./config/feishu-config.js";
import { createFeishuAuthService, FeishuAuthError } from "./services/feishu-auth-service.js";
import { createFeishuRecordService, FeishuRecordError } from "./services/feishu-record-service.js";
import { createReceivingDomainService } from "./modules/receiving/receiving-service.js";
import { createReceivingController } from "./modules/receiving/receiving-controller.js";
import { createLocationMoveService } from "./modules/location-move/location-move-service.js";
import { createLocationMoveController } from "./modules/location-move/location-move-controller.js";
import { createClientService } from "./modules/clients/client-service.js";
import { createClientController } from "./modules/clients/client-controller.js";
import { allowedOrigins, corsHeaders, errorResponse, json } from "./utils/response.js";

const MAX_BODY_BYTES = 16 * 1024;
function requestId(request) { return request.headers.get("X-Request-ID") || crypto.randomUUID(); }
function routeFor(pathname) { if (pathname === "/api/inventory/search") return "inventory-search"; if (pathname === "/api/b044/put-away/cancel-picking-list") return "b044-cancel"; if (pathname === "/api/b044/put-away/prepare") return "b044-prepare"; if (pathname === "/api/b044/put-away/create-picking-list") return "b044-create"; if (pathname === "/api/b044/put-away/complete-package") return "b044-complete"; if (pathname === "/api/health") return "health"; if (pathname === "/api/clients/search") return "client-search"; if (pathname === "/api/clients") return "client-create"; if (pathname === "/api/receiving/lookup") return "lookup"; if (pathname === "/api/receiving") return "receive"; if (pathname === "/api/location-move/lookup") return "location-move-lookup"; if (pathname === "/api/location-move") return "location-move"; return "not-found"; }
function methodAllowed(route, method) { return (route === "health" && method === "GET") || (["inventory-search", "b044-prepare", "b044-create", "b044-complete", "b044-cancel", "client-search", "client-create", "lookup", "receive", "location-move-lookup", "location-move"].includes(route) && method === "POST"); }
async function readJson(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("Content-Length") || 0); if (declared > limit) return { tooLarge: true };
  const text = await request.text(); if (new TextEncoder().encode(text).byteLength > limit) return { tooLarge: true };
  try { return { body: JSON.parse(text || "{}") }; } catch (error) { return { invalid: true }; }
}

export async function handleRequest(request, env) {
  const started = Date.now(); const id = requestId(request); const route = routeFor(new URL(request.url).pathname); const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins(env).has(origin)) return errorResponse(403, "CORS_DENIED", "Origin is not allowed.", false, id, request, env);
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (origin && !allowedOrigins(env).has(origin)) return errorResponse(403, "CORS_DENIED", "Origin is not allowed.", false, id, request, env);
  if (route === "not-found") return errorResponse(404, "NOT_FOUND", "Route not found.", false, id, request, env);
  if (!methodAllowed(route, request.method)) return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed.", false, id, request, env);
  if (route === "health") return json({ ok: true, service: "mkite-api", version: "0.1", feishuConfigured: isFeishuConfigured(env) }, 200, request, env);
  const parsed = await readJson(request, route.startsWith("b044-") ? 1024 * 1024 : MAX_BODY_BYTES);
  if (parsed.tooLarge) return errorResponse(413, "PAYLOAD_TOO_LARGE", "Request body is too large.", false, id, request, env);
  if (parsed.invalid) return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON.", false, id, request, env);
  try {
    const config = getFeishuConfig(env); const auth = createFeishuAuthService(config);
    const records = createFeishuRecordService(auth); let response;
    if (route === "inventory-search") response = await createInventoryController(createInventoryService(config, records)).search(parsed.body, id, request, env);
    else if (route.startsWith("b044-")) response = await handleB044(route, parsed.body, config, records, id, request, env);
    else if (route.startsWith("client-")) { const controller=createClientController(createClientService(config,records));response=route==="client-search"?await controller.search(parsed.body,id,request,env):await controller.create(parsed.body,id,request,env); }
    else if (route.startsWith("location-move")) { const controller = createLocationMoveController(createLocationMoveService(config, records)); response = route === "location-move-lookup" ? await controller.lookup(parsed.body, id, request, env) : await controller.move(parsed.body, id, request, env); }
    else { const controller = createReceivingController(createReceivingDomainService(config, records)); response = route === "lookup" ? await controller.lookup(parsed.body, id, request, env) : await controller.receive(parsed.body, id, request, env); }
    console.log(JSON.stringify({ requestId: id, route, status: response.status, durationMs: Date.now() - started })); return response;
  } catch (error) {
    const feishuCode = error instanceof FeishuRecordError ? error.feishuCode : undefined;
    console.error(JSON.stringify({ requestId: id, route, event: error instanceof FeishuAuthError ? "feishu_auth_error" : error instanceof FeishuRecordError ? "feishu_record_error" : "internal_error", feishuCode, durationMs: Date.now() - started }));
    return errorResponse(502, "FEISHU_API_ERROR", "Unable to complete the warehouse request.", true, id, request, env);
  }
}

export default { fetch: handleRequest };

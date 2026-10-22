import {projectRouteFor,handleProjects} from './modules/projects/project-controller.js';
export {ProjectCoordinator} from './modules/projects/project-coordinator.js';
import {caseCategoryRouteFor,handleCaseCategories} from './modules/case-categories/case-category-controller.js';
export {CaseCategoryCoordinator} from './modules/case-categories/case-category-coordinator.js';
import {caseRouteFor,handleCases} from './modules/cases/case-controller.js';
export {CaseCoordinator} from './modules/cases/case-coordinator.js';
import { handleInventoryLookup } from './modules/inventory-lookup/inventory-service.js';
import { createPickingSearchService, handlePickingSearch } from './modules/batch-picking-lists/search-service.js';
import { handleUsers } from './modules/users/user-controller.js';
export { UserManagementCoordinator } from './modules/users/user-coordinator.js';
import { handleCommandSimplifier } from './modules/ai/command-simplifier-controller.js';
import { createTinecoInventoryService, handleTinecoInventory } from './modules/tineco-inventory/inventory-service.js';
import { createTinecoSnEnrichmentService } from './modules/tineco-inventory/sn-enrichment-service.js';
import { handleTineco } from './modules/tineco-toc/tineco-controller.js';
export { TinecoTocCoordinator } from './modules/tineco-toc/tineco-coordinator.js';
import { createInventoryService } from './modules/inventory/inventory-service.js';
import { createInventoryController } from './modules/inventory/inventory-controller.js';
import { handleB044 } from "./modules/b044-put-away/put-away-controller.js";
export { B044PutAwayCoordinator } from "./modules/b044-put-away/put-away-coordinator.js";
import { getFeishuConfig } from "./config/feishu-config.js";
import { createFeishuAuthService, FeishuAuthError } from "./services/feishu-auth-service.js";
import { createFeishuRecordService, FeishuRecordError } from "./services/feishu-record-service.js";
import { createReceivingDomainService } from "./modules/receiving/receiving-service.js";
import { createReceivingController } from "./modules/receiving/receiving-controller.js";
import { createLocationMoveService } from "./modules/location-move/location-move-service.js";
import { createLocationMoveController } from "./modules/location-move/location-move-controller.js";
import { createClientService } from "./modules/clients/client-service.js";
import { createClientController } from "./modules/clients/client-controller.js";
import { createSafetyIconService } from "./modules/safety-icons/safety-icon-service.js";
import { handleSafetyIcons } from "./modules/safety-icons/safety-icon-controller.js";
import { createFeishuAttachmentService } from "./services/feishu-attachment-service.js";
import { createSopService } from "./modules/sops/sop-service.js";
import { handleSops, sopMutationAuthorized } from "./modules/sops/sop-controller.js";
export { SopProjectCoordinator } from "./modules/sops/sop-coordinator.js";
import { createPartUsedCoordinatorClient } from './modules/part-used/part-used-coordinator.js';
export { PartUsedCoordinator } from './modules/part-used/part-used-coordinator.js';
import { allowedOrigins, corsHeaders, errorResponse, json } from "./utils/response.js";
import { shouldBlockProductionMutation } from './security/mutation-guard.js';
import { b044LocalTestConfig, isB044LocalTestMode } from './modules/b044-put-away/local-test-data.js';

const MAX_BODY_BYTES = 16 * 1024;
function requestId(request) { return request.headers.get("X-Request-ID") || crypto.randomUUID(); }
function sopRouteFor(pathname){if(pathname==='/api/sops')return 'sops-list';const asset=pathname.match(/^\/api\/sops\/([^/]+)\/assets\/([^/]+)$/);if(asset)return {name:'sops-asset',sopId:decodeURIComponent(asset[1]),assetId:decodeURIComponent(asset[2])};const excel=pathname.match(/^\/api\/sops\/([^/]+)\/excel$/);if(excel)return {name:'sops-excel',sopId:decodeURIComponent(excel[1])};const project=pathname.match(/^\/api\/sops\/([^/]+)$/);return project?{name:'sops-get',sopId:decodeURIComponent(project[1])}:null;}
function sopMethodAllowed(route,method){return route==='sops-list'?['GET','POST'].includes(method):route==='sops-get'?['GET','PUT','DELETE'].includes(method):route==='sops-excel'?method==='POST':route==='sops-asset'&&method==='GET';}
function partUsedRouteFor(pathname){return pathname==='/api/part-used'?'part-used-query':pathname==='/api/part-used/summary'?'part-used-summary':null;}
function partUsedReportRouteFor(pathname){if(pathname==='/api/part-used-inventory-count/reports')return 'part-used-report-list';const picture=pathname.match(/^\/api\/part-used-inventory-count\/reports\/([^/]+)\/pictures\/([^/]+)$/);if(picture)return {name:'part-used-report-picture',reportId:decodeURIComponent(picture[1]),pictureId:decodeURIComponent(picture[2])};const match=pathname.match(/^\/api\/part-used-inventory-count\/reports\/([^/]+)(?:\/(results|matched|discrepancy|pictures|close|archive))?$/);return match?{name:`part-used-report-${match[2]||'get'}`,reportId:decodeURIComponent(match[1])}:null;}
function routeFor(pathname) { if (pathname === "/api/b044/put-away/local-test/reset") return "b044-local-test-reset"; if (pathname === "/api/b044/put-away/reconcile/diagnose") return "b044-reconcile-diagnose"; if (pathname === "/api/b044/put-away/reconcile/execute") return "b044-reconcile-execute"; if (pathname === "/api/inventory/lookup") return "inventory-lookup"; if (pathname === "/api/safety-icons") return "safety-icons-list"; if (pathname === "/api/safety-icons/create") return "safety-icons-create"; const safetyImage=pathname.match(/^\/api\/safety-icons\/image\/([^/]+)$/);if(safetyImage)return {name:"safety-icons-image",recordId:safetyImage[1]};const safetyUpdate=pathname.match(/^\/api\/safety-icons\/([^/]+)$/);if(safetyUpdate)return {name:"safety-icons-update",recordId:safetyUpdate[1]}; if (pathname === "/api/b044/put-away/admin-recover") return "b044-admin-recover"; if (pathname === "/api/b044/put-away/recover") return "b044-recover"; if (pathname === "/api/b044/put-away/reconcile") return "b044-reconcile"; if (pathname === "/api/picking-lists/search") return "picking-search"; if (pathname === "/api/picking-lists/detail") return "picking-detail"; const users = pathname.match(/^\/api\/users\/(list|get|tools|create|update)$/); if (users) return "users-" + users[1]; if (pathname === "/api/ai/simplify-command") return "ai-command"; if (pathname === "/api/tineco-toc/inventory/search") return "tineco-inventory"; const tineco = pathname.match(/^\/api\/tineco-toc\/(begin|resume|step|finish|pause|cancel|client-return)$/); if (tineco) return "tineco-" + tineco[1]; if (pathname === "/api/inventory/search") return "inventory-search"; if (pathname === "/api/b044/put-away/start-process") return "b044-start"; if (pathname === "/api/b044/put-away/cancel-picking-list") return "b044-cancel"; if (pathname === "/api/b044/put-away/prepare") return "b044-prepare"; if (pathname === "/api/b044/put-away/create-picking-list") return "b044-create"; if (pathname === "/api/b044/put-away/complete-package") return "b044-complete"; if (pathname === "/api/health") return "health"; if (pathname === "/api/clients/search") return "client-search"; if (pathname === "/api/clients") return "client-create"; if (pathname === "/api/receiving/lookup") return "lookup"; if (pathname === "/api/receiving") return "receive"; if (pathname === "/api/location-move/lookup") return "location-move-lookup"; if (pathname === "/api/location-move") return "location-move"; return "not-found"; }
function methodAllowed(route, method) {if(route==='part-used-query'||route==='part-used-summary'||route==='part-used-report-list'||route==='part-used-report-get')return method==='GET';if(route==='part-used-report-picture')return ['GET','DELETE'].includes(method);if(route==='part-used-report-results')return method==='PUT';if(['part-used-report-create','part-used-report-matched','part-used-report-discrepancy','part-used-report-pictures','part-used-report-close','part-used-report-archive'].includes(route))return method==='POST';if(route==='safety-icons-list'||route==='safety-icons-image')return method==='GET';if(route==='safety-icons-create')return method==='POST';if(route==='safety-icons-update')return method==='PATCH';return (route === "health" && method === "GET") || ((route.startsWith("picking-") || route.startsWith("users-") || route === "ai-command" || route.startsWith("tineco-") || ["inventory-lookup", "b044-local-test-reset", "b044-admin-recover", "b044-recover", "b044-reconcile", "b044-reconcile-diagnose", "b044-reconcile-execute", "inventory-search", "b044-prepare", "b044-create", "b044-start", "b044-complete", "b044-cancel", "client-search", "client-create", "lookup", "receive", "location-move-lookup", "location-move"].includes(route)) && method === "POST"); }
async function readJson(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers.get("Content-Length") || 0); if (declared > limit) return { tooLarge: true };
  const text = await request.text(); if (new TextEncoder().encode(text).byteLength > limit) return { tooLarge: true };
  try { return { body: JSON.parse(text || "{}") }; } catch (error) { return { invalid: true }; }
}

export async function handleRequest(request, env) {
  const started = Date.now(); const id = requestId(request); const pathname=new URL(request.url).pathname;const routeMatch = caseRouteFor(pathname)||caseCategoryRouteFor(pathname)||projectRouteFor(pathname)||sopRouteFor(pathname)||partUsedReportRouteFor(pathname)||partUsedRouteFor(pathname)||routeFor(pathname);let route=typeof routeMatch==='string'?routeMatch:routeMatch.name;if(route==='part-used-report-list'&&request.method==='POST')route='part-used-report-create';if(route==='safety-icons-list'&&request.method==='POST')route='safety-icons-create';if(route==='sops-list'&&request.method==='POST')route='sops-create';if(route==='sops-get'&&request.method==='PUT')route='sops-update';if(route==='sops-get'&&request.method==='DELETE')route='sops-delete'; const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") {
    if (!origin || !allowedOrigins(env).has(origin)) return errorResponse(403, "CORS_DENIED", "Origin is not allowed.", false, id, request, env);
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  if (origin && !allowedOrigins(env).has(origin)) return errorResponse(403, "CORS_DENIED", "Origin is not allowed.", false, id, request, env);
  if (shouldBlockProductionMutation(request,env,route,routeMatch)) return errorResponse(403,'LOCAL_PRODUCTION_MUTATION_BLOCKED','This non-production Worker cannot mutate production operational data.',false,id,request,env);
  if (route === 'projects') return handleProjects(request,env,id,routeMatch);
  if (route === 'cases') return handleCases(request,env,id,routeMatch);
  if (route === 'case-categories') return handleCaseCategories(request,env,id,routeMatch);
  if (route === "not-found") return errorResponse(404, "NOT_FOUND", "Route not found.", false, id, request, env);
  if (!(route.startsWith('sops-') ? sopMethodAllowed(route==='sops-create'?'sops-list':['sops-update','sops-delete'].includes(route)?'sops-get':route,request.method) : methodAllowed(route, request.method))) return errorResponse(405, "METHOD_NOT_ALLOWED", "Method not allowed.", false, id, request, env);
  if (route === "health") return json({ ok: true, service: "mkite-secure-api" }, 200, request, env);
  if(route==='part-used-report-picture'&&request.method==='GET'){try{const response=await createPartUsedCoordinatorClient(env).picture(routeMatch.reportId,routeMatch.pictureId),type=response.headers.get('Content-Type')||'application/octet-stream',headers=new Headers({'Content-Type':type,'Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});for(const [key,value] of Object.entries(corsHeaders(request,env)))headers.set(key,value);return new Response(response.body,{status:response.status,headers});}catch(error){return errorResponse(error.status||502,error.code||'REPORT_PICTURE_FAILED',error.message||'Unable to load the report picture.',error.status>=500,id,request,env);}}
  if(['part-used-query','part-used-summary','part-used-report-list','part-used-report-get'].includes(route)){try{const filters=Object.fromEntries(new URL(request.url).searchParams),client=createPartUsedCoordinatorClient(env),data=route==='part-used-summary'?await client.summary(filters):route==='part-used-query'?await client.query(filters):route==='part-used-report-list'?await client.listReports(filters):await client.getReport(routeMatch.reportId);return json({ok:true,data},200,request,env);}catch(error){return errorResponse(error.status||502,error.code||'PART_USED_FAILED',error.message||'Unable to read Part Used records.',error.status!==400,id,request,env);}}
  const parsed = await readJson(request, route.startsWith('sops-') ? 24*1024*1024 : route==='part-used-report-pictures' ? 7*1024*1024 : route.startsWith('part-used-report-') ? 128*1024 : route.startsWith("b044-")||route.startsWith('safety-icons-') ? 2 * 1024 * 1024 : MAX_BODY_BYTES);
  if (parsed.tooLarge) return errorResponse(413, "PAYLOAD_TOO_LARGE", "Request body is too large.", false, id, request, env);
  if (parsed.invalid) return errorResponse(400, "INVALID_JSON", "Request body must be valid JSON.", false, id, request, env);
  try {
    if (route.startsWith('b044-') && env.B044_LOCAL_TEST_DATA && !isB044LocalTestMode(env)) return errorResponse(503,'B044_LOCAL_TEST_CONFIGURATION_INVALID','B044 local test data mode is not safely configured.',false,id,request,env);
    if (route.startsWith('b044-') && isB044LocalTestMode(env)) return await handleB044(route, parsed.body, b044LocalTestConfig(env), null, id, request, env);
    if(route.startsWith('part-used-report-')){try{const client=createPartUsedCoordinatorClient(env),reportId=routeMatch.reportId,data=route==='part-used-report-create'?await client.createReport(parsed.body):route==='part-used-report-results'?await client.saveResults(reportId,parsed.body):route==='part-used-report-matched'?await client.markMatched(reportId,parsed.body):route==='part-used-report-discrepancy'?await client.submitDiscrepancy(reportId,parsed.body):route==='part-used-report-pictures'?await client.addPicture(reportId,parsed.body):route==='part-used-report-picture'?await client.removePicture(reportId,routeMatch.pictureId,parsed.body):route==='part-used-report-close'?await client.closeReport(reportId,parsed.body):await client.archiveReport(reportId,parsed.body);return json({ok:true,data},200,request,env);}catch(error){return errorResponse(error.status||502,error.code||'PART_USED_REPORT_FAILED',error.message||'Unable to complete the inventory count report.',error.status>=500,id,request,env);}}
    if (route === "inventory-lookup") return await handleInventoryLookup(parsed.body, env, id, request);
    if (route.startsWith("users-")) return await handleUsers(route.slice(6), parsed.body, request, env, id);
    if (route === "ai-command") return await handleCommandSimplifier(parsed.body, env, id, request);
    if(route==='sops-create'){
      if(!sopMutationAuthorized(request,env))return errorResponse(403,'TRUSTED_ORIGIN_REQUIRED','SOP editing is unavailable from this origin.',false,id,request,env);
      if(!env.SOP_PROJECTS)return errorResponse(503,'SOP_COORDINATOR_NOT_CONFIGURED','SOP project coordinator is not configured.',false,id,request,env);
      const objectId=env.SOP_PROJECTS.idFromName('sop-id-allocation');const upstream=await env.SOP_PROJECTS.get(objectId).fetch(new Request('https://sop-projects/create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(parsed.body)}));return json(await upstream.json(),upstream.status,request,env);
    }
    const config = getFeishuConfig(env); const auth = createFeishuAuthService(config);
    const records = createFeishuRecordService(auth); let response;
    if(route.startsWith('sops-'))response=await handleSops(route,{...parsed.body,sopId:routeMatch.sopId,assetId:routeMatch.assetId},createSopService(config,records,createFeishuAttachmentService(auth)),id,request,env);
    else if(route.startsWith('safety-icons-'))response=await handleSafetyIcons(route,{...parsed.body,recordId:routeMatch.recordId},createSafetyIconService(config,records,createFeishuAttachmentService(auth)),id,request,env);
    else if (route.startsWith("picking-")) response = await handlePickingSearch(route.slice(8), createPickingSearchService(config, records), parsed.body, id, request, env);
    else if (route === "tineco-inventory") response = await handleTinecoInventory(createTinecoInventoryService(config, records, createTinecoSnEnrichmentService(env,{onDiagnostic:diagnostic=>console.log(JSON.stringify({requestId:id,route:'tineco-sn-enrichment',...diagnostic}))})), parsed.body, id, request, env);
    else if (route.startsWith("tineco-")) response = await handleTineco(route.slice(7), parsed.body, config, request, env, id);
    else if (route === "inventory-search") response = await createInventoryController(createInventoryService(config, records)).search(parsed.body, id, request, env);
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

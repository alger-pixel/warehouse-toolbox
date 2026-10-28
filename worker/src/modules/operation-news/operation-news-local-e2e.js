const ENABLED='enabled';
const LOCAL_AUTHORIZATION=/^[a-f0-9]{64}$/;
export function isOperationNewsLocalE2E(env){return env?.FEISHU_DATA_ENVIRONMENT==='production'&&env?.WORKER_RUNTIME_ENVIRONMENT==='development'&&env?.OPERATION_NEWS_LOCAL_E2E===ENABLED&&LOCAL_AUTHORIZATION.test(env?.OPERATION_NEWS_LOCAL_E2E_AUTHORIZATION||'');}
export function controlledOperationNewsMutationAllowed(request,env,route,routeMatch){if(!isOperationNewsLocalE2E(env)||route!=='operation-news')return false;return (request.method==='POST'&&routeMatch?.action==='collection')||(request.method==='PATCH'&&routeMatch?.action==='status');}

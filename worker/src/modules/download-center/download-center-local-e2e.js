import {hasControlledLocalE2EAuthorization} from '../operation-news/operation-news-local-e2e.js';

export function isDownloadCenterLocalE2E(env){return env?.FEISHU_DATA_ENVIRONMENT==='production'&&env?.WORKER_RUNTIME_ENVIRONMENT==='development'&&env?.DOWNLOAD_CENTER_LOCAL_E2E==='enabled'&&hasControlledLocalE2EAuthorization(env);}

export function controlledDownloadCenterMutationAllowed(request,env,route,routeMatch){return isDownloadCenterLocalE2E(env)&&route==='download-center'&&request.method==='POST'&&routeMatch?.action==='register';}

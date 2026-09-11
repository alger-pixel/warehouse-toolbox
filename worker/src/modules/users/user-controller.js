import { json, errorResponse } from '../../utils/response.js';

export async function managementAuthorized(request, env) {
  const secret = env.USER_MANAGEMENT_ADMIN_KEY;
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = request.headers.get('Authorization') || '';
  if (supplied.length > 1024) return false;
  const digest = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a,b] = await Promise.all([digest(supplied), digest(`Bearer ${secret}`)]);
  let difference = 0;
  for (let i=0;i<a.length;i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
export async function handleUsers(action, body, request, env, requestId) {
  if (!env.USER_MANAGEMENT_ADMIN_KEY || env.USER_MANAGEMENT_ADMIN_KEY.length < 32) return errorResponse(503,'USER_MANAGEMENT_NOT_CONFIGURED','User Management requires a Worker administration key.',false,requestId,request,env);
  if (!await managementAuthorized(request, env)) return errorResponse(401,'ADMIN_KEY_REQUIRED','Enter the User Management administration key.',false,requestId,request,env);
  if (!env.FEISHU_USER_TABLE_ID || !env.FEISHU_TOOL_TABLE_ID || !env.USER_MANAGEMENT) return errorResponse(503,'USER_MANAGEMENT_NOT_CONFIGURED','Configure USER CLASS, TOOL CLASS and the User Management coordinator.',false,requestId,request,env);
  // One coordinator per live table, not per user: account uniqueness and admin counts are global.
  const id = env.USER_MANAGEMENT.idFromName(`${env.FEISHU_BASE_APP_TOKEN}:${env.FEISHU_USER_TABLE_ID}`);
  const response = await env.USER_MANAGEMENT.get(id).fetch(new Request(`https://user-management/${action}`, {
    method:'POST', headers:{'Content-Type':'application/json', Authorization:request.headers.get('Authorization')}, body:JSON.stringify(body)
  }));
  return json(await response.json(), response.status, request, env);
}

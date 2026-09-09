import {json,errorResponse} from '../../utils/response.js';
export async function handleTineco(action,body,config,request,env,id) {
  if(!config.tinecoTocUnitTableId || !env.TINECO_TOC) return errorResponse(503,'TINECO_TOC_TABLE_NOT_CONFIGURED','Configure the Tineco table and coordinator.',false,id,request,env);
  const stub=env.TINECO_TOC.get(env.TINECO_TOC.idFromName(`${config.appToken}:${config.tinecoTocUnitTableId}`));
  const response=await stub.fetch(new Request(`https://tineco.internal/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
  return json(await response.json(),response.status,request,env);
}

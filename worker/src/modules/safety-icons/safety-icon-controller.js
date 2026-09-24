import { PickingListError } from '../picking-lists/picking-list-service.js';
import { allowedOrigins,json,errorResponse,corsHeaders } from '../../utils/response.js';

// Interim authorization seam. Replace this predicate with authenticated user,
// tool and action permission checks for AT-SAFETY-ICON-MAINTAIN-0001.
export function safetyIconMutationAuthorized(request,env){const origin=request.headers.get('Origin');return Boolean(origin&&allowedOrigins(env).has(origin));}

export async function handleSafetyIcons(route,body,service,id,request,env){
  try{
    if(route==='safety-icons-list')return json({ok:true,data:await service.list()},200,request,env);
    if(route==='safety-icons-image'){
      const upstream=await service.image(body.recordId),contentType=String(upstream.headers.get('Content-Type')||'').split(';')[0].trim().toLowerCase();
      if(!['image/png','image/jpeg','image/webp'].includes(contentType))throw new PickingListError('UNSUPPORTED_SAFETY_ICON_IMAGE','Safety Icon image format is unsupported.');
      const headers=new Headers({'Content-Type':contentType,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff',...corsHeaders(request,env)});return new Response(upstream.body,{status:200,headers});
    }
    if(!safetyIconMutationAuthorized(request,env))return errorResponse(403,'TRUSTED_ORIGIN_REQUIRED','Safety Icon maintenance is unavailable from this origin.',false,id,request,env);
    const data=route==='safety-icons-create'?await service.create(body):await service.update(body.recordId,body);
    return json({ok:true,data},200,request,env);
  }catch(error){const known=error instanceof PickingListError;return errorResponse(known?(error.status||400):502,known?error.code:'SAFETY_ICON_REQUEST_FAILED',known?error.message:'Unable to complete the Safety Icon request.',false,id,request,env);}
}

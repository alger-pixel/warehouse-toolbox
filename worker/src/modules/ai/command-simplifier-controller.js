import {createCommandSimplifier} from './command-simplifier-service.js';
import {json,errorResponse} from '../../utils/response.js';
export async function handleCommandSimplifier(input,env,id,request){
 if(!input||typeof input.command!=='string')return errorResponse(400,'INVALID_COMMAND','Provide command text.',false,id,request,env);
 // X-Request-ID is caller-controlled: do not log arbitrary text supplied in it.
 const requestId=typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)?id:'REDACTED';
 const data=await createCommandSimplifier(env,{onDiagnostic:diagnostic=>console.log(JSON.stringify({requestId,route:'ai-command',...diagnostic}))}).simplify(input.command);
 return json({ok:true,data},200,request,env);
}

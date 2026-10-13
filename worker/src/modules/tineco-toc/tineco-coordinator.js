import {getFeishuConfig} from '../../config/feishu-config.js';
import {createFeishuAuthService} from '../../services/feishu-auth-service.js';
import {createFeishuRecordService} from '../../services/feishu-record-service.js';
import {createTinecoService} from './tineco-service.js';
import {TinecoError} from './tineco-fields.js';
import {createPartUsedCoordinatorClient} from '../part-used/part-used-coordinator.js';
export class TinecoTocCoordinator {
  constructor(ctx,env) {this.ctx=ctx;this.env=env;this.tail=Promise.resolve();}
  fetch(request) {const run=this.tail.then(()=>this.handle(request));this.tail=run.catch(()=>{});return run;}
  async handle(request) {
    const action=new URL(request.url).pathname.slice(1);
    try {
      if(!['begin','step','finish','pause','cancel','client-return'].includes(action)) return Response.json({ok:false,error:{code:'NOT_FOUND',message:'Unknown repair action.'}},{status:404});
      const config=getFeishuConfig(this.env),records=createFeishuRecordService(createFeishuAuthService(config));
      const service=createTinecoService(config,records,this.ctx.storage,{partUsed:createPartUsedCoordinatorClient(this.env)});
      const method=action==='client-return'?'clientReturn':action;
      return Response.json({ok:true,data:await service[method](await request.json())});
    } catch(error) {
      const known=error instanceof TinecoError,clientReturnWrite=action==='client-return'&&error?.name==='FeishuRecordError'&&error?.operation==='record update',code=known?error.code:clientReturnWrite?'TINECO_CLIENT_RETURN_WRITE_FAILED':'TINECO_TOC_SAVE_FAILED';
      console.error(JSON.stringify({route:'tineco-toc',action,code,httpStatus:error.httpStatus,feishuCode:error.feishuCode}));
      return Response.json({ok:false,error:{code,message:known?error.message:clientReturnWrite?'Unable to save the client return. Retry the same session.':'Unable to confirm the repair operation. Retry the same session.',retryable:!known}},{status:known?error.status:502});
    }
  }
}

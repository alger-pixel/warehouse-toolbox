import { getFeishuConfig } from '../../config/feishu-config.js';
import { createFeishuAuthService } from '../../services/feishu-auth-service.js';
import { createFeishuRecordService } from '../../services/feishu-record-service.js';
import { createUserService, UserError } from './user-service.js';
import { managementAuthorized } from './user-controller.js';

export class UserManagementCoordinator {
  constructor(ctx, env) { this.ctx=ctx; this.env=env; this.tail=Promise.resolve(); }
  fetch(request) {
    const run=this.tail.then(()=>this.handle(request));
    this.tail=run.catch(()=>{});
    return run;
  }
  async handle(request) {
    try {
      if (!await managementAuthorized(request,this.env)) return Response.json({ok:false,error:{code:'ADMIN_KEY_REQUIRED',message:'Administration key required.'}},{status:401});
      const action=new URL(request.url).pathname.slice(1);
      if (!['list','get','tools','create','update'].includes(action)) return Response.json({ok:false,error:{code:'NOT_FOUND',message:'Unknown administrative action.'}},{status:404});
      const config={...getFeishuConfig(this.env),managementSecret:this.env.USER_MANAGEMENT_ADMIN_KEY};
      const records=createFeishuRecordService(createFeishuAuthService(config));
      const service=createUserService(config,records,this.ctx.storage);
      return Response.json({ok:true,data:await service[action](await request.json())});
    } catch (error) {
      const known=error instanceof UserError;
      // Never serialize raw Feishu errors, request bodies, password hashes or credentials.
      return Response.json({ok:false,error:{code:known?error.code:'USER_WRITE_OR_READ_FAILED',message:known?error.message:'Unable to confirm the user operation. Keep the current edit and retry the same request.',retryable:!known}},{status:known?error.status:502});
    }
  }
}

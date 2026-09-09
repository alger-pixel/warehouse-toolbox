import {getFeishuConfig} from '../../config/feishu-config.js';
import {createFeishuAuthService} from '../../services/feishu-auth-service.js';
import {createFeishuRecordService} from '../../services/feishu-record-service.js';
import {createTinecoService} from './tineco-service.js';
import {TinecoError} from './tineco-fields.js';
export class TinecoTocCoordinator {
  constructor(ctx,env) {this.ctx=ctx;this.env=env;this.tail=Promise.resolve();}
  fetch(request) {const run=this.tail.then(()=>this.handle(request));this.tail=run.catch(()=>{});return run;}
  async handle(request) {
    const action=new URL(request.url).pathname.slice(1);
    try {
      if(!['begin','step','finish','cancel'].includes(action)) return Response.json({ok:false,error:{code:'NOT_FOUND',message:'Unknown repair action.'}},{status:404});
      const config=getFeishuConfig(this.env),records=createFeishuRecordService(createFeishuAuthService(config));
      const service=createTinecoService(config,records,this.ctx.storage);
      return Response.json({ok:true,data:await service[action](await request.json())});
    } catch(error) {
      const known=error instanceof TinecoError,code=known?error.code:'TINECO_TOC_SAVE_FAILED';
      console.error(JSON.stringify({route:'tineco-toc',action,code,httpStatus:error.httpStatus,feishuCode:error.feishuCode}));
      return Response.json({ok:false,error:{code,message:known?error.message:'Unable to confirm the repair operation. Retry the same session.',retryable:!known}},{status:known?error.status:502});
    }
  }
}

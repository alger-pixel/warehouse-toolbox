import {getFeishuConfig} from '../../config/feishu-config.js';
import {createFeishuAuthService} from '../../services/feishu-auth-service.js';
import {createFeishuRecordService} from '../../services/feishu-record-service.js';
import {createCaseCategoryService,CaseCategoryError} from './case-category-service.js';
export class CaseCategoryCoordinator{
 constructor(ctx,env,options={}){this.ctx=ctx;this.env=env;this.options=options;this.tail=Promise.resolve();}
 fetch(request){const run=this.tail.then(()=>this.handle(request));this.tail=run.catch(()=>{});return run;}
 async handle(request){let action;try{const body=await request.json();action=body.action;const config={...getFeishuConfig(this.env),caseCategoryTableId:this.env.FEISHU_CASE_CATEGORY_TABLE_ID};const service=this.options.service||createCaseCategoryService(config,createFeishuRecordService(createFeishuAuthService(config)),this.ctx.storage);const data=action==='create'?await service.create(body.input):await service.update(body.categoryId,body.input);return Response.json({ok:true,data},{status:action==='create'?201:200});}catch(error){const known=error instanceof CaseCategoryError;return Response.json({ok:false,error:{code:known?error.code:'CASE_CATEGORY_SAVE_FAILED',message:known?error.message:'Unable to confirm the Case Category operation. Retry the same request.',retryable:!known},...(known?error.details:{})},{status:known?error.status:502});}}
}

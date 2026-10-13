// Internal administration only; discovery by default. Never recreates fields or options.
const {TARGET}=require('./ensure-project-class-schema.js');
async function ensureReWork(service,{apply=false}={}) {
 const fields=await service.listFields(TARGET),matches=fields.filter(f=>f.field_name==='PROJECT TYPE');
 if(matches.length!==1||matches[0].type!==3)throw Error('Expected one PROJECT TYPE Single Select field.');
 const before=matches[0],options=before.property?.options||[];
 if(new Set(options.map(o=>o.name)).size!==options.length)throw Error('Existing duplicate project type options require review.');
 const missing=!options.some(o=>o.name==='Re-Work');
 if(!apply||!missing)return {changed:false,missing,options};
 const next=options.map(o=>({...o})),index=next.findIndex(o=>o.name==='Other');next.splice(index<0?next.length:index,0,{name:'Re-Work',color:7});
 await service.updateField({...TARGET,fieldId:before.field_id,field:{field_name:before.field_name,type:3,property:{...before.property,options:next}}});
 const after=(await service.listFields(TARGET)).find(f=>f.field_id===before.field_id);
 if(!after||after.property.options.filter(o=>o.name==='Re-Work').length!==1)throw Error('Re-Work option verification failed. Reinspect before retrying.');
 for(const old of options){const saved=after.property.options.find(o=>o.id===old.id);if(!saved||saved.name!==old.name||saved.color!==old.color)throw Error('An existing project type option changed.');}
 return {changed:true,missing:false,options:after.property.options};
}
if(require.main===module)(async()=>{
 if(process.argv.slice(2).some(a=>a!=='--apply'))throw Error('Use --apply or omit for discovery.');
 const {getFeishuConfig}=await import('../worker/src/config/feishu-config.js');
 const {createFeishuAuthService}=await import('../worker/src/services/feishu-auth-service.js');
 const {createFeishuRecordService}=await import('../worker/src/services/feishu-record-service.js');
 console.log(JSON.stringify(await ensureReWork(createFeishuRecordService(createFeishuAuthService(getFeishuConfig(process.env))),{apply:process.argv.includes('--apply')}),null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={ensureReWork};

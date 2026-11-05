import {getFeishuConfig} from '../worker/src/config/feishu-config.js';
import {createFeishuAuthService} from '../worker/src/services/feishu-auth-service.js';
import {createFeishuRecordService} from '../worker/src/services/feishu-record-service.js';
import {planCaseProjectionBackfill} from '../worker/src/modules/cases/case-projections.js';

const ALLOWED=new Set(['ASSIGNED WORKER','CASE ANSWERS']);
const FIELDS=['CASE ID','STATUS','ASSIGNED USERS','ASSIGNED WORKER','QUESTION SNAPSHOT','REPORT DATA','CASE ANSWERS'];

export async function runCaseProjectionBackfill(records,{appToken,tableId,apply=false}={}){
  const rows=await records.listRecords({appToken,tableId,fieldNames:FIELDS}),plans=rows.map(planCaseProjectionBackfill),results=[];
  if(apply){
    for(const plan of plans){
      const fields=plan.updates,keys=Object.keys(fields);
      if(!keys.length)continue;
      if(keys.some(key=>!ALLOWED.has(key)))throw Error(`Unauthorized projection field planned for ${plan.caseId}.`);
      try{
        await records.updateRecord({appToken,tableId,recordId:plan.recordId,fields});
        const verified=await records.getRecord({appToken,tableId,recordId:plan.recordId});
        const matches=keys.every(key=>String(verified.fields?.[key]??'').trim()===fields[key]);
        if(!matches)throw Error('Projection readback did not match.');
        results.push({caseId:plan.caseId,status:'updated',fields:keys,verified:true});
      }catch(error){results.push({caseId:plan.caseId,status:'failed',fields:keys,verified:false,error:error.message});break;}
    }
  }
  const count=(field,state)=>plans.filter(plan=>plan[field]===state).length;
  return {mode:apply?'apply':'dry-run',total:plans.length,summary:{assignedWorker:{eligible:count('assignedState','eligible'),already:count('assignedState','already'),noSource:count('assignedState','no-source')},caseAnswers:{eligible:count('answersState','eligible'),already:count('answersState','already'),noReport:count('answersState','no-report'),malformed:count('answersState','malformed')}},samples:plans.filter(plan=>Object.keys(plan.updates).length).slice(0,12).map(plan=>({caseId:plan.caseId,current:plan.current,proposed:plan.updates})),plans,results};
}

async function main(){
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--apply'))throw Error('Usage: node --env-file=worker/.dev.vars scripts/backfill-case-projections.mjs [--apply]');
  const config=getFeishuConfig(process.env),records=createFeishuRecordService(createFeishuAuthService(config));
  const report=await runCaseProjectionBackfill(records,{appToken:config.appToken,tableId:config.caseClassTableId,apply:args.includes('--apply')});
  const {plans,...output}=report;
  output.skipped=plans.filter(plan=>plan.reasons.length).map(plan=>({caseId:plan.caseId,reasons:plan.reasons}));
  console.log(JSON.stringify(output,null,2));
  if(report.results.some(result=>result.status==='failed'))process.exitCode=1;
}

if(import.meta.url===`file://${process.argv[1]}`)main().catch(error=>{console.error(error.message);process.exitCode=1;});

import { json, errorResponse } from '../../utils/response.js';
export const EXPORT_LIMIT = 5000;
export const WORKING_SET_LIMIT = 2000;
export const ENRICHMENT_BATCH_LIMIT = 50;
export const COLUMNS = ['UNIT ID','SN','TRACKING NUMBER','CLIENT ID','WAREHOUSE','REPAIR DATE','LATEST RE-ENTRY AT','TIMES OF RE-ENTER','CLIENT RETURN COUNT','LATEST CLIENT RETURN AT','CURRENT STEP','ISSUE FOUND','PRE-QC NOTE','PART USED DETAIL','TOTAL PARTS USED','LABOR MINUTES','LABOR MINUTES PER STEP','REPAIR LEVEL','REPAIR RESULT','FINAL QC RESULT','FINAL QC NOTE','CLIENT STATUS'];
const text = v => Array.isArray(v) ? v.map(x => x.text || '').join('') : String(v ?? '').trim();
const rawText = v => Array.isArray(v) ? v.map(x => x.text || '').join('') : String(v ?? '');
const norm = v => text(v).toLocaleUpperCase();
export const normalizeLocationQuery = value => text(value).toLocaleLowerCase().replace(/\s+/g,' ');
const safeNumber=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0;
const parseHistory=(value,key)=>{if(!text(value))return {value:{schemaVersion:1,[key]:[]},valid:true};try{const parsed=JSON.parse(rawText(value));if(parsed?.schemaVersion===1&&Array.isArray(parsed[key]))return {value:parsed,valid:true};}catch{}return {value:{schemaVersion:1,[key]:[]},valid:false};};
const normalizeRepair=item=>({repairId:text(item?.repairId),visitNumber:safeNumber(item?.visitNumber),entryNumber:safeNumber(item?.entryNumber),startedAt:text(item?.startedAt),completedAt:text(item?.completedAt),archivedAt:text(item?.archivedAt),trackingNumber:text(item?.trackingNumber),issueFound:text(item?.issueFound),preQcNote:text(item?.preQcNote),repairLevel:text(item?.repairLevel),repairResult:text(item?.repairResult),partsUsed:Array.isArray(item?.partsUsed)?item.partsUsed.map(part=>({partSku:text(part?.partSku),quantity:safeNumber(part?.quantity)})).filter(part=>part.partSku&&part.quantity):[],labor:{preQcMinutes:safeNumber(item?.labor?.preQcMinutes),repairMinutes:safeNumber(item?.labor?.repairMinutes),finalQcMinutes:safeNumber(item?.labor?.finalQcMinutes),totalMinutes:safeNumber(item?.labor?.totalMinutes)},finalQc:{result:text(item?.finalQc?.result),note:text(item?.finalQc?.note)},generalNotes:Array.isArray(item?.generalNotes)?item.generalNotes.map(text).filter(Boolean):[],clientStatus:text(item?.clientStatus),followedByReturnId:text(item?.followedByReturnId)});
const normalizeReturn=item=>({returnId:text(item?.returnId),repairId:text(item?.repairId),returnedAt:text(item?.returnedAt),previousCompletedAt:text(item?.previousCompletedAt),previousRepairResult:text(item?.previousRepairResult),previousLaborMinutes:safeNumber(item?.previousLaborMinutes),confirmedBy:text(item?.confirmedBy)});
class SearchError extends Error {}
class EnrichmentError extends Error {}
const trusted = status => ['RESOLVED','LEGITIMATELY_EMPTY'].includes(status);
const terminalReasons = new Set(['auth_error','config_error','bad_request','http_error','upstream_rejection']);
const fieldState = (value, field) => {
  const status = field === 'model' ? value?.modelStatus || value?.status : value?.icssStatusStatus || value?.status;
  if (status === 'SUCCESS') return value?.[field] == null || text(value[field]) === '' ? 'LEGITIMATELY_EMPTY' : 'RESOLVED';
  if (status === 'NO_MATCH') return 'LEGITIMATELY_EMPTY';
  return terminalReasons.has(value?.reason) ? 'TERMINAL_FAILURE' : 'RETRYABLE_FAILURE';
};
function dateKey(v, timeZone) {
  if(v==null||v==='')return '';
  const d=new Date(typeof v==='string'&&/^\d+$/.test(v)?Number(v):v);
  if(!Number.isFinite(d.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
function dateTime(v,timeZone){if(v==null||v==='')return '';const d=new Date(typeof v==='string'&&/^\d+$/.test(v)?Number(v):v);if(!Number.isFinite(d.getTime()))return '';const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d),get=k=>parts.find(p=>p.type===k)?.value||'';return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;}
export function createTinecoInventoryService(config, records, snEnrichment = null, locationEnrichment = null) {
  return {async search(input={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new SearchError('Provide inventory filters.');
    if(!config.tinecoTocUnitTableId)throw new SearchError('TINECO TOC inventory table is not configured.');
    const query=Object.fromEntries(['trackingNumber','sn','location','model','icssStatus','repairFrom','repairTo','repairLevel','repairResult','clientStatus'].map(k=>[k,text(input[k])]));
    if(Object.values(query).some(v=>v.length>500))throw new SearchError('Filters must be at most 500 characters.');
    for(const k of ['repairFrom','repairTo'])if(query[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(query[k])||!Number.isFinite(Date.parse(query[k]))||new Date(query[k]).toISOString().slice(0,10)!==query[k]))throw new SearchError('Enter valid repair dates.');
    if(query.repairFrom&&query.repairTo&&query.repairFrom>query.repairTo)throw new SearchError('Repair Date From cannot be later than Repair Date To.');
    const requested=input.page??1;if(!Number.isSafeInteger(requested)||requested<1)throw new SearchError('Use a positive page number.');
    const args={appToken:config.appToken,tableId:config.tinecoTocUnitTableId};
    // The shared record service pages Feishu on the Worker; ordinary responses contain only 50 rows.
    const [raw,schema]=await Promise.all([records.listRecords(args),records.listFields(args)]);
    const inventory=raw.map(r=>{const repairs=parseHistory(r.fields?.['REPAIR HISTORY'],'repairs'),returns=parseHistory(r.fields?.['CLIENT RETURN HISTORY'],'returns'),repairHistory={schemaVersion:1,repairs:repairs.value.repairs.map(normalizeRepair)},clientReturnHistory={schemaVersion:1,returns:returns.value.returns.map(normalizeReturn)};return {recordId:r.record_id,laborMinutesPerStep:rawText(r.fields?.['LABOR MINUTES PER STEP']),clientReturnCount:Number(r.fields?.['CLIENT RETURN COUNT']||0),latestClientReturnAt:dateTime(r.fields?.['LATEST CLIENT RETURN AT'],config.warehouseTimeZone||'America/Toronto'),repairHistory,repairHistoryCount:repairHistory.repairs.length,repairHistoryValid:repairs.valid,clientReturnHistory,clientReturnHistoryValid:returns.valid,generalNote:text(r.fields?.['GENERAL NOTE']),...Object.fromEntries(COLUMNS.map(k=>[k,k==='LABOR MINUTES PER STEP'?rawText(r.fields?.[k]):k==='REPAIR DATE'?dateKey(r.fields?.[k],config.warehouseTimeZone||'America/Toronto'):['LATEST RE-ENTRY AT','LATEST CLIENT RETURN AT'].includes(k)?dateTime(r.fields?.[k],config.warehouseTimeZone||'America/Toronto'):k==='CLIENT RETURN COUNT'?String(Number(r.fields?.[k]||0)):text(r.fields?.[k])]))};});
    if(input.enrichmentBatch!==undefined){
      if(!Array.isArray(input.enrichmentBatch)||!input.enrichmentBatch.length||input.enrichmentBatch.length>ENRICHMENT_BATCH_LIMIT)throw new SearchError(`Enrichment batches must contain 1 to ${ENRICHMENT_BATCH_LIMIT} rows.`);
      const byId=new Map(inventory.map(row=>[row.recordId,row])),seen=new Set(),batch=[];
      for(const item of input.enrichmentBatch){const recordId=text(item?.recordId),sn=text(item?.sn),row=byId.get(recordId);if(!recordId||!sn||!row||text(row.SN)!==sn||seen.has(recordId))throw new SearchError('Enrichment batch contains an invalid inventory identity.');seen.add(recordId);batch.push(row);}
      const diagnostics={},snResolved=snEnrichment?await snEnrichment.enrich(batch):{enrichment:new Map(),diagnostic:{}},locationResolved=locationEnrichment?await locationEnrichment.enrich(batch):{enrichment:new Map(),diagnostic:{}};diagnostics.sn=snResolved.diagnostic;diagnostics.location=locationResolved.diagnostic;
      const results=batch.map(row=>{const hasSn=Boolean(text(row.SN)),extra=snResolved.enrichment.get(text(row.SN))||{status:hasSn?'NO_MATCH':'LOOKUP_FAILED',model:null,icssStatus:null,reason:hasSn?null:'bad_request'},location=locationResolved.enrichment.get(text(row.SN))||{status:hasSn?'LEGITIMATELY_EMPTY':'TERMINAL_FAILURE',locations:[],reason:hasSn?null:'bad_request'};return {recordId:row.recordId,sn:row.SN,model:extra.model,icssStatus:extra.icssStatus,snEnrichmentStatus:extra.status,modelEnrichmentStatus:fieldState(extra,'model'),icssEnrichmentStatus:fieldState(extra,'icssStatus'),location:(location.locations||[]).join('\n'),locationEnrichmentStatus:location.status};});
      return {results,diagnostics,batch:{requested:batch.length,resolved:results.length,limit:ENRICHMENT_BATCH_LIMIT}};
    }
    const options={};for(const field of ['REPAIR LEVEL','REPAIR RESULT','CLIENT STATUS'])options[field]=[...new Set([...(schema.find(f=>f.field_name===field)?.property?.options||[]).map(o=>o.name),...inventory.map(r=>r[field])].filter(Boolean))].sort();
    const workingSet=input.workingSet===true;
    const base=inventory.filter(r=>(workingSet||!query.repairLevel||r['REPAIR LEVEL']===query.repairLevel)&&(workingSet||!query.repairResult||r['REPAIR RESULT']===query.repairResult)&&(workingSet||!query.clientStatus||r['CLIENT STATUS']===query.clientStatus)&&(!query.repairFrom||(r['REPAIR DATE']&&r['REPAIR DATE']>=query.repairFrom))&&(!query.repairTo||(r['REPAIR DATE']&&r['REPAIR DATE']<=query.repairTo)));
    // Resolve each identifier's exact priority against the same non-identifier filtered set,
    // then intersect: both identifiers are AND filters without order-dependent fallback.
    const predicates=(workingSet?[]:[['sn','SN'],['trackingNumber','TRACKING NUMBER']]).filter(([k])=>query[k]).map(([k,field])=>{
      const q=norm(query[k]),exact=base.some(r=>norm(r[field])===q);
      return r=>{const value=norm(r[field]);return exact?value===q:Boolean(value)&&(value.includes(q)||q.includes(value));};
    });
    let filtered=base.filter(r=>predicates.every(p=>p(r))).sort((a,b)=>b['REPAIR DATE'].localeCompare(a['REPAIR DATE'])||a.recordId.localeCompare(b.recordId)),enrichmentStarted=Date.now();
    const authoritativeCount=filtered.length;
    if(workingSet)filtered=filtered.slice(0,WORKING_SET_LIMIT);
    if(workingSet&&input.baseOnly===true){for(const row of filtered){row.model=null;row.icssStatus=null;row.location='';row.snEnrichmentStatus='PENDING';row.modelEnrichmentStatus='PENDING';row.icssEnrichmentStatus='PENDING';row.locationEnrichmentStatus='PENDING';}const summary={found:filtered.length,pending:0,completed:0,disposal:0,totalLaborMinutes:0};for(const row of filtered){const status=row['CLIENT STATUS'];if(['Pending','Completed','Disposal'].includes(status))summary[status.toLowerCase()]++;const n=Number(row['LABOR MINUTES']);if(Number.isFinite(n))summary.totalLaborMinutes+=n;}return {query,options,summary,exportLimit:EXPORT_LIMIT,columns:COLUMNS,results:filtered,workingSet:{loaded:filtered.length,capped:authoritativeCount>WORKING_SET_LIMIT,limit:WORKING_SET_LIMIT,authoritativeCount},enrichment:{pending:filtered.length,complete:0},pagination:{page:1,pageSize:WORKING_SET_LIMIT,totalMatched:filtered.length,totalPages:1,hasPrevious:false,hasNext:false}};}
    let locationDiagnostic=null,locationFilterDiagnostics=null;
    if(query.location){
      if(!locationEnrichment)throw new EnrichmentError('Location search is not configured.');
      if(filtered.length>EXPORT_LIMIT)throw new SearchError(`Location search is limited to ${EXPORT_LIMIT} candidate records. Narrow the other filters.`);
      const resolved=await locationEnrichment.enrich(filtered);locationDiagnostic=resolved.diagnostic;const needle=normalizeLocationQuery(query.location),values=[];
      for(const row of filtered){const value=resolved.enrichment.get(text(row.SN))||{status:text(row.SN)?'LEGITIMATELY_EMPTY':'TERMINAL_FAILURE',locations:[],reason:text(row.SN)?null:'bad_request'};values.push(value);row.location=(value.locations||[]).join('\n');row.locationEnrichmentStatus=value.status;}
      locationFilterDiagnostics={attempted:values.length,resolved:values.filter(value=>value.status==='RESOLVED').length,legitimatelyEmpty:values.filter(value=>value.status==='LEGITIMATELY_EMPTY').length,unresolved:values.filter(value=>!trusted(value.status)).length,staleUsed:values.filter(value=>value.source==='stale-cache').length,retries:values.reduce((sum,value)=>sum+(value.retries||0),0)};
      const systemic=values.some(value=>['auth_error','config_error'].includes(value.reason))||(values.length>0&&!values.some(value=>trusted(value.status)));
      if(systemic)throw new EnrichmentError('Location filtering is temporarily unavailable. Retry the search.');
      if(input.export===true&&locationFilterDiagnostics.unresolved)throw new EnrichmentError('Some location data could not be verified. Retry the export.');
      filtered=filtered.filter(row=>trusted(row.locationEnrichmentStatus)&&normalizeLocationQuery(row.location).includes(needle));
    }
    let summary={found:filtered.length,pending:0,completed:0,disposal:0,totalLaborMinutes:0};
    for(const r of filtered){const status=r['CLIENT STATUS'];if(['Pending','Completed','Disposal'].includes(status))summary[status.toLowerCase()]++;const n=Number(r['LABOR MINUTES']);if(Number.isFinite(n))summary.totalLaborMinutes+=n;}
    if(input.export===true&&filtered.length>EXPORT_LIMIT)throw new SearchError(`Export is limited to ${EXPORT_LIMIT} filtered records. Narrow your filters; no partial workbook was exported.`);
    const totalPages=Math.max(1,Math.ceil(filtered.length/50)),page=Math.min(requested,totalPages);
    let results=input.export===true||workingSet?filtered:filtered.slice((page-1)*50,page*50),diagnostics={};
    if(snEnrichment){const {enrichment,diagnostic}=await snEnrichment.enrich(results),values=[];diagnostics.sn=diagnostic;for(const row of results){const hasSn=Boolean(text(row.SN)),extra=enrichment.get(text(row.SN))||{status:hasSn?'NO_MATCH':'LOOKUP_FAILED',model:null,icssStatus:null,reason:hasSn?null:'bad_request'};values.push(extra);row.model=extra.model;row.icssStatus=extra.icssStatus;row.snEnrichmentStatus=extra.status;row.modelEnrichmentStatus=fieldState(extra,'model');row.icssEnrichmentStatus=fieldState(extra,'icssStatus');}if(workingSet&&(values.some(value=>['auth_error','config_error'].includes(value.reason))||(values.length&&!values.some(value=>['SUCCESS','NO_MATCH'].includes(value.status)))))throw new EnrichmentError('MODEL and ICSS enrichment is temporarily unavailable. Retry the search.');}
    if(locationEnrichment&&!query.location){const resolved=await locationEnrichment.enrich(results),values=[];locationDiagnostic=resolved.diagnostic;for(const row of results){const value=resolved.enrichment.get(text(row.SN))||{status:text(row.SN)?'LEGITIMATELY_EMPTY':'TERMINAL_FAILURE',locations:[],reason:text(row.SN)?null:'bad_request'};values.push(value);row.location=(value.locations||[]).join('\n');row.locationEnrichmentStatus=value.status;}if(workingSet&&(values.some(value=>['auth_error','config_error'].includes(value.reason))||(values.length&&!values.some(value=>trusted(value.status)))))throw new EnrichmentError('LOCATION enrichment is temporarily unavailable. Retry the search.');}
    if((query.model||query.icssStatus)&&input.export===true){const modelNeedle=normalizeLocationQuery(query.model),icssNeedle=normalizeLocationQuery(query.icssStatus);results=results.filter(row=>(!modelNeedle||normalizeLocationQuery(row.model).includes(modelNeedle))&&(!icssNeedle||normalizeLocationQuery(row.icssStatus)===icssNeedle));filtered=results;summary={found:filtered.length,pending:0,completed:0,disposal:0,totalLaborMinutes:0};for(const r of filtered){const status=r['CLIENT STATUS'];if(['Pending','Completed','Disposal'].includes(status))summary[status.toLowerCase()]++;const n=Number(r['LABOR MINUTES']);if(Number.isFinite(n))summary.totalLaborMinutes+=n;}}
    if(locationDiagnostic)diagnostics.location=locationDiagnostic;diagnostics.durationMs=Date.now()-enrichmentStarted;
    const validation={model:{resolved:0,legitimatelyEmpty:0,retryableFailure:0,terminalFailure:0},location:{resolved:0,legitimatelyEmpty:0,retryableFailure:0,terminalFailure:0},icssStatus:{resolved:0,legitimatelyEmpty:0,retryableFailure:0,terminalFailure:0}};
    const count=(bucket,status)=>{if(status==='RESOLVED')bucket.resolved++;else if(status==='LEGITIMATELY_EMPTY')bucket.legitimatelyEmpty++;else if(status==='TERMINAL_FAILURE')bucket.terminalFailure++;else bucket.retryableFailure++;};
    for(const row of results){count(validation.model,row.modelEnrichmentStatus||'LEGITIMATELY_EMPTY');count(validation.location,row.locationEnrichmentStatus||'LEGITIMATELY_EMPTY');count(validation.icssStatus,row.icssEnrichmentStatus||'LEGITIMATELY_EMPTY');}
    if(input.export===true&&Object.values(validation).some(bucket=>bucket.retryableFailure||bucket.terminalFailure))throw new EnrichmentError(`Some API-enriched data could not be verified. MODEL: ${validation.model.retryableFailure+validation.model.terminalFailure} unresolved; LOCATION: ${validation.location.retryableFailure+validation.location.terminalFailure} unresolved; ICSS STATUS: ${validation.icssStatus.retryableFailure+validation.icssStatus.terminalFailure} unresolved.`);
    const responseSummary=workingSet?{found:results.length,pending:0,completed:0,disposal:0,totalLaborMinutes:0}:summary;if(workingSet)for(const r of results){const status=r['CLIENT STATUS'];if(['Pending','Completed','Disposal'].includes(status))responseSummary[status.toLowerCase()]++;const n=Number(r['LABOR MINUTES']);if(Number.isFinite(n))responseSummary.totalLaborMinutes+=n;}
    const responseTotalPages=Math.max(1,Math.ceil(filtered.length/50));
    return {query,options,summary:responseSummary,exportLimit:EXPORT_LIMIT,columns:COLUMNS,results,enrichment:{validation,diagnostics},...(workingSet?{workingSet:{loaded:results.length,capped:authoritativeCount>WORKING_SET_LIMIT,limit:WORKING_SET_LIMIT,authoritativeCount}}:{}),...(locationFilterDiagnostics?{locationFilterDiagnostics}:{}),pagination:{page,pageSize:workingSet?WORKING_SET_LIMIT:50,totalMatched:filtered.length,totalPages:workingSet?1:responseTotalPages,hasPrevious:workingSet?false:page>1,hasNext:workingSet?false:page<responseTotalPages}};
  }};
}
export async function handleTinecoInventory(service,input,id,request,env){
  try{return json({ok:true,data:await service.search(input)},200,request,env);}
  catch(e){const expected=e instanceof SearchError||e instanceof EnrichmentError;return errorResponse(e instanceof SearchError?400:502,'TINECO_INVENTORY_SEARCH_FAILED',expected?e.message:'Unable to load TINECO TOC inventory.',e instanceof EnrichmentError||!expected,id,request,env);}
}

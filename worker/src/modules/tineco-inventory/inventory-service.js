import { json, errorResponse } from '../../utils/response.js';
export const EXPORT_LIMIT = 5000;
export const COLUMNS = ['UNIT ID','SN','TRACKING NUMBER','CLIENT ID','WAREHOUSE','REPAIR DATE','TIMES OF RE-ENTER','CURRENT STEP','ISSUE FOUND','PRE-QC NOTE','PART USED DETAIL','TOTAL PARTS USED','LABOR MINUTES','REPAIR LEVEL','REPAIR RESULT','FINAL QC RESULT','FINAL QC NOTE','CLIENT STATUS'];
const text = v => Array.isArray(v) ? v.map(x => x.text || '').join('') : String(v ?? '').trim();
const norm = v => text(v).toLocaleUpperCase();
class SearchError extends Error {}
function dateKey(v, timeZone) {
  if(v==null||v==='')return '';
  const d=new Date(typeof v==='string'&&/^\d+$/.test(v)?Number(v):v);
  if(!Number.isFinite(d.getTime()))return '';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d);
  return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
}
export function createTinecoInventoryService(config, records) {
  return {async search(input={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new SearchError('Provide inventory filters.');
    if(!config.tinecoTocUnitTableId)throw new SearchError('TINECO TOC inventory table is not configured.');
    const query=Object.fromEntries(['trackingNumber','sn','repairFrom','repairTo','repairLevel','repairResult','clientStatus'].map(k=>[k,text(input[k])]));
    if(Object.values(query).some(v=>v.length>500))throw new SearchError('Filters must be at most 500 characters.');
    for(const k of ['repairFrom','repairTo'])if(query[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(query[k])||!Number.isFinite(Date.parse(query[k]))||new Date(query[k]).toISOString().slice(0,10)!==query[k]))throw new SearchError('Enter valid repair dates.');
    if(query.repairFrom&&query.repairTo&&query.repairFrom>query.repairTo)throw new SearchError('Repair Date From cannot be later than Repair Date To.');
    const requested=input.page??1;if(!Number.isSafeInteger(requested)||requested<1)throw new SearchError('Use a positive page number.');
    const args={appToken:config.appToken,tableId:config.tinecoTocUnitTableId};
    // The shared record service pages Feishu on the Worker; ordinary responses contain only 50 rows.
    const [raw,schema]=await Promise.all([records.listRecords(args),records.listFields(args)]);
    const inventory=raw.map(r=>({recordId:r.record_id,...Object.fromEntries(COLUMNS.map(k=>[k,k==='REPAIR DATE'?dateKey(r.fields?.[k],config.warehouseTimeZone||'America/Toronto'):text(r.fields?.[k])]))}));
    const options={};for(const field of ['REPAIR LEVEL','REPAIR RESULT','CLIENT STATUS'])options[field]=[...new Set([...(schema.find(f=>f.field_name===field)?.property?.options||[]).map(o=>o.name),...inventory.map(r=>r[field])].filter(Boolean))].sort();
    const base=inventory.filter(r=>(!query.repairLevel||r['REPAIR LEVEL']===query.repairLevel)&&(!query.repairResult||r['REPAIR RESULT']===query.repairResult)&&(!query.clientStatus||r['CLIENT STATUS']===query.clientStatus)&&(!query.repairFrom||(r['REPAIR DATE']&&r['REPAIR DATE']>=query.repairFrom))&&(!query.repairTo||(r['REPAIR DATE']&&r['REPAIR DATE']<=query.repairTo)));
    // Resolve each identifier's exact priority against the same non-identifier filtered set,
    // then intersect: both identifiers are AND filters without order-dependent fallback.
    const predicates=[['sn','SN'],['trackingNumber','TRACKING NUMBER']].filter(([k])=>query[k]).map(([k,field])=>{
      const q=norm(query[k]),exact=base.some(r=>norm(r[field])===q);
      return r=>{const value=norm(r[field]);return exact?value===q:Boolean(value)&&(value.includes(q)||q.includes(value));};
    });
    const filtered=base.filter(r=>predicates.every(p=>p(r))).sort((a,b)=>b['REPAIR DATE'].localeCompare(a['REPAIR DATE'])||a.recordId.localeCompare(b.recordId));
    const summary={found:filtered.length,pending:0,completed:0,disposal:0,totalLaborMinutes:0};
    for(const r of filtered){const status=r['CLIENT STATUS'];if(['Pending','Completed','Disposal'].includes(status))summary[status.toLowerCase()]++;const n=Number(r['LABOR MINUTES']);if(Number.isFinite(n))summary.totalLaborMinutes+=n;}
    if(input.export===true&&filtered.length>EXPORT_LIMIT)throw new SearchError(`Export is limited to ${EXPORT_LIMIT} filtered records. Narrow your filters; no partial workbook was exported.`);
    const totalPages=Math.max(1,Math.ceil(filtered.length/50)),page=Math.min(requested,totalPages);
    return {query,options,summary,exportLimit:EXPORT_LIMIT,columns:COLUMNS,results:input.export===true?filtered:filtered.slice((page-1)*50,page*50),pagination:{page,pageSize:50,totalMatched:filtered.length,totalPages,hasPrevious:page>1,hasNext:page<totalPages}};
  }};
}
export async function handleTinecoInventory(service,input,id,request,env){
  try{return json({ok:true,data:await service.search(input)},200,request,env);}
  catch(e){return errorResponse(e instanceof SearchError?400:502,'TINECO_INVENTORY_SEARCH_FAILED',e instanceof SearchError?e.message:'Unable to load TINECO TOC inventory.',!(e instanceof SearchError),id,request,env);}
}

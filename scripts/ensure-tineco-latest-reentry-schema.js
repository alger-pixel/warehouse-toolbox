// Local administration only. Discovery is read-only; --apply creates the field once.
const REQUIRED = Object.freeze({ field_name: 'LATEST RE-ENTRY AT', type: 5, property: { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false } });
const REQUIRED_FIELDS = Object.freeze([REQUIRED,{field_name:'CLIENT RETURN COUNT',type:2,property:{formatter:'0'}},{field_name:'LATEST CLIENT RETURN AT',type:5,property:{date_formatter:'yyyy-MM-dd HH:mm',auto_fill:false}},{field_name:'CLIENT RETURN HISTORY',type:1},{field_name:'REPAIR HISTORY',type:1}]);

function inspect(fields) {
  const matches = fields.filter(field => field.field_name === REQUIRED.field_name);
  if (matches.length > 1) throw Error(`DUPLICATE FIELD NAME: ${REQUIRED.field_name}`);
  if (!matches.length) return { missing: true, field: null };
  const field = matches[0];
  if (field.type !== REQUIRED.type) throw Error(`FIELD TYPE MISMATCH: ${REQUIRED.field_name}; existing type ${field.type}; expected type ${REQUIRED.type}`);
  if (field.property?.date_formatter !== REQUIRED.property.date_formatter) throw Error(`FIELD PROPERTY MISMATCH: ${REQUIRED.field_name}; existing date_formatter ${field.property?.date_formatter}; expected ${REQUIRED.property.date_formatter}`);
  return { missing: false, field };
}

async function ensureTinecoLatestReentrySchema(service, target, { apply = false } = {}) {
  const validate=(fields,definition)=>{const matches=fields.filter(field=>field.field_name===definition.field_name);if(matches.length>1)throw Error(`DUPLICATE FIELD NAME: ${definition.field_name}`);if(!matches.length)return null;const field=matches[0];if(field.type!==definition.type)throw Error(`FIELD TYPE MISMATCH: ${definition.field_name}; existing type ${field.type}; expected type ${definition.type}`);if(definition.type===5&&field.property?.date_formatter!==definition.property.date_formatter)throw Error(`FIELD PROPERTY MISMATCH: ${definition.field_name}`);return field;};
  let fields=await service.listFields(target),created=[];for(const definition of REQUIRED_FIELDS)validate(fields,definition);if(apply){for(const definition of REQUIRED_FIELDS){fields=await service.listFields(target);if(!validate(fields,definition)){const field=await service.createField({...target,field:definition});if(!field.field_id||field.field_name!==definition.field_name||field.type!==definition.type)throw Error(`FIELD CREATION VERIFICATION FAILED: ${definition.field_name}`);created.push(field);}}}
  fields=await service.listFields(target);const status=fields.find(field=>field.field_name==='CLIENT STATUS');if(!status||status.type!==3)throw Error('FIELD TYPE MISMATCH: CLIENT STATUS must be Single Select.');const requiredStatusOptions=['EC Check','Awaiting Parts'],missingStatusOptions=requiredStatusOptions.filter(name=>!status.property?.options?.some(option=>option.name===name)),statusOptionsAdded=[];if(apply&&missingStatusOptions.length){if(!service.updateField)throw Error('CLIENT STATUS options require updateField support.');await service.updateField({...target,fieldId:status.field_id,field:{field_name:status.field_name,type:status.type,property:{...status.property,options:[...(status.property?.options||[]),...missingStatusOptions.map(name=>({name}))]}}});statusOptionsAdded.push(...missingStatusOptions);}
  const final=await service.listFields(target),missing=REQUIRED_FIELDS.filter(definition=>!validate(final,definition)),finalStatus=final.find(field=>field.field_name==='CLIENT STATUS'),statusOption=finalStatus?.property?.options?.find(option=>option.name==='EC Check')||null,statusOptions=Object.fromEntries(requiredStatusOptions.map(name=>[name,finalStatus?.property?.options?.find(option=>option.name===name)||null])),optionReady=Object.values(statusOptions).every(Boolean);if(apply&&(missing.length||!optionReady))throw Error('FINAL TINECO SCHEMA INCOMPLETE');return {target:{tableId:target.tableId},mode:apply?'apply':'plan',missing,created,statusOptionAdded:statusOptionsAdded.includes('EC Check'),statusOptionsAdded,statusOption,statusOptions,fields:Object.fromEntries(REQUIRED_FIELDS.map(definition=>[definition.field_name,validate(final,definition)])),field:validate(final,REQUIRED),verified:!missing.length&&optionReady};
}

async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--apply', '--json'].includes(arg))) throw Error('Usage: node --env-file=worker/.dev.vars scripts/ensure-tineco-latest-reentry-schema.js [--apply] [--json]');
  const { getFeishuConfig } = await import('../worker/src/config/feishu-config.js');
  const { createFeishuAuthService } = await import('../worker/src/services/feishu-auth-service.js');
  const { createFeishuRecordService } = await import('../worker/src/services/feishu-record-service.js');
  const config = getFeishuConfig(process.env), target = { appToken: config.appToken, tableId: config.tinecoTocUnitTableId };
  if (!target.tableId) throw Error('FEISHU_TINECO_TOC_UNIT_TABLE_ID is not configured.');
  const service = createFeishuRecordService(createFeishuAuthService(config));
  const report = await ensureTinecoLatestReentrySchema(service, target, { apply: args.includes('--apply') });
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else console.log(`${report.created.length} fields created; ${report.missing.length} missing; ${report.verified ? 'verified' : 'apply required'}.`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { REQUIRED, REQUIRED_FIELDS, inspect, ensureTinecoLatestReentrySchema };

// Local administration only. Defaults to discovery; --apply creates missing fields.
// Run: node --env-file=worker/.dev.vars scripts/ensure-project-class-schema.js [--apply]
// Feishu type 1 is multiline text (also used for JSON); type 5 covers dates and date-times.
const TARGET = Object.freeze({ appToken: 'FGLSbhJ8taJ9KNsIp22cq9xDnuh', tableId: 'tbldVnRmtOLM1Jzw' });
const text = field_name => ({ field_name, type: 1 });
const select = (field_name, names) => ({ field_name, type: 3, property: { options: names.map((name, color) => ({ name, color })) } });
const date = (field_name, time = false) => ({ field_name, type: 5, property: { date_formatter: time ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd', auto_fill: false } });
const attachment = field_name => ({ field_name, type: 17 });
const number = field_name => ({ field_name, type: 2, property: { formatter: '0' } });
const REQUIRED_FIELDS = [
  text('PROJECT ID'), text('CLIENT ID'), text('PROJECT NAME'),
  select('PROJECT STATUS', ['Preparing', 'Activating', 'In-Progress', 'Finalizing', 'Awaiting Closing', 'Closed']),
  select('PROJECT TYPE', ['Refurbishment', 'Repair', 'Inspection', 'Repack', 'Relabel', 'Sorting', 'Re-Work', 'Other']),
  text('WAREHOUSE'), text('PROJECT OWNER'), text('ENGINEER'),
  date('START DATE'), date('TARGET END DATE'), date('ACTUAL END DATE'),
  text('PROJECT DATA'), text('PREPARATION DATA'),
  select('PREPARATION STATUS', ['Not Started', 'In Progress', 'Ready']),
  text('DAILY REPORT DATA'), text('FINAL REPORT DATA'), text('CLOSING DATA'),
  number('ORIGINAL PROJECT QUANTITY'), number('TOTAL PROJECT QUANTITY'), text('QUANTITY CHANGE DATA'),
  attachment('ACTIVATION SIGNATURE'), text('ACTIVATED BY'), date('ACTIVATED AT', true),
  attachment('DAILY REPORT ASSETS'), attachment('FINAL REPORT ASSETS'), attachment('CLOSING ASSETS'),
  number('TOTAL PROCESSED'), number('A GRADE QTY'), number('B GRADE QTY'), number('C GRADE QTY'), number('D GRADE QTY'),
  text('OPEN ISSUES'), text('IMPROVEMENT NOTES'), text('NOTE'),
  date('CREATED AT', true), text('CREATED BY'), date('UPDATED AT', true), text('UPDATED BY')
];

function compareSchema(fields) {
  const byName = new Map(), issues = [], missing = [];
  for (const field of fields) {
    if (byName.has(field.field_name)) issues.push(`DUPLICATE FIELD NAME: ${field.field_name}`);
    byName.set(field.field_name, field);
  }
  for (const required of REQUIRED_FIELDS) {
    const existing = byName.get(required.field_name);
    if (!existing) { missing.push(required); continue; }
    // A manually created PROJECT TYPE text field is an explicitly allowed V1 fallback.
    if (required.field_name === 'PROJECT TYPE' && existing.type === 1) continue;
    if (existing.type !== required.type) {
      issues.push(`FIELD TYPE MISMATCH: ${required.field_name}; existing type ${existing.type}; expected type ${required.type}`);
      continue;
    }
    if (required.type === 3) {
      const actual = (existing.property?.options || []).map(option => option.name).sort();
      const expected = required.property.options.map(option => option.name).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`FIELD OPTIONS MISMATCH: ${required.field_name}; existing ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);
    }
    if (required.type === 5 && existing.property?.date_formatter !== required.property.date_formatter) {
      issues.push(`FIELD PROPERTY MISMATCH: ${required.field_name}; existing date_formatter ${existing.property?.date_formatter}; expected ${required.property.date_formatter}`);
    }
  }
  return { missing, issues };
}

function assertCompatible(fields) {
  const result = compareSchema(fields);
  if (result.issues.length) throw new Error(result.issues.join('\n'));
  return result;
}

async function ensureProjectClassSchema(service, { apply = false, log = () => {} } = {}) {
  const before = await service.listFields(TARGET);
  log('Existing schema', before.map(({ field_name, type, field_id }) => ({ field_name, type, field_id })));
  const plan = assertCompatible(before), created = [];
  log('Missing fields', plan.missing.map(field => field.field_name));
  if (!apply) return { target: TARGET, mode: 'plan', before, missing: plan.missing, created, final: before, verified: plan.missing.length === 0 };
  for (const required of plan.missing) {
    // Re-discover before each write. Never blindly retry an ambiguous POST; rerun discovery instead.
    const current = await service.listFields(TARGET);
    const pending = assertCompatible(current).missing;
    if (!pending.some(field => field.field_name === required.field_name)) continue;
    const field = await service.createField({ ...TARGET, field: required });
    if (!field.field_id || field.field_name !== required.field_name || field.type !== required.type) {
      throw new Error(`FIELD CREATION VERIFICATION FAILED: ${required.field_name}. Re-run discovery before retrying.`);
    }
    created.push(field);
    log('Created field', { field_name: field.field_name, type: field.type, field_id: field.field_id });
  }
  const final = await service.listFields(TARGET), validation = assertCompatible(final);
  if (validation.missing.length) throw new Error(`FINAL SCHEMA INCOMPLETE: ${validation.missing.map(field => field.field_name).join(', ')}`);
  for (const original of before) {
    const saved = final.find(field => field.field_id === original.field_id);
    if (!saved || saved.field_name !== original.field_name || saved.type !== original.type || saved.is_primary !== original.is_primary) {
      throw new Error(`EXISTING FIELD CHANGED: ${original.field_name}`);
    }
  }
  return { target: TARGET, mode: 'apply', before, missing: plan.missing, created, final, verified: true };
}

async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--apply', '--json'].includes(arg))) throw new Error('Usage: node --env-file=worker/.dev.vars scripts/ensure-project-class-schema.js [--apply] [--json]');
  const { getFeishuConfig } = await import('../worker/src/config/feishu-config.js');
  const { createFeishuAuthService } = await import('../worker/src/services/feishu-auth-service.js');
  const { createFeishuRecordService } = await import('../worker/src/services/feishu-record-service.js');
  const service = createFeishuRecordService(createFeishuAuthService(getFeishuConfig(process.env)));
  const report = await ensureProjectClassSchema(service, {
    apply: args.includes('--apply'),
    log: args.includes('--json') ? () => {} : (message, data) => { console.log(message); console.table(data); }
  });
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.table(report.final.map(({ field_name, type, field_id }) => ({ field_name, type, field_id })));
    console.log(`${report.created.length} fields created; ${report.verified ? 'all required fields already exist and verify' : `${report.missing.length} fields missing (read-only plan; use --apply)`}.`);
  }
}
if (require.main === module) main().catch(error => {
  // Existing service errors deliberately suppress credentials and upstream payloads.
  console.error(error.message);
  if (error.feishuCode !== undefined) console.error(JSON.stringify({ operation: error.operation, feishuCode: error.feishuCode, httpStatus: error.httpStatus }));
  process.exitCode = 1;
});
module.exports = { TARGET, REQUIRED_FIELDS, compareSchema, ensureProjectClassSchema };

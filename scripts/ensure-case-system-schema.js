// Local administration only. Defaults to read-only discovery.
const fs = require('node:fs');
const path = require('node:path');

const BASE_ID = 'FGLSbhJ8taJ9KNsIp22cq9xDnuh';
const text = field_name => ({ field_name, type: 1 });
const select = (field_name, names) => ({ field_name, type: 3, property: { options: names.map((name, color) => ({ name, color })) } });
const number = field_name => ({ field_name, type: 2, property: { formatter: '0' } });
const dateTime = field_name => ({ field_name, type: 5, property: { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false } });
const attachment = field_name => ({ field_name, type: 17 });

const TABLES = Object.freeze([
  {
    key: 'caseCategory', name: 'CASE CATEGORY', tableId: 'tblwFyckkj7CxLnt', identity: 'CASE CATEGORY ID',
    purpose: 'Manager-maintained warehouse Case templates.',
    fields: [
      text('CASE CATEGORY ID'), text('CLIENT ID'), select('MAIN CATEGORY', ['Receiving', 'In-House Daily', 'Replenishing', 'Inventory', 'Shipping', 'Other']),
      text('CASE CATEGORY NAME'), text('WAREHOUSE ID'), select('STATUS', ['Active', 'Inactive']), select('DEFAULT PRIORITY', ['Normal', 'Urgent']),
      text('DEFAULT INSTRUCTION'), text('MANDATORY QUESTIONS'), text('ISSUE OPTIONS'), select('REQUIRE COMPLETION PHOTO', ['Yes', 'No']),
      number('SORT ORDER'), dateTime('CREATED AT'), text('CREATED BY'), dateTime('UPDATED AT'), text('UPDATED BY'), text('NOTE')
    ]
  },
  {
    key: 'caseClass', name: 'CASE CLASS', tableId: 'tbluJiLs4arOJgt6', identity: 'CASE ID',
    purpose: 'One row per operational Case, including assignments, snapshots, reports, evidence, issue state, completion, and audit data.',
    fields: [
      text('CASE ID'), text('CASE TITLE'), select('STATUS', ['Assigned', 'In Progress', 'Pending With Issue', 'Completed']), select('PRIORITY', ['Normal', 'Urgent']),
      text('WAREHOUSE ID'), text('CLIENT ID'), text('CASE CATEGORY ID'), text('MAIN CATEGORY'), text('CASE CATEGORY NAME'), text('ASSIGNED USERS'),
      text('CASE INSTRUCTION'), text('QUESTION SNAPSHOT'), text('ISSUE OPTIONS SNAPSHOT'), attachment('CASE ATTACHMENTS'), dateTime('DUE AT'),
      text('REPORT DATA'), attachment('REPORT ASSETS'), text('CURRENT ISSUE CATEGORY'), text('CURRENT ISSUE DATA'), text('LAST REPORTED BY'),
      dateTime('LAST REPORTED AT'), text('COMPLETED BY'), dateTime('COMPLETED AT'), text('CREATED BY'), dateTime('CREATED AT'),
      text('UPDATED BY'), dateTime('UPDATED AT'), text('NOTE')
    ]
  }
]);

const target = table => ({ appToken: BASE_ID, tableId: table.tableId });
const optionNames = field => (field.property?.options || []).map(option => option.name);
function compareTable(table, fields) {
  const byName = new Map(), issues = [], missing = [];
  for (const field of fields) {
    if (byName.has(field.field_name)) issues.push(`DUPLICATE FIELD NAME: ${table.name}.${field.field_name}`);
    byName.set(field.field_name, field);
  }
  const identityExists = byName.has(table.identity);
  const primaryCandidates = fields.filter(field => field.is_primary);
  let reusablePrimary = null;
  if (!identityExists) {
    if (primaryCandidates.length === 1 && primaryCandidates[0].type === 1) reusablePrimary = primaryCandidates[0];
    else if (primaryCandidates.length) issues.push(`PRIMARY FIELD CANNOT BE REUSED: ${table.name}; expected one primary Text field for ${table.identity}`);
  }
  for (const required of table.fields) {
    const existing = byName.get(required.field_name);
    if (!existing) {
      if (!(required.field_name === table.identity && reusablePrimary)) missing.push(required);
      continue;
    }
    if (existing.type !== required.type) {
      issues.push(`FIELD TYPE MISMATCH: ${table.name}.${required.field_name}; field ID ${existing.field_id}; existing type ${existing.type}; required type ${required.type}`);
      continue;
    }
    if (required.type === 3) {
      const actual = optionNames(existing).sort(), expected = optionNames(required).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`FIELD OPTIONS MISMATCH: ${table.name}.${required.field_name}; existing ${JSON.stringify(actual)}; required ${JSON.stringify(expected)}`);
    }
    if (required.type === 5 && existing.property?.date_formatter !== required.property.date_formatter) issues.push(`FIELD PROPERTY MISMATCH: ${table.name}.${required.field_name}; field ID ${existing.field_id}; existing date_formatter ${existing.property?.date_formatter}; required ${required.property.date_formatter}`);
  }
  return { missing, issues, reusablePrimary };
}

function assertCompatible(table, fields) {
  const result = compareTable(table, fields);
  if (result.issues.length) throw Error(result.issues.join('\n'));
  return result;
}

async function ensureCaseSystemSchema(service, { apply = false } = {}) {
  const before = {};
  for (const table of TABLES) before[table.key] = await service.listFields(target(table));
  const plans = Object.fromEntries(TABLES.map(table => [table.key, assertCompatible(table, before[table.key])]));
  if (!apply) return { baseId: BASE_ID, mode: 'plan', tables: Object.fromEntries(TABLES.map(table => [table.key, { tableId: table.tableId, before: before[table.key], missing: plans[table.key].missing, reusablePrimary: plans[table.key].reusablePrimary, created: [], final: before[table.key], verified: plans[table.key].missing.length === 0 && !plans[table.key].reusablePrimary }])) };
  const results = {};
  for (const table of TABLES) {
    const created = [], renamed = [];
    let current = await service.listFields(target(table));
    let plan = assertCompatible(table, current);
    if (plan.reusablePrimary) {
      const original = plan.reusablePrimary;
      const changed = await service.updateField({ ...target(table), fieldId: original.field_id, field: text(table.identity) });
      if (!changed.field_id || changed.field_id !== original.field_id || changed.field_name !== table.identity || changed.type !== 1) throw Error(`PRIMARY FIELD RENAME VERIFICATION FAILED: ${table.name}.${table.identity}`);
      renamed.push({ field_id: changed.field_id, from: original.field_name, to: table.identity });
    }
    for (const required of table.fields) {
      current = await service.listFields(target(table));
      plan = assertCompatible(table, current);
      if (!plan.missing.some(field => field.field_name === required.field_name)) continue;
      const field = await service.createField({ ...target(table), field: required });
      if (!field.field_id || field.field_name !== required.field_name || field.type !== required.type) throw Error(`FIELD CREATION VERIFICATION FAILED: ${table.name}.${required.field_name}. Re-run discovery before retrying.`);
      created.push(field);
    }
    const final = await service.listFields(target(table)), validation = assertCompatible(table, final);
    if (validation.missing.length || validation.reusablePrimary) throw Error(`FINAL SCHEMA INCOMPLETE: ${table.name}`);
    for (const original of before[table.key]) {
      const saved = final.find(field => field.field_id === original.field_id), allowedRename = renamed.some(item => item.field_id === original.field_id);
      if (!saved || saved.type !== original.type || saved.is_primary !== original.is_primary || (!allowedRename && saved.field_name !== original.field_name)) throw Error(`EXISTING FIELD CHANGED: ${table.name}.${original.field_name}`);
    }
    results[table.key] = { tableId: table.tableId, before: before[table.key], missing: [], renamed, created, final, verified: true };
  }
  return { baseId: BASE_ID, mode: 'apply', tables: results };
}

const TYPE_NAMES = { 1: 'Text / Long Text', 2: 'Number', 3: 'Single Select', 5: 'Date & Time', 17: 'Attachment' };
function renderDocumentation(report) {
  const lines = ['# Case System V1 — Lark Schema', '', `Base ID: \`${BASE_ID}\``, '', 'Schema-only foundation. No Case Category, Case, report, issue, assignment, or USER CLASS records are created or modified.', ''];
  for (const table of TABLES) {
    const result = report.tables[table.key];
    lines.push(`## ${table.name}`, '', `Table ID: \`${table.tableId}\``, '', table.purpose, '', `Primary identity: the original default primary Text field was reused as \`${table.identity}\` and retains field ID \`${result.final.find(item => item.field_name === table.identity)?.field_id || 'missing'}\`.`, '', '| Field | Type | Field ID | Single Select options | Purpose |', '|---|---|---|---|---|');
    for (const required of table.fields) {
      const field = result.final.find(item => item.field_name === required.field_name), options = (field?.property?.options || []).map(option => `${option.name} (\`${option.id || 'ID unavailable'}\`)`).join('<br>');
      const jsonPurpose = ['MANDATORY QUESTIONS','ISSUE OPTIONS','ASSIGNED USERS','QUESTION SNAPSHOT','ISSUE OPTIONS SNAPSHOT','REPORT DATA','CURRENT ISSUE DATA'].includes(required.field_name) ? 'Versioned structured JSON.' : required.field_name === 'CLIENT ID' && table.key === 'caseCategory' ? 'Identifies the client that owns this Case Category.' : required.field_name === 'CASE TITLE' ? 'Optional manager-supplied Case title.' : '';
      lines.push(`| ${required.field_name} | ${TYPE_NAMES[required.type]} | \`${field?.field_id || 'missing'}\` | ${options || '—'} | ${jsonPurpose || '—'} |`);
    }
    lines.push('', `Verified: **${result.verified ? 'Yes' : 'No'}**. Created on this run: **${result.created.length}**. Reused primary fields: **${result.renamed.length}**.`, '');
  }
  lines.push('## Validation', '', `Run mode: \`${report.mode}\``, '', 'A second idempotency run must report zero created fields, zero missing fields, and zero type or option mismatches.', '');
  return lines.join('\n');
}

async function main(args = process.argv.slice(2)) {
  if (args.some(arg => !['--apply', '--json', '--docs'].includes(arg))) throw Error('Usage: node --env-file=worker/.dev.vars scripts/ensure-case-system-schema.js [--apply] [--json] [--docs]');
  const { getFeishuConfig } = await import('../worker/src/config/feishu-config.js');
  const { createFeishuAuthService } = await import('../worker/src/services/feishu-auth-service.js');
  const { createFeishuRecordService } = await import('../worker/src/services/feishu-record-service.js');
  const service = createFeishuRecordService(createFeishuAuthService(getFeishuConfig(process.env)));
  const report = await ensureCaseSystemSchema(service, { apply: args.includes('--apply') });
  if (args.includes('--docs')) fs.writeFileSync(path.join(__dirname, '..', 'docs', 'case-system-schema.md'), renderDocumentation(report));
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else for (const table of TABLES) console.log(`${table.name}: ${report.tables[table.key].created.length} created; ${report.tables[table.key].missing.length} missing; ${report.tables[table.key].verified ? 'verified' : 'apply required'}.`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { BASE_ID, TABLES, compareTable, ensureCaseSystemSchema, renderDocumentation };

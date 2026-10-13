const test = require('node:test');
const assert = require('node:assert/strict');
const { TARGET, REQUIRED_FIELDS, compareSchema, ensureProjectClassSchema } = require('../scripts/ensure-project-class-schema.js');
const full = () => REQUIRED_FIELDS.map((field, i) => ({ ...structuredClone(field), field_id: `fld-${i}`, is_primary: i === 0 }));
function fixture(initial = full().slice(0, 2)) {
  const fields = structuredClone(initial), writes = [];
  return { fields, writes, service: {
    async listFields(target) { assert.deepEqual(target, TARGET); return structuredClone(fields); },
    async createField({ appToken, tableId, field }) {
      assert.deepEqual({ appToken, tableId }, TARGET);
      assert.ok(!fields.some(existing => existing.field_name === field.field_name));
      const made = { ...structuredClone(field), field_id: `new-${writes.length}`, is_primary: false };
      writes.push(made); fields.push(made); return structuredClone(made);
    }
  } };
}
test('read-only default discovers 36 missing fields and preserves the two existing IDs', async () => {
  const f = fixture(), result = await ensureProjectClassSchema(f.service);
  assert.equal(REQUIRED_FIELDS.length, 38); assert.equal(result.missing.length, 36); assert.equal(f.writes.length, 0);
  assert.equal(result.verified, false); assert.deepEqual(result.before.map(f => f.field_id), ['fld-0', 'fld-1']);
});
test('apply creates only missing fields and verifies all types/options; second apply writes nothing', async () => {
  const f = fixture(), result = await ensureProjectClassSchema(f.service, { apply: true });
  assert.equal(result.created.length, 36); assert.equal(result.final.length, 38); assert.equal(result.verified, true);
  assert.deepEqual(compareSchema(result.final), { missing: [], issues: [] });
  const second = await ensureProjectClassSchema(f.service, { apply: true });
  assert.equal(second.created.length, 0); assert.equal(second.missing.length, 0); assert.equal(f.writes.length, 36);
  assert.deepEqual(second.final.slice(0, 2), full().slice(0, 2));
});
test('incompatible existing type blocks all writes even if other fields are missing', async () => {
  const f = fixture([...full().slice(0, 2), { field_name: 'UPDATED AT', type: 1, field_id: 'wrong' }]);
  await assert.rejects(ensureProjectClassSchema(f.service, { apply: true }), /FIELD TYPE MISMATCH: UPDATED AT; existing type 1; expected type 5/);
  assert.equal(f.writes.length, 0);
});
test('incorrect select options block mutation without replacing or deleting existing options', async () => {
  const fields = full(), status = fields.find(f => f.field_name === 'PROJECT STATUS');
  status.property.options.push({ name: 'Invented Status' }); const f = fixture(fields);
  await assert.rejects(ensureProjectClassSchema(f.service, { apply: true }), /FIELD OPTIONS MISMATCH: PROJECT STATUS/);assert.equal(f.writes.length, 0);
});
test('existing PROJECT TYPE text is accepted; duplicate names and incorrect date formats are rejected', () => {
  const fields = full();fields.find(f => f.field_name === 'PROJECT TYPE').type = 1;assert.equal(compareSchema(fields).issues.length, 0);
  fields.push(fields[0]);assert.match(compareSchema(fields).issues.join('\n'), /DUPLICATE FIELD NAME/);
  fields.pop();fields.find(f => f.field_name === 'ACTIVATED AT').property.date_formatter = 'yyyy-MM-dd';assert.match(compareSchema(fields).issues.join('\n'), /FIELD PROPERTY MISMATCH: ACTIVATED AT/);
});
test('re-discovery avoids recreating a field added after initial discovery', async () => {
  const f = fixture(), list = f.service.listFields;let reads = 0;
  f.service.listFields = async target => { if (++reads === 2) f.fields.push(full()[2]);return list(target); };
  const result = await ensureProjectClassSchema(f.service, { apply: true });assert.equal(result.created.length, 35);assert.equal(result.final.length, 38);
});
test('ambiguous creation is not retried blindly; rerun discovers the saved field and resumes', async () => {
  const f = fixture(), create = f.service.createField;let first = true;
  f.service.createField = async args => { const result = await create(args);if (first) { first = false;throw new Error('network failure after save'); }return result; };
  await assert.rejects(ensureProjectClassSchema(f.service, { apply: true }), /network failure after save/);assert.equal(f.writes.length, 1);
  const result = await ensureProjectClassSchema(f.service, { apply: true });assert.equal(result.created.length, 35);assert.equal(f.fields.length, 38);
});
test('existing unrelated fields are preserved; a broken creation response stops execution', async () => {
  const f = fixture([...full(), { field_name: 'KEEP ME', type: 1, field_id: 'untouched' }]);
  assert.equal((await ensureProjectClassSchema(f.service, { apply: true })).final.length, 39);
  const broken = fixture();broken.service.createField = async () => ({});
  await assert.rejects(ensureProjectClassSchema(broken.service, { apply: true }), /FIELD CREATION VERIFICATION FAILED/);
});
test('schema uses multiline text for JSON, attachments for assets, and non-autofill date-time audit fields', () => {
  for (const name of ['PROJECT DATA', 'PREPARATION DATA', 'DAILY REPORT DATA', 'QUANTITY CHANGE DATA', 'FINAL REPORT DATA', 'CLOSING DATA']) assert.equal(REQUIRED_FIELDS.find(f => f.field_name === name).type, 1);
  for (const name of ['ACTIVATED AT', 'CREATED AT', 'UPDATED AT']) assert.deepEqual(REQUIRED_FIELDS.find(f => f.field_name === name).property, { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false });
  assert.equal(REQUIRED_FIELDS.filter(f => f.type === 17).length, 4);
  assert.equal(REQUIRED_FIELDS.filter(f => f.type === 2).length, 7);
});

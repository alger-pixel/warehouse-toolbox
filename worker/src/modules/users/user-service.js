import { hashPassword } from './password.js';
export class UserError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const fail = (code, message, status) => { throw new UserError(code, message, status); };
const text = value => Array.isArray(value) ? value.map(v => v.text || '').join('') : String(value ?? '');
export const parseAccess = value => [...new Set(text(value).split('|').map(v => v.trim()).filter(Boolean))];
export const isActiveAdmin = user => user.status === 'Active' && user.isAdmin === true;
export const hasToolAccess = (user, tool) => user.status === 'Active' && (isActiveAdmin(user) || (user.warehouses.includes(tool.warehouse) && user.clients.includes(tool.clientId) && user.toolIds.includes(tool.toolId)));
export function publicUser(record) {
  const f = record.fields || {};
  return { userId: text(f['USER ID']), account: text(f.ACCOUNT), displayName: text(f['DISPLAY NAME']), status: text(f.STATUS), isAdmin: text(f['IS ADMIN']) === 'Admin', warehouses: parseAccess(f['WAREHOUSE ACCESS']), clients: parseAccess(f['CLIENT ACCESS']), toolIds: parseAccess(f['ACCESSIBLE TOOL IDS']), createdDate: f['CREATED DATE'] ?? null, updatedDate: f['UPDATED DATE'] ?? null, lastLogin: f['LAST LOGIN'] ?? null };
}
const REQUIRED_FIELDS = ['USER ID','ACCOUNT','DISPLAY NAME','PASSWORD HASH','STATUS','IS ADMIN','WAREHOUSE ACCESS','CLIENT ACCESS','ACCESSIBLE TOOL IDS','CREATED DATE','UPDATED DATE','LAST LOGIN'];
function access(value, label) {
  if (!Array.isArray(value) || value.length > 500 || value.some(v => typeof v !== 'string' || !v.trim() || v.length > 160 || /[|\u0000-\u001f]/.test(v))) fail('INVALID_ACCESS', `${label} must contain valid individual identifiers.`);
  return [...new Set(value.map(v => v.trim()))];
}
function required(value, label, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) fail('INVALID_USER', `${label} is required and must be valid text.`);
  return value.trim();
}
export function createUserService(config, records, storage, { hash = hashPassword, now = Date.now } = {}) {
  const args = tableId => ({ appToken: config.appToken, tableId });
  function configured() { if (!config.userTableId || !config.toolTableId) fail('USER_MANAGEMENT_NOT_CONFIGURED', 'Configure USER CLASS and TOOL CLASS table IDs on the Worker.', 503); }
  async function users() {
    configured();
    const rows = await records.listRecords(args(config.userTableId));
    const ids = new Set(), accounts = new Set();
    for (const row of rows) {
      const u = publicUser(row), account = u.account.trim().toUpperCase();
      if (!u.userId || !account || ids.has(u.userId) || accounts.has(account)) fail('USER_DATA_CONFLICT', 'USER CLASS has missing or duplicate identities. Review the table before making changes.', 409);
      ids.add(u.userId); accounts.add(account);
    }
    return rows;
  }
  async function tools() {
    configured();
    const rows = await records.listRecords(args(config.toolTableId)), ids = new Set(), result = [];
    for (const row of rows) {
      const f = row.fields || {}, toolId = text(f['TOOL ID']).trim();
      if (!toolId) continue;
      if (ids.has(toolId)) fail('TOOL_DATA_CONFLICT', 'TOOL CLASS contains duplicate Tool IDs.', 409);
      ids.add(toolId);
      result.push({ toolId, name: text(f['TOOL NAME']), warehouse: text(f.WAREHOUSE).trim(), clientId: text(f['CLIENT ID']).trim(), status: text(f.STATUS) || 'Active' });
    }
    return result;
  }
  const matches = (record, fields) => record && Object.entries(fields).every(([key, value]) => typeof value === 'number' ? record.fields[key] === value : text(record.fields[key]) === text(value));
  async function reconcile(rows) {
    const pending = await storage.get('pending');
    if (!pending) return;
    const row = rows.find(r => text(r.fields['USER ID']) === pending.userId);
    if (!matches(row, pending.fields)) fail('WRITE_UNCONFIRMED', 'A previous user write is not confirmed. Reload users to reconcile it; do not create a replacement account. If it persists, review USER CLASS and the pending administrative operation.', 409);
    await storage.put(`request:${pending.requestId}`, { fingerprint: pending.fingerprint, user: publicUser(row) });
    await storage.delete('pending');
  }
  async function save(body, create) {
    configured();
    if (!storage) fail('COORDINATOR_REQUIRED', 'User writes require the administrative coordinator.', 503);
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail('INVALID_USER', 'A user object is required.');
    const requestId = required(body.requestId, 'Request identity', 80);
    if (!/^[a-zA-Z0-9-]{16,80}$/.test(requestId)) fail('INVALID_REQUEST_ID', 'A valid request identity is required.');
    // HMAC prevents an operation fingerprint becoming an offline password oracle.
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(config.managementSecret), { name:'HMAC', hash:'SHA-256' }, false, ['sign']);
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(JSON.stringify({ create, body })))), b => b.toString(16).padStart(2,'0')).join('');
    const rows = await users();
    await reconcile(rows);
    const previous = await storage.get(`request:${requestId}`);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', 'This request identity belongs to a different edit.', 409);
      return previous.user;
    }
    const schema = new Set((await records.listFields(args(config.userTableId))).map(f => f.field_name));
    if (REQUIRED_FIELDS.some(f => !schema.has(f))) fail('USER_SCHEMA_ERROR', 'USER CLASS is missing a required field.', 409);
    const existing = create ? null : rows.find(r => publicUser(r).userId === body.userId);
    if (create && body.userId) fail('IMMUTABLE_USER_ID', 'USER ID is generated by the server.');
    if (!create && !existing) fail('USER_NOT_FOUND', 'User not found.', 404);
    const account = required(body.account, 'Account'), displayName = required(body.displayName, 'Display name');
    if (rows.some(r => r !== existing && publicUser(r).account.trim().toUpperCase() === account.toUpperCase())) fail('ACCOUNT_EXISTS', 'An account with this name already exists.', 409);
    if (!['Active','Disabled'].includes(body.status) || typeof body.isAdmin !== 'boolean') fail('INVALID_USER', 'Choose a valid status and administrator setting.');
    const warehouses = access(body.warehouses, 'Warehouse access'), clients = access(body.clients, 'Client access'), toolIds = access(body.toolIds, 'Tool access');
    const catalog = await tools(), byId = new Map(catalog.map(t => [t.toolId,t]));
    for (const id of toolIds) {
      const t = byId.get(id);
      if (!t || t.status !== 'Active') fail('INVALID_TOOL', 'Assigned tools must exist and be Active in TOOL CLASS.');
      if (!body.isAdmin && (!warehouses.includes(t.warehouse) || !clients.includes(t.clientId))) fail('TOOL_SCOPE_MISMATCH', 'Assigned tools must belong to the selected warehouse and client scope.');
    }
    const remainingAdmins = rows.filter(r => r.record_id !== existing?.record_id && isActiveAdmin(publicUser(r))).length + Number(body.status === 'Active' && body.isAdmin);
    if (remainingAdmins < 1) fail('LAST_ADMIN', 'The final Active Admin cannot be disabled or demoted. At least one Active Admin must remain.', 409);
    const password = body.password ?? '';
    if (typeof password !== 'string' || (password && (Array.from(password).length < 6 || !/[a-z]/i.test(password) || !/[0-9]/.test(password) || new TextEncoder().encode(password).length > 1024))) fail('INVALID_PASSWORD', 'Use at least 6 characters, including a letter (A–Z) and a number (0–9), and at most 1024 UTF-8 bytes.');
    if (create && !password) fail('PASSWORD_REQUIRED', 'A password is required for new users.');
    let userId = existing ? publicUser(existing).userId : '';
    if (create) {
      const max = Math.max(0, ...rows.map(r => /^U-\d+$/.test(publicUser(r).userId) ? Number(publicUser(r).userId.slice(2)) : 0), Number(await storage.get('lastUserNumber')) || 0);
      if (!Number.isSafeInteger(max) || max >= 999999999) fail('USER_ID_EXHAUSTED', 'User numbering requires administrative review.', 409);
      userId = `U-${String(max + 1).padStart(4,'0')}`;
      await storage.put('lastUserNumber', max + 1);
    }
    const fields = { ACCOUNT:account, 'DISPLAY NAME':displayName, STATUS:body.status, 'IS ADMIN':body.isAdmin ? 'Admin' : null, 'WAREHOUSE ACCESS':warehouses.join('|'), 'CLIENT ACCESS':clients.join('|'), 'ACCESSIBLE TOOL IDS':toolIds.join('|'), 'UPDATED DATE':now() };
    if (create) Object.assign(fields, { 'USER ID':userId, 'CREATED DATE':fields['UPDATED DATE'] });
    if (password) fields['PASSWORD HASH'] = await hash(password);
    // Persist the intent before the external write. Never persist plaintext passwords.
    await storage.put('pending', { requestId, fingerprint, userId, fields });
    if (create) await records.createRecord({ ...args(config.userTableId), fields });
    else await records.updateRecord({ ...args(config.userTableId), recordId:existing.record_id, fields });
    const user = publicUser({ fields:{ ...(existing?.fields || {}), ...fields } });
    await storage.put(`request:${requestId}`, { fingerprint, user });
    await storage.delete('pending');
    return user;
  }
  return {
    async list() { return (await users()).map(publicUser); },
    async get(body) { const found = (await users()).find(r => publicUser(r).userId === body?.userId); if (!found) fail('USER_NOT_FOUND', 'User not found.',404); return publicUser(found); },
    tools, create: body => save(body, true), update: body => save(body, false)
  };
}

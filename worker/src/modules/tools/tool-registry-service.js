import '../../../../js/client-tools-registry.js';
import '../../../../js/in-house-tools-registry.js';
const registry = { all: () => [...globalThis.MkiteClientToolRegistry.all(), ...globalThis.MkiteInHouseToolRegistry.all().filter(tool => tool.toolId)] };
const text = value => Array.isArray(value) ? value.map(v => v.text || '').join('') : String(value ?? '');
export function createToolRegistryService(config, records, source = registry) {
  let syncing = false;
  const args = () => {
    if (!config.toolTableId) throw new Error('TOOL_CLASS_NOT_CONFIGURED');
    return { appToken: config.appToken, tableId: config.toolTableId };
  };
  async function find(toolId) {
    const matches = (await records.listRecords(args())).filter(r => text(r.fields?.['TOOL ID']) === toolId);
    if (matches.length > 1) throw new Error('DUPLICATE_TOOL_ID');
    return matches[0] || null;
  }
  return { find, async sync() {
    // Trusted manual caller only. Not routed publicly. Caller must serialize across processes.
    if (syncing) throw new Error('TOOL_SYNC_IN_PROGRESS');
    syncing = true;
    try {
      const tools = source.all(), ids = new Set();
      for (const tool of tools) { if (!tool.toolId || ids.has(tool.toolId)) throw new Error('DUPLICATE_TOOL_ID'); ids.add(tool.toolId); }
      const fields = await records.listFields(args()), names = new Set(fields.map(f => f.field_name));
      for (const name of ['TOOL ID', 'TOOL NAME', 'WAREHOUSE', 'CLIENT ID', 'TOOL TYPE', 'ROUTE']) if (!names.has(name)) throw new Error('TOOL_CLASS_SCHEMA_ERROR');
      const results = [];
      for (const tool of tools) {
        const desired = { 'TOOL ID': tool.toolId, 'TOOL NAME': tool.name, WAREHOUSE: tool.warehouse, 'CLIENT ID': tool.clientId, 'TOOL TYPE': tool.toolType, ROUTE: tool.route };
        if (tool.dataFields) { if (!names.has('DATA FIELDS')) throw new Error('TOOL_CLASS_SCHEMA_ERROR: DATA FIELDS is required for this tool'); desired['DATA FIELDS'] = JSON.stringify(tool.dataFields); }
        if (names.has('STATUS')) desired.STATUS = tool.status.toLowerCase() === 'active' ? 'Active' : 'Inactive';
        const existing = await find(tool.toolId);
        if (!existing) { await records.createRecord({ ...args(), fields: desired }); results.push({ toolId: tool.toolId, action: 'created' }); }
        else {
          const changed = Object.fromEntries(Object.entries(desired).filter(([key, value]) => key !== 'TOOL ID' && text(existing.fields[key]) !== value));
          if (Object.keys(changed).length) await records.updateRecord({ ...args(), recordId: existing.record_id, fields: changed });
          results.push({ toolId: tool.toolId, action: Object.keys(changed).length ? 'updated' : 'unchanged' });
        }
      }
      return results;
    } finally { syncing = false; }
  } };
}

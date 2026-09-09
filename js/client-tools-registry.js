(function (root) {
  'use strict';
  const norm = value => String(value || '').trim().toUpperCase();
  function createRegistry(entries) {
    const ids = new Set();
    const tools = entries.map(entry => {
      if (!entry.toolId || ids.has(entry.toolId) || !entry.warehouse || !entry.clientId || !entry.route) throw new Error('CLIENT_TOOL_CONFIGURATION_ERROR: missing identity or duplicate Tool ID');
      ids.add(entry.toolId); return Object.freeze({ status: 'active', ...entry });
    });
    return Object.freeze({
      all() { return tools.slice(); },
      filter({ warehouse = '', clientId = '', query = '' } = {}) { return tools.filter(t => t.status.toLowerCase() === 'active' && (!warehouse || norm(t.warehouse) === norm(warehouse)) && (!clientId || norm(t.clientId) === norm(clientId)) && (!query || norm(`${t.name} ${t.toolId}`).includes(norm(query)))); },
      forClient(clientId, warehouse) { return this.filter({ clientId, warehouse }); },
      get(clientId, slug, warehouse) {
        // Only the established B044 legacy route has an implicit warehouse.
        const resolved = warehouse || (norm(clientId) === 'B044' && slug === 'put-away-scan' ? 'MKS66' : '');
        if (!resolved) return null;
        return tools.find(t => norm(t.clientId) === norm(clientId) && norm(t.warehouse) === norm(resolved) && (t.route === slug || t.toolId === slug)) || null;
      },
      context(tool) { return Object.freeze({ warehouse: tool.warehouse, clientId: tool.clientId, toolId: tool.toolId, route: tool.route }); },
      search(clientId, query) { return this.filter({ clientId, query }); }
    });
  }
  root.MkiteCreateClientToolRegistry = createRegistry;
  root.MkiteClientToolRegistry = createRegistry([
    { id: 'put-away-scan', route: 'put-away-scan', toolId: 'CT-MKS66-B044-0001', warehouse: 'MKS66', clientId: 'B044', toolType: 'Client Tool', name: 'Put Away Scan', description: 'Scan package tracking numbers, print labels, and complete put-away processing.', category: 'Inbound Operations', status: 'active', icon: 'warehouse', theme: 'blue', cardTheme: 'blue', version: 'v1.0', module: 'b044.put-away-scan', sortOrder: 1 },
    { id: 'tineco-toc', route: 'tineco-toc', toolId: 'CT-MKS66-TINECO-TOC-0001', warehouse: 'MKS66', clientId: 'TINECO-TOC', toolType: 'Client Tool', name: 'TINECO TOC', description: 'Record a returned machine repair visit through Pre-QC, Repair and Final QC.', category: 'Production / Repair', status: 'active', icon: 'warehouse', theme: 'blue', cardTheme: 'teal', version: 'v1', module: 'tineco.toc', sortOrder: 2, dataFields: [{field:'SN',required:true},{field:'TRACKING NUMBER',required:false},{field:'ISSUE FOUND',required:false},{field:'PRE-QC NOTE',required:false},{field:'PART USED DETAIL',required:false},{field:'TOTAL PARTS USED',required:false},{field:'REPAIR LEVEL',required:true},{field:'FINAL QC NOTE',required:false}] }
    ,{ id:'tineco-toc-batch-inventory', route:'tineco-toc-batch-inventory', toolId:'CT-MKS66-TINECO-TOC-0002', warehouse:'MKS66', clientId:'TINECO-TOC', toolType:'Client Tool', name:'TINECO TOC Batch Inventory', description:'Search and export read-only machine inventory and repair history.', category:'Inventory / Reporting', status:'active', icon:'warehouse', theme:'indigo', cardTheme:'indigo', version:'v1', module:'tineco.inventory', sortOrder:3 }
  ]);
}(typeof window === 'undefined' ? globalThis : window));

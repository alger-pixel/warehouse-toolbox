(function (window) {
  "use strict";
  /*
   * Shared application components must remain independent from individual
   * warehouse tool business logic. Add tool metadata here once; catalog,
   * dashboard, and search views consume this registry.
   */
  const tools = [
    { id: "matching", name: "Matching", description: "Validate scanned values against a known list.", category: "Validation", status: "active", priority: 1, icon: "match", theme: "matching", module: "matching" },
    { id: "sorting", name: "Sorting", description: "Assign scanned values to numbered pallets.", category: "Operations", status: "active", priority: 2, icon: "sort", theme: "sorting", module: "sorting" },
    { id: "counting", name: "Counting", description: "Count values, SKUs, quantities, and unique data.", category: "Data", status: "coming-soon", priority: 3, icon: "count", theme: "counting" },
    { id: "data-cleaning", name: "Data Cleaning", description: "Prepare and normalize warehouse data.", category: "Data", status: "coming-soon", priority: 4, icon: "data", theme: "cleaning" },
    { id: "calculators", name: "Calculators", description: "Quick calculations for warehouse operations.", category: "Operations", status: "coming-soon", priority: 5, icon: "calculator", theme: "calculators" },
    { id: "warehouse-utilities", name: "Warehouse Utilities", description: "Tools for locations, SKUs, and inventory.", category: "Warehouse", status: "coming-soon", priority: 6, icon: "warehouse", theme: "warehouse" },
    { id: "safety-icon-maintain", toolId: "AT-SAFETY-ICON-MAINTAIN-0001", name: "Safety Icon Maintain", description: "Maintain the shared safety icon library used by SOP tools.", category: "Safety", status: "active", priority: 7, icon: "quality", theme: "safety", module: "safetyIconMaintain", warehouse: "", clientId: "", toolType: "Assisting Tool", route: "#tool/safety-icon-maintain" },
    { id: "sop-builder", toolId: "AT-SOP-BUILDER-0001", name: "SOP Builder", description: "Create, save and resume standardized multi-page MKS work instructions.", category: "Documentation", status: "active", priority: 8, icon: "data", theme: "sop", module: "sopBuilder", warehouse: "", clientId: "", toolType: "Assisting Tool", route: "#tool/sop-builder" }
  ];
  window.MkiteToolRegistry = {
    all() { return tools.slice().sort((a, b) => a.priority - b.priority); },
    active() { return this.all().filter((tool) => tool.status === "active"); },
    get(id) { return tools.find((tool) => tool.id === id) || null; },
    search(query) { const value = String(query || "").trim().toLowerCase(); return this.all().filter((tool) => !value || `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(value)); }
  };
}(typeof window !== "undefined" ? window : globalThis));

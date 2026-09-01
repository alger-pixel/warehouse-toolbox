(function (window) {
  "use strict";
  /*
   * Shared application components must remain independent from individual
   * warehouse tool business logic. Add tool metadata here once; catalog,
   * dashboard, and search views consume this registry.
   */
  const tools = [
    { id: "matching", name: "Matching", description: "Validate scanned values against a known list.", category: "Validation", status: "active", priority: 1, icon: "match", module: "matching" },
    { id: "sorting", name: "Sorting", description: "Assign scanned values to numbered pallets.", category: "Operations", status: "active", priority: 2, icon: "sort", module: "sorting" },
    { id: "counting", name: "Counting", description: "Count values, SKUs, quantities, and unique data.", category: "Data", status: "coming-soon", priority: 3, icon: "count" },
    { id: "data-cleaning", name: "Data Cleaning", description: "Prepare and normalize warehouse data.", category: "Data", status: "coming-soon", priority: 4, icon: "data" },
    { id: "calculators", name: "Calculators", description: "Quick calculations for warehouse operations.", category: "Operations", status: "coming-soon", priority: 5, icon: "calculator" },
    { id: "warehouse-utilities", name: "Warehouse Utilities", description: "Tools for locations, SKUs, and inventory.", category: "Warehouse", status: "coming-soon", priority: 6, icon: "warehouse" }
  ];
  window.MkiteToolRegistry = {
    all() { return tools.slice().sort((a, b) => a.priority - b.priority); },
    active() { return this.all().filter((tool) => tool.status === "active"); },
    get(id) { return tools.find((tool) => tool.id === id) || null; },
    search(query) { const value = String(query || "").trim().toLowerCase(); return this.all().filter((tool) => !value || `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(value)); }
  };
}(window));

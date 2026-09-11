(function (window) {
  "use strict";
  /* MKITE-owned operational modules are registered here, independently of general and client tools. */
  const tools = [
    {
      id: "receiving",
      name: "Receiving",
      description: "Receive packages into MKITE warehouse inventory.",
      category: "Inbound Operations",
      status: "active",
      version: "v0.5",
      theme: "receiving",
      icon: "receiving",
      module: "receiving",
      sortOrder: 1
    },
    {
      id: "move-location-by-sku", name: "Move Location by SKU", description: "Move an active package to a new warehouse location.", category: "Warehouse Operations", status: "active", version: "v0.1", theme: "location-move", icon: "warehouse", module: "moveLocationBySku", sortOrder: 2
    },
    { id: "batch-inventory", name: "Batch Inventory", description: "Search package inventory and inspect activity history.", category: "Inventory Inquiry", status: "active", version: "v1", theme: "batch-inventory", icon: "warehouse", module: "batchInventory", sortOrder: 3 },
    { id: "batch-picking-list", toolId: "batch-picking-list", route: "batch-picking-list", warehouse: "", clientId: "", toolType: "In-House Tool", name: "Batch Picking List", description: "Review Picking Lists and export confirmed parts usage.", category: "Inventory Inquiry", status: "active", version: "v1", theme: "batch-inventory", cardTheme: "batch-picking-list", icon: "warehouse", module: "batchPickingList", sortOrder: 4 }
  ];

  window.MkiteInHouseToolRegistry = {
    all() { return tools.slice().sort((a, b) => a.sortOrder - b.sortOrder); },
    get(id) { return tools.find((tool) => tool.id === id) || null; },
    search(query) {
      const value = String(query || "").trim().toLowerCase();
      return this.all().filter((tool) => !value || `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(value));
    }
  };
}(typeof window === "undefined" ? globalThis : window));

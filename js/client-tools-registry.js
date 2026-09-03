(function (window) {
  "use strict";
  /*
   * Metadata stays separate from general tools. Client-specific business logic
   * must remain inside that client's modules, never in shared application code.
   */
  const tools = [
    { id: "put-away-scan", clientId: "b044", name: "Put Away Scan", description: "Generate and print put-away labels from inbound package data.", category: "Inbound Operations", status: "active", icon: "warehouse", theme: "blue", version: "v1.0", module: "b044.put-away-scan", sortOrder: 1 }
  ];

  window.MkiteClientToolRegistry = {
    all() { return tools.slice(); },
    forClient(clientId) { return tools.filter((tool) => tool.clientId === clientId).sort((a, b) => a.sortOrder - b.sortOrder); },
    get(clientId, toolId) { return tools.find((tool) => tool.clientId === clientId && tool.id === toolId) || null; },
    search(clientId, query) {
      const value = String(query || "").trim().toLowerCase();
      return this.forClient(clientId).filter((tool) => !value || `${tool.name} ${tool.description} ${tool.category}`.toLowerCase().includes(value));
    }
  };
}(window));

(function (window) {
  "use strict";
  /* Client definitions live in code so every warehouse uses the same deployment. */
  const clients = [
    {
      id: "b044",
      name: "B044",
      shortName: "B",
      description: "Client-specific warehouse utilities for B044 operations.",
      status: "active",
      theme: "b044",
      toolIds: ["put-away-scan"],
      sortOrder: 1
    }
  ];

  window.MkiteClientRegistry = {
    all() { return clients.slice().sort((a, b) => a.sortOrder - b.sortOrder); },
    get(id) { return clients.find((client) => client.id === id) || null; },
    search(query) {
      const value = String(query || "").trim().toLowerCase();
      return this.all().filter((client) => !value || `${client.name} ${client.description}`.toLowerCase().includes(value));
    }
  };
}(window));

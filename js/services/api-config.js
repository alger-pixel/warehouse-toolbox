(function (window) {
  "use strict";
  /*
   * Public frontend configuration only. Secrets and Feishu credentials must
   * never be added here. Switch to "live" only after configuring a secure API.
   */
  window.MkiteApiConfig = Object.freeze({
    mode: "live",
    baseUrl: "https://mkite-secure-api.mkite-api.workers.dev",
    endpoints: Object.freeze({ receiving: "/api/receiving", receivingLookup: "/api/receiving/lookup", clientsSearch: "/api/clients/search", clientsCreate: "/api/clients", locationMove: "/api/location-move", locationMoveLookup: "/api/location-move/lookup" }),
    mockDelayMs: 450
  });
}(window));

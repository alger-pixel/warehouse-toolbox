(function (window) {
  "use strict";
  /*
   * Public frontend configuration only. Secrets and Feishu credentials must
   * never be added here. Switch to "live" only after configuring a secure API.
   */
  // All tools share the local Worker during local frontend development.
  const localDevelopment = ["localhost", "127.0.0.1"].includes(window.location?.hostname);
  const baseUrl = localDevelopment ? "http://127.0.0.1:8787" : "https://mkite-secure-api.mkite-api.workers.dev";
  window.MkiteApiConfig = Object.freeze({
    mode: "live",
    baseUrl,
    userManagementBaseUrl: "",
    endpoints: Object.freeze({ receiving: "/api/receiving", receivingLookup: "/api/receiving/lookup", clientsSearch: "/api/clients/search", clientsCreate: "/api/clients", locationMove: "/api/location-move", locationMoveLookup: "/api/location-move/lookup" }),
    mockDelayMs: 450
  });
}(window));

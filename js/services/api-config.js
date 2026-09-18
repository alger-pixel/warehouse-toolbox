(function (window) {
  "use strict";
  /*
   * Public frontend configuration only. Secrets and Feishu credentials must
   * never be added here. Switch to "live" only after configuring a secure API.
   */
  const LOCAL_API = "http://127.0.0.1:8787";
  const PRODUCTION_API = "https://mkite-secure-api.mkite-api.workers.dev";
  const isLocalHostname = hostname => ["localhost", "127.0.0.1"].includes(String(hostname || "").toLowerCase());
  const resolveApiBase = hostname => isLocalHostname(hostname) ? LOCAL_API : PRODUCTION_API;
  const assertSafeApiBase = (hostname, baseUrl) => {
    if (!isLocalHostname(hostname) && /(?:localhost|127\.0\.0\.1)/i.test(String(baseUrl || ""))) throw new Error("Production API configuration is invalid.");
    return baseUrl;
  };
  const hostname=window.location?.hostname || "";
  const baseUrl = assertSafeApiBase(hostname, resolveApiBase(hostname));
  window.MkiteApiEnvironment = Object.freeze({ LOCAL_API, PRODUCTION_API, isLocalHostname, resolveApiBase, assertSafeApiBase });
  window.MkiteApiConfig = Object.freeze({
    mode: "live",
    baseUrl,
    environment: isLocalHostname(hostname) ? "LOCAL" : "PRODUCTION",
    userManagementBaseUrl: "",
    endpoints: Object.freeze({ receiving: "/api/receiving", receivingLookup: "/api/receiving/lookup", clientsSearch: "/api/clients/search", clientsCreate: "/api/clients", locationMove: "/api/location-move", locationMoveLookup: "/api/location-move/lookup" }),
    mockDelayMs: 450
  });
}(window));

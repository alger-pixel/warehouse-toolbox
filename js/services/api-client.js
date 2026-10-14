(function (window) {
  "use strict";

  function normalizeFailure(response, payload) {
    const source = payload && payload.error ? payload.error : {};
    return {
      ok: false,
      error: {
        code: String(source.code || `HTTP_${response.status}`),
        stage: typeof source.stage === 'string' ? source.stage : undefined,
        operationState: typeof source.operationState === 'string' ? source.operationState : undefined,
        message: String(source.message || "The server could not complete the request."),
        errors: Array.isArray(source.errors) ? source.errors : Array.isArray(payload?.errors) ? payload.errors : [],
        details: payload && payload.details && typeof payload.details === 'object' ? payload.details : source.details && typeof source.details === 'object' ? source.details : {},
        retryable: source.retryable !== false && response.status >= 500
      },
      records: payload && Array.isArray(payload.records) ? payload.records : []
    };
  }

  async function localConnectionFailure(baseUrl) {
    const healthUrl = `${baseUrl.replace(/\/$/, "")}/api/health`;
    try {
      await window.fetch(healthUrl, { method: "GET", mode: "no-cors", cache: "no-store" });
      return { code: "API_CONNECTION_ERROR", message: "Local Worker is reachable, but the API request was blocked by CORS or another browser connection policy.", retryable: true };
    } catch {
      return { code: "CONNECTION_ERROR", message: "Local Worker is not running on port 8787.", retryable: true };
    }
  }

  function apiBase(path) {
    const config = window.MkiteApiConfig;
    return path.startsWith("/api/users/") && config.userManagementBaseUrl
      ? config.userManagementBaseUrl : config.baseUrl;
  }
  function url(path) {
    const baseUrl = apiBase(path);
    if (!baseUrl) throw new Error("The secure MKITE API endpoint is not configured.");
    window.MkiteApiEnvironment?.assertSafeApiBase(window.location?.hostname, baseUrl);
    return `${baseUrl.replace(/\/$/, "")}${path}`;
  }

  async function request(method,path,body,options={}) {
      const baseUrl = apiBase(path);
      if (!baseUrl) return { ok: false, error: { code: "API_NOT_CONFIGURED", message: "The secure MKITE API endpoint is not configured.", retryable: false } };
      let requestUrl;
      try { requestUrl = url(path); }
      catch { return { ok: false, error: { code: "API_CONFIGURATION_ERROR", message: "Production API configuration is invalid.", retryable: false } }; }
      try {
        const response = await window.fetch(requestUrl, {
          method,
          headers: { "Content-Type": "application/json", ...(options.authorization ? { Authorization: options.authorization } : {}) },
          ...(method==='GET'?{}:{body: JSON.stringify(body)})
        });
        let payload = null;
        try { payload = await response.json(); } catch (error) { /* Normalized below. */ }
        if (!response.ok || !payload || payload.ok === false) return normalizeFailure(response, payload);
        return { ok: true, data: payload.data || payload };
      } catch (error) {
        const local=window.MkiteApiEnvironment?.isLocalHostname(window.location?.hostname);
        return { ok: false, error: local ? await localConnectionFailure(baseUrl) : { code: "CONNECTION_ERROR", message: "The secure MKITE API could not be reached.", retryable: true } };
      }
  }
  window.MkiteApiClient = {
    url,
    get:(path,options)=>request('GET',path,undefined,options),
    post:(path,body,options)=>request('POST',path,body,options),
    patch:(path,body,options)=>request('PATCH',path,body,options)
    ,put:(path,body,options)=>request('PUT',path,body,options)
    ,delete:(path,options)=>request('DELETE',path,undefined,options)
  };
}(window));

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
        retryable: source.retryable !== false && response.status >= 500
      },
      records: payload && Array.isArray(payload.records) ? payload.records : []
    };
  }

  window.MkiteApiClient = {
    async post(path, body, options = {}) {
      const config = window.MkiteApiConfig;
      const baseUrl = path.startsWith("/api/users/") && config.userManagementBaseUrl
        ? config.userManagementBaseUrl : config.baseUrl;
      if (!baseUrl) return { ok: false, error: { code: "API_NOT_CONFIGURED", message: "The secure MKITE API endpoint is not configured.", retryable: false } };
      try { window.MkiteApiEnvironment?.assertSafeApiBase(window.location?.hostname, baseUrl); }
      catch { return { ok: false, error: { code: "API_CONFIGURATION_ERROR", message: "Production API configuration is invalid.", retryable: false } }; }
      try {
        const response = await window.fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(options.authorization ? { Authorization: options.authorization } : {}) },
          body: JSON.stringify(body)
        });
        let payload = null;
        try { payload = await response.json(); } catch (error) { /* Normalized below. */ }
        if (!response.ok || !payload || payload.ok === false) return normalizeFailure(response, payload);
        return { ok: true, data: payload.data || payload };
      } catch (error) {
        const local=window.MkiteApiEnvironment?.isLocalHostname(window.location?.hostname)&&/(?:localhost|127\.0\.0\.1)/i.test(baseUrl);
        return { ok: false, error: { code: "CONNECTION_ERROR", message: local ? "Local Worker is not running on port 8787." : "The secure MKITE API could not be reached.", retryable: true } };
      }
    }
  };
}(window));

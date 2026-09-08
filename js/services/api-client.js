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
    async post(path, body) {
      const config = window.MkiteApiConfig;
      if (!config.baseUrl) return { ok: false, error: { code: "API_NOT_CONFIGURED", message: "The secure MKITE API endpoint is not configured.", retryable: false } };
      try {
        const response = await window.fetch(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        let payload = null;
        try { payload = await response.json(); } catch (error) { /* Normalized below. */ }
        if (!response.ok || !payload || payload.ok === false) return normalizeFailure(response, payload);
        return { ok: true, data: payload.data || payload };
      } catch (error) {
        return { ok: false, error: { code: "CONNECTION_ERROR", message: "The secure MKITE API could not be reached.", retryable: true } };
      }
    }
  };
}(window));

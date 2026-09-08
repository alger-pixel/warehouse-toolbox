const TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const EXPIRY_BUFFER_SECONDS = 300;
let cachedToken = "";
let cachedAppId = "";
let expiresAt = 0;

export class FeishuAuthError extends Error {
  constructor() { super("Feishu authentication failed"); this.name = "FeishuAuthError"; }
}

export function createFeishuAuthService(config, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => Date.now());
  return {
    async getTenantAccessToken() {
      if (cachedToken && cachedAppId === config.appId && now() < expiresAt) return cachedToken;
      let response; let payload;
      try {
        response = await fetchImpl(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }) });
        payload = await response.json();
      } catch (error) { throw new FeishuAuthError(); }
      if (!response.ok || !payload || payload.code !== 0 || !payload.tenant_access_token) throw new FeishuAuthError();
      const lifetime = Number(payload.expire) > 0 ? Number(payload.expire) : 7200;
      cachedToken = String(payload.tenant_access_token); cachedAppId = config.appId; expiresAt = now() + Math.max(1, lifetime - EXPIRY_BUFFER_SECONDS) * 1000;
      return cachedToken;
    }
  };
}

export function resetTokenCacheForTests() { cachedToken = ""; cachedAppId = ""; expiresAt = 0; }

import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuAuthService, FeishuAuthError, resetTokenCacheForTests } from "../src/services/feishu-auth-service.js";

const config = { appId: "app-id", appSecret: "placeholder" };

test("extracts and caches a safely expiring tenant token", async () => {
  resetTokenCacheForTests(); let calls = 0; let time = 1_000;
  const service = createFeishuAuthService(config, { now: () => time, fetchImpl: async () => { calls += 1; return new Response(JSON.stringify({ code: 0, tenant_access_token: `token-${calls}`, expire: 3600 }), { status: 200 }); } });
  assert.equal(await service.getTenantAccessToken(), "token-1"); assert.equal(await service.getTenantAccessToken(), "token-1"); assert.equal(calls, 1);
  time += 3_301_000; assert.equal(await service.getTenantAccessToken(), "token-2"); assert.equal(calls, 2);
});

test("normalizes authentication failure without exposing response details", async () => {
  resetTokenCacheForTests(); const service = createFeishuAuthService(config, { fetchImpl: async () => new Response(JSON.stringify({ code: 10003, msg: "sensitive upstream detail" }), { status: 200 }) });
  await assert.rejects(service.getTenantAccessToken(), (error) => error instanceof FeishuAuthError && error.message === "Feishu authentication failed");
});

# Shared warehouse inventory lookup (Phase 1)

POST `/api/inventory/lookup` with `{"sku":"9FWPT011100"}` and optional string `warehouseCode`.
SKU is trimmed only. Warehouse filtering compares trimmed codes case-sensitively, after all pages have loaded. Blank optional warehouse code means no filter.

Success: `{ "ok": true, "sku": "9FWPT011100", "total": 0, "locations": [] }`.
`total` is the number of returned rows after filtering. Rows remain in upstream order and quantities are never aggregated. The normalizer explicitly allows standard location fields; `sourceFields` and arbitrary upstream properties are excluded. Invalid quantities become null, not zero. IDs are strings.

## Configuration and local test

- Required Worker secret: `MKITE_WAREHOUSE_API_KEY`.
- Optional Worker variable: `MKITE_WAREHOUSE_API_URL` (HTTPS only, no embedded credentials; redirects fail closed).
- Default: `https://tool.mkite.cn/api/v1/open/warehouse-inventory/locations`.
- No Feishu configuration or database access is required by this endpoint.

For local development, add `MKITE_WAREHOUSE_API_KEY=<your key>` to the existing ignored `worker/.dev.vars`, using a local editor. Never put the key in frontend configuration, request bodies, committed files, or command history. `worker/.dev.vars.example` contains blank placeholders only. Preserve any other local configuration.

From the repository root:

```sh
cd worker
npx wrangler dev --local --port 8787
```

In a second terminal:

```sh
curl --fail-with-body http://127.0.0.1:8787/api/inventory/lookup \
  -H 'Origin: http://localhost:5501' \
  -H 'Content-Type: application/json' \
  --data '{"sku":"9FWPT011100"}'
```

The existing Wrangler allowed-origin list includes this development origin. Adjust `ALLOWED_ORIGINS` through existing configuration if necessary. Production setup, when authorized, uses `npx wrangler secret put MKITE_WAREHOUSE_API_KEY` from `worker/`; this phase does not set secrets or deploy.

## Bounds and failures

Each upstream request sends `{ "product_sku": "<trimmed sku>", "page": 1, "pageSize": 200 }`, incrementing page until the advertised total is collected. Maximum 25 pages; each request, including JSON reading, has a 10-second timeout. Missing or repeated pages, changing totals, malformed rows, and reaching the cap return errors instead of partial results.

Errors use the existing `{ok:false,error:{code,message,retryable},requestId}` envelope. Codes include `INVALID_SKU`, `INVALID_WAREHOUSE_CODE`, `WAREHOUSE_API_NOT_CONFIGURED`, `WAREHOUSE_API_UNAUTHORIZED`, `WAREHOUSE_API_RATE_LIMITED`, `WAREHOUSE_API_UNAVAILABLE`, `WAREHOUSE_API_TIMEOUT`, `WAREHOUSE_API_INVALID_RESPONSE`, `WAREHOUSE_API_FAILED`, and `WAREHOUSE_API_PAGINATION_LIMIT`. Upstream messages and sensitive headers are not forwarded or logged.

The endpoint follows existing Worker origin/CORS policy, including acceptance of requests without an Origin header. CORS is not user authentication; this phase adds no separate authentication framework. The API key is used only by the Worker when contacting upstream.

No recommendation, ranking, stock mutation, Feishu write, or tool UI integration is included.

## Targeted validation

```sh
node --test worker/test/inventory-lookup.test.js worker/test/worker-http.test.js
```

Tests mock upstream fetch; they do not contact the warehouse API.

## Local runtime compatibility fix and Phase 4 validation

The fast local 502 was caused by `redirect: "error"`, which workerd rejects with a TypeError before network I/O. A local workerd probe confirmed it accepts `manual` and rejects `error`. The client now uses `manual` and rejects redirect HTTP responses, so the upstream secret is never forwarded to a redirect destination. Environment URL/key whitespace is trimmed. The timeout remains 10,000 milliseconds; it was not the cause.

The existing local Worker returned HTTP 200 for `9FWPT011100` with warehouse `MKS66` after this change: three real locations, each with available quantity 1. No production data was mutated. Disabling `--local` was unnecessary.

Both tools now use `js/services/inventory-location-lookup.js` (the actual repository path). It uses `MkiteApiClient.post`, validates the same response contract, caps concurrency at four, caches pending/success/error states in memory, disposes queued work, and isolates rendering callback failures. Tineco resets on a new visit/mount; B044 scopes lookup rendering to its current PL. No polling or durable cache is added.

Frontend API config currently targets production for operational APIs even when served locally; only User Management switches automatically. For a safe local browser test, set the shared public configuration in DevTools before using a test unit:

```js
window.MkiteApiConfig = Object.freeze({ ...window.MkiteApiConfig, baseUrl: 'http://127.0.0.1:8787' });
```

This override is page-memory only and contains no secrets. Do not use real production units merely to test lookup. Live Worker lookup was verified; live browser Tineco/B044 workflow testing and visual viewport checks were not performed. B044 live lookup additionally needs a known SKU emitted by its unchanged possible-parts parser; `9FWPT011100` is not emitted.

Targeted validation: 166 tests across inventory Worker, shared frontend helper, Tineco frontend, and B044 frontend passed, plus changed JS syntax and diff checks. Failure, zero-result, non-blocking workflow, caching, and race checks used mocked data. Worker release needs the application fix and `MKITE_WAREHOUSE_API_KEY`; frontend release needs the shared-helper changes. No deployment was performed.

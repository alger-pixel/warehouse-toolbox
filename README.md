# MKITE Warehouse Tools

A browser-based collection of warehouse operations utilities.

## Purpose

MKITE Warehouse Tools provides a focused home for general utilities, isolated client workflows, and MKITE-owned warehouse operations.

## Current Version

Package Activity Note Logging v0.1 · Receiving v0.6 · Move Location by SKU v0.1

## Architecture

- **Application shell:** Sidebar, header, theme controls, responsive layout, and shared view rendering.
- **Shared services:** Safe namespaced storage, toast notifications, optional Web Audio tones, and hash-based routing.
- **Tool registry:** `js/tools-registry.js` is the single metadata source for dashboard cards, the Tools catalog, search, and each tool's visual theme identity.
- **Tool modules:** Each active tool owns an isolated render/init/session/reset/cleanup lifecycle under `js/tools/`.
- **Data services:** Operational UI modules call use-case services, which call the shared API client. Backend-specific response formats and authentication do not leak into UI code.
- **CSS layers:** Design tokens, base rules, layout, shared components, responsive rules, and narrowly scoped tool styles.
- **Local browser dependencies:** SheetJS Community Edition is vendored for Excel parsing/export and `qrcode-generator` is vendored for offline QR generation. No CDN request or build step is used at runtime.

Shared application components must remain independent from individual warehouse tool business logic. Future tools should use shared services instead of duplicating application-level functionality.

## Project Structure

```text
warehouse-toolbox/
├── index.html
├── assets/
│   ├── images/
│   │   ├── mkite-logo.png
│   │   └── mkite-logo.svg
│   └── icons/
├── css/
│   ├── variables.css
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   ├── responsive.css
│   ├── client-tools/
│   │   ├── client-tools.css
│   │   └── b044-put-away-scan.css
│   ├── in-house-tools/
│   │   └── in-house-tools.css
│   └── tools/
│       ├── matching.css
│       └── sorting.css
├── js/
│   ├── app.js
│   ├── router.js
│   ├── storage.js
│   ├── toast.js
│   ├── audio.js
│   ├── tools-registry.js
│   ├── clients-registry.js
│   ├── client-tools-registry.js
│   ├── in-house-tools-registry.js
│   ├── services/
│   │   ├── api-config.js
│   │   └── api-client.js
│   ├── client-tools/
│   │   └── b044/
│   │       └── put-away-scan.js
│   ├── in-house-tools/
│   │   └── receiving/
│   │       ├── receiving-service.js
│   │       └── receiving.js
│   └── tools/
│       ├── matching.js
│       └── sorting.js
├── vendor/
│   ├── xlsx.full.min.js
│   ├── qrcode.min.js
│   ├── QRCODE-LICENSE.txt
│   └── SHEETJS-LICENSE.txt
├── worker/
│   ├── src/
│   │   ├── index.js
│   │   ├── config/feishu-config.js
│   │   ├── services/
│   │   │   ├── feishu-auth-service.js
│   │   │   ├── feishu-record-service.js
│   │   │   └── package-activity-service.js
│   │   ├── modules/receiving/
│   │   │   ├── receiving-controller.js
│   │   │   └── receiving-service.js
│   │   ├── modules/clients/
│   │   │   ├── client-controller.js
│   │   │   ├── client-fields.js
│   │   │   └── client-service.js
│   │   └── utils/
│   │       ├── response.js
│   │       └── validation.js
│   ├── test/
│   ├── wrangler.toml
│   ├── package.json
│   └── .dev.vars.example
└── README.md
```

## How to Add a Future Tool

1. Add the tool metadata once in `js/tools-registry.js`.
2. Create an isolated JavaScript module under `js/tools/` using the established lifecycle.
3. Add tool-specific CSS under `css/tools/` only when shared components are insufficient.
4. Load the files from `index.html` and connect the module name in its registry entry.
5. Test dashboard cards, the Tools library, search, hash navigation, storage namespace, and responsive behavior.
6. Deploy normally to GitHub Pages.

## Client Tools Architecture

General Tools are reusable warehouse utilities for any operation. Client Tools are a separate area for workflows configured for a specific client. Registry definitions live in the codebase so every warehouse location using the deployment receives the same clients and tools.

- `js/clients-registry.js` defines clients, descriptions, status, themes, and their tool IDs.
- `js/client-tools-registry.js` defines client-specific tool metadata independently from the general tool registry.
- Client business logic belongs only in modules such as `js/client-tools/b044/put-away-scan.js`.
- Shared application files must not accumulate client-specific conditional logic.
- Client routes use GitHub Pages-safe hashes: `#client-tools`, `#client/<client-id>`, and `#client/<client-id>/tool/<tool-id>`.
- The optional last-client shortcut uses `mkite.toolbox.client-tools.last-client`; registry data is never stored in localStorage.
- Future client-tool sessions should use namespaces such as `mkite.toolbox.client.<client-id>.<tool-id>.session`.

## B044 — Put Away Scan

Put Away Scan reads only the first worksheet of an uploaded `.xlsx` or `.xls` workbook. It locates columns by the exact trimmed headers `到仓日期`, `跟踪号`, `入库SKU`, and `仓库入库单号`; missing headers stop processing. Arrival dates are normalized to `YYYY-MM-DD`, and identifiers are handled as display text.

Warehouse orders must contain a dash and begin with a configured `RMA` or `RV` prefix. The remaining part of the first segment is the client ID, and the printable SKU is `<clientId>-<入库SKU>`. Incomplete rows, unsupported orders, and every occurrence of a duplicated normalized tracking number are excluded from printing and shown in the invalid-row review.

Each package assigned to the operational Picking List has one portrait 4 × 6 inch, black-and-white thermal label with QR codes encoding the final SKU and warehouse inbound order exactly. Label previews are scaled only on screen; printing uses one physical label per page. QR generation is fully local through the MIT-licensed `qrcode-generator` browser bundle in `vendor/`.

Step 2 uses only the operational Picking List's package collection. With 20 source
rows, six assigned packages and fourteen exceptions, its table, preview, printing,
scan candidates and counters all use those six packages. Step 1 retains the upload
and exceptions. PL labels printed counts print requests; found packages remaining
counts packages not yet completed, so printing alone does not reduce that count.

Scan & Print Mode checks exact tracking first, then complete tracking contained in
the first scan. Contained candidates require explicit confirmation; ambiguous
matches never auto-select. The first tracking scan prints one package label and
enters WAITING_FOR_PRINT_CONFIRMATION. The next scan is only confirmation of that
pending package and must equal its tracking number after trimming and case
normalization. Final SKU, another package's tracking and partial/contained values
are rejected. A successful backend completion clears the pending package and
focuses the scanner again. Reprinting retains the same pending identity and never
completes a package. Already-completed packages do not automatically print again.

PRINT FOUND PACKAGES and PREVIEW FOUND PACKAGES use only this same PL collection.
Batch printing is blocked while a package confirmation is pending. Thermal label
layout and QR payloads are unchanged. Chrome's `--kiosk-printing` flag may
confirm print dialogs automatically; normal Chrome allows printer/paper review.

The completion endpoint accepts `pickingListNumber`, `pickingListRecordId`,
`packageRecordId`, `trackingNumber`, and `confirmationTracking`. It verifies PL
membership, exact normalized tracking identity and the latest package SKU/status
before Processed and DONE NOTE. The old Final SKU confirmation fields are no longer
accepted as proof of completion. Duplicate acknowledged completions remain
idempotent. Generation, numbering, A4, CREATED NOTE and cancellation are unchanged.

The active session is stored under `mkite.toolbox.client.b044.put-away-scan.session`. Browser print completion cannot be detected reliably: records are marked printed when the print dialog is initiated, even if the operator subsequently cancels the dialog. Silent printing is not claimed or implemented.

## Platform Categories

- **General Tools:** Reusable utilities that are not tied to a client or MKITE system workflow.
- **Client Tools:** Client-configured workflows isolated by client registry and module.
- **In House Tools:** MKITE's internal warehouse operations and future WMS modules.

## In House Tools Architecture

`js/in-house-tools-registry.js` is the source of truth for internal tool metadata. The landing route is `#in-house-tools`; individual modules use `#in-house-tool/<tool-id>`. An internal tool is added with one registry entry, one isolated lifecycle module, and optional scoped CSS. Shared routing and rendering do not contain its business rules.

Receiving follows this boundary:

```text
Receiving UI
  → Receiving Service
  → Platform API Client
  → Secure MKITE API
  → Feishu Base or a future WMS backend
```

This keeps future backend replacement, audit metadata, station/user context, movement history, attachments, and offline queueing possible without coupling the current UI to Feishu.

## Responsive Platform Standard

MKITE Warehouse Tools is one responsive application across warehouse desktops, laptops, tablets, Android phones, and iPhones. Layout adaptation uses CSS—not user-agent-specific application versions.

- **Wide desktop:** `1200px` and above; full sidebar and multi-column operational layouts.
- **Compact desktop / landscape tablet:** `768px–1199px`; reduced spacing and adaptive grids.
- **Mobile / portrait tablet:** below `768px`; off-canvas navigation and single-column tool flows.
- **Small phone:** below `480px`; tighter safe spacing and typography.

Wide tables remain tables inside horizontally scrollable containers. Coarse-pointer devices receive at least approximately 44px controls, hover-only movement is removed when hover is unavailable, and reduced-motion preferences are respected.

## Receiving v0.6

Every receipt requires a non-empty Client ID, text SKU, and current location. Client ID letters normalize to uppercase while typing or scanning; surrounding whitespace is trimmed before use. Client ID + Enter immediately focuses SKU, SKU + Enter focuses Location, and Location + Enter starts the existing duplicate-check / Receive flow. Any non-empty Client ID is accepted, including IDs absent from CLIENT CLASS.

Receiving has no client search, suggestion dropdown, selection, verification, record ID requirement, or client-creation flow. It never calls `/api/clients/search` or `/api/clients`. Editing Client ID clears downstream SKU, Location, and temporary receipt state. The reusable CLIENT CLASS endpoints remain available for future client management and retain their existing case-sensitive rules.

SKU comparison trims surrounding whitespace and compares case-insensitively, without fuzzy, partial, or substring matching. The original trimmed SKU remains intact for display and storage. Location values reject blanks, whitespace-only values, and control characters. Confirmed success clears Client ID, SKU, and Location; disables SKU and Location; and returns focus to Client ID for the next package. Lookup, API, and connection failures preserve the active values for retry. Pending-state protection plus a 1.6-second SKU/location event guard prevents scanner double-Enter and rapid double-click submissions.

One exact existing record displays `DUPLICATE SKU FOUND`; two or more display `MULTIPLE EXISTING SKU RECORDS`. Existing location, record ID, and timestamp are shown before confirmation. Confirmed receipts record `duplicateOverride` and `duplicateMatchCount` locally for future auditing, without writing unsupported fields into the current Base schema.

The local workstation session uses `mkite.toolbox.in-house.receiving.session` and retains up to 20 structured receipt records containing `localId`, `toolId`, Client ID, SKU, location, status, timestamp, server record ID, and duplicate-override metadata. It is operational feedback, not global warehouse history or the source of truth.

Receiving only creates a new physical-package record. It never updates an existing package location. A future Location Transfer module will own package movement and location history.

Receiving local workstation data now carries a local `YYYY-MM-DD` session date. When the Receiving page is opened after the local calendar date changes, counters, last location, and recent activity reset automatically. The Reset Session action performs the same local-only reset after confirmation. Neither reset calls the API or changes Feishu records.

## Package Activity Note Logging v0.1

`PACKAGE CLASS.NOTE` is a system-generated, human-readable history for one package. Operators cannot edit it in Warehouse Tools. The backend models each confirmed action as structured data before formatting NOTE, using stable action types, server time, package context, locations, status, and the originating tool ID. That normalized event can later be sent to a structured BATCH LOG without rewriting Receiving or Move Location. BATCH LOG is planned but is not implemented or called in this version.

Current action templates use the configured `America/Toronto` warehouse timezone and 24-hour `YYYY/MM/DD HH:mm` timestamps:

```text
RECEIVED     → YYYY/MM/DD HH:mm - RECEIVED
MOVED_BY_SKU → YYYY/MM/DD HH:mm - MOVED BY SKU FROM: <old> TO: <new>
```

Receiving initializes NOTE only after required-field validation and duplicate protection pass, and includes it in the confirmed PACKAGE CLASS create. Move Location re-reads the selected Feishu record, validates SKU, latest location, and Active status, then appends one line to the latest NOTE and updates exactly `LOCATION` and `NOTE`. The success path checks Feishu's returned record and, when necessary, re-reads it; success is withheld unless both destination LOCATION and the complete appended NOTE are confirmed. Existing content is retained; redundant trailing blank lines are removed only at the append boundary. A legacy package with blank NOTE receives only its real Move entry—no historical Receiving event is invented. Failed, cancelled, blocked, or unconfirmed actions do not add history.

## Move Location by SKU v0.1

Move Location by SKU is an isolated In House Tool at `#in-house-tool/move-location-by-sku`. Its scanner workflow is:

```text
Current Location → SKU → Verify → Destination unlock → Move
```

Operators establish Current Location first, then scan package SKUs from that working location. Verification identifies a package by exact normalized SKU plus exact normalized current location. Only a record whose `STATUS` is exactly `Active` may move. Missing SKUs, wrong locations, inactive records, and multiple Active matches produce distinct operator states; multiple matches require explicit record selection before Destination unlocks. Changing SKU or Current Location invalidates the selection immediately. After success, Current Location is retained while SKU and Destination clear and focus returns to SKU for the next package.

The move endpoint re-retrieves the selected record by `recordId` and checks SKU, current `LOCATION`, and `STATUS` again before updating. A successful request updates exactly two fields on exactly one record:

```text
LOCATION → destinationLocation
NOTE     → latest NOTE plus one MOVED_BY_SKU activity line
```

It does not modify `SKU`, `CLIENT ID`, `DATE OF RECEIVED`, or `STATUS`, and never creates a package. Receiving owns creation; Move Location owns movement. PACKAGE CLASS stores current location and a readable NOTE timeline, while local Recent Moves remains workstation feedback rather than a global movement ledger. A future Location Movement History or BATCH LOG data model can consume the existing normalized activity shape.

Move Location uses the same daily local-session reset standard as Receiving. Its local namespace is `mkite.toolbox.in-house.move-location-by-sku.session`; counters and the latest 20 moves reset on local date change or confirmed Reset Session without modifying Feishu.

### Mock and Live Modes

`js/services/api-config.js` centrally selects `mock` or `live`. The current configuration uses the deployed secure API. Mock mode remains available for controlled development and is prominently identified in the Receiving UI; mock success never claims to write to Feishu. The exact mock fixtures `DUPLICATE-TEST-001` and `DUPLICATE-MULTI-001` return one and two existing records respectively. Live mode requires a secure `baseUrl` and sends requests through `js/services/api-client.js`. Registry data and API credentials are never stored in localStorage.

### Frontend API Contract

`POST /api/clients/search` accepts `{ "query": "B04" }` and returns safe ranked records containing `recordId`, `clientId`, and `matchType`. Search suggestions may include a lower-ranked case-insensitive discovery result, but verification and existence checks remain case-sensitive.

`POST /api/clients` accepts `{ "clientId": "B077" }`. The Worker returns the existing exact record without creating a duplicate, or creates one CLIENT CLASS record containing only `CLIENT ID`.

`POST /api/receiving/lookup`

```json
{
  "sku": "1Z999AA10123456784"
}
```

The normalized response contains `{ "ok": true, "found": false, "records": [] }`, or exact records containing `recordId`, `sku`, `location`, `receivedAt`, and `status`. Lookup failure prevents creation.

`POST /api/receiving`

```json
{
  "clientId": "B044",
  "sku": "1Z999AA10123456784",
  "location": "A-01-03",
  "duplicateOverride": false
}
```

A successful `200` or `201` response is normalized to:

```json
{
  "ok": true,
  "recordId": "recXXXX",
  "clientId": "B044",
  "sku": "1Z999AA10123456784",
  "location": "A-01-03",
  "receivedAt": "2026-09-03T14:30:00.000Z",
  "status": "Active"
}
```

Failures use `{ "ok": false, "error": { "code": "...", "message": "...", "retryable": true } }`. The service converts backend results into this stable application shape before the UI consumes them.

### Current Feishu Mapping

- Base: `MKS WAREHOUSE DATABASE`
- Base app token: `FGLSbhJ8taJ9KNsIp22cq9xDnuh`
- Table: `PACKAGE CLASS`
- Table ID: `tblBlNuQTIfHbqBQ`
- `CLIENT ID`: trimmed uppercase Client ID entered by the operator
- `SKU`: package tracking number
- `LOCATION`: current warehouse location
- `DATE OF RECEIVED`: server-generated receipt time in epoch milliseconds
- `STATUS`: server-controlled initial value `Active`
- `NOTE`: backend-generated, append-only human-readable package activity
- Client table: `CLIENT CLASS`
- Client table ID: `tblQGCq6Y404LLJB`
- Client field: case-sensitive `CLIENT ID`

The secure backend owns Feishu authentication and record creation. **Never put `FEISHU_APP_SECRET`, tenant access tokens, or other Feishu credentials in frontend code, repository configuration, README values, or localStorage.** Backend secrets must be supplied only through secure environment bindings. Non-secret PACKAGE CLASS and CLIENT CLASS table IDs are centralized in Worker configuration.

## Secure MKITE API

The `worker/` directory contains a Cloudflare Worker-style operational API. It is separate from the GitHub Pages frontend and is the initial backend boundary for future Receiving, Transfer, Inventory, QC, Outbound, and other WMS services.

```text
Worker HTTP route
  → Receiving Controller
  → Receiving Domain Service
  → Feishu Record Service
  → Feishu Auth Service
  → Feishu Open API
```

Only these public routes exist in v0.1:

- `GET /api/health`
- `POST /api/clients/search`
- `POST /api/clients`
- `POST /api/receiving/lookup`
- `POST /api/receiving`
- `POST /api/location-move/lookup`
- `POST /api/location-move`

Other methods return `405`; unknown paths return `404`; bodies over 16 KB are rejected. No Base/table/field administration endpoints are exposed.

### Feishu Authentication and Records

The Worker uses the internal/custom-app tenant-token endpoint and keeps the token only in Worker-instance memory. Cached tokens are reused until five minutes before reported expiry. Tokens, authorization headers, and App Secrets are never returned or logged.

The reusable record service calls the Bitable v1 paginated record-list and record-create APIs. Client search projects `CLIENT ID`, ranks a compact result set in the Worker, and requires case-sensitive exact selection or creation. Receiving lookup projects only the confirmed package fields, including `NOTE`, then performs the authoritative normalized, case-insensitive exact SKU comparison in the Worker and returns every exact record. Partial matches are rejected. Field titles have centralized sources of truth in the Receiving and Clients modules.

Every create endpoint request repeats the duplicate lookup server-side. A duplicate without override returns HTTP `409` with `DUPLICATE_SKU`; `duplicateOverride: true` creates another record and never updates the existing record. Because Feishu Base is not a transactional SQL database, this recheck reduces race risk but does not guarantee strict uniqueness under truly simultaneous writes. A future WMS database may enforce a unique constraint.

The Worker ignores browser-supplied `receivedAt` and `status`. It maps exactly:

```text
trimmed uppercase clientId → CLIENT ID
sku               → SKU
location          → LOCATION
server Date.now   → DATE OF RECEIVED (epoch milliseconds)
constant Active   → STATUS
RECEIVED activity → NOTE
```

Receiving v0.6 validates required fields and uppercases Client ID server-side before package creation, with no CLIENT CLASS existence lookup. Missing fields return `CLIENT_ID_REQUIRED`, `SKU_REQUIRED`, or `LOCATION_REQUIRED`. Package creation still writes exactly CLIENT ID, SKU, LOCATION, DATE OF RECEIVED (server time), STATUS (Active), and the existing RECEIVED NOTE. Mock mode returns the same normalized fields. A race-time `409` returns to duplicate confirmation.

Run `node --test tests/receiving-client-entry.test.cjs` for the v0.6 frontend flow and `cd worker && npm test` for Worker regressions.

### Worker Environment and Deployment

Required bindings:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_APP_TOKEN`
- `FEISHU_PACKAGE_TABLE_ID`
- `FEISHU_CLIENT_TABLE_ID`
- `WAREHOUSE_TIME_ZONE` (non-secret; currently `America/Toronto`)
- `ALLOWED_ORIGINS`

`.dev.vars` and `.env*` files are ignored. Copy `worker/.dev.vars.example` for local development and replace placeholders only in the ignored local file. Never paste the Feishu App Secret into frontend files, committed source, `wrangler.toml`, README, or chat. Configure production secrets through Cloudflare Worker secret/environment bindings.

CORS uses an exact, comma-separated `ALLOWED_ORIGINS` allowlist. The deployed configuration permits `https://alger-pixel.github.io`, `http://127.0.0.1:5501`, and `http://localhost:5501`. These two fixed Live Server origins support local Receiving tests; arbitrary localhost ports and wildcard origins remain blocked.

Deployment outline:

1. Install or make the Cloudflare Wrangler CLI available outside the static frontend.
2. Configure the Feishu bindings (including PACKAGE CLASS and CLIENT CLASS table IDs) and the allowed-origin binding in the Worker environment; store the App Secret as a Worker secret.
3. Run `npm test` from `worker/`.
4. Deploy `worker/src/index.js` using `worker/wrangler.toml`.
5. Verify `/api/health`, then perform controlled real lookup and create tests.
6. Set `js/services/api-config.js` to `mode: "live"` and its single `baseUrl` to the deployed HTTPS Worker origin.
7. Re-test CORS, duplicate blocking/override, server timestamp, and `Active` status from the GitHub Pages deployment.

The current frontend is configured for the deployed live Worker. Switch to mock mode only for controlled development, and never interpret a visibly labeled mock receipt as a Feishu write.

### Generic Picking List foundation v0.1 / B044 Generate & Cancel v2.1

Current lifecycle: [B044 Generate / Cancel v2.1](docs/b044-generate-cancel-v2.1.md).
The earlier [recovery audit](docs/b044-picking-milestone.md) describes the historical v2.0 attachment workflow.

The B044 frontend uses `POST /api/b044/put-away/prepare`,
`POST /api/b044/put-away/create-picking-list`, and
`POST /api/b044/put-away/complete-package`, and
`POST /api/b044/put-away/cancel-picking-list`. Upload and prepare are read-only.
Confirmed generation persists the Picking List number and B044 detail text before assigning packages
to Processing. A second exact tracking-number scan is required for Processed;
printing alone never completes a package.

`FEISHU_PICKING_LIST_TABLE_ID` is configured as `tblRfLgo1jIQkzmi` in
`worker/wrangler.toml` and `worker/.dev.vars.example`, using the centralized
Worker configuration reader.
PICKING LIST CLASS must contain `PICKING LIST NUMBER` and the text field
`PICKING LIST DETAIL`. No media upload is used for Picking List persistence. PACKAGE CLASS STATUS must be single-select for writes. Generation requires the
Processing option, completion requires Processed, and cancellation requires Active.
Prepare only reads record status: exactly Active is eligible. The existing Wrangler configuration includes
the required `B044_PUT_AWAY` Durable Object binding and migration.

From the repository root, the deployment command (not executed during recovery) is:

```sh
npx wrangler deploy --config worker/wrangler.toml
```

After deployment and configuration, the frontend on `http://localhost:5501`
can call the configured live Worker; that exact origin is allowed by CORS.
Run `npm --prefix worker test` and `node --test tests/*.test.cjs` before deployment.

### How to Add a New Client

1. Add client metadata to `js/clients-registry.js`.
2. Add its tool metadata to `js/client-tools-registry.js`.
3. Add independent client-tool modules only as needed.
4. Add optional client-specific assets or narrowly scoped styling.
5. Test Client Tools selection, search, routing, and invalid states.
6. Deploy normally to GitHub Pages.

### How to Add a Tool to an Existing Client

1. Add tool metadata to `js/client-tools-registry.js` with the correct `clientId`.
2. Add the tool ID to the client's `toolIds` list.
3. Create an independent module under `js/client-tools/<client-id>/`.
4. Add tool-specific CSS only when shared client-tool styles are insufficient.
5. Test the client pool, category grouping, route, and shared navigation.
6. Deploy normally to GitHub Pages.

## Local Development

Open `index.html` directly in a modern browser or use VS Code Live Server. No installation, package manager, or build command is required.

## GitHub Pages Compatibility

All resources use relative paths. Navigation uses URL hashes such as `#dashboard`, `#tools`, `#tool/matching`, `#client-tools`, `#client/b044/tool/put-away-scan`, `#in-house-tools`, and `#in-house-tool/receiving`, so repository-subdirectory hosting and browser refreshes do not require server routing. The static site has no embedded backend, secrets, CDN dependencies, or build step.

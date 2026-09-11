# B044 actual parts and Batch Picking List v1

Local milestone. No deployment, commit, live TOOL CLASS sync or Feishu mutation was performed during implementation.

## Preparation and scanning

B044 preserves the exact raw 操作指令, existing AI wording/fallback, Excel matching, package/command labels and strict confirmation. First scan identifies the package by tracking; final confirmation requires exact normalized equality with its stored In-House SKU / tracking identifier (`trackingNumber`), not its generated `finalSku`. Normal packages retain tracking scan → print → one exact scan of the same tracking identifier.

For commanded packages:

1. Scan tracking and print the existing package + command label page(s).
2. Scan actual part SKUs. Identical trimmed literal scans increment quantity. Case, internal content and punctuation are retained; different strings are not mapped together. Remove deletes the selected SKU and its entire quantity, so it can be rescanned correctly.
3. CONFIRM PARTS USED marks the local draft ready. An empty list is allowed for commands requiring no consumables. This action sends no request and writes nothing to Feishu.
4. Exact normalized In-House SKU / Tracking confirmation starts completion. The request carries `confirmationTracking`; the Worker compares it to the stored PL row `normalizedTracking`, never a client-supplied expected value. A wrong/wrapped scan sends no write.
5. Before submitting, EDIT TEMPORARY PARTS reopens the list. Once submitted, parts stay locked for recovery with the original payload. Retry by scanning the same In-House SKU / Tracking again.

Draft parts live in the existing B044 localStorage session as `temporaryParts: {packageId, parts:[{sku,quantity}], ready, submitted}`. They survive ordinary refresh/remount; clearing browser storage is outside that guarantee. No draft is written to PART USED. Each request supports up to 100 distinct SKUs, 128 characters per SKU, and integer quantity 1–9999.

## Possible Parts

`js/shared/picking-parts.js` provides deterministic extraction, independent of OpenAI. Rules collect recognized `CARTON-<digits>-<digits>-<digits>` and M-number part patterns joined by `-` or `*` (such as `M8LS-14-BS` and `M8LS*14`), excluding unrelated code-like tokens and `FD-` references, and the exact Chinese concepts 说明书, 泡沫板, 泡沫, 泡棉, 仓库箱子 and 贴纸. Longer material names win over overlapping substrings. No equivalence between `M8LS*14` and `M8LS-14-BS` is assumed.

The estimate counts one per distinct literal mention **per eligible package**, then aggregates across the PL. Repeated wording within one command is not treated as additional quantity. Quantities and negated/conditional commands are not interpreted as definite demand. The panel expressly labels these as preparation estimates; they may be inaccurate. They never populate actual scans, PART USED, or inventory export totals.

## Storage and successful final-scan boundary

Reuse `FEISHU_PICKING_LIST_TABLE_ID` and existing PICKING LIST CLASS. Required new field: `PART USED`, Feishu Text (type 1). The Worker checks this field before a commanded package can become Processed. No field is created automatically, and no other table receives parts data.

PART USED is versioned JSON:

```json
{
  "version": 1,
  "packages": [
    {
      "packageRecordId": "rec-example",
      "trackingNumber": "875539379028",
      "finalSku": "B044-EXAMPLE",
      "requestId": "original-generation-request-id:rec-example",
      "status": "CONFIRMED",
      "confirmedAt": "2026-09-10T12:00:00.000Z",
      "parts": [{ "sku": "M8LS*14", "quantity": 2 }]
    }
  ]
}
```

PICKING LIST DETAIL remains the existing human-readable text snapshot, with WAREHOUSE and PACKAGE ID added. Each successful completion adds one JSON line:

```text
COMPLETION: {"packageRecordId":"rec-example","trackingNumber":"875539379028","completedAt":"2026-09-10T12:00:00.000Z"}
```

There is no second PL table/model. The existing per-base Durable Object serializes operations and retains durable completion intent in its existing job. A package/request identity is deterministic: original generation request ID + package record ID.

Sequence:

1. Validate the strict In-House SKU / Tracking confirmation and actual list.
2. Validate PART USED schema, existing JSON, master identity and 90,000-character per-field limit before any package transition.
3. Persist immutable completion intent in Durable Object storage. This is pending intent, not confirmed usage.
4. Re-read PACKAGE CLASS; perform and verify the existing Processing → Processed + NOTE transition.
5. Write confirmed PART USED and the completion line together to the existing PL record; re-read to verify both.
6. Mark the durable job row completed and return success to the browser.

**Feishu provides no cross-table transaction.** There can be a temporary Processed package whose PL usage write still needs recovery. The browser does not show completed until both writes are confirmed. Usage is never written before Processed acknowledgement. A lost response or failed checkpoint retries the original intent, recognizes the existing NOTE, and merges by package ID without adding another entry. Changed parts during recovery are rejected. A completed row returns its existing completion without appending usage. Existing malformed/conflicting PART USED is preserved and blocks the new completion for manual review.

If the master write fails, retry the same final scan in the same B044 session. No automatic background reconciliation is added in v1. Do not clear that session while completion is unconfirmed. Manual external edits to Feishu remain outside the serialized Worker transaction boundary.

## Cancellation

Cancellation is allowed only when no package is Processed. The inspected baseline actually permitted mixed completed/unfinished cancellation; this milestone corrects that behavior to the requested zero-Processed rule, on both frontend and Worker.

The Worker checks all assigned package states before rollback and checks each package again during rollback. If any is Processed, cancellation is rejected without starting rollback. Otherwise the existing Active restoration and cancellation NOTE behavior remains. Successful cancellation discards temporary parts, including ready-but-unsubmitted lists. If a failed completion left a package Processing, an authoritative cancellation can still proceed; if the transition reached Processed, cancellation is blocked and the original final scan must be recovered. Uncertain cancellation failures retain the operation for retry.

## Batch Picking List

- In-House registry ID / TOOL ID: `batch-picking-list`
- TOOL NAME: `Batch Picking List`
- TOOL TYPE: `In-House Tool`
- ROUTE metadata: `batch-picking-list`
- Browser route: `#in-house-tool/batch-picking-list`
- Status: Active
- Warehouse/client metadata: blank (shared In-House inquiry, not a client-specific tool)

The existing In-House registry has slug identities (`receiving`, `move-location-by-sku`, `batch-inventory`) and no numbered TOOL ID scheme. The new tool follows that established slug convention rather than inventing a numbered prefix. The older In-House tools are not silently assigned new sync identities. No authentication enforcement or scope semantics change is included.

Read-only endpoints:

- `POST /api/picking-lists/search`
- `POST /api/picking-lists/detail` with `{ "recordId": "..." }`

Search body fields: `pickingListNumber`, `createdFrom`, `createdTo`, `warehouse`, `clientId`, `trackingNumber`, `partSku`, `hasCommand` (`yes`/`no`/empty), `status`, `page` (default 1), optional `export: true`.

All active filters use AND. PL number, tracking and actual-part SKU use case-insensitive literal contains. Warehouse/client/status use exact equality. Date bounds are inclusive warehouse-local calendar dates already stored by B044 (America/Toronto). Warehouse/client/status dropdowns derive from stored records.

Ordinary search returns only 50 PL summary rows. The existing Feishu record service paginates records inside the Worker for filtering and full-set summary calculation. The browser never downloads the entire table just for pagination. Details are fetched separately. No search/detail code calls create/update methods.

Main Parts Used Summary aggregates confirmed actual usage by exact SKU. To contribute, usage must match a package identity, tracking and completion timestamp in the detail snapshot. Temporary/unrecognized/unmatched usage never contributes; detail shows warnings for unreadable/unmatched history. Package-level traceability and original/organized commands are secondary expandable sections. All text is escaped.

Legacy text is tolerated. A unique legacy tracking number can acquire its package ID from a new completion event. Old lists without recorded completion events show `Completion unverified`, not a fabricated Processing/Completed status. `Not Confirmed Complete` is total minus recorded confirmations; it is not a claim that every remainder is currently Processing. Historical cancelled status remains visible. Completed and Partially completed are derived only from recorded confirmations.

## Export

EXPORT FILTERED RESULTS requests every matching PL from the Worker, not only the visible page. Safety limits: 1,000 filtered Picking Lists and 8 MB serialized response data. Exceeding either returns a clear error, never a partial workbook.

Local SheetJS produces `BATCH_PICKING_LIST_YYYY-MM-DD.xlsx` with:

1. PICKING LISTS: PL summary columns and status.
2. PART USED SUMMARY: PL number, exact part SKU, aggregated confirmed quantity.
3. PACKAGE DETAIL: package record ID/tracking/final SKU/raw command/completion/confirmed parts for audit.

## TOOL CLASS sync (manual only)

The existing service now combines the three Client Tool entries with the new In-House entry. Sync remains idempotent by TOOL ID. Repeated sync does not duplicate rows. Run only when ready to update live TOOL CLASS; this invocation uses the local source and does not require a Worker deployment first:

```sh
cd /Users/algerou/warehouse-toolbox
node --env-file=worker/.dev.vars --input-type=module <<'NODE'
import { getFeishuConfig } from './worker/src/config/feishu-config.js';
import { createFeishuAuthService } from './worker/src/services/feishu-auth-service.js';
import { createFeishuRecordService } from './worker/src/services/feishu-record-service.js';
import { createToolRegistryService } from './worker/src/modules/tools/tool-registry-service.js';
const config = getFeishuConfig(process.env);
if (config.toolTableId !== 'tblNxCev7LS7uETW') throw new Error('Unexpected TOOL CLASS table ID');
const records = createFeishuRecordService(createFeishuAuthService(config));
console.table(await createToolRegistryService(config, records).sync());
NODE
```

The local env file must contain the existing Feishu configuration including `FEISHU_TOOL_TABLE_ID`; do not print its contents or credentials. If TOOL TYPE is a select field, its schema must permit `In-House Tool`; no automatic field-option changes are made.

## Local validation and testing

Run:

```sh
node --test worker/test/*.test.js tests/*.test.cjs
git diff --check
```

Frontend syntax can be checked with `node --check` for the changed scripts; Worker files use the existing worker package ES-module configuration. Local browser fixtures exercised the actual page route/rendering and B044 parts controls at desktop/tablet/mobile widths in light/dark mode, with all network calls blocked and synthetic data only.

For a local end-to-end Worker test, start Wrangler locally, then override `window.MkiteApiConfig` to a new object with `baseUrl: 'http://localhost:8787'` in the testing tab (the current API client resolves configuration per request). The automatic port-5501 override applies only to User Management; this milestone does not redirect production warehouse operations. Reopen the tool after changing the base URL. Use an isolated Feishu test base/table configuration for any test that generates/completes a PL; a local Worker can still write to whichever real table its credentials target. A real scanner/printer and test-table write/recovery check remain operator validations before deployment.

## Files in this milestone

New files:

- `js/shared/picking-parts.js`
- `js/in-house-tools/batch-picking-list.js`
- `css/in-house-tools/batch-picking-list.css`
- `worker/src/modules/batch-picking-lists/search-service.js`
- `tests/batch-picking-list.test.cjs`
- `worker/test/batch-picking-list.test.js`
- `docs/b044-parts-and-batch-picking-list-v1.md`

Existing files changed:

- `js/client-tools/b044/put-away-scan.js`
- `css/client-tools/b044-put-away-scan.css`
- `js/in-house-tools-registry.js`
- `index.html`
- `worker/src/index.js`
- `worker/src/modules/b044-put-away/put-away-detail.js`
- `worker/src/modules/b044-put-away/put-away-service.js`
- `worker/src/modules/picking-lists/picking-list-fields.js`
- `worker/src/modules/picking-lists/picking-list-service.js`
- `worker/src/modules/tools/tool-registry-service.js`
- `tests/b044-picking-workflow.test.cjs`
- `worker/test/b044-put-away.test.js`
- `worker/test/tool-registry.test.js`

Other existing uncommitted User Management/local-development files were preserved. No new dependency was added for this milestone.

# B044 create-picking-list 409 audit

## Evidence boundary

Reported live observations: prepare returns six eligible and fourteen exceptions;
create returns HTTP 409; PICKING LIST CLASS appears empty; the browser shows Retry /
Resume and disables A4. The failed response body and live Durable Object storage
were not available during this audit. No remote mutation, deployment, state reset,
or commit was performed. The deployed revision was not independently compared to
the local files. Therefore the exact live error code and root cause remain
unconfirmed. The analysis below describes the current workspace path.

## Complete HTTP path

`put-away-scan.js#createPickingList` → `picking-workflow.js#post` →
`api-client.js#post` → `index.js#handleRequest` →
`put-away-controller.js#handleB044` → the per-Base
`B044PutAwayCoordinator.fetch/handle` → `put-away-service.js#create` →
generic `picking-list-service.js` → Feishu auth/record/attachment services.

The sole explicit HTTP 409 producer on this path is the coordinator's catch.
Before this audit it selected 409 for **any thrown error with a truthy `.code`**.
It now selects 409 only for the existing `PickingListError` domain type; unexpected
runtime/storage errors are normalized to 502 without exposing their internals.
The outer Worker/controller do not manufacture a creation 409. The controller
forwards the coordinator status. Missing bindings return 503; outer errors 502.

## Every domain code that can escape create as HTTP 409

“Before” means before a new Feishu master write in this invocation. An existing
job can already have external effects, as noted.

| Code | Exact triggering condition | Stage | Persistence relation |
| --- | --- | --- | --- |
| INVALID_INPUT | Body is null, not an object, or an array | VALIDATE_REQUEST | Before all state/external calls |
| REQUEST_ID_REQUIRED | requestId fails `^[a-zA-Z0-9-]{16,80}$` | VALIDATE_REQUEST | Before all state/external calls |
| INVALID_ROWS | rows is not an array, empty, over 500; any required trackingNumber/arrivalDate/inboundSku/warehouseInboundOrder is empty, over 256 characters, contains control characters; order does not match RMA/RV plus client segment and dash | VALIDATE_SOURCE | After job read, before any external call; prior job may already exist |
| DUPLICATE_SOURCE_TRACKING | Two source rows have the same normalized tracking value | VALIDATE_SOURCE | Same as INVALID_ROWS |
| REQUEST_ID_CONFLICT | Existing job fingerprint differs from JSON of normalized source rows | VALIDATE_SOURCE | No external call this attempt; prior job may be persisting, blocked, assigning or operational |
| PACKAGE_STATUS_SCHEMA_ERROR | STATUS field missing, type not numeric 3, or its options omit any exact name Active, Processing, Processed | CHECK_PACKAGE_SCHEMA | Feishu fields read only this attempt; before new allocation/persistence; also checked on assigning retries |
| NO_ELIGIBLE_PACKAGES | Fresh server prepare returns no eligible records | CHECK_ELIGIBILITY | Feishu schema and inventory reads, before allocation/writes |
| PACKAGE_RESERVED | Any eligible package has a truthy `reserved:<recordId>` value in the Durable Object | CHECK_PACKAGE_RESERVATIONS | Before this job's allocation/writes; owning prior job may have external effects |
| PL_NUMBER_COLLISION | No unused suffix found in the allocator's 0001–9999 candidate loop | ALLOCATE_PL_NUMBER | Master-number list read, before XLSX/upload/create |

`PICKING_LIST_NOT_CONFIGURED` can be thrown by generic nextNumber if its configured
table ID is empty. In the normal HTTP path the controller already rejects that
same missing binding with **503**, so it is not a reachable normal creation 409.

There are no further explicitly coded creation conflicts. In the old coordinator,
an unexpected library/platform exception carrying `.code` could also become 409
at whichever await threw; the source cannot enumerate external runtime codes.
This broad classification has been corrected rather than treating unknown failures
as intentional concurrency guards.

## Branches that do NOT produce creation HTTP 409

- Existing `persisting` or `blocked`: HTTP 200, operational=false; inspection required.
- Existing `operational`: HTTP 200, original job returned, including completed rows.
- Existing `assigning`: resumes unfinished transitions; no second upload/master.
- Upload, master create, missing returned record ID, attachment/number reread mismatch,
  or persistence-checkpoint failure: caught inside create; HTTP 200, phase=blocked.
- PACKAGE_CHANGED and PACKAGE_UPDATE_UNCONFIRMED during assignment: caught per
  package; HTTP 200, phase=assigning, failed array. These may escape as 409 on the
  separate completion endpoint, but not on create.
- Ordinary Feishu auth/list/field API errors outside persistence: no `.code` on the
  local Feishu error classes, so HTTP 502, even if the upstream HTTP status was 409.

`PL_PERSISTENCE_UNCONFIRMED` never escapes the normal persistence catch as a
creation 409. No create path deletes records, removes attachments, rolls back
package changes, or clears state. An empty table is not explained by local cleanup.

## Durable Object and retry identity

One coordinator per Base serializes live requests through its promise queue.
Storage retains `job:<requestId>`, `reserved:<packageRecordId>` and
`pl:<pickingListNumber>` → job key. The browser's body requestId is a stable
**operation ID**, generated and saved before the first network request. It is
different from the server-generated per-HTTP-request correlation ID. There is no
separate attempt ID, upload ID, PL-number reservation key or “busy → 409” guard.

Retries send the same operation ID and the full valid normalized source batch,
including the fourteen exceptions, rather than just the six eligible packages.
The server reclassifies the batch for a new job. It fingerprints all normalized
source fields, source row order and normalized Excel row numbers. File name and
totalSourceRows are metadata, not fingerprint identity. Once a job exists, its
saved eligible set is authoritative. The browser's operationBusy suppresses
duplicate clicks; the coordinator serializes duplicates from separate requests.

Retry / Resume text depends only on the browser's saved creationRequestId. A4
requires an operational PL. Thus both observed UI states occur even if validation
fails before a Durable Object job is written. Clearing browser state or generating
a new operation ID is not a safe remedy for uncertain external persistence.

Uncertain `persisting` checkpoints are deliberately not automatically retried:
the existing checkpoint does not prove whether upload/master writes succeeded.
Blindly rerunning persistence could duplicate attachments or masters. This audit
preserves that guard and does not introduce a recovery endpoint or delete state.

## How far the live request got

HTTP 409 alone cannot prove whether any of the seven requested stages happened
in a **previous** attempt. All intentional escaping create guards precede new
persistence in the current attempt. For the schema branch specifically:

| Stage | Reproduced PACKAGE_STATUS_SCHEMA_ERROR branch |
| --- | --- |
| Feishu reached | Yes: authentication as needed, then PACKAGE CLASS field read |
| PL number allocated | No |
| XLSX generated | No |
| Media uploaded | No |
| PICKING LIST CLASS created | No |
| Attachment attached | No |
| Master reread | No |
| Active → Processing | No |
| Durable job created | No |

A new integration test exactly reproduces the observed counts followed by this
409 by omitting Processed from the mocked STATUS options. Correcting that mocked
schema lets the same operation ID succeed. This demonstrates a matching failure
mechanism, **not confirmation that the live schema is wrong**. Confirm using the
original Network response's error.code/error.message. If it is
PACKAGE_STATUS_SCHEMA_ERROR, inspect STATUS type and exact option names; do not
weaken the guard or alter attachments. If it is REQUEST_ID_CONFLICT or
PACKAGE_RESERVED, inspect the original operation's state before any recovery.

## Targeted changes

- Forward the HTTP correlation ID into the coordinator and return it with errors.
- Add safe stage/operation-state/count diagnostics around validation, schema,
  eligibility, reservations, numbering, XLSX, upload, persistence and assignments.
- Log only route, UUID correlation ID, fixed stage/state names, eligible count,
  event, normalized error code and status. Never log request rows, NOTE contents,
  contact data, credentials, file tokens or bytes, or exception messages.
- Keep existing domain conflict codes. Add structured result errors for protected
  resume, persistence failure and incomplete assignment; retain existing HTTP
  200 non-operational response semantics and all concurrency guards.
- Preserve normalized code/stage/state through the frontend API/helper and display
  the code alongside the existing error message, without changing layout.
- Normalize unexpected assignment error messages rather than exposing internals.

No Feishu payload, field mapping, table ID, attachment mechanism, numbering rule,
status transition rule or frontend layout was changed.

Files changed in this investigation:

- `worker/src/modules/b044-put-away/put-away-controller.js`
- `worker/src/modules/b044-put-away/put-away-coordinator.js`
- `worker/src/modules/b044-put-away/put-away-service.js`
- `worker/src/modules/picking-lists/picking-list-service.js`
- `js/services/api-client.js`
- `js/client-tools/b044/picking-workflow.js`
- `tests/b044-picking-workflow.test.cjs`

Files created:

- `worker/test/b044-coordinator.test.js`
- `docs/b044-create-409-audit.md`

Tests cover schema 409 with six eligible/fourteen exceptions, first valid create,
same-ID retry after schema correction, interrupted assignment, concurrent duplicate
clicks, fingerprint conflict, reservations, blocked/persisting states, persistence
failure without Processing, completed-job retries, frontend operation identity
across remounts, error propagation, and absence of private data in diagnostic logs.

Deployment command from repository root (not executed):

```sh
npx wrangler deploy --config worker/wrangler.toml
```

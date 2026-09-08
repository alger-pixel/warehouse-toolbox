# B044 Picking List Generate / Cancel workflow v2.1

Step 1 retains its slate preparation styling and exposes PREPARING, READY TO
GENERATE, PICKING LIST CREATED and PICKING LIST CANCELLED lifecycle states.
Upload, parsing, inventory matching and exception export do not write Feishu.

Generate Picking List requires a browser confirmation showing the eligible count
and Active → Processing effect. It reuses the original operation ID on retries.
The Worker rechecks eligibility, generates the PL number, persists the master
and detail text, rereads both fields, then assigns packages using the existing
STATUS/NOTE-only updates and CREATED note. A4 and Step 2 unlock only after the
server reports an operational PL with a number and master record ID.

Remove Excel clears the uploaded file, parsed rows, matching, exceptions and
pre-generation session data locally. Reset Page also requires confirmation.
Neither calls Feishu. Active PLs cannot be silently reset or removed. Unknown
generation outcomes retain the operation ID and require Retry / Resume before
local state can be discarded. A definitively rejected pre-persistence generation
can be cleared locally. After cancellation, Reset Page starts a fresh local session.

## Text persistence

`PICKING LIST DETAIL` must now be a Text field. The generic service writes only
`PICKING LIST NUMBER` and `PICKING LIST DETAIL` as strings, and verifies rereads
(including segmented text representations). It does not generate XLSX, upload
media or attach file tokens. The reusable Excel and Feishu attachment utilities
remain available independently. Text uses the existing
[Feishu record API](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/create).

B044's separate `put-away-detail.js` formatter owns PL/client/tool headers, local
creation time, package count, CREATED status, and ordered per-package SKU,
location, Final Put Away SKU and warehouse order entries. Other Picking List
consumers can provide their own text format. Numbering and location sorting are
unchanged.

## Cancellation

```text
POST /api/b044/put-away/cancel-picking-list
{ "pickingListNumber": "<PL>", "requestId": "<original generation ID>" }
```

The existing per-Base Durable Object serializes generation, completion and
cancellation. Cancellation requires an operational PL, or the same cancellation
already in progress. Generation that is still assigning must first be resolved.
The server uses its stored package membership, not submitted frontend package rows.

Before any rollback, a fresh paginated inventory read checks every PL member.
Processing members return to Active; Processed members retain their status and
DONE note without a rollback note. Unexpected statuses remain unchanged and are
counted as skipped. Identity, latest B044 ownership note for lifecycle statuses,
and the durable reservation must still match. Missing records, changed identities
or conflicting ownership block the operation. The master remains stored with
STATUS: CANCELLED and counts for `processedRetained`,
`processingReturnedToActive`, and `skipped`. These outcomes are checkpointed for
safe retries. Cancellation clears pending frontend confirmation and locks Scan & Print. Write validation requires a single-select STATUS field and only the current
operation’s target option: Processing for generation, Processed for completion,
and Active for cancellation. Prepare does not check option metadata; only records
whose status is exactly Active are eligible. The Worker never creates or edits
Feishu field options.

The server checkpoints `cancelling` before rollback, preventing completion or
generation retries from making that PL operational. It rolls back in bounded
groups of eight packages, with another fresh read before each update. Only STATUS
and NOTE are written: Processing → Active, preserving all existing note history
and appending:

```text
YYYY/MM/DD HH:mm - B044 SCAN PUT AWAY TOOL: PL NUMBER: <PL> - CANCELLED
```

The normalized action type is `B044_PUTAWAY_CANCELLED`, retaining tool, package,
client, PL, timestamp and status-transition context for future BATCH LOG use.
SKU, CLIENT ID, LOCATION and DATE OF RECEIVED are not updated.

After all package rollbacks are confirmed, the retained master detail receives:

```text
STATUS: CANCELLED
CANCELLED: YYYY/MM/DD HH:mm
```

Only then is the job marked `cancelled`. Its PL remains non-operational, with A4
and Scan & Print disabled. Reservations owned by a cancelled job may be reused by
a new generation. A repeated old cancellation returns the old result without
touching packages now assigned to another PL.

This is a full-list cancellation intent, not a user-selectable partial cancel.
External writes are not an atomic Feishu transaction: interruptions can leave
some rollbacks applied. The saved `cancelling` operation must be retried to finish;
lost acknowledgements are recognized using status/ownership/CANCELLED note so
retries do not duplicate notes. Master-update failures are also resumable. The
coordinator serializes this tool's requests but cannot lock unrelated Feishu
editors or integrations; fresh reads detect conflicting changes and stop further
writes.

Legacy uncertain `persisting`/`blocked` jobs are not cleared or automatically
recreated by this update. Previously created non-text masters require inspection
if the new text lifecycle cannot be confirmed; their data is never deleted.

## Validation and deployment

Worker tests cover prepare without writes, text-before-assignment ordering, notes,
unfinished-remainder cancellation, Processed preservation, unexpected statuses, unrelated record safety,
ownership changes, duplicate cancellation, interruption recovery, master-update
failure, cancelled reservation reuse and cancellation/completion serialization.
Receiving, Move Location, NOTE, health and CORS regression suites remain in place.
Frontend tests cover confirmation, matching without creation, local clearing,
active/uncertain protection, cancellation identity and execution gating.

Run from repository root:

```sh
npm --prefix worker test
node --test tests/*.test.cjs
```

Deployment command (not executed):

```sh
npx wrangler deploy --config worker/wrangler.toml
```

The existing centralized table ID remains `tblRfLgo1jIQkzmi`. Live Feishu writes,
browser layout and physical printing are not exercised by the Node test suites.

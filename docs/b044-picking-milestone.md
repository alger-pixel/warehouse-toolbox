# B044 Picking List milestone recovery audit

The recovery started from the existing workspace without restoring, resetting,
committing, pushing, or deploying. `git diff --name-only` omitted untracked files:
the entire Worker, its B044 backend and tests, and the frontend API helper already
existed on disk. Those implementations were preserved and audited, not recreated.
`pasted-text.txt` was not present on disk; this audit uses the recovery message's
requirements. Comparison against the original editor buffer remains outstanding.

## Frontend preserved

| Requirement | Recovered implementation and audit result |
| --- | --- |
| PACKAGE CLASS matching | Upload triggers prepare; manual refresh is available before creation. |
| Eligibility | ELIGIBLE, NOT_FOUND, BLOCKED_STATUS badges were present. Added current location, package status and reason columns. |
| Exceptions | XLSX export retains source identifiers, status and reason. |
| Creation | Explicit Create Picking List action, stable request ID, retry/resume and assignment failure display. |
| A4 | Separate A4 iframe, PL metadata, ordered package table, quantities, checkboxes and operator fields. |
| Scan gating | Scan mode requires an operational persisted PL, after all assignments succeed. |
| PL session | Local storage retains source rows, PL, request ID and pending package; backend Durable Object retains authoritative jobs. |
| Package state | Separate print counters and completion timestamps; scan queue is limited to PL members. |
| WAITING_FOR_LABEL_CONFIRMATION | Represented by pendingPackageId and scan state `waiting`; displayed as WAITING FOR LABEL CONFIRMATION. |
| Reprint | Requests another label without updating package status. |
| Final SKU | Exact physical Final SKU match invokes completion; wrong labels and server failures keep the package pending. |
| Progress | Completed/total counters and final PL completion display. |
| Responsive | Existing mobile navigation, scrollable tables, breakpoints and touch controls preserved. CSS reviewed; no visual browser/device verification performed. |

The recovered navigation, Receiving, Move Location, audio, styling and script
loading changes were retained. No frontend state-machine rewrite was needed.

## Backend architecture and behavior

`worker/src/modules/picking-lists/picking-list-fields.js` centralizes only the two
generic master fields. `picking-list-service.js` allocates numbers, generates a
caller-specified workbook, uploads it, creates the master and rereads it to confirm
both number and attachment token. B044-specific columns and transition rules live
in `modules/b044-put-away/put-away-service.js`, with its own HTTP controller and
Durable Object coordinator. No separate generic HTTP controller is needed because
there is no generic public endpoint in this milestone.

Prepare validates 1–500 normalized uploaded rows, deriving Final SKU server-side.
One paginated PACKAGE CLASS inventory read serves the whole uploaded batch; SKU
matching uses trimmed uppercase tracking numbers, retaining duplicate records for
manual review. A unique match with STATUS exactly Active is ELIGIBLE. Missing
matches are NOT_FOUND. All other statuses and ambiguous duplicate matches are
BLOCKED_STATUS, with reasons. Prepare performs no record or session writes.

Numbers now follow `B044-PL-YYYYMMDD-XXXX`, using warehouse-local date and the first
unused four-digit sequence from 0001 to 9999. The service checks PICKING LIST CLASS
for collisions and blocks on exhaustion. B044 mutations serialize in one Durable
Object per Base. This serialization does not lock external Feishu writers.

The B044 XLSX snapshot sorts naturally by CURRENT LOCATION, then tracking number.
Its eleven columns are PL NUMBER, CLIENT ID, SEQUENCE, CURRENT LOCATION,
IN-HOUSE SKU / TRACKING NUMBER, 到仓日期, 入库SKU, FINAL PUT AWAY SKU,
仓库入库单号, PACKAGE STATUS AT PL CREATION and PL CREATED TIME. The generic
Worker-native OOXML writer accepts other schemas; cells are explicit text to
preserve leading zeros and prevent formula interpretation.

Attachment upload uses multipart `POST /open-apis/drive/v1/medias/upload_all`,
with file_name, parent_type=bitable_file, parent_node=Base app token, byte size and
file. The returned file_token is persisted as `[{ file_token }]` in PICKING LIST
DETAIL. Credentials remain in backend bindings. References:
[Feishu media upload](https://open.feishu.cn/document/server-docs/docs/drive-v1/media/upload_all),
[attachment field](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/attachment),
[Feishu's published multipart example](https://www.postman.com/feishu-op/feishu-s-public-workspace/request/yids5ez/).

After master persistence and reread succeed, each assigned package is reread and
updated using only STATUS and NOTE. Active becomes Processing, appending:

```text
YYYY/MM/DD HH:mm - B044 SCAN PUT AWAY TOOL: PL NUMBER: <PL> - CREATED
```

Assignments advance in chunks of eight using the same creation request ID. Partial
success stays non-operational and is resumable. Uncertain master persistence blocks
the job for manual Feishu inspection; it does not transition packages. Reservations
and durable checkpoints prevent automatic creation retries from duplicating jobs.
There is no operator recovery endpoint for blocked jobs in this milestone.

Completion verifies the persisted PL, package membership, record ID, SKU, physical
Final SKU, Processing status and matching CREATED note. It changes only STATUS to
Processed and appends:

```text
YYYY/MM/DD HH:mm - B044 SCAN PUT AWAY TOOL: PL NUMBER: <PL> - DONE PUTTING AWAY
```

The reread after writing now also verifies identity. SKU, CLIENT ID, LOCATION and
DATE OF RECEIVED are never included in transition updates. Already-confirmed
updates recover safely after a lost response without duplicating notes. External
concurrent edits are not transactionally locked by Feishu's read/update API.

Package activity actions B044_PUTAWAY_CREATED and B044_PUTAWAY_COMPLETED retain
tool, client, package, PL, timestamp and status context for future BATCH LOG use.
BATCH LOG is not implemented.

## Files touched during this recovery

Created:

- `tests/b044-picking-workflow.test.cjs`
- `docs/b044-picking-milestone.md`

Changed from the recovered on-disk state:

- `README.md`
- `js/client-tools/b044/put-away-scan.js`
- `worker/src/modules/picking-lists/picking-list-service.js`
- `worker/src/modules/b044-put-away/put-away-service.js`
- `worker/test/b044-put-away.test.js`
- `worker/test/worker-http.test.js`

Other untracked Worker and frontend files were already present at recovery start.
They remain untracked; no git staging or commits were performed.

## Validation and deployment prerequisites

58 Worker tests and 13 frontend tests pass. Coverage includes classification with
no prepare writes, numbering/collisions/exhaustion, XLSX readback, attachment upload
and rejection, master persistence failure, partial assignments, both status
transitions and notes, completion rechecks, retries, scan gating, physical label
confirmation, session restoration, API wiring and exception export. Existing
Receiving, Move Location, activity, health and CORS regressions pass.

The table ID was unavailable during recovery. It has since been supplied and
configured as `FEISHU_PICKING_LIST_TABLE_ID=tblRfLgo1jIQkzmi` in Wrangler and the
local environment example. The Feishu application also needs access to the Base and supported
record/attachment operations. Live attachment persistence, real Durable Object
execution and physical printer behavior were not tested by the Node suites.

Exact deploy command, from the project root, after configuration:

```sh
npx wrangler deploy --config worker/wrangler.toml
```

No deployment was performed. After deploying to the configured Worker origin,
`http://localhost:5501` can test this frontend against it: the frontend already uses
live mode and Wrangler's origin allowlist includes localhost:5501 and 127.0.0.1:5501.

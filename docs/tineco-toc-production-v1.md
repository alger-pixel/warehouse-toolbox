# TINECO TOC — one-SN-one-record workflow

Identity remains MKS66 / TINECO-TOC / CT-MKS66-TINECO-TOC-0001.
Route: `#client/MKS66/TINECO-TOC/tool/tineco-toc`.
Table: TINECO TO C UNIT CLASS (`tblztQK3EhDAw2Wm`).

## Record identity and entry

ONE normalized SN = ONE Lark record. Trim outer whitespace, retain internal
characters and punctuation; existing case-insensitive SN comparison continues.
Tracking number is optional, editable, and never identifies a machine.

A successful first begin creates a Pending unit with entry count 1, numeric
CURRENT STEP 1, zero prior labor and an empty part list. UNIT ID is allocated
once using the warehouse-date TCU-YYYYMMDD-XXXX sequence and collision checks.
Future entries reuse both recordId and UNIT ID. Scanning a Pending unit and
submitting BEGIN UNIT intentionally starts another entry and increments its
stored TIMES OF RE-ENTER by one. Retries and refresh recovery use the same
requestId and never increment again. A new request cannot enter an SN already
owned by an active request; resume/cancel that active entry first.

Completed and Disposal units open read-only information panels and do not
increment the counter or reopen. Multiple normalized-SN records produce
DUPLICATE_SN_RECORDS with the matching count. No records are merged, deleted,
or chosen arbitrarily. Invalid Pending CURRENT STEP or disposition values
require manual correction.

## SOP and persistence

CURRENT STEP is always a number: 1 Pre-QC, 2 Repair, 3 Final QC. It is the stage
to resume next time. Begin returns the zero-based UI `step`, one-based
`currentStep`, authoritative recordId/Unit ID, entry, clientStatus, previous labor,
prior results and form data. Pending units resume directly at their stored step.

Each Continue/Back saves form data and the new numeric step to the same record.
Forward skipping is blocked. Pre-QC requires ISSUE FOUND to continue or exit;
PRE-QC NOTE is optional. Repair requires REPAIR LEVEL. Forward buttons use the
next stage color (Repair amber; Final QC green). Back navigation preserves data.

| Outcome | CLIENT STATUS | CURRENT STEP | FINAL QC RESULT |
|---|---|---|---|
| NFF | Pending | 1 | blank |
| Awaiting Parts | Pending | 1 | blank |
| Can Not Be Fixed | Pending | 2 | blank |
| Final QC Fail | Pending | 3 | Fail |
| Completed | Completed | 3 | Pass |

Final QC failure requires FINAL QC NOTE. Operators cannot directly edit Client
Status, Unit ID, re-entry count, numeric Current Step, repair date or labor.
No CURRENT STEP 4 or automatic Disposal transition exists.

PART USED DETAIL is the current actual part list, not a historical usage ledger.
Load previous parts on entry, scan additions (duplicates retained), and remove
recovered parts. Save overwrites detail with newline-joined items and derives
TOTAL PARTS USED from their count on the server. Can Not Be Fixed retains parts.

LABOR MINUTES is cumulative. Freeze current session elapsed time at first valid
final submission, round up to whole minutes with a minimum of one, and add it
to the previous authoritative labor total. The frontend shows previous, current
and total labor. Retries use the frozen absolute total, never increment it again.
Intermediate step saves do not add labor. REPAIR DATE means latest repair
activity: begin and successful step/final updates write their server timestamp;
retry preserves the original operation timestamp. Warehouse timezone is used
for generated IDs and optional human-readable audit lines.

## Authoritative writes and recovery

The existing begin/step/finish/cancel endpoints and dedicated Durable Object
remain. All updates after begin use authoritative recordId, with recordId, SN,
UNIT ID, CLIENT ID and WAREHOUSE rechecked. Active status, entry, step, labor
and ownership checks block conflicting external changes.

Durable mutation checkpoints hold an absolute patch and the prior record values.
A retry confirms an already-applied patch or reapplies it only if the prior
values still match. This prevents double re-entry, double labor and duplicate
optional NOTE lines. Interrupted first creation is recovered by exact SN/Unit ID;
if no record can be confirmed, it stays SAVE_UNCONFIRMED rather than blindly
creating a duplicate. A save from an older completed entry never modifies a newer
entry. Existing old-model Durable Object jobs are rejected with
SESSION_MODEL_CHANGED instead of replaying their old create-per-visit behavior.
Resolve any such pending legacy work before starting fresh.

Local storage preserves the current draft and pending request. Recovery reuses
that identity. Cancel discards unsaved local changes and releases the entry;
it does not delete the unit, undo begin's entry count, or undo saved step changes.
A pending begin is recovered before cancellation so its active lock is not lost.
A pending final update must be resolved before cancel. A new begin now writes a
record; the prior assumption that start/cancel never leaves a row no longer applies.

## Schema and future work

Read-only live inspection confirmed CLIENT STATUS is single-select with Pending,
Completed, Disposal and CURRENT STEP is Number. All requested REPAIR RESULT
options now exist, including Awaiting Parts, Can Not Be Fixed and Final QC Fail.
Final QC offers Pass/Fail; repair levels are Level 1/2/3. NOTE remains absent and
optional. If a text NOTE field is present, append one entry/step/outcome/session
labor line on final save without replacing earlier history. No schema mutation
or live repair writes were performed during this refactor.

No automatic migration of prior multi-row test data is included. The future
Pending Resolution tool can find Pending records, remove recovered parts and
set final disposition on these same stable records. That tool, access control,
new tables and TOOL CLASS changes are outside this milestone.

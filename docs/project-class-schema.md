# PROJECT CLASS — verified schema

Verified on 2026-09-30 using the existing Worker Feishu authentication/configuration and authenticated record service.

- Base App Token: `FGLSbhJ8taJ9KNsIp22cq9xDnuh`
- Table ID: `tbldVnRmtOLM1Jzw`
- View ID (unchanged): `vewQIbDs6C`
- Table: [PROJECT CLASS](https://sf5f34st5r.feishu.cn/base/FGLSbhJ8taJ9KNsIp22cq9xDnuh?table=tbldVnRmtOLM1Jzw&view=vewQIbDs6C)

## Execution result

- Before: PROJECT ID (Text, `fldhLOLmUR`, primary) and CLIENT ID (Text, `fldYkGSpQS`).
- Missing: the 33 fields marked Created below. All 33 were created.
- After: 35 required fields; names, types, select options and date formats verified by re-fetch.
- Both original field IDs, types, names and primary-field designation preserved.
- No field-type or option mismatches encountered. No fields renamed, replaced or deleted.
- Second live `--apply` run: **0 created, 0 missing, 35 verified**.
- No Bases, tables or records created; no records updated or deleted.
- No commit, push or deployment performed. Neither Worker nor frontend deployment is needed for this schema operation.

## Final field schema

| Field | Type | Feishu field ID | Result |
|---|---|---|---|
| PROJECT ID | Text (1) | `fldhLOLmUR` | Preserved |
| CLIENT ID | Text (1) | `fldYkGSpQS` | Preserved |
| PROJECT NAME | Text (1) | `fldTnfoXyQ` | Created |
| PROJECT STATUS | Single Select (3) | `fldgyK61L7` | Created |
| PROJECT TYPE | Single Select (3) | `fldcKEiBSs` | Created |
| WAREHOUSE | Text (1) | `fldbKIdLI1` | Created |
| PROJECT OWNER | Text (1) | `fldfZi43S7` | Created |
| ENGINEER | Text (1) | `fldLzz0OC9` | Created |
| START DATE | Date (5) | `fld1ZszxjA` | Created |
| TARGET END DATE | Date (5) | `fldlBNwOQP` | Created |
| ACTUAL END DATE | Date (5) | `fldl7dBQWA` | Created |
| PROJECT DATA | Long Text / JSON (1) | `fldQlpTEf9` | Created |
| PREPARATION DATA | Long Text / JSON (1) | `flduXl0WXO` | Created |
| PREPARATION STATUS | Single Select (3) | `fld2BJ8LLG` | Created |
| DAILY REPORT DATA | Long Text / JSON (1) | `fldMGvlvJh` | Created |
| FINAL REPORT DATA | Long Text / JSON (1) | `fldIB1UjmW` | Created |
| CLOSING DATA | Long Text / JSON (1) | `fldopldsKN` | Created |
| ACTIVATION SIGNATURE | Attachment (17) | `fldnUcIMiX` | Created |
| ACTIVATED BY | Text (1) | `fldyULTMSo` | Created |
| ACTIVATED AT | Date & Time (5) | `fldJurDa7q` | Created |
| DAILY REPORT ASSETS | Attachment (17) | `fldl2TZdUe` | Created |
| FINAL REPORT ASSETS | Attachment (17) | `fldVXpdqHj` | Created |
| CLOSING ASSETS | Attachment (17) | `fldnI9FdXn` | Created |
| TOTAL PROCESSED | Number (2) | `fldtUO05i8` | Created |
| A GRADE QTY | Number (2) | `fldSVpMKdy` | Created |
| B GRADE QTY | Number (2) | `fldZCzH3Qr` | Created |
| C GRADE QTY | Number (2) | `fldHFWtkYa` | Created |
| D GRADE QTY | Number (2) | `fldJveNDyl` | Created |
| OPEN ISSUES | Long Text (1) | `fldR6dBImE` | Created |
| IMPROVEMENT NOTES | Long Text (1) | `fldCYfTL13` | Created |
| NOTE | Long Text (1) | `fldC4AAe8X` | Created |
| CREATED AT | Date & Time (5) | `fldy7XhMvo` | Created |
| CREATED BY | Text (1) | `fldEBqE3NR` | Created |
| UPDATED AT | Date & Time (5) | `fldPR9gorz` | Created |
| UPDATED BY | Text (1) | `fldQTskUtH` | Created |

## Verified select options

### PROJECT STATUS

| Option | Feishu option ID | Color |
|---|---|---|
| Preparing | `optc6OmYXy` | 0 |
| Activating | `optKzwohSr` | 1 |
| In-Progress | `optJ0PFn5Q` | 2 |
| Finalizing | `optrHYNu8v` | 3 |
| Awaiting Closing | `optzFUOZ4n` | 4 |
| Closed | `optUT9HdYz` | 5 |

### PROJECT TYPE

| Option | Feishu option ID | Color |
|---|---|---|
| Refurbishment | `opt7n7mEf7` | 0 |
| Repair | `opt7iVrOPr` | 1 |
| Inspection | `optTBaoRyk` | 2 |
| Repack | `optmxEovAx` | 3 |
| Relabel | `opt74U28Xh` | 4 |
| Sorting | `optlKa1q85` | 5 |
| Other | `optynihJMN` | 6 |

### PREPARATION STATUS

| Option | Feishu option ID | Color |
|---|---|---|
| Not Started | `optgcglxWD` | 0 |
| In Progress | `optyR7ZoAa` | 1 |
| Ready | `optNNsGaWQ` | 2 |

## Storage and future API conventions

- Feishu type 1 is multiline Text, used for both normal text and Long Text JSON fields. No JSON was prefilled.
- Calendar dates use `yyyy-MM-dd`; date-times use `yyyy-MM-dd HH:mm`. All six date fields have `auto_fill: false`.
- KPI numbers use formatter `0`. No totals or audit fields were populated.
- New project creation should set PROJECT STATUS to Preparing in the future API. This schema task did not set record defaults or update existing records.
- PROJECT CLASS remains the authoritative master record; workflow state belongs in the JSON fields and evidence in the attachment fields.

## Local admin script

Read-only discovery is the default:

```sh
node --env-file=worker/.dev.vars scripts/ensure-project-class-schema.js
```

Create missing fields and verify:

```sh
node --env-file=worker/.dev.vars scripts/ensure-project-class-schema.js --apply
```

Add `--json` for the complete before/missing/created/final schema report. Credentials are loaded from existing local bindings and are not logged.

The script preflights all existing required fields before writing, re-discovers before each creation, and verifies existing field identities afterward. An incompatible type, conflicting select options or date format stops execution; it never deletes/replaces fields. Existing PROJECT TYPE Text is an allowed fallback. On an interrupted request, rerun discovery rather than blindly repeating the POST.

## Repository changes and validation

- `scripts/ensure-project-class-schema.js`: new local admin script and required schema.
- `worker/src/services/feishu-record-service.js`: reusable `createField` method using existing auth/error handling.
- `tests/project-class-schema.test.cjs`: planning, idempotency, mismatches, recovery and preservation tests.
- `worker/test/feishu-record-service.test.js`: authenticated field-creation and safe-error tests.
- `docs/project-class-schema.md`: this verified schema handoff.

**23 targeted tests passed** across the schema script and existing Feishu auth/record service tests. Syntax checks and `git diff --check` passed.

Ready for Project Management API foundation; UI and lifecycle endpoints are outside this task.

API reference: [Feishu field creation](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/create) and [field editing guide](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/guide).

# Create Case V1

Route: `Projects / Cases > Create / Report a Case > Create Case` (`#cases/create`)

Create Case uses the existing Settings administration key. Client selection and compact client creation use CLIENT CLASS `CLIENT ID`; category selection uses Active CASE CATEGORY records matching Warehouse ID, Client ID and Main Category; worker selection uses Active USER CLASS records with access to the selected warehouse.

The Worker re-reads all three authoritative tables before writing CASE CLASS. It snapshots category metadata, mandatory questions, issue options, the final instruction, and assigned User IDs/display names. IDs use `<WAREHOUSE>-<TORONTO-YYYYMMDD>-CASE-<NNN>` and a serialized Durable Object with stable request identities prevents duplicate Cases on retry.

`CASE TITLE` is optional Text field `fld3GGXJmU`. Manager attachments use the existing secure Feishu media upload service and are written only to `CASE ATTACHMENTS`. New Cases initialize as `Assigned`, with `{ "schemaVersion": 1, "revision": 0, "reports": [] }` in `REPORT DATA`, blank current-issue/report/completion audit fields, and Worker-controlled timestamps.

This phase exposes authenticated `POST /api/cases` and `GET /api/cases/:caseId`. The Open Case action is a read-only summary. Reporting and Case status transitions are outside V1.

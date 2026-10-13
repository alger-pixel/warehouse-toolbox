# Project In-Progress V1

The In-Progress workspace uses `PROJECT CLASS` as its source of truth. A project's original and current quantities are stored in `ORIGINAL PROJECT QUANTITY` and `TOTAL PROJECT QUANTITY`. `QUANTITY CHANGE DATA` keeps a versioned audit log with stable `QTY-NNN` identities, the previous and new totals, difference, reason, operator, and a Worker-generated timestamp.

Project progress is derived on every read from submitted daily reports:

```text
completed = sum(report.completedQty where report.status == "Submitted")
remaining = max(totalProjectQuantity - completed, 0)
percent = totalProjectQuantity > 0 ? completed / totalProjectQuantity * 100 : 0
```

The API returns the raw percentage. The workspace displays one decimal place. Draft reports never affect progress, and a quantity update cannot lower the total below submitted completion. Legacy In-Progress projects without a quantity enter a controlled setup state; their first quantity becomes both the original and current quantity.

`DAILY REPORT DATA` schema version 2 contains a revision and a `reports` array. New reports receive server-generated IDs in this format:

```text
<PROJECT-ID>-DR-<YYYYMMDD>-<NNN>
```

Each report has a client request identity, date, shift, production and quality quantities, work performed, issue declaration and conditional issue details, staffing snapshot, six keyed 5S results, production evidence, submitter, status, and Worker-controlled timestamps. Drafts are editable. Submitted reports are immutable for normal users. Replaying an already submitted report or request identity returns the authoritative project without adding another report or counting its quantity again.

Daily report writes include `expectedRevision`. A stale revision returns `PROJECT_REVISION_CONFLICT` instead of overwriting another operator's work. Submission validates all required fields in one response before uploading any files. The first four 5S checks require a Pass/Fail result and a picture. The final two are optional until evaluated. Any Fail also requires a corrective note. A single evidence identity cannot satisfy multiple report requirements.

All daily pictures are stored in the existing `DAILY REPORT ASSETS` attachment field. Structured report JSON contains opaque asset IDs, filenames, MIME types, and controlled `/api/projects/:projectId/assets/:assetId` URLs. Raw Lark attachment tokens never enter browser DTOs. The same project-bound Worker proxy used by preparation evidence serves these pictures.

The current endpoints are:

- `PUT /api/projects/:projectId/daily-report` with `action: "Draft" | "Submitted"`
- `PUT /api/projects/:projectId/quantity`
- `PUT /api/projects/:projectId/staffing`
- `GET /api/projects/:projectId/assets/:assetId`

No public endpoint deletes a submitted report.

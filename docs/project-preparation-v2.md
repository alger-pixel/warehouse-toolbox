# Project Preparation V2 — evidence and staffing

Implemented and locally validated October 1, 2026. No commit, push or deployment was performed.

## PROJECT CLASS schema extension

The internal schema helper fetched and validated the existing PROJECT CLASS schema before writing. It created only these missing fields:

| Field | Type | Feishu field ID |
| --- | --- | --- |
| WORKSTATION ASSETS | Attachment (17) | `fldF0X0EVM` |
| EQUIPMENT ASSETS | Attachment (17) | `fldKR4Blnk` |
| PARTS MATERIALS ASSETS | Attachment (17) | `fldan8cP52` |
| SOP GUIDEBOOK ASSETS | Attachment (17) | `fldCASkbbe` |
| PRODUCTION REPORT ASSETS | Attachment (17) | `fld267lrZ9` |
| STAFFING ASSETS | Attachment (17) | `fldYIjjtvk` |
| STAFFING DATA | Long Text (1) | `fldXjniEmE` |

The first authenticated run created seven fields and verified their types. The second run created zero fields and verified the same IDs. Existing fields were compared before/after and preserved. An incompatible or duplicate field stops the helper before mutation. The helper is [scripts/ensure-project-preparation-schema.js](/Users/algerou/warehouse-toolbox/scripts/ensure-project-preparation-schema.js).

## Preparation schema and compatibility

PREPARATION DATA now normalizes to `schemaVersion: 2`, including a monotonically increasing `revision`. Existing V1 JSON and category objects without items, evidence, or V2 fields load safely and normalize in memory. Historical extra data remains stored; public DTOs expose only supported fields. No existing records were batch-rewritten.

General categories contain `status`, `note`, `updatedBy`, `updatedAt`, and an `evidence` array. Equipment and Parts / Materials contain the same section fields plus `items`. Item identity uses stable generated IDs (`EQ-...` and `PART-...`) rather than array indexes. Each item stores its name, note, opaque asset ID, safe filename/MIME metadata, and Worker-controlled create/update timestamps.

STAFFING DATA remains independently versioned at schema version 1 and has its own revision:

```json
{
  "schemaVersion": 1,
  "revision": 2,
  "members": [{
    "memberId": "STAFF-...",
    "name": "Operator",
    "status": "Active",
    "joinedAt": "Worker timestamp",
    "leftAt": null,
    "note": ""
  }]
}
```

During Preparing, unsaved accidental entries can be removed. Once saved, a member cannot be deleted; an Active member can be marked Left, preserving identity and joined time while the Worker assigns left time. Left members cannot be reactivated or renamed through the normal API. The staffing endpoint remains available during Activating, In-Progress, Finalizing and Awaiting Closing, allowing additions, notes, and Active → Left changes. Closed projects remain read-only.

Preparation and staffing revisions prevent stale browser sessions from overwriting newer checklist, evidence, or roster changes. A conflict returns `PROJECT_REVISION_CONFLICT` and tells the operator to reload while leaving their browser draft intact.

## Evidence upload and retrieval

Pictures are selected using camera-friendly `accept="image/*" capture="environment"` inputs. The browser decodes and resizes them to a maximum 1600-pixel edge, encodes JPEG, keeps the draft locally in memory, and submits it to the Worker only when saving.

The Worker accepts PNG, JPEG, or WebP, verifies binary signatures rather than trusting the declared MIME type, permits at most 5 MiB per processed picture and 20 MiB of new pictures per save, and uploads through the existing Feishu media service. The browser never sends directly to Feishu.

Each category has a separate Lark Attachment field. PREPARATION DATA stores opaque asset IDs and safe metadata only. The Worker verifies every saved asset against the matching project record, category attachment field, filename, and Feishu token. Equipment and part items must use distinct asset IDs and filenames, so one picture cannot satisfy multiple items. Cross-project and cross-category references are rejected.

Public project DTOs remove Feishu file tokens, upload payloads, local identifiers, and unknown stored properties. Saved evidence receives only an opaque URL such as `/api/projects/<projectId>/assets/<assetId>`. This GET endpoint accepts only the configured trusted frontend origin or its Referer, resolves the token server-side, downloads through Feishu, permits only PNG/JPEG/WebP responses, sets `X-Content-Type-Options: nosniff`, and uses `Cache-Control: private, no-store`. It never forwards a bearer token to redirect targets or the browser.

Replacing an item picture creates a new opaque reference and retains every unrelated item attachment. Removing an item detaches its reference from the record’s category Attachment field. Feishu media binaries may remain orphaned because the media API does not provide a safe atomic delete with the record update; the application does not guess or delete shared media.

Uploads occur before the Lark record update. A network or validation failure after media upload can therefore also leave an orphaned media object. Record data and active references remain unchanged, and retry creates a fresh upload. This is the safe failure mode available without transactional Feishu media operations.

## Server readiness rules

Readiness shown by the UI comes from the Worker response, never from dropdown counting:

| Category | Valid only when |
| --- | --- |
| Workstation | Status Ready and at least one verified WORKSTATION ASSETS picture |
| Equipment | Status Ready, at least one named item, and one unique verified picture per item |
| Parts / Materials | Status Ready, at least one named item, and one unique verified picture per item |
| SOP / Guidebook | Status Ready and at least one verified SOP GUIDEBOOK ASSETS picture |
| Production Report Setup | Status Ready and at least one verified PRODUCTION REPORT ASSETS picture |
| Staffing / Resources | Status Ready, at least one named Active member, and verified STAFFING ASSETS evidence |

All untouched content derives Not Started. Any partial content, Blocked state, missing content, missing evidence, or invalid Ready selection derives In Progress. Only six server-valid categories derive Ready and display 6 of 6.

READY FOR ACTIVATION stays disabled while the draft is unsaved or readiness is not server-valid. The Worker independently re-reads Lark preparation, staffing, and attachments before allowing Preparing → Activating. Dropdowns alone produce 0 of 6 and `PREPARATION_VALIDATION_FAILED` with structured field errors on a direct transition attempt. Later stages are not implemented in this phase; the existing Activating placeholder remains.

The UI keeps Saved, Unsaved, Saving, and Save failed states. Names, notes, roster edits, status changes, adding/removing/replacing pictures, and item changes mark the draft dirty. A failed upload/save leaves all fields and previews available for retry. SPA navigation and browser unload guards continue to protect unsaved work.

## Files changed in this phase

- [project-schema.js](/Users/algerou/warehouse-toolbox/worker/src/modules/projects/project-schema.js): V2 normalization, staffing history, revisions, safe DTOs, and authoritative readiness.
- New [project-evidence.js](/Users/algerou/warehouse-toolbox/worker/src/modules/projects/project-evidence.js): secure picture validation, upload hydration, item association, replacement and detachment.
- [project-service.js](/Users/algerou/warehouse-toolbox/worker/src/modules/projects/project-service.js): preparation/staffing saves, activation guard, authoritative post-write reload, and protected asset resolution.
- [project-controller.js](/Users/algerou/warehouse-toolbox/worker/src/modules/projects/project-controller.js) and [project-coordinator.js](/Users/algerou/warehouse-toolbox/worker/src/modules/projects/project-coordinator.js): asset/staffing routes, trusted-origin responses, larger bounded preparation body, and serialized writes.
- [project-workspace.js](/Users/algerou/warehouse-toolbox/js/projects/project-workspace.js): dynamic equipment/parts, roster history, evidence camera inputs/previews, server readiness, retries, and mid-project staffing.
- [projects.css](/Users/algerou/warehouse-toolbox/css/projects.css): scoped evidence/item/roster/dialog and responsive styling. No shared card styles changed.
- New schema helper and tests: `scripts/ensure-project-preparation-schema.js`, `tests/project-preparation-schema.test.cjs`.
- Expanded `worker/test/projects.test.js` and `tests/project-workspace.test.cjs`.
- This report.

## Validation

- 329 targeted tests passed, zero failures. The suite covers all requested schema, readiness, item/photo, roster/history, timestamp, stale-write, security, proxy, save/retry, project lifecycle, shared attachment, SOP, Part-Used, B044, TINECO, navigation and existing tool regressions.
- Syntax checks passed for all changed Project application, Worker, schema helper and test JavaScript. `git diff --check` passed.
- Local Worker health passed on 8787. Local frontend validation used 5501 only.
- Browser validation created `MKS66-20260930-PROJ-004`, PROJECT PREPARATION EVIDENCE TEST, with Re-Work and a blank target date. Six Ready dropdowns without evidence returned 0/6. The UI added two equipment items, two parts, two staff members, and eight pictures. A simulated failed save retained all drafts; retry succeeded. All eight protected previews loaded, immediate and reloaded readiness showed 6/6, and Preparing → Activating succeeded.
- Light/dark visual checks passed at 1440, 768 and 390 pixels with no horizontal overflow. Evidence controls, roster cards and sticky/stacked readiness layouts were reviewed.
- After activation, one saved member was marked Left and a replacement member was added. Reload preserved all three records, original joined time, Worker left time, and the replacement joined time.
- Before cleanup, raw Lark verification confirmed attachment counts 1 workstation + 2 equipment + 2 parts + 1 SOP + 1 production report + 1 staffing, V2 preparation, three roster members with one Left, Ready preparation, and Activating project status. The authorized test record was deleted through internal tooling and confirmed absent; GET now returns 404 `PROJECT_NOT_FOUND`. No public DELETE route exists. Uploaded Feishu media may remain orphaned as documented above.

## Deployment and next phase

Worker deployment is required for schema/validation/upload/proxy/staffing behavior. Frontend deployment is required for the V2 editor. The seven Lark schema fields are already present. No Durable Object migration is needed. No application deployment, commit, or push was performed.

The project is ready for the Activating/signature phase. Signature controls and enforcement remain deliberately unimplemented.

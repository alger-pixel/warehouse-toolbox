# Projects workspace and Preparing stage

Implemented and locally validated September 30, 2026. No commit, push or deployment.

## Creation and Lark schema

The exact project type list is now Refurbishment, Repair, Inspection, Repack, Relabel, Sorting, **Re-Work**, Other. Frontend, Worker validation and schema definitions agree.

Before changing Lark, internal schema discovery confirmed PROJECT TYPE was Single Select with the original seven options. `scripts/update-project-type-options.js` added Re-Work before Other using the existing authenticated Feishu service. Every original option ID, name and color was preserved; no field was recreated or renamed. Re-Work received option ID `optkkjXHFf`. A second application returned `changed:false`, confirming no duplicate option or repeated write. The helper defaults to discovery; mutation requires `--apply`. It uses the official [Feishu field update API](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/update).

The reported Target End Date auto-fill was not reproduced in the checked-out implementation: the input already had no default value or required attribute, and the live Lark field had `auto_fill:false`. Those settings remain intact. The Worker now explicitly omits null/empty date fields on creation. Omitted, null and empty-string target dates are accepted without a synthetic date. An explicit null on metadata update can clear a date. Omitting the field during updates preserves historical dates. The creation summary and workspace display **Not set** for an absent target date. Browser validation confirmed the input began blank and raw Lark data remained empty. No historical projects were rewritten.

## Workspace and preparation

`#projects/project/<projectId>` loads the authoritative project through GET `/api/projects/:projectId`. Create-result OPEN PROJECT, exact-ID opening and search-result opening route here. The existing router handles encoding, sidebar selection and navigation.

The header shows project ID/name, client ID, warehouse ID/name, project type, owner, engineer, start date, target end date and project status. The informational six-stage stepper marks prior stages complete, the current stage active and future stages inactive. It has no status-changing controls.

Preparing provides six stable-key required areas:

| Key | Display label |
| --- | --- |
| workstation | Workstation |
| equipment | Equipment |
| parts | Parts / Materials |
| sopGuidebook | SOP / Guidebook |
| productionReport | Production Report Setup |
| staffingResources | Staffing / Resources |

Each area contains `status`, `note`, `updatedBy`, `updatedAt`. Status choices are Not Started, In Progress, Ready and Blocked. Additional Notes is optional. JSON retains `schemaVersion:1`. Empty JSON and legacy empty category objects normalize to Not Started / empty note / empty actor / null timestamp. Existing extra category data is preserved; legacy flags never invent readiness.

Top-level PREPARATION STATUS remains Not Started, In Progress or Ready:

- All six required areas Ready → Ready.
- All six Not Started, all category notes empty and Additional Notes empty → Not Started.
- Every other combination, including any Blocked area or notes-only progress → In Progress.

Audit metadata does not count as progress. The Worker derives this status on every preparation save. A caller-supplied summary must agree with the checklist; spoofed category audit fields are rejected. Category audit timestamps are Worker-controlled and actor names follow the existing request-actor convention.

Preparation uses PUT `/api/projects/:projectId/preparation`. The browser sends only changed status/note fields and optional changed Additional Notes; the Worker merges them under the existing per-project Durable Object serialization. Unrelated categories and fields are preserved. Preparation editing is permitted only while the project is Preparing.

Example body:

```json
{
  "data": {
    "schemaVersion": 1,
    "equipment": { "status": "Ready", "note": "Scanner and bench tested" }
  },
  "actor": "Operator"
}
```

Save states are Saved, Unsaved, Saving and Save failed. Failed saves retain edits and enable retry. Controls are disabled during writes. SPA navigation confirms before discarding unsaved edits; browser reload/close uses beforeunload protection. No lifecycle draft is stored in localStorage.

READY FOR ACTIVATION is disabled until all six required areas are Ready. It saves pending changes first, then calls POST `/api/projects/:projectId/status` with Activating. The Worker re-reads preparation JSON and rejects incomplete readiness with `PROJECT_PREPARATION_INCOMPLETE`, even if Lark’s top-level summary was manually set to Ready. Existing sequential status validation still blocks Preparing → In-Progress. A successful transition shows PROJECT READY FOR ACTIVATION / Activation workflow coming next. Later statuses load their summary and stage placeholder without being downgraded.

The olive design uses a compact checklist and desktop readiness sidebar. Tablet/mobile layouts stack, with a wrapping stepper and touch-friendly controls. No signature, attachment, daily report, finalizing or closing UI was added.

## Files changed in this phase

- `index.html`: loads the new lifecycle workspace module.
- `js/router.js`, `js/app.js`: project-ID route, title/render integration and unsaved navigation guard hook.
- `js/projects/create-report.js`: Re-Work option, workspace opening and safe blank-date summary.
- New `js/projects/project-workspace.js`: header, stepper, Preparing editor, save/retry/leave guards, readiness action and later-stage placeholders.
- `css/projects.css`: scoped workspace, checklist, stepper and responsive styles. No shared card styles changed in this phase.
- `worker/src/modules/projects/project-schema.js`: Re-Work, preparation defaults, normalization, validation, derivation and audit merge.
- `worker/src/modules/projects/project-service.js`: empty creation-date omission, derived preparation saves and authoritative activation guard.
- `worker/src/services/feishu-record-service.js`: internal field-update method.
- `scripts/ensure-project-class-schema.js`: expected Re-Work option; new `scripts/update-project-type-options.js`: preserving/idempotent internal schema update.
- `worker/test/projects.test.js`, `worker/test/feishu-record-service.test.js`: expanded behavior coverage.
- New `tests/project-workspace.test.cjs`, `tests/project-type-options.test.cjs`.
- This report. Existing unrelated working-tree changes are preserved.

Project ID format, warehouse/day sequencing, Toronto date allocation, status names, Lark authority, B044 barcode logic, Part-Used logic and local ports are unchanged.

## Validation

303 targeted tests passed, zero failures. Coverage includes:

- Frontend: existing create/search foundation and sidebar, exact Re-Work order, blank optional date, project route roundtrip and rejected navigation, safe header escaping, all six stepper states, default checklist and readiness derivation.
- Worker: Re-Work create/reload; omitted/null/blank and explicit dates; historical date preservation; preparation normalization, notes/status updates, derived summary, Blocked behavior, category audit protection, forged summary rejection, required readiness, transition guards, concurrent partial merges, failed-write retry and existing ID/concurrency contracts.
- Internal schema helper: preserved option IDs/colors/names, no duplicate creation on repeat; authenticated field-update request contract.
- Regressions: Projects, Dashboard, In House Tools, Client Tools, Assisting Tools, Worker HTTP/config, B044, TINECO, Part-Used Inventory Count, SOP Builder and tool registry.

Syntax checks passed for the nine changed application/admin JavaScript files. `git diff --check` passed.

Actual local browser validation used frontend **5501**, Worker **8787**, with GET `/api/health` passing first. No 5502 use. The browser created the authorized live record with a blank target date and Re-Work, opened its workspace, verified the incomplete server guard, changed a Blocked item and note, rejected navigation with unsaved edits, simulated a failed save, confirmed edits survived, retried successfully and reloaded the saved checklist. Light/dark layouts at 1440, 768 and 390 pixels had no horizontal overflow. Screenshots were visually reviewed. Marking all six Ready enabled the action; saving and transitioning to Activating succeeded and persisted after reload.

The only live test record created for this phase was **MKS66-20260930-PROJ-003**, named PROJECT PREPARING UI TEST, client TEST, warehouse MKS66. Internal cleanup first verified its exact ID/name/creator plus raw Lark Re-Work, absent target date, all-ready preparation and Activating status. It then deleted the record and confirmed absence. GET by project ID returned 404 `PROJECT_NOT_FOUND`. No public DELETE endpoint was added. Its allocator sequence remains consumed intentionally.

## Deployment and next phase

Both Worker and frontend deployment will be required later. There is no new Durable Object migration in this phase. The authorized Lark Re-Work schema update is already applied. Application code remains local; nothing was committed, pushed or deployed.

Ready for the Activating/signature UI phase. Signature validation/enforcement and attachment flows remain future work; no fake signature data or controls were introduced.

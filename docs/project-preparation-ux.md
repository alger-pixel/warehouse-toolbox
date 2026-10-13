# Project Preparation UX upgrade

Implemented and locally validated October 1, 2026. No commit, push, deployment, or live Lark test record was created for this UI refinement.

## Save progress

Preparation and mid-project staffing saves now display an in-workspace progress panel with a percentage, progress bar, accessible `progressbar` semantics, and a short stage label:

| Percentage | Label |
| --- | --- |
| 0% | Preparing save… |
| 15% | Validating preparation… |
| 30% | Preparing attachments… |
| 55% | Uploading and saving evidence… |
| 75% | Saving preparation data… |
| 90% | Verifying server state… |
| 100% | Saved |

The stages are deterministic UI feedback around the existing single Worker request. They do not claim byte-level upload progress. Timers stop immediately when the request resolves or fails, so the display cannot advance after the outcome is known.

While saving, every editable control and action is disabled and the `busy` guard ignores duplicate submit events. This prevents repeated preparation requests and duplicate attachment uploads. Success reaches 100% and remains visible briefly before returning to the normal Saved state.

On failure, progress stops at the current stage below 100%, changes to SAVE FAILED styling, preserves the entire draft and pending image data, and exposes an in-workspace RETRY action. Retry uses the same current draft. Existing Saved, Unsaved, Saving and Save failed states remain.

## Structured validation contract

Authoritative activation validation now returns `PREPARATION_VALIDATION_FAILED` with every problem in one response. The existing API envelope is preserved:

```json
{
  "ok": false,
  "error": {
    "code": "PREPARATION_VALIDATION_FAILED",
    "message": "Controlled summary",
    "retryable": false
  },
  "errors": [
    {
      "path": "equipment.items.EQ-002.asset",
      "code": "EQUIPMENT_EVIDENCE_REQUIRED",
      "message": "A picture is required for this equipment item."
    }
  ]
}
```

The shared API client retains the `errors` array on normalized failures. Paths, codes, and messages contain application concepts only; no Feishu response, token, filename, or attachment internals are returned.

Stable paths map to exact controls:

- `workstation.evidence`
- `equipment.items` and `equipment.items.<itemId>.name|asset`
- `parts.items` and `parts.items.<itemId>.name|asset`
- `sopGuidebook.evidence`
- `productionReport.evidence`
- `staffing.members`, `staffing.members.<memberId>.name`, and `staffing.evidence`
- `<category>.status` when a required category is not Ready

The Worker readiness result also includes the same flat validation array, alongside the existing per-category messages. All errors are collected in one pass. Stable item/member IDs are used throughout; array positions are never validation identities.

## Field-level behavior

After an explicit save or activation attempt, the workspace renders a summary containing every error and maps each path to its exact UI element. Invalid targets receive a restrained red border/tint, `aria-invalid="true"`, and inline `role="alert"` text. The first invalid control scrolls into view and receives focus after the explicit action only.

- Workstation Ready without a picture highlights Workstation Evidence: “Workstation photo is required before this section can be Ready.”
- Equipment validates every row independently. Missing names and pictures target only that item. A valid first item remains unmarked when a second item is incomplete.
- Parts / Materials follows the same per-item behavior with part-specific messages.
- SOP / Guidebook and Production Report Setup highlight their evidence regions when Ready evidence is absent.
- Staffing highlights the roster when there is no Active member, the exact Active member name field when blank, and the staffing evidence region when absent.
- Notes remain optional because no current business rule makes them mandatory. The path-based architecture can add note rules later.

Editing an invalid field or adding its picture clears that exact stale error immediately while leaving unrelated errors visible. Server responses replace client findings when available. Multiple errors remain visible together in both the field locations and the summary.

Client validation provides immediate target mapping. The Worker remains authoritative: Preparing → Activating re-reads saved Lark state and returns all server validation errors. READY FOR ACTIVATION remains disabled for dirty drafts or anything below server-validated 6/6 readiness.

## Readiness panel

The existing server-validated count and meter remain. The panel now adds a compact **Missing** list containing every incomplete category, so a 5/6 result explicitly names the remaining area. Draft changes are still labeled “Unsaved changes · save to validate,” avoiding a misleading client-only readiness claim.

## Files changed

- [project-workspace.js](/Users/algerou/warehouse-toolbox/js/projects/project-workspace.js): deterministic progress controller, failure/retry flow, client validation, path mapping, focus/scroll and targeted clearing.
- [projects.css](/Users/algerou/warehouse-toolbox/css/projects.css): progress, validation summary, invalid controls, inline messages and responsive wrapping.
- [project-schema.js](/Users/algerou/warehouse-toolbox/worker/src/modules/projects/project-schema.js): structured multi-error readiness output.
- [project-service.js](/Users/algerou/warehouse-toolbox/worker/src/modules/projects/project-service.js): structured activation validation failure.
- [api-client.js](/Users/algerou/warehouse-toolbox/js/services/api-client.js) and [index.html](/Users/algerou/warehouse-toolbox/index.html): preserve validation errors and update the cache version.
- `tests/project-workspace.test.cjs`, `tests/api-local-development.test.cjs`, and `worker/test/projects.test.js`: progress, target mapping, error transport and HTTP contract coverage.
- This report.

## Validation

- Unit coverage verifies 0% start, stage advances, failure below 100%, retry, 100% success, and accessible progress markup.
- Validation coverage includes workstation evidence; equipment and parts name/evidence using stable IDs; a valid first/invalid second equipment row; SOP evidence; production-report evidence; empty staffing; blank staff name; staffing evidence; and multiple simultaneous errors.
- HTTP coverage confirms all errors arrive together and contain no Feishu internals.
- Browser validation on frontend 5501 used the real workspace with controlled local API responses. It confirmed 0% start, intermediate 30–75% stages, duplicate-submit blocking, failure stopping below 100%, three simultaneous field highlights, first-error focus, exact stale-error clearing, retained values, retry, 100% success, and return to Saved.
- Desktop 1440px, tablet 768px, and mobile 390px layouts were visually reviewed in light/dark modes. Validation text wraps and no horizontal overflow was detected.
- Worker `/api/health` passed on 8787 before validation. Port 5502 was not used.
- Full targeted regressions include Preparation V2, project workspace/status, upload/proxy, staffing history, V1 compatibility, SOP attachments, Part-Used evidence, B044, TINECO, navigation and shared Worker contracts.

Worker and frontend deployment will both be required. No schema or Durable Object migration is required for this refinement. The application remains ready for the Activating/signature phase; no signature or later lifecycle UI was added.

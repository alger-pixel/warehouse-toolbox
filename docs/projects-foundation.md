# Projects foundation — local implementation report

Validated September 30, 2026. No commit, push or deployment performed.

## Navigation and interface

Sidebar before: Dashboard → In House Tools → Client Tools → Assisting Tools → Settings.

Sidebar after: Dashboard → **Projects** → In House Tools → Client Tools → Assisting Tools → Settings.

`#projects` displays the registry-driven landing page. `#projects/create-report` opens the foundation workspace. Projects uses an olive/sage industrial accent and the existing SVG icon system. The registry exposes only **Create / Report Project**; future overview, daily reports, closing and archive entries are hidden metadata.

The workspace offers CREATE NEW PROJECT and OPEN / REPORT EXISTING PROJECT. Creation includes warehouse ID, warehouse, client ID, project name, project type, project owner, engineer, start date, target end date and created by. Only warehouse ID, client ID and project name are required. ID and initial statuses are assigned by the Worker. Success shows a summary, OPEN PROJECT and CREATE ANOTHER.

Opening supports exact ID plus paginated search by warehouse ID, client ID, status and project name. Search results open a summary. Lifecycle editing screens remain deferred. Project data never depends on localStorage.

## Identity and persistence

Permanent IDs use `<WAREHOUSE ID>-<Toronto YYYYMMDD>-PROJ-<NNN>`. Warehouse IDs are trimmed, uppercased and validated against `[A-Z0-9_-]+`. Changing warehouse metadata never regenerates the ID.

`ProjectCoordinator` serializes creation at `project-id:<warehouse>:<Toronto day>`; independent warehouses have independent sequences. It reconciles existing Lark IDs, checks for a collision and reserves the sequence in Durable Object storage before creating the Lark record. Failed or ambiguous writes can leave gaps; IDs are never deliberately reused. Daily capacity is 999. Existing IDs determine the high-water mark even if warehouse metadata was subsequently changed.

All updates and workflow merges serialize at `project:<permanent ID>`. Lark PROJECT CLASS remains authoritative for project content. Centralized field names, DTO normalization and schema validation are in `project-schema.js`. No fields were recreated or renamed.

## API contract

All paths start with `/api/projects`. Responses follow the existing `{ok,data}` or controlled `{ok:false,error}` envelope.

| Method/path | Purpose |
| --- | --- |
| POST `/` | Create; returns 201 and normalized project |
| GET `/` | Bounded list; `limit` defaults to 25, maximum 100; opaque `cursor` |
| GET `/:projectId` | Exact lookup; missing project returns 404 `PROJECT_NOT_FOUND` |
| PUT `/:projectId` | Editable metadata; immutable ID and audit timestamps cannot be supplied |
| POST `/:projectId/status` | Body `{projectStatus, actor}`; next transition only |
| PUT `/:projectId/preparation` | Body `{data, preparationStatus?, actor}` |
| PUT `/:projectId/daily-report` | Body `{data:{reportId,date?,production?,fiveS?,issues?,notes?},actor}` |
| PUT `/:projectId/final-report` | Body `{data:{totals?,openIssues?,improvementNotes?,...},actor}` |
| PUT `/:projectId/closing` | Body `{data,actor}` |

List filters: `warehouseId`, `clientId`, `projectStatus`, `projectType`, `projectOwner`, `search` (project name). Feishu performs filtering and pagination. Blank starter rows without a project ID are excluded. There is no public DELETE endpoint.

Create defaults: Preparing, Not Started, Worker timestamps, supplied actor/createdBy or Warehouse Operator. Subsequent writes stamp Worker time and request actor; clients cannot directly override audit timestamps. Date-only fields are validated calendar dates stored at noon UTC to preserve their Toronto calendar day.

| Current status | Only allowed next status |
| --- | --- |
| Preparing | Activating |
| Activating | In-Progress |
| In-Progress | Finalizing |
| Finalizing | Awaiting Closing |
| Awaiting Closing | Closed |
| Closed | None |

Skipping/backwards transitions return `INVALID_PROJECT_STATUS_TRANSITION` with current/requested status. Unknown statuses return `INVALID_PROJECT_STATUS`. Closed projects are read-only. Signature enforcement is deliberately deferred; no signature or activation audit is fabricated.

Structured fields use `schemaVersion:1`. Blank JSON normalizes safely; malformed stored JSON is rejected rather than erased. Preparation initializes workstation/equipment/parts/sopGuidebook/productionReport sections. Daily reports append or update by stable `reportId`, preserve other reports and original submission audit, and require a date for new reports. Final totals (`totalProcessed`, `aGradeQty`, `bGradeQty`, `cGradeQty`, `dGradeQty`) synchronize numeric Lark fields; open issues and improvement notes synchronize text fields. Closing supports extensible versioned data. Workflow JSON is capped at 80 KB and request bodies at 128 KB.

Attachment fields return counts only. Upload/download workflows and signature canvas remain deferred; no attachment file tokens or Feishu credentials reach the frontend.

## Files changed for this foundation

- Frontend: `index.html`, `js/app.js`, `js/router.js`; new `js/projects-registry.js`, `js/projects/create-report.js`, `css/projects.css`.
- Shared layout: `css/layout.css` adds a desktop-only collapsed-label rule. Hidden labels previously consumed flex space and clipped sidebar icons; accessible label text remains present and mobile drawer layout is unchanged.
- Worker: `worker/src/index.js`, `worker/src/config/feishu-config.js`, `worker/src/services/feishu-record-service.js`; new `worker/src/modules/projects/project-schema.js`, `project-service.js`, `project-controller.js`, `project-coordinator.js`.
- Config: `worker/wrangler.toml`, `worker/.dev.vars.example`, ignored local `worker/.dev.vars`.
- Tests: new `tests/projects.test.cjs`, `worker/test/projects.test.js`; extended `worker/test/feishu-record-service.test.js`.
- Documentation: this report. Earlier Part-Used and schema work already in the working tree is preserved.

Config adds `FEISHU_PROJECT_TABLE_ID=tbldVnRmtOLM1Jzw`, the PROJECTS Durable Object binding and `projects-v1` SQLite migration. Example table IDs use placeholders, including correcting existing SOP/Part-Used example values. Existing Feishu auth/service code is reused. CORS permits the existing 5501 origin; no 5502 origin was added.

## Validation results

- 283 targeted tests passed, zero failures. Six new frontend tests and twelve project Worker tests cover routes, registry, escaping, forms, normalization, Toronto midnight, per-warehouse/day sequencing, concurrent creation, collision recovery, immutable identity, CRUD/audit, bounded filters, all status transitions, workflow history/totals and safe DTOs. Feishu search service coverage verifies bounded requests.
- Regressions passed for Dashboard, In House Tools, Client Tools, Assisting Tools routing, B044, TINECO, Part-Used Inventory Count, SOP Builder, Worker HTTP/config and tool registry.
- Syntax checks passed for new/modified Projects JavaScript and shared app/router/Worker/config/service files. `git diff --check` passed.
- Frontend exercised at `http://127.0.0.1:5501`: actual create form, success summary, exact-ID open, filtered search, collapsed sidebar, mobile drawer and existing navigation routes. Landing layouts checked at 1440, 768 and 390 pixels in light/dark themes; no horizontal overflow. Mobile form reviewed for readable controls and text.
- Worker health passed at `http://127.0.0.1:8787`. Real Lark tests passed for create/read/update, filtered list, preparation, daily append/update preserving both reports, final totals, closing and all five status transitions. Local CORS response header verified.
- The one authorized live record was `MKS66-20260930-PROJ-001`, named PROJECT API FOUNDATION TEST. Internal cleanup verified its ID, name and creator, deleted it through the Feishu record service and confirmed absence. The public API subsequently returned 404 `PROJECT_NOT_FOUND`. No test project remains. The local allocator reservation remains intentionally consumed.

## Release and next phase

Both frontend and Worker deployment will be required later. Worker release must include the PROJECTS Durable Object binding/migration and project table configuration. No release action was performed.

The foundation is ready for the next lifecycle UI phase. Portfolio/Gantt, preparation checklist UI, signatures, daily/final report forms, closing UI and attachment handling remain intentionally deferred.

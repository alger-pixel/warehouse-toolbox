# Project Activating V1

The existing project workspace renders a dedicated activation view when `PROJECT STATUS` is `Activating`. It keeps the shared header and lifecycle stepper, shows read-only project facts, authoritative preparation readiness, staffing history, authorization controls, and activation progress. The view uses the repository's official `assets/images/MKS LOGO.png` and `assets/images/MKS LOGO BLACK.png` assets for dark and light themes.

## Signature and authorization

The native canvas accepts pointer events from a mouse, finger, or stylus and disables browser panning only within the signing surface. It renders at 1200 × 360 pixels, displays responsively, and exports a white-background PNG. Legal name, confirmation, and signature validation errors appear together at their exact controls. The first invalid control receives focus after an explicit activation attempt.

The browser posts the PNG to `POST /api/projects/:projectId/activate`. It never communicates with Feishu directly. The Worker re-reads the project, requires `Activating`, revalidates all six preparation categories, validates authorization fields and PNG content, uploads with the existing private attachment service, and writes `ACTIVATION SIGNATURE`, `ACTIVATED BY`, Worker-generated `ACTIVATED AT`, and `PROJECT STATUS = In-Progress` in one record update. Responses expose only availability and the Worker proxy URL. A second activation cannot replace the audit record.

Unsigned projects may use `POST /api/projects/:projectId/back-to-preparing`. The Worker rejects this correction path once any activation audit field or signature exists.

## Progress and recovery

The deterministic stages are 0, 20, 40, 65, 80, 90, and 100 percent. The activation button is locked while a request is active. A failed request stops below 100, keeps the name, confirmation, and drawn canvas, and enables retry. Success renders the In-Progress placeholder automatically with the activation audit, proxied signature, and current staff.

# MKITE Warehouse Tools

A browser-based collection of warehouse operations utilities.

## Purpose

MKITE Warehouse Tools provides a focused home for general warehouse utilities and isolated client-specific operational workflows.

## Current Version

B044 Put Away Scan v1

## Architecture

- **Application shell:** Sidebar, header, theme controls, responsive layout, and shared view rendering.
- **Shared services:** Safe namespaced storage, toast notifications, optional Web Audio tones, and hash-based routing.
- **Tool registry:** `js/tools-registry.js` is the single metadata source for dashboard cards, the Tools catalog, search, and each tool's visual theme identity.
- **Tool modules:** Each active tool owns an isolated render/init/session/reset/cleanup lifecycle under `js/tools/`.
- **CSS layers:** Design tokens, base rules, layout, shared components, responsive rules, and narrowly scoped tool styles.
- **Local browser dependencies:** SheetJS Community Edition is vendored for Excel parsing/export and `qrcode-generator` is vendored for offline QR generation. No CDN request or build step is used at runtime.

Shared application components must remain independent from individual warehouse tool business logic. Future tools should use shared services instead of duplicating application-level functionality.

## Project Structure

```text
warehouse-toolbox/
├── index.html
├── assets/
│   ├── images/
│   │   ├── mkite-logo.png
│   │   └── mkite-logo.svg
│   └── icons/
├── css/
│   ├── variables.css
│   ├── base.css
│   ├── layout.css
│   ├── components.css
│   ├── responsive.css
│   ├── client-tools/
│   │   ├── client-tools.css
│   │   └── b044-put-away-scan.css
│   └── tools/
│       ├── matching.css
│       └── sorting.css
├── js/
│   ├── app.js
│   ├── router.js
│   ├── storage.js
│   ├── toast.js
│   ├── audio.js
│   ├── tools-registry.js
│   ├── clients-registry.js
│   ├── client-tools-registry.js
│   ├── client-tools/
│   │   └── b044/
│   │       └── put-away-scan.js
│   └── tools/
│       ├── matching.js
│       └── sorting.js
├── vendor/
│   ├── xlsx.full.min.js
│   ├── qrcode.min.js
│   ├── QRCODE-LICENSE.txt
│   └── SHEETJS-LICENSE.txt
└── README.md
```

## How to Add a Future Tool

1. Add the tool metadata once in `js/tools-registry.js`.
2. Create an isolated JavaScript module under `js/tools/` using the established lifecycle.
3. Add tool-specific CSS under `css/tools/` only when shared components are insufficient.
4. Load the files from `index.html` and connect the module name in its registry entry.
5. Test dashboard cards, the Tools library, search, hash navigation, storage namespace, and responsive behavior.
6. Deploy normally to GitHub Pages.

## Client Tools Architecture

General Tools are reusable warehouse utilities for any operation. Client Tools are a separate area for workflows configured for a specific client. Registry definitions live in the codebase so every warehouse location using the deployment receives the same clients and tools.

- `js/clients-registry.js` defines clients, descriptions, status, themes, and their tool IDs.
- `js/client-tools-registry.js` defines client-specific tool metadata independently from the general tool registry.
- Client business logic belongs only in modules such as `js/client-tools/b044/put-away-scan.js`.
- Shared application files must not accumulate client-specific conditional logic.
- Client routes use GitHub Pages-safe hashes: `#client-tools`, `#client/<client-id>`, and `#client/<client-id>/tool/<tool-id>`.
- The optional last-client shortcut uses `mkite.toolbox.client-tools.last-client`; registry data is never stored in localStorage.
- Future client-tool sessions should use namespaces such as `mkite.toolbox.client.<client-id>.<tool-id>.session`.

## B044 — Put Away Scan

Put Away Scan reads only the first worksheet of an uploaded `.xlsx` or `.xls` workbook. It locates columns by the exact trimmed headers `到仓日期`, `跟踪号`, `入库SKU`, and `仓库入库单号`; missing headers stop processing. Arrival dates are normalized to `YYYY-MM-DD`, and identifiers are handled as display text.

Warehouse orders must contain a dash and begin with a configured `RMA` or `RV` prefix. The remaining part of the first segment is the client ID, and the printable SKU is `<clientId>-<入库SKU>`. Incomplete rows, unsupported orders, and every occurrence of a duplicated normalized tracking number are excluded from printing and shown in the invalid-row review.

Each valid row generates one portrait 4 × 6 inch, black-and-white thermal label with QR codes encoding the final SKU and warehouse inbound order exactly. Label previews are scaled only on screen; printing uses one physical label per page. QR generation is fully local through the MIT-licensed `qrcode-generator` browser bundle in `vendor/`.

Scan & Print Mode checks in this order: exact tracking match, complete tracking number contained in the scan, then no match. It is intended for Chrome launched with `--kiosk --kiosk-printing`: an unprinted exact match immediately renders only that package label, issues the print request, and returns the focused station to Ready. One contained candidate requires confirmation; multiple candidates require an explicit operator selection. Printed packages require reprint confirmation and maintain `printStatus`, `printCount`, and the last print timestamp. Outside kiosk-printing mode, the same request may still open the native browser dialog.

Print All Labels is intentionally separate from Scan & Print Mode. It renders every valid label as an individual 4 × 6 page and requests the normal browser print workflow so the operator can review the printer, paper size, and copies. Chrome's `--kiosk-printing` flag may automatically confirm every `window.print()` call at browser level; webpage code cannot reliably override that behavior for one request. For manual batch review, open the site in normal Chrome. A different direct-print integration can be considered later if Windows station testing requires per-request control.

The active session is stored under `mkite.toolbox.client.b044.put-away-scan.session`. Browser print completion cannot be detected reliably: records are marked printed when the print dialog is initiated, even if the operator subsequently cancels the dialog. Silent printing is not claimed or implemented.

### How to Add a New Client

1. Add client metadata to `js/clients-registry.js`.
2. Add its tool metadata to `js/client-tools-registry.js`.
3. Add independent client-tool modules only as needed.
4. Add optional client-specific assets or narrowly scoped styling.
5. Test Client Tools selection, search, routing, and invalid states.
6. Deploy normally to GitHub Pages.

### How to Add a Tool to an Existing Client

1. Add tool metadata to `js/client-tools-registry.js` with the correct `clientId`.
2. Add the tool ID to the client's `toolIds` list.
3. Create an independent module under `js/client-tools/<client-id>/`.
4. Add tool-specific CSS only when shared client-tool styles are insufficient.
5. Test the client pool, category grouping, route, and shared navigation.
6. Deploy normally to GitHub Pages.

## Local Development

Open `index.html` directly in a modern browser or use VS Code Live Server. No installation, package manager, or build command is required.

## GitHub Pages Compatibility

All resources use relative paths. Navigation uses URL hashes such as `#dashboard`, `#tools`, `#tool/matching`, `#client-tools`, and `#client/b044/tool/put-away-scan`, so repository-subdirectory hosting and browser refreshes do not require server routing. The project has no backend, environment variables, CDN dependencies, or build step.

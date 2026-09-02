# MKITE Warehouse Tools

A browser-based collection of warehouse operations utilities.

## Purpose

MKITE Warehouse Tools provides a focused home for matching, sorting, counting, data-cleaning, calculation, and other daily warehouse utilities. UI Foundation v0.2 establishes the shared application shell and modular architecture; warehouse business logic will be added in later milestones.

## Current Version

UI Color System v0.7

## Architecture

- **Application shell:** Sidebar, header, theme controls, responsive layout, and shared view rendering.
- **Shared services:** Safe namespaced storage, toast notifications, optional Web Audio tones, and hash-based routing.
- **Tool registry:** `js/tools-registry.js` is the single metadata source for dashboard cards, the Tools catalog, search, and each tool's visual theme identity.
- **Tool modules:** Each active tool owns an isolated render/init/session/reset/cleanup lifecycle under `js/tools/`.
- **CSS layers:** Design tokens, base rules, layout, shared components, responsive rules, and narrowly scoped tool styles.
- **Local reporting dependency:** SheetJS Community Edition 0.20.3 is vendored under `vendor/` for offline `.xlsx` generation; no CDN request or build step is used at runtime.

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
│   └── tools/
│       ├── matching.js
│       └── sorting.js
├── vendor/
│   ├── xlsx.full.min.js
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

## Local Development

Open `index.html` directly in a modern browser or use VS Code Live Server. No installation, package manager, or build command is required.

## GitHub Pages Compatibility

All resources use relative paths. Navigation uses URL hashes such as `#dashboard`, `#tools`, and `#tool/matching`, so repository-subdirectory hosting and browser refreshes do not require server routing. The project has no backend, environment variables, CDN dependencies, or build step.

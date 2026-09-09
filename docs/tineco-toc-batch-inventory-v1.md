# TINECO TOC Batch Inventory v1

Read-only Client Tool for MKS66 / TINECO-TOC.

- Tool ID: `CT-MKS66-TINECO-TOC-0002`
- Tool name: TINECO TOC Batch Inventory
- Route: `#client/MKS66/TINECO-TOC/tool/tineco-toc-batch-inventory`
- Registry status: Active; cardTheme: indigo. The production tool remains teal.
- Source: TINECO TO C UNIT CLASS, `tblztQK3EhDAw2Wm`, using the existing `FEISHU_TINECO_TOC_UNIT_TABLE_ID` binding.

## Filters and matching

Tracking Number, SN, Repair Date From/To, Repair Level, Repair Result and Client Status use AND semantics. Level, result and status comparisons are exact. Dropdown choices include schema options and observed values, tolerating future options; frontend fallback choices cover known values.

Identifiers are converted to strings, trimmed and compared case-insensitively. Internal spaces and punctuation are preserved. Comparisons are literal, never regex. Each identifier first checks for exact matches within the rows passing the date/dropdown filters. If none exist, either-direction containment is used; multiple partial matches are valid. When both identifier filters are set, their independently selected match sets are intersected, ensuring filter order does not change exact priority. Legacy duplicate exact identities can all be returned.

Repair-date boundaries are inclusive, using the configured warehouse time zone (America/Toronto by default). Either date boundary can be used alone. Invalid/reversed dates are rejected. Missing dates are excluded when a date boundary is supplied.

## Browsing and summaries

Opening the tool automatically loads page 1 with empty filters. Pages contain 50 rows. Previous/Next show Page X of Y and the actual record range. New searches and Clear Filters reset to page 1. Results sort by repair date descending, then record ID for stable ordering.

FOUND, PENDING, COMPLETED, DISPOSAL and TOTAL LABOR MINUTES cover the entire filtered set, not the current page. Unknown statuses still count in FOUND and labor totals.

The table shows Unit ID, SN, Tracking Number, Repair Date, Repair Level, Repair Result, Client Status, Labor Minutes, Times of Re-enter and Total Parts Used. Click a row or focus it and press Enter to view read-only detail. Notes and parts are safely escaped and preserve line breaks. CURRENT STEP shows `1 — Pre-QC`, `2 — Repair`, or `3 — Final QC`; unknown values are displayed without changing them.

## Endpoint and read-only guarantee

`POST /api/tineco-toc/inventory/search` is separate from production mutation routes. Request filters use `trackingNumber`, `sn`, `repairFrom`, `repairTo`, `repairLevel`, `repairResult`, `clientStatus`; `page` defaults to 1. The page size is fixed at 50.

The Worker uses the existing Feishu record service to traverse source pages and read schema options. It filters and computes summaries on the Worker, returning only the requested page for ordinary browsing. Like traditional inventory, each request reads the full source set on the Worker; very large tables may require a future indexed or cached search design. No source records are downloaded wholesale for browser pagination.

The search module only calls listRecords/listFields. It never calls record create/update or the production coordinator. There are no edit controls, and no source schema changes.

## Export all filtered results

EXPORT FILTERED RESULTS posts the last successfully searched filters with `export: true` to the same read-only endpoint. The Worker rereads and filters all source pages, then returns all matches. It is a fresh live read and can reflect changes since browsing. The browser generates XLSX with the local SheetJS vendor; it does not export only its visible page. Incomplete responses are rejected.

The maximum is **5,000 filtered records**, configured by `EXPORT_LIMIT` in the service. Larger exports fail explicitly and ask the operator to narrow filters; no partial workbook is produced. This limit is also shown beside the export button.

Filename: `TINECO_TOC_BATCH_INVENTORY_YYYY-MM-DD.xlsx` (Toronto date).

Columns: UNIT ID, SN, TRACKING NUMBER, CLIENT ID, WAREHOUSE, REPAIR DATE, TIMES OF RE-ENTER, CURRENT STEP, ISSUE FOUND, PRE-QC NOTE, PART USED DETAIL, TOTAL PARTS USED, LABOR MINUTES, REPAIR LEVEL, REPAIR RESULT, FINAL QC RESULT, FINAL QC NOTE, CLIENT STATUS. Export preserves the numeric step value as stored text; display labels are only used in detail. Strings are exported as text, not formulas.

## TOOL CLASS sync

The existing trusted registry sync includes this entry automatically. It finds/upserts by Tool ID, so repeated syncs do not duplicate the tool. It writes the name, warehouse, client, type, route and Active status when the STATUS field is available. No form DATA FIELDS configuration is required. Search itself never triggers sync. Live TOOL CLASS synchronization has not been run as part of this local implementation.

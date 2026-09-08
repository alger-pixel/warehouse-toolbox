# Batch Inventory v1

Open `#in-house-tool/batch-inventory` from the shared In-House Tools library.
The teal inventory workspace supports manual filters and an exact-only pasted batch
of up to 500 nonblank lines. Entry and Clear Filters automatically load inventory page 1 with 50 records.
Empty manual filters mean browse inventory; empty batch input remains invalid. Status accepts common suggestions or any future exact value.

`POST /api/inventory/search` is read-only. JSON keeps opaque identifiers out of
URL paths. Manual request keys are `sku`, `clientId`, `location`, `status`,
`receivedFrom`, `receivedTo`, and `note`. Populated filters combine with AND.
SKU is exact-first within the other filters, falling back to stored-SKU-contains-query.
Client and identifiers use existing trim/case-insensitive comparison. Punctuation
and internal characters are preserved. Location and NOTE use contained matching;
status uses exact matching. Received dates are inclusive warehouse-local dates.

Batch requests use `{ "mode": "batch", "skus": "first\nsecond" }`. Blank lines
are ignored, normalized duplicate inputs counted, and missing unique inputs returned
explicitly. Batch queries never use fuzzy matching. FOUND in the batch summary
counts unique found inputs; the package summary counts matching database records.

The Worker reuses Feishu auth, centralized PACKAGE CLASS fields, and all-page
record listing without field projections or remote filter expressions. Filtering
runs entirely on the Worker. Requests accept `page` (default 1) and `pageSize` (default 50, maximum 500 per
request). Responses include page, pageSize, totalPages, totalMatched, returnedCount,
hasPrevious, and hasNext. Previous/Next browse the full matched set with no total
500-record cap. New searches reset to page 1. Summary counts cover all matches;
only the requested page reaches the browser. Searches reread current inventory,
so concurrent inventory changes can shift page boundaries.
This deliberately trades server-side full-table reads for compatibility with current
Feishu projection quirks; it is not an indexed search and cost grows with inventory.

Selecting a row opens a keyboard-accessible native dialog. NOTE entries are shown
latest-line first, preserving unknown lines and offering the original text as fallback.
All record text is HTML escaped. Export uses bundled SheetJS and includes only the
visible page plus all batch missing inputs. The button is labeled EXPORT CURRENT
PAGE and adjacent copy states the scope; export does not fetch additional pages.

The module makes no create/update/delete calls. No inventory results are persisted
locally. Final SKU, Excel upload, PL joins, edits, and lifecycle actions are excluded.

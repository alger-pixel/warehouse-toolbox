# Warehouse-Aware Client Tools Foundation v1

Operational identity is `(warehouse, clientId, toolId)`. CLIENT ID alone is not
unique across warehouses. The current assignment is MKS66 / B044 /
CT-MKS66-B044-0001, named Put Away Scan, route `put-away-scan`, type Client Tool.
Tool IDs are explicitly assigned, globally unique and immutable; renaming a tool
or changing its slug must not change or reuse its Tool ID. Duplicate registry IDs
are configuration errors. Frozen registry entries prevent accidental mutation.

`js/client-tools-registry.js` is the shared metadata source for browser directory
and backend sync. The directory derives active warehouse/client options from it,
shows all active tools by default, and combines warehouse, client and name/ID
search filters with AND. Cards show immutable ID and warehouse/client assignment.
The registry does not load or deduplicate CLIENT CLASS by client ID.

New links use `#client/MKS66/B044/tool/put-away-scan`. Legacy
`#client/B044/tool/put-away-scan` (including existing lowercase b044 bookmarks)
resolves to MKS66. Other clients do not receive an inferred default warehouse.
The module receives `warehouse`, `clientId`, immutable `toolId`, `route`, and a
frozen `clientToolContext`. Future access checks should consume that full context;
this milestone does not implement authorization. The workspace header shows
warehouse and Tool ID without changing B044 scan mode.

TOOL CLASS is an external metadata mirror, not the runtime permission authority.
Configure `FEISHU_TOOL_TABLE_ID` before syncing; the real table ID is still required.
The empty optional binding does not block normal app operation or other tools.

The backend-only `createToolRegistryService(config, records)` exposes `find(toolId)`
and explicit `sync()`. Construct it with the existing Feishu config/auth/record
services in a trusted administrative runner. There is deliberately no public HTTP
sync endpoint or frontend button. Nothing syncs on browsing, import or deployment.
A future admin runner must enforce authorization and one exclusive sync across all
processes; the service rejects concurrent calls on the same instance, but does not
provide a distributed lock. Do not expose it as an unauthenticated endpoint.

Sync reads TOOL CLASS schema and existing IDs, creates missing registered IDs,
and patches only changed TOOL NAME, WAREHOUSE, CLIENT ID, TOOL TYPE and ROUTE.
STATUS is included as Active/Inactive only if present. Unknown fields and unrelated
records are never updated. Existing TOOL ID values are never changed; duplicate
upstream IDs block sync. Retries recheck ID before creating. Feishu credentials
remain in the backend and existing normalized record-service errors are retained.

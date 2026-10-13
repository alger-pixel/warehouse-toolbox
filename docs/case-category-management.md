# Case Category Management V1

Route: `Settings > Case Management > Case Category` (`#settings/case-categories`)

The workspace maintains records in CASE CATEGORY table `tblwFyckkj7CxLnt`. `CLIENT ID` is a required Text field for new or edited categories; its live field ID is `fldiFFOaOu`. Legacy records with a blank Client ID remain readable and are never backfilled automatically.

The list shows Client ID and provides search, status, client, Main Category, and warehouse filters. Client choices come from distinct non-empty values in the loaded records. Search is trimmed and case-insensitive across Category ID, Client ID, Category Name, Main Category, and Warehouse ID. Default ordering remains Warehouse ID, Sort Order, then Category Name. The API also accepts `warehouseId`, `clientId`, `status`, `mainCategory`, and partial `search` query parameters; Client ID and Warehouse ID match exactly after normalization. V1 has no hard-delete API.

Case Category records are templates. Editing a template never updates an existing CASE CLASS record. Future Case creation must copy `MANDATORY QUESTIONS` into `QUESTION SNAPSHOT`, `ISSUE OPTIONS` into `ISSUE OPTIONS SNAPSHOT`, and `DEFAULT INSTRUCTION` into `CASE INSTRUCTION`. Those Case snapshots remain unchanged after later category edits.

Creation uses a serialized Worker coordinator and stable request identity. IDs follow `CC-<WAREHOUSE>-<NNN>`. The Worker controls `CREATED AT` and `UPDATED AT`; the manager supplies the temporary `CREATED BY` or `UPDATED BY` display text until authenticated identity is available.

Manager attachments and Case reporting are outside this workspace. No Case, report, issue, assignment, analytics, archive, or dashboard workflow is implemented in this phase.

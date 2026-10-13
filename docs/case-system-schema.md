# Case System V1 — Lark Schema

Base ID: `FGLSbhJ8taJ9KNsIp22cq9xDnuh`

Schema-only foundation. No Case Category, Case, report, issue, assignment, or USER CLASS records are created or modified.

## CASE CATEGORY

Table ID: `tblwFyckkj7CxLnt`

Manager-maintained warehouse Case templates.

Primary identity: the original default primary Text field was reused as `CASE CATEGORY ID` and retains field ID `fldNvszuuR`.

| Field | Type | Field ID | Single Select options | Purpose |
|---|---|---|---|---|
| CASE CATEGORY ID | Text / Long Text | `fldNvszuuR` | — | — |
| CLIENT ID | Text / Long Text | `fldiFFOaOu` | — | Identifies the client that owns this Case Category. |
| MAIN CATEGORY | Single Select | `fldhzdG9ZI` | Receiving (`opt5cXbHNR`)<br>In-House Daily (`optGhAY0Pp`)<br>Replenishing (`optK3p8fuY`)<br>Inventory (`optwihBn0u`)<br>Shipping (`optuiEafbX`)<br>Other (`opt2uE5t6K`) | — |
| CASE CATEGORY NAME | Text / Long Text | `fldJUlkXGY` | — | — |
| WAREHOUSE ID | Text / Long Text | `fld0YIW0GB` | — | — |
| STATUS | Single Select | `fldvW7Mvvy` | Active (`optPb3RF1m`)<br>Inactive (`optDSgFY4B`) | — |
| DEFAULT PRIORITY | Single Select | `fldta24S5d` | Normal (`optz3tPAr3`)<br>Urgent (`optkRpz4k3`) | — |
| DEFAULT INSTRUCTION | Text / Long Text | `fldTcGJJmy` | — | — |
| MANDATORY QUESTIONS | Text / Long Text | `fldV4603KC` | — | Versioned structured JSON. |
| ISSUE OPTIONS | Text / Long Text | `fldDw7gjCy` | — | Versioned structured JSON. |
| REQUIRE COMPLETION PHOTO | Single Select | `fldoXK22RJ` | Yes (`optvSVCS2M`)<br>No (`optclMSvEw`) | — |
| SORT ORDER | Number | `fld6DTr9Eq` | — | — |
| CREATED AT | Date & Time | `fldJsnbjLZ` | — | — |
| CREATED BY | Text / Long Text | `fldGdliXXj` | — | — |
| UPDATED AT | Date & Time | `fldLhToZLW` | — | — |
| UPDATED BY | Text / Long Text | `fldmIHtr4y` | — | — |
| NOTE | Text / Long Text | `fldRzaGEv5` | — | — |

Verified: **Yes**. Created on this run: **0**. Reused primary fields: **0**.

## CASE CLASS

Table ID: `tbluJiLs4arOJgt6`

One row per operational Case, including assignments, snapshots, reports, evidence, issue state, completion, and audit data.

Primary identity: the original default primary Text field was reused as `CASE ID` and retains field ID `fldKGfW760`.

| Field | Type | Field ID | Single Select options | Purpose |
|---|---|---|---|---|
| CASE ID | Text / Long Text | `fldKGfW760` | — | — |
| CASE TITLE | Text / Long Text | `fld3GGXJmU` | — | Optional manager-supplied Case title. |
| STATUS | Single Select | `fldVl9VYxs` | Assigned (`optBwMd2ox`)<br>In Progress (`opt9XkKq2b`)<br>Pending With Issue (`optG9WgFiA`)<br>Completed (`optGnofgL7`) | — |
| PRIORITY | Single Select | `fldbUS9FHa` | Normal (`optMqfm5o2`)<br>Urgent (`optUoU1c5X`) | — |
| WAREHOUSE ID | Text / Long Text | `fldP0pJSQ7` | — | — |
| CLIENT ID | Text / Long Text | `fldcjkSOgN` | — | — |
| CASE CATEGORY ID | Text / Long Text | `fldDAJhSiD` | — | — |
| MAIN CATEGORY | Text / Long Text | `fld0Im2tKo` | — | — |
| CASE CATEGORY NAME | Text / Long Text | `fldcgWQHl4` | — | — |
| ASSIGNED USERS | Text / Long Text | `fldJN5ZNEN` | — | Versioned structured JSON. |
| CASE INSTRUCTION | Text / Long Text | `fldD1n6Fv6` | — | — |
| QUESTION SNAPSHOT | Text / Long Text | `fldCCQVHNI` | — | Versioned structured JSON. |
| ISSUE OPTIONS SNAPSHOT | Text / Long Text | `fldXty87z4` | — | Versioned structured JSON. |
| CASE ATTACHMENTS | Attachment | `fld5wC5JEt` | — | — |
| DUE AT | Date & Time | `fldCfcJAeu` | — | — |
| REPORT DATA | Text / Long Text | `fldb92jseB` | — | Versioned structured JSON. |
| REPORT ASSETS | Attachment | `fldB4QGpcJ` | — | — |
| CURRENT ISSUE CATEGORY | Text / Long Text | `fldnzRQo4F` | — | — |
| CURRENT ISSUE DATA | Text / Long Text | `fldggesgJ0` | — | Versioned structured JSON. |
| LAST REPORTED BY | Text / Long Text | `fldvr6rCkj` | — | — |
| LAST REPORTED AT | Date & Time | `fldjZJNv5E` | — | — |
| COMPLETED BY | Text / Long Text | `fld2V8tYW5` | — | — |
| COMPLETED AT | Date & Time | `fldHl5vcJR` | — | — |
| CREATED BY | Text / Long Text | `fldlktuVJn` | — | — |
| CREATED AT | Date & Time | `fldrKuR7cl` | — | — |
| UPDATED BY | Text / Long Text | `fldgLNjb3J` | — | — |
| UPDATED AT | Date & Time | `fldlZCny5a` | — | — |
| NOTE | Text / Long Text | `fldgcHbKnQ` | — | — |

Verified: **Yes**. Created on this run: **1**. Reused primary fields: **0**.

## Validation

Run mode: `apply`

A second idempotency run must report zero created fields, zero missing fields, and zero type or option mismatches.

# B044 AI Command Simplifier v1

## Excel and source data

The optional 操作指令 column supplies commandRaw. Nonblank text is retained exactly from the cell value, including leading/trailing whitespace, punctuation and line breaks. Whitespace-only cells become empty commands. Files without this column behave as before.

登记时间 is an alias for 到仓日期. If both columns exist, a populated 登记时间 cell wins; otherwise 到仓日期 is used. Both map to arrivalDate. The existing date normalization is unchanged.

A row is commanded when commandRaw.trim() is nonempty. commandRaw is the source of truth and is never overwritten by AI. commandDisplay holds organized text or the exact raw fallback. commandAiStatus is PENDING, SIMPLIFIED, FALLBACK or NOT_REQUIRED; commandAiSource is AI, RAW_FALLBACK or NONE. commandReference is optional rendering context.

## Architecture and API

GitHub Pages → Cloudflare Worker `POST /api/ai/simplify-command` → OpenAI Responses API → B044 local session → PL/labels.

The request contains only `{ "command": "raw instruction" }`. No Excel workbook, package record, tracking identity, customer details or Feishu configuration is attached. Operators should avoid unrelated personal data in instruction cells because the instruction itself is sent.

The Worker uses fetch to `https://api.openai.com/v1/responses`, `store:false` and `text.format` with a strict JSON schema. Schema fields: title (string), steps (array of strings), reference (string or null), displayText (string); additional properties are disallowed by the schema. Model selection is entirely configured by OPENAI_COMMAND_MODEL.

Implementation reference: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

The formatter prompt preserves Chinese, actions, quantities, identifiers, categories, prerequisites, conditions and escalation requirements. Raw text is treated as data, not instructions to the formatter. Uncertain wording must remain unchanged. Runtime checks reject malformed, refused, incomplete and blank outputs, and outputs losing literal alphanumeric quantity/code tokens from visible text/reference. These checks do not prove semantic equivalence; the original text remains preserved for review and recovery.

## Fallback and bounds

Missing key/model, API errors, rate limits, refusal, network errors, invalid output and timeouts all produce commandDisplay = commandRaw, FALLBACK, RAW_FALLBACK. Empty commands skip OpenAI and use NOT_REQUIRED / NONE. AI failure never blocks matching or PL creation.

- Worker timeout: 8 seconds including response parsing; request is aborted on timeout.
- Browser watchdog: 10 seconds per request, then raw fallback.
- Maximum AI input: 6,000 characters; longer commands remain raw. Existing endpoint JSON body limit also applies; frontend falls back on request rejection.
- One command per endpoint request; no bulk fan-out on the Worker.
- Frontend concurrency: at most 2 requests.
- Automatic preparation: at most 10 unique commands per uploaded session. Other commands use raw fallback.
- Explicit RETRY COMMAND SIMPLIFICATION handles at most 10 unsuccessful commands per click. Successful entries are reused.

The existing 500-source-row B044 limit remains. These are basic per-session/request safeguards, not distributed rate limits or an account-wide spend cap.

## Cache and preparation UI

Cache keys are the trimmed raw command, preserving case, internal content and punctuation. Identical keys reuse one result; each row still keeps its own exact raw text. Cache entries are stored as key/value pairs in the current B044 local session. Rendering, preview and printing never call OpenAI. Remounts reuse cached results. A new upload clears the cache.

Step 1 shows commanded package count plus simplified, raw fallback and pending counts. Preparation is bounded; the existing Working state is shown while processing. Optional retries are available before a PL creation identity exists, so a persisted PL snapshot is not changed by later AI results.

## Picking List and persistence

Only eligible operational packages appear on the A4 list. Commanded packages have a darker gray row and explicit COMMANDED text, with a full-width wrapped command area and reference when available. Long instructions use a compact row excerpt with an explicit continuation pointer and a full command appendix; no instruction is silently omitted.

Worker row normalization retains commanded, commandRaw, commandDisplay, AI status/source and reference. Missing/failed AI data normalizes to raw fallback. The existing Durable Object job stores this snapshot. PICKING LIST DETAIL adds an escaped JSON COMMAND SNAPSHOT line for commanded rows containing commanded, commandRaw, commandDisplay and commandReference. No PICKING LIST CLASS schema changes are made. There is no new standalone parser that reconstructs an entire job from Lark detail alone; existing session/coordinator recovery remains in use.

AI output is never written to PACKAGE CLASS. Existing package STATUS/NOTE lifecycle writes are unchanged. Normal legacy rows retain their original snapshot structure.

## Labels and confirmation

Normal packages print the original single 4x6 label. Commanded packages print that same original label first, followed by a dedicated white/black COMMAND label. Preview shows the total label-page count and the package/command distinction. Large commands use COMMAND 1/N, 2/N continuation pages. The body uses conservative code-point wrapping and 30pt, 24pt or a minimum 20pt type size; it is not shrunk to tiny text. Reference text is included in the paginated body; stored tracking appears on each command page. Overflow is visible rather than clipped. Verify printer scaling at actual 4x6 size before operational rollout.

One print operation still concerns one package. Print requests/cancelled dialogs do not complete packages. The existing single strict second tracking scan remains required, regardless of label-page count. No third scan or Final SKU confirmation is introduced. Physical exact/contained matching and Excel exact-first/two-way Active-only matching are unchanged.

All command HTML is escaped. No AI output is interpreted as HTML or executable content.

## Configuration and security

For local development, copy the existing example to the ignored `worker/.dev.vars` and configure:

```text
OPENAI_API_KEY=<local secret>
OPENAI_COMMAND_MODEL=<model supporting Responses Structured Outputs>
```

The example contains empty placeholders only. No real key is supplied or required to run mocked tests; unconfigured operation uses raw instructions.

For production, provision the secret from the worker directory using `npx wrangler secret put OPENAI_API_KEY` through the normal authorized release process. OPENAI_COMMAND_MODEL can be a Worker environment variable or secret. No key may appear in wrangler.toml, frontend assets, logs, API responses or Git. No production secret was provisioned and nothing was deployed in this implementation.

The AI module does not log prompts, raw commands, upstream response bodies, credentials or headers. Existing request metadata logging remains separate. There is no new Lark table or TOOL CLASS identity.

## Live-readiness verification and UI polish (2026-09-09)

Two explicit sample POSTs were made to the deployed Worker using the representative Chinese command. Both returned HTTP 200 with FALLBACK / RAW_FALLBACK and an exact copy of the raw instruction (2.59s and 2.54s). The second request included Origin `https://alger-pixel.github.io`; the response allowed that exact origin. No live PL, package record, completion, or cancellation was created or changed.

This verifies endpoint reachability, browser-origin response handling and preservation through raw fallback. It does **not** verify live AI simplification success. The deployed service intentionally suppresses upstream failure details, so the reason is undetermined from these responses. The configured model was not changed. [Official GPT-5.6 Luna documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna) was consulted; documentation alone does not establish the deployment's account access or upstream request outcome. A successful SIMPLIFIED response remains an outstanding rollout check. No additional production deployment or secret modification was performed.

Step 1 now separates command-package, simplified, raw-fallback, pending and failed/retryable counts. Completed raw fallback is explicitly identified as retaining original instructions. The review note says “AI-organized instructions should be reviewed before printing.” Retry is offered only for FAILED/FALLBACK rows before creation; successful and pending commands are not selected by the retry action. Retry availability does not prevent generating a PL. Active requests remain bounded and use the existing preparation lock.

Every preview page now has a Package Label or Command Label caption; continuation command pages are numbered in order. Captions are preview-only and do not change the original normal label or thermal print content.

Source review and mocked unauthorized-request logging tests confirmed no command/credential/output logging on the AI path. Live Cloudflare log history was not retrieved. The full local suite passed 329 tests, including old/new Excel headers, exact raw preservation, success/failure fixtures, AI timeout/unauthorized fallback, A4 command/appendix rendering, continuation labels, existing matching and single strict confirmation. Syntax and whitespace checks passed.

Physical printer validation remains required: actual 4x6 size at 100% scale, Chinese glyph coverage, 20–30pt instruction readability, reference/tracking wrapping, continuation-page boundaries/order, and A4 grayscale shading/appendix pagination. Browser print cancellation and one strict confirmation should be exercised at the warehouse without assuming a requested print guarantees paper output.

## Safe live-fallback diagnostics

The active deployment was inspected read-only with Wrangler. Version `66ef0c80-3194-49a8-a02b-d0f46b0cf416` (100% traffic at inspection) includes OPENAI_API_KEY as secret_text and OPENAI_COMMAND_MODEL as plain_text `gpt-5.6-luna`. The secret value was neither retrieved nor printed. The service reads these exact env names directly; it does not rely on the Feishu config loader. Local process env and worker/.dev.vars did not contain an OpenAI key/model for a same-account local replay.

A fresh sample call returned Worker HTTP 200, FALLBACK / RAW_FALLBACK, exact raw preservation, no diagnostics, in 2.51 seconds. This call finished before the 8-second timer; there is no evidence supporting an increased timeout. The OpenAI upstream HTTP status/code is not available in the deployed response. Binding presence does not establish key validity, billing, permissions, model access or output acceptance. Exact live root cause therefore remains unverified.

The known error-handling defect has been corrected locally: HTTP failures previously threw a generic error without reading the error payload; every exception was collapsed to indistinguishable raw fallback. The service now records bounded, safe diagnostic fields while retaining the original fallback contract. It distinguishes config errors, HTTP errors, model access, authentication, rate/quota, network failure, timeout, malformed transport JSON, incomplete responses, refusal, missing output blocks, malformed structured JSON, structure validation and missing literal code tokens.

The request remains Responses `/v1/responses`, bearer Authorization, application/json, configurable model, string input, instructions, store:false and text.format `{type:"json_schema",name,strict:true,schema}`. The schema uses required title/steps/reference/displayText, additionalProperties:false and a nullable string reference. This matches [official Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs); [the documented Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna) supports Structured Outputs. Those facts do not verify access for this specific OpenAI account. No model change was made.

The parser reads response.output message items, then content blocks of type output_text. It ignores reasoning items and detects refusal blocks explicitly. Successful output is copied field by field rather than spreading arbitrary upstream properties into the endpoint response. Existing output-shape handling was consistent with Responses, but its failure reporting was not useful for diagnosis. No evidence has established parsing as the production cause.

### Safe metadata

Logs contain only sanitized requestId, fixed route, sanitized configured model, upstream HTTP status, known error code/type, response/validation stage, validation result, elapsed milliseconds, timeout boolean, failure category and fallback reason. Unknown upstream codes/types become OTHER; error messages, params, bodies, output text, raw command and headers are never logged. Arbitrary caller X-Request-ID text is redacted. Logging failure itself cannot block raw fallback.

Response diagnostic metadata is opt-in, only when the **server** environment sets `OPENAI_COMMAND_DIAGNOSTICS=true`. Clients cannot enable it with a request field. On fallback, `data.diagnostics` contains the same safe metadata. With the flag absent or false, the original endpoint contract is retained. Successful responses retain their contract regardless of the flag. The original commandDisplay raw fallback remains intentionally returned as operational data, outside diagnostics.

Example diagnostic shape:

```json
{"fallbackReason":"OPENAI_HTTP_ERROR","failureCategory":"MODEL_ACCESS","openaiStatus":404,"openaiCode":"model_not_found","openaiType":"invalid_request_error","validationStage":"RESPONSE_JSON","validationResult":"NOT_RUN","timeout":false}
```

This example is a tested fixture, **not an observed production error**. Codes such as invalid_api_key and insufficient_quota similarly distinguish the corresponding problems without exposing upstream messages.

### Next diagnostic execution

No deployment was performed. Production will continue returning indistinguishable fallback until the diagnostic build is released through an authorized deployment. Enable the server diagnostic flag temporarily for that investigation, send the sample, inspect only data.diagnostics, then set the flag false after resolution. This diagnostic change itself is not a proven fix for the unknown upstream failure.

Alternatively, run the same service locally using the same OpenAI project credentials placed in ignored worker/.dev.vars. Do not paste keys into chat or command-line arguments:

```sh
cd worker
node --env-file=.dev.vars scripts/diagnose-command.mjs
```

Set both OPENAI_API_KEY and OPENAI_COMMAND_MODEL in that ignored file first. The script sends only the representative fixture and prints only diagnostics/status, never the raw command or full AI result. It returns exit 0 for AI success, 1 for fallback. Local credentials must actually represent the deployed OpenAI project for account-related findings to transfer to production. Cloudflare secret values cannot be recovered using secret list.

No UI, matching, completion, labels, Lark schema, model value or timeout was changed in this diagnostic pass. Existing B044/TINECO/inventory tests and new safe diagnostics tests pass (348 total). A Worker redeploy is required to obtain these diagnostics from the live endpoint, but remains unperformed per instruction.


## Fixed 4x6 command-label layout

Command labels now use the same exact `4in × 6in` page geometry as the original B044 label, including every continuation and preview. This matches the existing print architecture rather than mixing literal 100×150mm dimensions with 4×6 inches (101.6×152.4mm). Original package-label markup and physical CSS remain unchanged.

Order: COMMAND → tracking identity → warehouse order → left-aligned instructions → separate REF when present. Both identity fields repeat on all continuation pages, sourced from trackingNumber and warehouseInboundOrder. Ordinary identity values use bold 14pt type; exceptionally lengthy identities use 12pt/10pt wrapping to retain both without displacing instructions. Critical instructions and references remain at least 20pt.

Pagination measures bold Arial text with canvas when available and reserves space for the heading and both identity fields. The fallback estimate is conservative. Mixed-language wrapping retains normal Latin words and hyphenated model/reference codes as whole tokens when they fit; font tiers reduce to 20pt before splitting an oversized token. Long content continues rather than being clipped. REF is a separate section, with its heading repeated if it spans pages. Preview figures have the normal package label’s width and centered alignment; narrow screens can scroll the preview area without distorting page proportions.

Headless Chrome measured eight fixture command pages at 384×576 CSS pixels (4×6 inches at 96 CSS pixels/inch), without horizontal or vertical overflow, including a long Chinese command and oversized identities. Physical thermal-printer scaling, Chinese font coverage and feed boundaries still require warehouse validation.

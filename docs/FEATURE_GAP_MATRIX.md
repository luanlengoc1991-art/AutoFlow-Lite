# Feature Gap Matrix — AutoFlow-Lite vs TobyFlow 1.3.106

Audit: 2026-10-24 · AutoFlow `0.17.0` @ `06aadc8` (local = `origin/main`, working tree clean).
TobyFlow reference: `D:\AUTO TOPY COPY\extracted` (read-only, minified bundle; only behaviour and module boundaries were studied, no code reused).

**Audit depth.** AutoFlow: implementation read for runner, store, background, workflow runner, chat driver, editor. TobyFlow: module list + targeted greps of the bundled code (spot checks, not a full read). Rows marked *shallow* need a deeper pass before work starts on them.

**Status legend:** `PASS` exists and tested · `FAIL` exists, wrong · `PARTIAL` · `MISSING` · `UNVERIFIED` exists, no test · `BLOCKED`.
**Verified at:** `mock` = e2e on mock pages (Edge headless) · `real` = real provider · `—` = not verified.

| # | Feature | TobyFlow behaviour (files) | AutoFlow today (files) | Gap | Status | Verified | Prio | Plan / test |
|---|---|---|---|---|---|---|---|---|
| 1 | Manifest & permissions | MV3, many hosts, oauth/backend hosts | MV3; storage, tabs, scripting, downloads, sidePanel, DNR; hosts limited to providers + localhost + Telegram (`manifest.json`) | No backend hosts needed. `activeTab`+`tabs` both present | PASS | mock | P3 | Review whether `activeTab` is still needed |
| 2 | Background service worker | Large SW: queue, MCP, Telegram, recovery (`background.js` 395 KB) | Thin SW: downloads, rename Flow downloads, bgFetch, context menu, notifications (`background.js`) | **Execution lives in the side panel**, not the SW. Closing the panel stops runs. | PARTIAL | mock | P1 | Keep panel-hosted runner (MV3 SW is killed when idle); make it *recoverable* (row 24). Moving the runner to an offscreen doc/SW is an ADR candidate, not done now |
| 3 | Side panel | Sidebar app (`src/app.js`) | Gen, Queue, History, Library, Workflows, Settings (`sidepanel/app.js`) | — | PASS | mock | — | Keep |
| 4 | Workflow editor | Drawflow-based editor (`src/workflow/*`) | Own canvas: typed ports, @mention, notes, undo/redo, versions, run node/all (`workflow-editor.js`) | — | PASS | mock | — | Keep, don't rewrite |
| 5 | Workflow engine | `WorkflowExecutor`, `WorkflowSingleNodeSession` | `sidepanel/lib/workflow.js`: topo order, run-only + ancestors, saved-result reuse, edit-only, queue of runs | No node checkpoint/resume after panel restart; no per-node retry button; run history = last result only | PARTIAL | mock | P1 | M4: checkpoint + resume from failed node |
| 6 | Task runner | `PromptQueue` (submittedAt, checkpoints, reconciliation) | `sidepanel/lib/runner.js`: submit → poll → finalize → download | **Resubmitted tasks whose result was unknown** (panel reopen, lost tracking, timeout) → duplicate generations / wasted credit | FAIL → fixed | mock | **P0** | Fixed in M2 step 1 (see progress). Tests: panel reload, Flow reload |
| 7 | Queue | `BatchQueue`, `GenBatchScheduler`, `ProviderWebScheduler` | Single list `store.tasks`, `nextTask()` with provider busy check, delays, chainPrev | Workflow runs queued separately in workflow runner (OK, one executor underneath) | PASS | mock | — | Keep |
| 8 | Browser tabs | `ProviderTabScroll`, tab activation | `flow.ready()/findTab()` (`sidepanel/lib/flow.js`) | Task does not remember its tab across sessions (fixed by storing `tabId` on submit) | PARTIAL | mock | P0 | Done with row 6 |
| 9 | Execution locks | `ExecutionLock`, `ProviderTabLock` (owner, epoch, release) | `Runner.busy(provider)`: in-memory count per provider (flow = concurrency, chat = 1) | Fixed v0.19: one controlling panel (lease + handover), ADR-003. Per-tab ownership inside one runner still implicit (one task per chat tab, Flow concurrency setting) | PARTIAL | mock | P2 | `tests/test-panels.mjs` |
| 10 | Provider drivers | Per-provider adapters + `ProviderRegistry` | `content/flow-driver.js`, `chat-driver.js` (ChatGPT/Gemini/Grok/Claude), `gen-driver.js` (Dreamina), `providers.js` | Selectors guessed for Claude/Dreamina (README) | PARTIAL | mock | P2 | Real-provider verification needed |
| 11 | Google Flow | UI driver v2 + Flow **API** driver | UI driver, API error sniffing (`PUBLIC_ERROR_*`) | No API path (TobyFlow uses internal API — not adopted, per security rules) | PASS (UI) | mock | — | Keep UI-only |
| 12 | ChatGPT | `chat-content-chatgpt.js`, `ChatGPTSession` | `chat-driver.js` cfg.chatgpt; edit-backdrop detection by pixel fingerprint (v0.15) | — | PASS | mock | — | Real check pending |
| 13 | Claude | (MCP icons only; no Claude web driver seen — *shallow*) | `chat-driver.js` cfg.claude | Selectors unverified | UNVERIFIED | — | P2 | Real check |
| 14 | Gemini | `chat-content-gemini.js` | `chat-driver.js` cfg.gemini | — | UNVERIFIED | — | P2 | Real check |
| 15 | Grok | `chat-content-grok.js` | `chat-driver.js` cfg.grok | — | UNVERIFIED | — | P2 | Real check |
| 16 | Dreamina/Seedance | Muse session (*shallow*) | `gen-driver.js`, no mock page | No mock, selectors guessed | UNVERIFIED | — | P2 | Add mock + real check |
| 17 | Image/video references | `RefImageAssignment`, `ImageNameRegistry`, `MentionParser` | `store.refs` (data URLs in `chrome.storage.local`), modes all/mention/sequential | No **None** mode; refs keyed by random id, no names/slugs; whole map rewritten on each save | PARTIAL | mock | P1 | M3 |
| 18 | Albums | `AlbumStore` | `sidepanel/albums.js`, `aflAlbums` (data URLs) | Data URLs in storage.local | PASS | mock | P2 | M3 |
| 19 | Media storage | `ImageStore`, `MediaRegistry`, `ThumbnailCache`, `BlobUrlManager` (IndexedDB) | Data URLs in `chrome.storage.local` (refs, albums, workflow image nodes) | No IndexedDB, no dedupe, every `store.save('refs')` rewrites all images | MISSING | — | P1 | M3: IndexedDB media store + batched migration, keep old data until verified |
| 20 | Prompt library | `UserPromptsManager`, `SnippetsPanel` | `store.library` + styles | No tags/favorites/variables/versioning | PARTIAL | mock | P3 | M6 |
| 21 | Workflow templates | `WorkflowTemplateList`, `MyTemplatesList`, online gallery (backend) | `workflow-templates.js` built-ins + `isTemplate` workflows | No categories/tags/import of gallery (no backend — by design) | PARTIAL | mock | P3 | M6 |
| 22 | MCP | `McpExecutor` (many tools) | 6 tools: generate, status, list/run/create workflow, recent results (`mcp/autoflow-mcp.mjs`, `bridges.js`); token-guarded localhost long-poll | No task-level status/cancel, no reference upload | PARTIAL | mock | P2 | M5 |
| 23 | Telegram | `TelegramExecutor` | `/gen /video /status /stop`, send results (`bridges.js`) | **First chat that sends /start gets linked** (trust-on-first-use); no workflow commands | PARTIAL | mock | P1 (security) | M5: require explicit linking code shown in Settings |
| 24 | Recovery | `FlowWebRecovery`, `ConfigAccessRecovery`, reconciliation after reload | Was: requeue all "running" tasks on panel start | Fixed: reattach by tab+token, else "Chưa rõ" (no auto resend) | FAIL → fixed | mock | **P0** | Done (M2 step 1) |
| 25 | Checkpoint | `FlowApiV2CheckpointStore`, queue checkpoints | Task fields persisted via debounced `store.save('tasks')`; now `submittedAt/tabId/token` | No workflow-node checkpoint | PARTIAL | mock | P1 | M4 |
| 26 | Logging | Console + telemetry to backend | In-panel log list (`log()` in app.js), not persisted | Fixed v0.19: persisted 300-line log, tokens masked (ADR-004). No error codes yet | PARTIAL | mock | P2 | M7: error codes |
| 27 | Diagnostics | Selector helpers | Settings → Chẩn đoán: exports page structure JSON | — | PASS | mock | — | Keep |
| 28 | Security | Auth, request signing, device keys (backend) | No backend; tokens in storage.local (MCP token, Telegram token) | Telegram TOFU (row 23). Backups no longer contain tokens (v0.19) | PARTIAL | mock | P1 | M5: Telegram linking code |
| 29 | Device sync | `BackendSync`, `UsageSync` (server) | None | Cross-device sync needs a backend — out of scope until approved | BLOCKED | — | — | Needs backend + privacy decision |
| 30 | Dev Center | — (settings page + run window) | — | No central management page | MISSING | — | P2 | M7, after M2–M5 (needs stable services to display) |
| 31 | Performance | Tile/thumbnail caches, request coalescing | Debounced saves, polling 400–1500 ms per active job | Large data-URL writes; status polling every 4 s in panel | PARTIAL | — | P2 | M3 (media) + M8 |
| 32 | Automated tests | (none shipped) | `tests/test-driver.mjs` (31), `tests/test-e2e.mjs` (114), `tests/test-recovery.mjs` (4) on mock pages | No real-provider tests (cannot run without spending credit) | PARTIAL | mock | — | Keep adding per change |

## Removed from scope (already done)

Workflow editor, run-node/run-all, edit-in-place + result versions, ChatGPT edit-result correlation (v0.14–0.15), running-path wires (v0.17), image-drag clone fix (v0.17), smart retry by category (captcha/quota/setup/policy/rate-limit already distinct in `Runner.fail`).

## Top P0/P1 gaps, in order

1. **Duplicate resubmission of tasks with unknown outcome** (rows 6, 24) — fixed in M2 step 1.
2. **Two panels → two runners** on the same tabs (row 9).
3. **Workflow checkpoint/resume** after panel restart (rows 5, 25).
4. **Telegram trust-on-first-use** linking (row 23).
5. **Media in `chrome.storage.local` as data URLs** (rows 17–19).

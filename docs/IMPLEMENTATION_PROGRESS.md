# Implementation Progress

Read this file first in each session. Don't redo items marked DONE. Audit details are in `FEATURE_GAP_MATRIX.md`, and decisions are in `ARCHITECTURE_DECISIONS.md`.

Baseline: `0.17.0` @ `06aadc8` (2026-10-24).

| Milestone | Item | Status | Notes |
|---|---|---|---|
| M1 Audit | Version / git verification | DONE | local = origin/main, clean |
| M1 Audit | Feature gap matrix | DONE | `docs/FEATURE_GAP_MATRIX.md` (TobyFlow side is a shallow pass) |
| M2 Stability | No auto-resend of submitted tasks with unknown outcome; reattach after panel reopen | DONE (mock) | v0.18.0. ADR-001, ADR-002. Files: `sidepanel/lib/runner.js`, `sidepanel/lib/flow.js`, `sidepanel/app.js`, `sidepanel/style.css`; tests `tests/test-recovery.mjs` + 2 cases in `tests/test-e2e.mjs`, mock `SLOW` mode. Real providers UNVERIFIED |
| M2 Stability | Poll timeout so a silent tab can't stall the queue | DONE (no test for silent tab) | `flow.sendWithin` |
| M2 Stability | Find why finished workflow tasks stay `running` in storage (seen in e2e: #34, #40) | TODO | Now harmless (become `unknown` on reopen) but means workflow/task state drift |
| M2 Stability | Single active runner lease (two panels) | TODO | ADR-003 |
| M2 Stability | Persisted, bounded log ring + error codes | TODO | |
| M3 Media | IndexedDB media store, batched migration of refs/albums | TODO | Keep old data until the new store is verified |
| M3 Media | Reference mode "None", named refs | TODO | |
| M4 Workflow | Node checkpoint + resume from failed node after panel restart | TODO | |
| M5 Integrations | Telegram explicit linking code (replace first-/start linking) | TODO | Security |
| M5 Integrations | MCP task status/cancel | TODO | |
| M6 Content | Prompt/template tags, favorites | TODO | |
| M7 Dev Center | Management page in its own tab (read-only views over existing store/runner) | TODO | After M2–M5 |
| M8 Optimization | Perf, regression, docs | TODO | |

## Not verified on real providers

Every result here comes from mock pages. Nothing in M2 has been run against real Flow, ChatGPT, Gemini, Grok, Claude or Dreamina, so as not to spend the user's credit.

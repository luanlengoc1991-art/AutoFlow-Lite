# Architecture Decisions

## ADR-001 — Keep the runner in the side panel; make it recoverable (2026-10-24)

**Context.** Task and workflow execution runs in the side panel (`sidepanel/lib/runner.js`, `sidepanel/lib/workflow.js`). An MV3 service worker is suspended when idle, so it cannot host a long polling loop without keep-alive tricks. Content scripts keep per-job state (`jobs` map keyed by token) in the provider tab, which survives the side panel closing.

**Decision.** Do not move execution out of the panel now. Instead:
- Persist on each task, at the moment the page accepts it: `submittedAt`, `tabId`, `token`.
- On panel start, `Runner.recover()` reconciles every task left in `running`:
  - not submitted → back to `pending` (safe to send);
  - submitted and the tab still knows the token → reattach and keep polling;
  - otherwise → `unknown`.

**Consequences.** Closing and reopening the panel no longer loses or duplicates work while the provider tab stays open. A workflow run that was in progress is not resumed yet; see ADR-003 (planned). Moving the runner to an offscreen document stays open as an option if panel-hosted execution proves too fragile.

## ADR-002 — New terminal task status `unknown` ("Chưa rõ") (2026-10-24)

**Context.** Three paths resent a task that may already have been generated: panel reopen, lost tracking (tab reload or close), and timeout without output. Each resend can create duplicates and spend credit.

**Decision.** A submitted task whose outcome cannot be confirmed becomes `unknown`:
- It is part of `FINAL`, so workflows and chains do not hang. Workflow nodes treat it as a failure with an explanatory error.
- It is never retried automatically. "Chạy lại tất cả lỗi" also skips it.
- The user can resend that one task with its own Retry button. The tooltip warns to check the page first.
- An explicit failure reported by the page (`status: 'failed'`) still goes through the existing category-based retry in `Runner.fail`.

**Consequences.** There are fewer automatic retries after timeouts; that is the intended trade (credit safety over throughput). The MCP `autoflow_status` and Telegram `/status` output now include an `unknown` count.

## ADR-003 — (planned) Single active runner lease

Two side panels (two windows) each create a `Runner`, and both can submit to the same provider tab. Planned fix: a lease in `chrome.storage.session` (`owner`, `heartbeat`), with stale-lease takeover after N seconds. Without the lease, a panel shows state read-only. Not implemented yet.

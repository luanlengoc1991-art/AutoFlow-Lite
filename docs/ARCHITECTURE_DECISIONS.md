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

## ADR-003 — One controlling side panel (lease) (2026-10-25)

**Context.** Each Chrome window has its own side panel, and every panel loads `app.js`. Commands sent with `chrome.runtime.sendMessage` reach all of them: run workflow from the editor, enqueue from Angles/Effects, keyboard shortcut. Two panels would each run the command, creating duplicate generations. Each panel also keeps its own in-memory queue and overwrites the other's `aflTasks`. Both would also poll Telegram.

**Decision.** `sidepanel/lib/leader.js` holds a lease in `chrome.storage.session` (`aflLeader`: id, heartbeat every 4 s, `busy`).
- The panel id is kept in `sessionStorage`, so a panel that reloads keeps control.
- A panel without the lease shows an overlay and ignores commands. It does not recover tasks, start MCP or Telegram, or write the queue.
- A lease older than 12 s counts as free: the leader was closed. A follower then reloads and claims it.
- The lease is not released on `pagehide`, because reloading also fires it and would let another panel grab control mid-reload.
- **"Dùng ở cửa sổ này" (take over):**
  - The new panel writes the lease.
  - The old panel stops MCP and Telegram, then `runner.detach()` waits for the loop to exit, so a half-sent task finishes saving its token. Running tasks are kept, not cancelled.
  - The old panel flushes storage and writes `aflHandover`.
  - The new panel waits for `aflHandover`, reloads, and `Runner.recover()` reattaches the running tasks.

**Consequences.** A workflow that was mid-run in the old panel stops; the user is warned before taking over. Tasks already sent continue in the new panel.

## ADR-004 — Persisted, redacted log (2026-10-25)

The log is stored in `aflLogs` (latest 300 lines) and written only by the controlling panel. Writes are batched 300 ms and flushed on `pagehide`/hidden. Telegram bot tokens and `token=` query values are masked before the log is shown or stored. Older-session lines appear dimmed.

## Security note — backups (2026-10-25)

Settings → Sao lưu no longer exports `tgToken`/`mcpToken`. Restore accepts only `afl*` keys whose values are objects, and keeps the tokens already on the device.

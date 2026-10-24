# Test Results

Levels: **unit** · **mock** (extension loaded in headless Edge against the mock pages in `tests/`) · **real Chrome** · **real provider**. Only results that were actually run are listed.

## 2026-10-24 — M2 step 1: no auto-resend of tasks with unknown outcome

| Suite | Level | Result |
|---|---|---|
| `tests/test-e2e.mjs` | mock | 114 pass / 0 fail |
| `tests/test-recovery.mjs` (new) | mock | 4 pass / 0 fail |
| `tests/test-driver.mjs` | mock | 31 pass / 0 fail |
| Real Chrome / real providers | — | **UNVERIFIED** (not run, to avoid spending credit) |

New cases:
- **Reloading the side panel while a Flow task is generating:** the task reattaches through its tab and token, gets the result, and Flow receives exactly 1 submit.
- **Reattach while other tasks are pending:** the queue pauses with a banner and the pending task is not sent. Pressing **Tiếp tục** runs it.
- **Reloading the Flow tab while a task is generating:** the task becomes `unknown` ("Chưa rõ") and Flow receives 0 new submits within 15 s. The row offers Chạy lại.
- Also exercised with 2K menu downloads and 2 images per task (ad-hoc run, passed).

Findings while testing:
- In the long e2e run, the hidden mock Flow tab had its timers throttled by Chrome to about one per minute, so the slow mock tile stalled at 35%. The tests now bring the Flow tab to the front first. This was a test-environment artifact, not an extension bug.
- At panel reload during e2e, 2 workflow tasks from earlier tests (#34, #40) were still stored as `running` long after their workflows finished. The old code would have **resent** them. The new code marks them `unknown`. **Why they stay `running` is still open** (TODO in progress doc).
- `flow.send` had no timeout, so a tab that never answers could stall the whole queue loop. Polls now use `sendWithin` (15 s; 5 s during recovery). A late answer counts as "still running", not "lost". There is no automated test for a non-answering tab (the mock can't block the extension's isolated-world handler): **UNVERIFIED**.

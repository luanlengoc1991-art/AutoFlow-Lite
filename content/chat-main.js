// Nhận lệnh từ side panel trên các trang chat AI.
(function () {
  if (window.__aflChatMain) return;
  window.__aflChatMain = true;
  const C = window.AFLChat;

  const handlers = {
    'afl:ping': () => ({ ok: true, provider: C.provider, editor: C.ready(), submit: C.ready(), inProject: true, account: C.account() }),
    'afl:submit': (m) => C.submitTask(m.task),
    'afl:poll': (m) => C.pollJob(m.token),
    'afl:finalize': (m) => ({ ok: true, results: C.finalizeJob(m.token, m.results), conv: location.pathname }),
    'afl:deleteChat': (m) => C.deleteChat(m.conv),
    'afl:fetch': async (m) => ({ ok: true, ...(await C.fetchMedia(m.url)) }),
    'afl:diagnose': () => ({ ok: true, report: C.diagnose() }),
    'afl:tracker': (m) => { window.AFLTracker?.update(m.state); return { ok: true }; }
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const h = handlers[msg?.type];
    if (!h) return false;
    if (msg.selectors !== undefined) C.setOverrides(msg.selectors);
    Promise.resolve()
      .then(() => h(msg))
      .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e), category: 'error' }));
    return true;
  });
})();

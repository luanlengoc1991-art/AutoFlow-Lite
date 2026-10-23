// Nhận lệnh từ side panel và gọi driver Flow.
(function () {
  if (window.__aflMain) return;
  window.__aflMain = true;
  const D = window.AFLDriver;

  // Gửi một task: đóng popup cũ → áp cài đặt → ảnh tham chiếu → prompt → bấm tạo.
  async function submitTask(task) {
    const project = await D.ensureProject();
    if (!project.ok) return { ok: false, error: project.error, category: 'setup' };
    await D.closePanels();
    const settings = await D.applySettings(task);
    if (!task.keepRefs) await D.clearRefs();
    if (task.refs?.length) {
      const r = await D.attachRefs(task.refs, task.genType === 'video' ? task.videoMode : null);
      if (!r.ok) return { ok: false, error: r.error, category: 'error' };
    }
    const { clean, mentions } = D.parseMentions(task.prompt);
    for (const m of mentions) {
      const r = await D.selectComponent(m.kind, m.name);
      if (!r.ok) return { ok: false, error: r.error + (r.available?.length ? ` (có: ${r.available.join(', ')})` : ''), category: 'config' };
    }
    const p = await D.setPrompt(clean);
    if (!p.ok) return { ok: false, error: p.error, category: 'error' };
    const token = await D.startJob({ ...task, prompt: clean });
    const s = task.manualSubmit ? await D.waitManualSubmit() : await D.submit();
    if (!s.ok) return { ok: false, error: s.error, category: 'error' };
    return { ok: true, token, warnings: settings.warnings };
  }

  const handlers = {
    'afl:ping': () => ({
      ok: true, inProject: D.inProject(), editor: !!D.findEditor(), submit: !!D.findSubmit(),
      settings: D.readComposerSettings(), account: D.account()
    }),
    'afl:submit': (m) => submitTask(m.task),
    'afl:poll': (m) => D.pollJob(m.token),
    'afl:finalize': async (m) => ({ ok: true, results: await D.finalizeJob(m.token, m.results) }),
    'afl:scrape': async () => ({ ok: true, options: await D.scrapeOptions() }),
    'afl:listMedia': async (m) => ({ ok: true, items: await D.listProjectMedia(m.opts) }),
    'afl:scrapeComponents': async () => ({ ok: true, components: await D.scrapeComponents() }),
    'afl:downloadMenu': (m) => D.downloadViaMenu(m.url, m.label),
    'afl:lastFrame': async (m) => ({ ok: true, ...(await D.lastFrame(m.url)) }),
    'afl:diagnose': () => ({ ok: true, report: D.diagnose() }),
    'afl:fetch': async (m) => ({ ok: true, ...(await D.fetchMedia(m.url)) }),
    'afl:tracker': (m) => { window.AFLTracker?.update(m.state); return { ok: true }; }
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const h = handlers[msg?.type];
    if (!h) return false;
    if (msg.selectors !== undefined) D.setOverrides(msg.selectors);
    Promise.resolve()
      .then(() => h(msg))
      .then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e), category: 'error' }));
    return true;
  });
})();

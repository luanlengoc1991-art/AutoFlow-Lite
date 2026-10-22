// Bộ chạy hàng đợi: gửi task sang Flow / trang chat, theo dõi, thử lại, tải kết quả.
import { store, uid } from './store.js';
import * as flow from './flow.js';
import { PROVIDERS } from './providers.js';
import { buildFilename, extFor } from './prompts.js';
import { applyFlowDefaults, chatOptions } from './defaults.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOW_FIELDS = ['prompt', 'genType', 'videoMode', 'model', 'ratio', 'quantity', 'duration', 'resolution'];
const FINAL = new Set(['done', 'error', 'cancelled']);
// Độ phân giải cần tải qua menu của Flow (upscale); "original" tải thẳng file gốc.
const UPSCALE = { image: ['2k', '4k'], video: ['1080p', '4k'] };

export class Runner {
  constructor({ log, onChange }) {
    this.log = log;
    this.onChange = onChange;
    this.running = false;
    this.paused = false;
    this.stopRequested = false;
    this.active = new Map(); // taskId -> { token, tabId, provider, startedAt }
    this.tabId = null;
    this.message = '';
    this.level = '';
    this.lastBroadcast = 0;
    this.settledListeners = new Set();
  }

  // Workflow đăng ký để biết khi task kết thúc.
  onSettled(fn) { this.settledListeners.add(fn); return () => this.settledListeners.delete(fn); }
  settled(task) { for (const fn of this.settledListeners) { try { fn(task); } catch (_) { /* listener lỗi */ } } }

  changed() {
    store.save('tasks');
    this.onChange();
    this.broadcast();
  }

  async start() {
    if (this.running) { this.paused = false; this.changed(); return; }
    Object.assign(this, { running: true, paused: false, stopRequested: false, message: '', level: '' });
    this.log('Bắt đầu chạy hàng đợi');
    this.changed();
    try {
      await this.loop();
    } catch (e) {
      this.log(`Lỗi hàng đợi: ${e.message || e}`, 'error');
    } finally {
      for (const id of this.active.keys()) {
        const t = this.find(id);
        if (t && t.status === 'running') { t.status = 'cancelled'; t.error = 'Đã dừng khi đang tạo'; this.settled(t); }
      }
      this.active.clear();
      if (this.stopRequested) {
        for (const t of store.tasks) if (t.status === 'pending' && t.workflowRun) { t.status = 'cancelled'; t.error = 'Đã dừng'; this.settled(t); }
      }
      this.running = false;
      this.paused = false;
      const done = store.tasks.filter((t) => t.status === 'done').length;
      const failed = store.tasks.filter((t) => t.status === 'error').length;
      this.log(this.stopRequested ? 'Đã dừng hàng đợi' : `Hoàn tất: ${done} xong, ${failed} lỗi`, this.stopRequested ? 'warn' : 'ok');
      if (!this.stopRequested) this.onFinish?.({ done, failed });
      if (!this.stopRequested && store.settings.notify) {
        chrome.runtime.sendMessage({ type: 'afl:notify', title: 'AutoFlow đã chạy xong', message: `${done} task xong, ${failed} lỗi` }).catch(() => {});
      }
      this.changed();
      setTimeout(() => this.broadcast(true), 4000);
    }
  }

  pause() { if (this.running) { this.paused = true; this.log('Tạm dừng (task đang tạo vẫn được theo dõi)', 'warn'); this.changed(); } }
  resume() { if (this.running) { this.paused = false; this.message = ''; this.log('Tiếp tục'); this.changed(); } }
  togglePause() { this.paused ? this.resume() : this.pause(); }
  stop() { if (this.running) { this.stopRequested = true; this.paused = false; this.changed(); } }

  find(id) { return store.tasks.find((t) => t.id === id); }
  busy(provider) {
    const n = [...this.active.values()].filter((a) => a.provider === provider).length;
    return n >= (provider === 'flow' ? Math.max(1, store.settings.concurrency) : 1);
  }
  nextTask() {
    const now = Date.now();
    return store.tasks.find((t) => t.status === 'pending' && (!t.retryAt || t.retryAt <= now) && !this.busy(t.provider || 'flow') && this.chainReady(t));
  }
  // Task dùng kết quả trước làm tham chiếu phải đợi các task trước cùng lô kết thúc.
  chainReady(t) {
    if (!t.chainPrev) return true;
    return !store.tasks.some((x) => x.batchId === t.batchId && x.index < t.index && !FINAL.has(x.status));
  }
  async chainRefs(task) {
    const prev = store.tasks.filter((x) => x.batchId === task.batchId && x.index < task.index && x.status === 'done' && x.results?.length);
    const pick = task.chainPrev === 'all' ? prev : prev.slice(-1);
    const ids = [];
    for (const t of pick) {
      for (const r of t.results.filter((x) => x.kind === 'image')) {
        try {
          const { dataUrl, mime } = await this.mediaToDataUrl(t, r);
          ids.push(store.addRef({ name: `ket-qua-${t.index}.png`, mime, dataUrl }));
        } catch (e) {
          this.log(`#${task.index}: không lấy được kết quả #${t.index} làm tham chiếu (${e.message})`, 'warn');
        }
      }
    }
    return ids;
  }
  hasPending() { return store.tasks.some((t) => t.status === 'pending'); }

  async loop() {
    let lastSubmit = 0, gap = 0;
    while (!this.stopRequested) {
      for (const [id, a] of [...this.active]) {
        if (this.stopRequested) break;
        await this.pollOne(id, a);
      }
      if (this.stopRequested) break;
      const s = store.settings;
      const next = !this.paused && Date.now() - lastSubmit >= gap ? this.nextTask() : null;
      if (next) {
        await this.submitOne(next);
        lastSubmit = Date.now();
        const min = Math.max(0, +s.delayMin || 0), max = Math.max(min, +s.delayMax || min);
        gap = (min + Math.random() * (max - min)) * 1000;
      } else if (!this.active.size && !this.hasPending()) {
        break;
      }
      this.broadcast();
      await sleep(next ? 400 : 1500);
    }
  }

  async submitOne(task) {
    const provider = task.provider || 'flow';
    const isChat = PROVIDERS[provider].kind === 'chat';
    Object.assign(task, { status: 'running', attempts: (task.attempts || 0) + 1, progress: null, error: '', retryAt: 0, startedAt: Date.now() });
    this.changed();
    let tab;
    try {
      ({ tab } = await flow.ready(provider, { newChat: isChat && (task.newChat ?? store.settings.chatNewChat) }));
    } catch (e) {
      task.status = 'pending';
      task.attempts--;
      this.setMessage(e.message, 'error');
      this.log(e.message, 'error');
      this.pause();
      return;
    }
    this.tabId = tab.id;
    if (task.chainPrev && !task.chainDone) {
      task.refIds = [...(task.refIds || []), ...(await this.chainRefs(task))];
      task.chainDone = true;
    }
    const payload = isChat
      ? { chatMode: task.chatMode || 'image', ...chatOptions(provider, task, store.settings) }
      : { ...Object.fromEntries(FLOW_FIELDS.map((k) => [k, applyFlowDefaults(task, store.settings)[k]])), keepRefs: store.settings.keepRefs };
    payload.refs = store.getRefs(task.refIds);
    let res;
    try {
      res = await flow.send(tab.id, { type: 'afl:submit', task: payload });
    } catch (e) {
      res = { ok: false, error: `Mất kết nối trang ${PROVIDERS[provider].name}: ${e.message || e}`, category: 'error' };
    }
    if (!res?.ok) { this.fail(task, res?.error, res?.category); return; }
    for (const w of res.warnings || []) this.log(`#${task.index}: ${w}`, 'warn');
    this.log(`#${task.index} đã gửi (${PROVIDERS[provider].name}): ${task.prompt.slice(0, 60)}`);
    this.active.set(task.id, { token: res.token, tabId: tab.id, provider, startedAt: Date.now() });
  }

  async pollOne(id, a) {
    const task = this.find(id);
    if (!task) { this.active.delete(id); return; }
    let r;
    try {
      r = await flow.send(a.tabId, { type: 'afl:poll', token: a.token });
    } catch (_) {
      r = { status: 'lost' };
    }
    if (!r || r.status === 'lost') {
      this.active.delete(id);
      this.fail(task, 'Mất theo dõi (trang đã tải lại hoặc bị đóng)', 'error');
      return;
    }
    task.progress = r.progress;
    const timedOut = Date.now() - a.startedAt > Math.max(1, store.settings.timeoutMin) * 60000;
    if (r.status === 'running' && !timedOut) { this.onChange(); this.broadcast(); return; }
    this.active.delete(id);
    const hasOutput = r.results?.length || (task.chatMode === 'text' && r.text);
    if (r.status === 'failed' || (timedOut && !hasOutput)) {
      this.fail(task, r.error || 'Hết thời gian chờ kết quả', timedOut ? 'timeout' : r.category);
      return;
    }
    await this.finish(task, a, r);
  }

  async finish(task, a, r) {
    let results = r.results || [];
    let conv = '';
    try {
      const fin = await flow.send(a.tabId, { type: 'afl:finalize', token: a.token, results });
      if (fin?.ok) ({ results, conv = '' } = fin);
    } catch (_) { /* giữ kết quả thô */ }
    // Tải tự động: theo task, tắt hẳn nếu cài đặt chung tắt (task MCP theo cài đặt MCP riêng).
    const auto = (task.autoDownload ?? true) && (task.source === 'mcp' ? store.settings.mcpAutoDownload !== false : store.settings.autoDownload !== false);
    const saved = [];
    for (let n = 0; n < results.length; n++) {
      const item = { url: results[n].url, kind: results[n].kind, thumb: results[n].thumb || '' };
      if (auto) Object.assign(item, await this.download(a.tabId, task, item, n + 1));
      saved.push(item);
    }
    if (r.text) task.text = r.text;
    if (auto && task.chatMode === 'text' && r.text) await this.saveText(task, r.text);
    Object.assign(task, { status: 'done', progress: 100, results: saved, finishedAt: Date.now(), error: '' });
    if (task.provider === 'flow' || !task.provider) {
      if (results.length < (task.quantity || 1)) task.note = `Nhận ${results.length}/${task.quantity} kết quả`;
      if (r.errors?.length) task.note = `${task.note ? task.note + '; ' : ''}${r.errors[0]}`;
    }
    store.addHistory({
      id: uid(), taskId: task.id, provider: task.provider || 'flow', prompt: task.prompt, genType: task.genType, model: task.model, ratio: task.ratio,
      text: task.chatMode === 'text' ? r.text : '', at: Date.now(),
      results: saved.map(({ url, kind, thumb, filename, downloadId }) => ({ url, kind, thumb, filename, downloadId }))
    });
    const what = task.chatMode === 'text' ? `${(r.text || '').length} ký tự` : `${results.length} kết quả`;
    this.log(`#${task.index} xong: ${what}${auto && saved.length ? `, đã tải ${saved.filter((s) => s.downloaded).length}` : ''}`, 'ok');
    this.changed();
    if (PROVIDERS[task.provider]?.kind === 'chat') await this.chatCleanup(task, a, conv, auto || task.chatMode === 'text');
    this.settled(task);
  }

  // Sau khi gen thành công trên trang chat: xoá cuộc trò chuyện (nếu bật và kết quả đã được lưu),
  // đóng tab khi không còn task nào của provider đó.
  async chatCleanup(task, a, conv, kept) {
    const s = store.settings, p = task.provider, name = PROVIDERS[p].name;
    const followers = store.tasks.some((x) => x.chainPrev && x.batchId === task.batchId && x.index > task.index && !FINAL.has(x.status));
    if (s[`${p}DeleteAfter`] && conv) {
      if (!kept) this.log(`#${task.index}: giữ cuộc trò chuyện ${name} vì kết quả chưa được tải về`, 'warn');
      else if (followers) this.log(`#${task.index}: giữ cuộc trò chuyện ${name} cho task dùng kết quả trước`);
      else {
        const r = await flow.send(a.tabId, { type: 'afl:deleteChat', conv }).catch((e) => ({ ok: false, error: e.message }));
        this.log(r?.ok ? `#${task.index}: đã xoá cuộc trò chuyện ${name}` : `#${task.index}: không xoá được cuộc trò chuyện ${name} (${r?.error || 'lỗi'})`, r?.ok ? '' : 'warn');
      }
    }
    if (s[`${p}AutoClose`] && !store.tasks.some((x) => x.provider === p && (x.status === 'pending' || x.status === 'running'))) {
      await chrome.tabs.remove(a.tabId).catch(() => {});
      this.log(`Đã đóng tab ${name}`);
    }
  }

  baseName(task, n) {
    const s = store.settings;
    const folder = (task.folder || s.folder || 'AutoFlow').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const prompt = task.prompt.replace(/@(char|voice):(\[[^\]]+\]|\S+)/g, ' ').trim();
    const name = buildFilename(s.pattern, { index: task.index, prompt, n, genType: task.genType || task.chatMode, model: task.model || task.provider, time: task.createdAt, project: s.project });
    return `${folder}/${name}`;
  }

  async saveText(task, text) {
    const url = `data:text/plain;charset=utf-8,${encodeURIComponent(`${task.prompt}\n\n---\n\n${text}`)}`;
    await chrome.runtime.sendMessage({ type: 'afl:download', url, filename: `${this.baseName(task, 1)}.txt` }).catch(() => {});
  }

  async download(tabId, task, item, n) {
    const base = this.baseName(task, n);
    const isFlow = !task.provider || task.provider === 'flow';
    const res = isFlow ? (item.kind === 'video' ? store.settings.dlVideoRes : store.settings.dlImageRes) : 'original';
    try {
      if (isFlow && UPSCALE[item.kind]?.includes(res)) {
        const r = await this.downloadViaMenu(tabId, item, res, base);
        if (r.ok) return r;
        this.log(`#${task.index}: không tải được bản ${res} (${r.error}), tải bản gốc`, 'warn');
      }
      return await this.downloadDirect(tabId, item, base);
    } catch (e) {
      this.log(`#${task.index} lỗi tải file ${n}: ${e.message || e}`, 'error');
      return { downloaded: false };
    }
  }

  // Chọn độ phân giải trong menu Download của Flow; background đổi tên file Flow tạo ra.
  async downloadViaMenu(tabId, item, label, base) {
    // Upscale video có thể mất vài phút; quá thời gian thì quay về tải bản gốc.
    const waiting = chrome.runtime.sendMessage({ type: 'afl:expectDownload', filename: base, timeoutMs: item.kind === 'video' ? 300000 : 120000 });
    const r = await flow.send(tabId, { type: 'afl:downloadMenu', url: item.url, label }).catch((e) => ({ ok: false, error: e.message }));
    if (!r?.ok) {
      chrome.runtime.sendMessage({ type: 'afl:cancelExpect' }).catch(() => {});
      await waiting.catch(() => null);
      return { ok: false, error: r?.error };
    }
    const d = await waiting;
    return d?.ok ? { ok: true, downloaded: true, filename: d.filename, downloadId: d.id, resolution: label } : { ok: false, error: d?.error };
  }

  async downloadDirect(tabId, item, base) {
    let url = item.url, mime = '';
    if (url.startsWith('blob:')) {
      const f = await flow.send(tabId, { type: 'afl:fetch', url });
      if (!f?.ok) throw new Error(f?.error);
      url = f.dataUrl; mime = f.mime;
    }
    let filename = `${base}.${extFor(item.kind, item.url, mime)}`;
    let res = await chrome.runtime.sendMessage({ type: 'afl:download', url, filename });
    if (!res?.ok && !url.startsWith('data:')) {
      // Tải trực tiếp bị chặn: đọc file qua trang (có cookie đăng nhập), rồi qua quyền host của extension.
      let f = await flow.send(tabId, { type: 'afl:fetch', url: item.url }).catch(() => null);
      if (!f?.ok) f = await chrome.runtime.sendMessage({ type: 'afl:bgFetch', url: item.url });
      if (!f?.ok) throw new Error(res?.error || f?.error);
      filename = `${base}.${extFor(item.kind, item.url, f.mime)}`;
      res = await chrome.runtime.sendMessage({ type: 'afl:download', url: f.dataUrl, filename });
    }
    if (!res?.ok) throw new Error(res?.error || 'Tải thất bại');
    return { downloaded: true, filename, downloadId: res.id };
  }

  // Lấy nội dung media dưới dạng data URL (để dùng làm ảnh tham chiếu cho bước sau của workflow).
  async mediaToDataUrl(task, item) {
    const provider = task.provider || 'flow';
    const tab = await flow.findTab(provider);
    let f = tab ? await flow.send(tab.id, { type: 'afl:fetch', url: item.url }).catch(() => null) : null;
    if (!f?.ok) f = await chrome.runtime.sendMessage({ type: 'afl:bgFetch', url: item.url });
    if (!f?.ok) throw new Error(f?.error || 'Không đọc được media');
    return { dataUrl: f.dataUrl, mime: f.mime };
  }

  fail(task, error, category) {
    const s = store.settings;
    const msg = error || 'Lỗi không rõ';
    let final = false;
    if (category === 'captcha') {
      task.status = 'pending';
      task.attempts = Math.max(0, (task.attempts || 1) - 1);
      this.setMessage('Trang yêu cầu xác minh captcha. Hãy giải captcha rồi bấm Tiếp tục.', 'error');
      this.log(`#${task.index}: cần giải captcha, đã tạm dừng`, 'error');
      this.notify('Cần giải captcha');
      this.pause();
    } else if (category === 'quota') {
      Object.assign(task, { status: 'error', error: msg, finishedAt: Date.now() });
      this.setMessage('Đã hết lượt/credit, hàng đợi dừng lại.', 'error');
      this.log(`#${task.index}: hết hạn mức (${msg})`, 'error');
      this.notify('Hết lượt/credit');
      this.stopRequested = true;
      final = true;
    } else if (category === 'setup') {
      task.status = 'pending';
      task.attempts = Math.max(0, (task.attempts || 1) - 1);
      this.setMessage(msg, 'error');
      this.log(msg, 'error');
      this.pause();
    } else if (category !== 'policy' && category !== 'config' && (task.attempts || 0) <= s.retries) {
      const wait = category === 'rate_limit' ? 60000 * task.attempts : 10000 * task.attempts;
      Object.assign(task, { status: 'pending', retryAt: Date.now() + wait, error: msg });
      this.log(`#${task.index} lỗi: ${msg}. Thử lại sau ${Math.round(wait / 1000)}s (lần ${task.attempts}/${s.retries})`, 'warn');
    } else {
      Object.assign(task, { status: 'error', error: category === 'policy' ? `Vi phạm chính sách: ${msg}` : msg, finishedAt: Date.now() });
      this.log(`#${task.index} thất bại: ${task.error}`, 'error');
      if (s.stopOnError) this.stopRequested = true;
      final = true;
    }
    this.changed();
    if (final) this.settled(task);
  }

  setMessage(message, level) { this.message = message; this.level = level; }
  notify(message) { if (store.settings.notify) chrome.runtime.sendMessage({ type: 'afl:notify', message }).catch(() => {}); }

  broadcast(force) {
    if (!this.tabId) return;
    const now = Date.now();
    if (!force && now - this.lastBroadcast < 800) return;
    this.lastBroadcast = now;
    const tasks = store.tasks;
    const current = tasks.find((t) => t.status === 'running');
    const state = {
      visible: this.running,
      total: tasks.filter((t) => t.status !== 'cancelled').length,
      done: tasks.filter((t) => FINAL.has(t.status) && t.status !== 'cancelled').length,
      current: current ? `#${current.index} ${current.prompt}` : '',
      progress: current?.progress ?? null,
      paused: this.paused,
      message: this.message,
      level: this.level
    };
    flow.send(this.tabId, { type: 'afl:tracker', state }).catch(() => {});
  }
}

export { FINAL };

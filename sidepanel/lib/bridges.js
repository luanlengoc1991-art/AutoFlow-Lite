// Cầu nối MCP (nhận lệnh từ máy chủ autoflow-mcp.mjs qua localhost) và bot Telegram (long-poll getUpdates).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setStatus(key, value) {
  const { aflBridgeStatus = {} } = await chrome.storage.local.get('aflBridgeStatus');
  aflBridgeStatus[key] = { ...value, at: Date.now() };
  await chrome.storage.local.set({ aflBridgeStatus });
}

export class McpBridge {
  constructor({ getSettings, handlers, log }) {
    this.getSettings = getSettings;
    this.handlers = handlers;
    this.log = log;
    this.running = false;
    this.ctrl = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    this.ctrl?.abort();
    setStatus('mcp', { state: 'off' });
  }

  async loop() {
    let lastState = '';
    const status = (state) => { if (state !== lastState) { lastState = state; setStatus('mcp', { state }); } };
    while (this.running) {
      const s = this.getSettings();
      if (!s.mcpEnabled || !s.mcpToken) { status('off'); await sleep(2000); continue; }
      const base = `http://127.0.0.1:${s.mcpPort || 17321}`;
      try {
        this.ctrl = new AbortController();
        const t = setTimeout(() => this.ctrl.abort(), 35000);
        const res = await fetch(`${base}/poll?token=${encodeURIComponent(s.mcpToken)}`, { signal: this.ctrl.signal });
        clearTimeout(t);
        if (res.status === 401) { status('badtoken'); await sleep(5000); continue; }
        status('connected');
        if (res.status !== 200) continue;
        const cmd = await res.json();
        this.execute(base, s.mcpToken, cmd);
      } catch (_) {
        status('waiting');
        await sleep(3000);
      }
    }
  }

  // Chạy song song để long-poll tiếp tục nhận lệnh khác.
  async execute(base, token, cmd) {
    let reply;
    try {
      const fn = this.handlers[cmd.tool];
      if (!fn) throw new Error(`Không hỗ trợ ${cmd.tool}`);
      this.log(`MCP: ${cmd.tool}`);
      reply = { id: cmd.id, ok: true, result: await fn(cmd.args || {}) };
    } catch (e) {
      reply = { id: cmd.id, ok: false, error: e.message || String(e) };
    }
    await fetch(`${base}/result?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(reply) }).catch(() => {});
  }
}

export class TelegramBot {
  constructor({ getSettings, saveSettings, onCommand, log }) {
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.onCommand = onCommand;
    this.log = log;
    this.running = false;
    this.offset = 0;
    this.ctrl = null;
  }

  base() { const s = this.getSettings(); return `${s.tgApiBase || 'https://api.telegram.org'}/bot${s.tgToken}`; }

  async api(method, body) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${this.base()}/${method}`, { method: 'POST', headers: isForm ? undefined : { 'content-type': 'application/json' }, body: isForm ? body : JSON.stringify(body || {}) });
    const j = await res.json();
    if (!j.ok) throw new Error(j.description || `Telegram ${method} lỗi`);
    return j.result;
  }

  start() { if (!this.running) { this.running = true; this.loop(); } }
  stop() { this.running = false; this.ctrl?.abort(); setStatus('tg', { state: 'off' }); }

  async loop() {
    let me = null;
    while (this.running) {
      const s = this.getSettings();
      if (!s.tgEnabled || !s.tgToken) { me = null; await sleep(2000); continue; }
      try {
        if (!me) { me = await this.api('getMe'); await setStatus('tg', { state: 'running', bot: me.username, chatId: s.tgChatId }); }
        this.ctrl = new AbortController();
        const t = setTimeout(() => this.ctrl.abort(), 35000);
        const res = await fetch(`${this.base()}/getUpdates?timeout=25&offset=${this.offset}`, { signal: this.ctrl.signal });
        clearTimeout(t);
        const j = await res.json();
        if (!j.ok) throw new Error(j.description || 'getUpdates lỗi');
        for (const u of j.result) {
          this.offset = u.update_id + 1;
          const m = u.message;
          if (!m?.text) continue;
          await this.handleMessage(m);
        }
      } catch (e) {
        if (!this.running) break;
        me = null;
        await setStatus('tg', { state: 'error', error: e.message });
        await sleep(5000);
      }
    }
  }

  async handleMessage(m) {
    const s = this.getSettings();
    const chatId = String(m.chat.id);
    const [cmdRaw, ...rest] = m.text.trim().split(/\s+/);
    const cmd = cmdRaw.toLowerCase().replace(/@.*$/, '');
    if (!s.tgChatId) {
      if (cmd !== '/start') return;
      // Liên kết chat đầu tiên gửi /start.
      await this.saveSettings({ tgChatId: chatId });
      await setStatus('tg', { state: 'running', chatId });
      await this.send('✦ Đã liên kết AutoFlow với chat này. Gửi /help để xem lệnh.', chatId);
      this.log(`Telegram: liên kết chat ${chatId}`, 'ok');
      return;
    }
    if (chatId !== String(s.tgChatId)) return; // chỉ nhận lệnh từ chat đã liên kết
    const reply = await this.onCommand(cmd, rest.join(' '), chatId).catch((e) => `Lỗi: ${e.message}`);
    if (reply) await this.send(reply, chatId);
  }

  send(text, chatId = this.getSettings().tgChatId) {
    if (!chatId) return Promise.resolve();
    return this.api('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000) }).catch((e) => this.log(`Telegram: ${e.message}`, 'warn'));
  }

  async sendMedia(dataUrl, kind, caption, chatId = this.getSettings().tgChatId) {
    if (!chatId) return;
    const blob = await (await fetch(dataUrl)).blob();
    const fd = new FormData();
    fd.append('chat_id', chatId);
    if (caption) fd.append('caption', caption.slice(0, 1000));
    fd.append(kind === 'video' ? 'video' : 'photo', blob, kind === 'video' ? 'autoflow.mp4' : 'autoflow.png');
    await this.api(kind === 'video' ? 'sendVideo' : 'sendPhoto', fd).catch((e) => this.log(`Telegram: ${e.message}`, 'warn'));
  }
}

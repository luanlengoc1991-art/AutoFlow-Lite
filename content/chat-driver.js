// Điều khiển trang chat AI (ChatGPT, Gemini, Grok): nhập prompt, đính kèm ảnh, gửi, chờ trả lời xong,
// lấy văn bản và ảnh. Mỗi trang có danh sách selector dự phòng; cài đặt có thể ghi đè theo tên provider.
(function () {
  if (window.AFLChat) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const compact = (s) => String(s ?? '').replace(/[\s​-‍﻿]+/g, '');

  const PROVIDERS = {
    chatgpt: {
      hosts: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/,
      composer: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]', 'form textarea'],
      send: ['[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send" i]'],
      stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
      response: ['[data-message-author-role="assistant"]'],
      responseText: ['.markdown', '[data-message-author-role="assistant"]'],
      attach: ['button[aria-label*="Attach" i]', 'button[aria-label*="Add photos" i]', 'button[aria-label*="Upload" i]', '[data-testid="composer-plus-btn"]']
    },
    gemini: {
      hosts: /(^|\.)gemini\.google\.com$/,
      composer: ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
      send: ['button.send-button:not(.stop)', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi"]'],
      stop: ['button.send-button.stop', 'button[aria-label*="Stop" i]', 'button[aria-label*="Dừng"]'],
      response: ['model-response'],
      responseText: ['message-content .markdown', 'message-content', '.model-response-text'],
      attach: ['button[aria-label*="upload" i]', 'button[aria-label*="tải lên" i]', 'uploader button', 'button[aria-label*="Add files" i]']
    },
    grok: {
      hosts: /(^|\.)grok\.com$|(^|\.)x\.com$/,
      composer: ['textarea[aria-label]', 'div.tiptap.ProseMirror[contenteditable="true"]', 'form textarea', 'div[contenteditable="true"]'],
      send: ['button[type="submit"][aria-label]', 'form button[type="submit"]', 'button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]'],
      stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="Cancel" i]'],
      response: ['div.message-bubble', '[class*="message-bubble"]', '[data-testid="message"]'],
      responseText: ['.response-content-markdown', '.prose', '[class*="markdown"]'],
      attach: ['button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]']
    }
  };

  let provider = Object.keys(PROVIDERS).find((k) => PROVIDERS[k].hosts.test(location.hostname)) || 'chatgpt';
  let cfg = PROVIDERS[provider];
  function setOverrides(all) {
    const o = all?.[provider];
    cfg = { ...PROVIDERS[provider] };
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) if (Array.isArray(o[k]) && o[k].length) cfg[k] = [...o[k], ...(PROVIDERS[provider][k] || [])];
    }
  }
  // Cho phép test trỏ một trang bất kỳ tới cấu hình của provider.
  function setProvider(name) { if (PROVIDERS[name]) { provider = name; cfg = PROVIDERS[name]; } }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }
  function first(list, root = document) {
    for (const sel of list) {
      try {
        const el = [...root.querySelectorAll(sel)].find(visible);
        if (el) return el;
      } catch (_) { /* selector sai */ }
    }
    return null;
  }
  function all(list, root = document) {
    for (const sel of list) {
      try {
        const els = [...root.querySelectorAll(sel)];
        if (els.length) return els;
      } catch (_) { /* selector sai */ }
    }
    return [];
  }
  async function waitFor(fn, timeout = 5000, step = 150) {
    const t0 = Date.now();
    do { const v = fn(); if (v) return v; await sleep(step); } while (Date.now() - t0 < timeout);
    return null;
  }
  const isDisabled = (b) => !b || b.disabled || b.getAttribute('aria-disabled') === 'true';

  // ---------- Bridge (bẫy chọn file) ----------
  let seq = 0;
  function callBridge(op, payload = {}, timeout = 4000) {
    const id = `aflc-${Date.now()}-${++seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ ok: false, error: 'BRIDGE_TIMEOUT' }); }, timeout);
      function onMsg(e) {
        if (e.source !== window || e.data?.src !== 'afl-res' || e.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(e.data);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ src: 'afl-req', id, op, ...payload }, '*');
    });
  }

  // ---------- Ô nhập ----------
  const composer = () => first(cfg.composer);
  function composerText(el) {
    if (!el) return '';
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText || el.textContent || '';
  }

  async function setText(text) {
    const el = composer();
    if (!el) return { ok: false, error: 'Không tìm thấy ô nhập của trang chat' };
    const want = compact(text);
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return compact(el.value) === want ? { ok: true } : { ok: false, error: 'Không xác nhận được nội dung' };
    }
    // ProseMirror / Quill: xoá rồi dán (giữ xuống dòng), dự phòng execCommand.
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(250);
    if (compact(composerText(composer())) !== want) {
      composer()?.focus();
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
      await sleep(250);
    }
    return compact(composerText(composer())) === want ? { ok: true } : { ok: false, error: 'Không xác nhận được nội dung' };
  }

  // ---------- Đính kèm ảnh ----------
  function dataUrlToFile({ dataUrl, name, mime }) {
    const [head, b64] = dataUrl.split(',');
    const type = mime || /data:([^;]+)/.exec(head)?.[1] || 'image/png';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name || 'image.png', { type });
  }
  function setInputFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function formOf(el) { return el?.closest('form') || el?.parentElement?.parentElement?.parentElement || document.body; }
  const previewCount = () => [...formOf(composer()).querySelectorAll('img')].filter(visible).length;

  async function attach(refs) {
    if (!refs?.length) return { ok: true };
    const files = refs.map(dataUrlToFile);
    const before = previewCount();
    let input = [...document.querySelectorAll('input[type="file"]')].find((i) => !i.accept || /image|\*/.test(i.accept));
    if (!input) {
      const btn = first(cfg.attach);
      if (btn) {
        await callBridge('armFilePick', { ms: 6000 });
        btn.click();
        input = await waitFor(() => document.querySelector('input[type="file"][data-afl-picked]'), 2500);
        if (!input) {
          const item = [...document.querySelectorAll('[role="menuitem"], button')].filter(visible)
            .find((b) => /upload|tải lên|from computer|máy tính|files?/i.test(b.textContent || b.getAttribute('aria-label') || ''));
          if (item) { item.click(); input = await waitFor(() => document.querySelector('input[type="file"][data-afl-picked]'), 2500); }
        }
        await callBridge('disarmFilePick');
      }
    }
    if (input) {
      setInputFiles(input, input.multiple ? files : files.slice(0, 1));
    } else {
      const target = composer() || document.body;
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    }
    const ok = await waitFor(() => previewCount() >= before + (input && !input.multiple ? 1 : files.length), 30000, 300);
    // Chờ upload xong: nút gửi bật lại.
    await waitFor(() => { const b = first(cfg.send); return b && !isDisabled(b); }, 30000, 300);
    return ok ? { ok: true } : { ok: false, error: 'Không xác nhận được ảnh đính kèm' };
  }

  // ---------- Câu trả lời ----------
  const responses = () => all(cfg.response);
  // Giữ xuống dòng (danh sách prompt mỗi dòng một prompt), chỉ gộp khoảng trắng trong dòng.
  function responseText(el) {
    const inner = first(cfg.responseText, el) || el;
    return String(inner.innerText || inner.textContent || '').replace(/[​-‍﻿]/g, '')
      .split('\n').map((l) => l.replace(/[ \t ]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function responseImages(el) {
    return [...el.querySelectorAll('img')].filter((img) => {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:image/svg')) return false;
      const big = Math.max(img.naturalWidth, img.naturalHeight) >= 256 || img.getBoundingClientRect().width >= 150;
      return big && img.complete && visible(img);
    }).map((img) => img.currentSrc || img.src);
  }

  function classify(text) {
    const t = String(text || '').toLowerCase();
    if (/captcha|verify you are human|unusual activity/.test(t)) return 'captcha';
    if (/usage (cap|limit)|reached (the|your) (limit|maximum)|limit reached|out of (credits|messages)|try again (after|in) \d|hết lượt|upgrade to/.test(t)) return 'quota';
    if (/too many requests|rate limit|slow down/.test(t)) return 'rate_limit';
    if (/content polic|violat|can't (help|create|generate)|cannot (help|create|generate)|unable to (create|generate)|not able to (create|generate)|safety|không thể tạo/.test(t)) return 'policy';
    return null;
  }

  const jobs = new Map();
  let jobSeq = 0;

  async function submitTask(task) {
    const c = await waitFor(composer, 15000, 300);
    if (!c) return { ok: false, error: 'Không tìm thấy ô nhập của trang chat (đã đăng nhập chưa?)', category: 'setup' };
    if (task.refs?.length) {
      const a = await attach(task.refs);
      if (!a.ok) return { ok: false, error: a.error, category: 'error' };
    }
    const s = await setText(task.prompt);
    if (!s.ok) return { ok: false, error: s.error, category: 'error' };
    const token = `chat-${Date.now()}-${++jobSeq}`;
    jobs.set(token, {
      token, before: new Set(responses()), prompt: compact(task.prompt), wantImage: task.chatMode === 'image',
      startedAt: Date.now(), sig: '', lastChange: Date.now()
    });
    const btn = await waitFor(() => { const b = first(cfg.send); return b && !isDisabled(b) ? b : null; }, 15000, 200);
    if (btn) btn.click();
    const accepted = await waitFor(() => compact(composerText(composer())) === '' || first(cfg.stop), 4000, 150);
    if (!accepted) {
      const el = composer();
      el?.focus();
      el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      if (!(await waitFor(() => compact(composerText(composer())) === '' || first(cfg.stop), 4000, 150))) {
        jobs.delete(token);
        return { ok: false, error: 'Không gửi được tin nhắn', category: 'error' };
      }
    }
    return { ok: true, token };
  }

  function latestResponse(job) {
    const fresh = responses().filter((el) => !job.before.has(el) && compact(el.innerText || el.textContent) !== job.prompt);
    return fresh[fresh.length - 1] || null;
  }

  function pollJob(token) {
    const job = jobs.get(token);
    if (!job) return { status: 'lost' };
    const now = Date.now();
    const el = latestResponse(job);
    const streaming = !!first(cfg.stop);
    const text = el ? responseText(el) : '';
    const images = el ? responseImages(el) : [];
    const sig = `${text.length}|${images.join(',')}`;
    if (sig !== job.sig) { job.sig = sig; job.lastChange = now; }
    const stable = now - job.lastChange;
    const results = images.map((url) => ({ url, kind: 'image' }));
    const base = { progress: null, results, text };

    if (!el) return { status: now - job.startedAt > 90000 ? 'failed' : 'running', ...base, error: 'Trang chat không trả lời', category: 'error' };
    if (streaming) return { status: 'running', ...base };
    if (job.wantImage) {
      if (images.length && stable >= 5000) return { status: 'done', ...base };
      // Lời từ chối / hết lượt rõ ràng: báo ngay, không chờ ảnh.
      const quick = !images.length && text && stable >= 4000 ? classify(text) : null;
      if (quick) return { status: 'failed', ...base, error: text.slice(0, 300), category: quick };
      // Đang "Creating image": chưa có ảnh, văn bản ngắn; chờ tối đa 60s sau khi ngừng thay đổi.
      if (!images.length && text && stable >= 60000) {
        const cat = classify(text);
        return { status: 'failed', ...base, error: text.slice(0, 300), category: cat || 'error' };
      }
      return { status: 'running', ...base };
    }
    if (text && stable >= 3000) {
      const cat = classify(text);
      if (cat === 'quota' || cat === 'captcha') return { status: 'failed', ...base, error: text.slice(0, 300), category: cat };
      return { status: 'done', ...base };
    }
    return { status: 'running', ...base };
  }

  function thumbOf(url) {
    const img = [...document.querySelectorAll('img')].find((i) => (i.currentSrc || i.src) === url);
    if (!img || !img.naturalWidth) return '';
    try {
      const scale = 200 / Math.max(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (_) { return ''; } // ảnh khác origin làm "bẩn" canvas
  }

  function finalizeJob(token, results) {
    jobs.delete(token);
    return (results || []).map((r) => ({ ...r, thumb: thumbOf(r.url) }));
  }

  async function fetchMedia(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
    return { dataUrl, mime: blob.type, size: blob.size };
  }

  function diagnose() {
    const describe = (el) => ({ tag: el.tagName.toLowerCase(), id: el.id, testid: el.getAttribute('data-testid'), aria: el.getAttribute('aria-label'), cls: String(el.className || '').slice(0, 80), text: norm(el.textContent).slice(0, 60) });
    return {
      url: location.href, provider, at: new Date().toISOString(),
      found: { composer: !!composer(), send: !!first(cfg.send), stop: !!first(cfg.stop), responses: responses().length },
      buttons: [...document.querySelectorAll('button')].filter(visible).slice(-60).map(describe),
      editables: [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible).map(describe)
    };
  }

  // Trạng thái tài khoản: đã đăng nhập chưa + tên/email nếu giao diện có hiển thị.
  function account() {
    const btns = [...document.querySelectorAll('button, a')].filter(visible);
    const loginBtn = btns.find((b) => /^(log in|sign in|sign up|đăng nhập|đăng ký)$/i.test(norm(b.textContent)));
    let label = '';
    const prof = document.querySelector('[data-testid="accounts-profile-button"], [aria-label*="Google Account" i], [aria-label*="Tài khoản Google" i], button[aria-label*="profile" i]');
    if (prof) {
      const aria = prof.getAttribute('aria-label') || '';
      const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(aria)?.[0];
      label = email || norm(prof.textContent).slice(0, 40) || aria.replace(/^(Google Account|Tài khoản Google)[:：]?\s*/i, '').slice(0, 60);
    }
    const ready = !!composer() && !loginBtn;
    return { provider, ready, loggedIn: !loginBtn, label };
  }

  window.AFLChat = {
    account,
    get provider() { return provider; }, setProvider, setOverrides, composer, setText, attach, submitTask, pollJob, finalizeJob, fetchMedia, diagnose,
    ready: () => !!composer()
  };
})();

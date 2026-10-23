// Điều khiển trang chat AI (ChatGPT, Gemini, Grok, Claude): nhập prompt, đính kèm ảnh, gửi, chờ trả lời xong,
// lấy văn bản và ảnh. Mỗi trang có danh sách selector dự phòng; cài đặt có thể ghi đè theo tên provider.
(function () {
  if (window.AFLChat) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const compact = (s) => String(s ?? '').replace(/[\s​-‍﻿]+/g, '');

  const PROVIDERS = {
    chatgpt: {
      hosts: /(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$/,
      // Giao diện 2026 ("octane"): textarea#mobile-composer-prompt, câu trả lời li[data-message-role="assistant"].
      // Selector của giao diện cũ giữ lại làm dự phòng.
      composer: ['#mobile-composer-prompt', 'textarea[aria-label*="ChatGPT" i]', '#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[name="prompt-textarea"]', 'form textarea'],
      // Nhãn nút theo ngôn ngữ giao diện (tiếng Anh / tiếng Việt: "Gửi lời nhắc", "Ngừng").
      send: ['button[aria-label="Send message"]', '[data-testid="send-button"]', '#composer-submit-button', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi"]'],
      stop: ['button[aria-label*="Stop" i]', '[data-testid="stop-button"]', 'button[aria-label="Ngừng"]', 'button[aria-label*="Ngừng tạo"]', 'button[aria-label*="Dừng"]'],
      // Cả lượt trả lời (ảnh tạo ra có thể nằm ngoài khối văn bản của câu trả lời). Chỉ dựa vào thuộc tính
      // vì thẻ HTML khác nhau giữa bản đăng nhập và chưa đăng nhập.
      response: ['[data-message-role="assistant"]', '[data-turn="assistant"]', '[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"])', '[data-message-author-role="assistant"]'],
      responseText: ['[data-assistant-markdown-root]', '.markdown', '[data-message-author-role="assistant"]'],
      attach: ['button[aria-label*="Attach" i]', 'button[aria-label*="Add photos" i]', 'button[aria-label*="Upload" i]', '[data-testid="composer-plus-btn"]'],
      modelPicker: ['[data-testid="model-switcher-dropdown-button"]', 'button[aria-label*="Model selector" i]', 'button[aria-label*="model" i][aria-haspopup]'],
      convMenu: ['[data-testid="conversation-options-button"]', 'button[aria-label*="Open conversation options" i]'],
      deleteConfirm: ['[data-testid="delete-conversation-confirm-button"]']
    },
    gemini: {
      hosts: /(^|\.)gemini\.google\.com$/,
      composer: ['rich-textarea .ql-editor[contenteditable="true"]', '.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
      send: ['button.send-button:not(.stop)', 'button[aria-label*="Send" i]', 'button[aria-label*="Gửi"]'],
      stop: ['button.send-button.stop', 'button[aria-label*="Stop" i]', 'button[aria-label*="Dừng"]'],
      response: ['model-response'],
      responseText: ['message-content .markdown', 'message-content', '.model-response-text'],
      attach: ['button[aria-label*="upload" i]', 'button[aria-label*="tải lên" i]', 'uploader button', 'button[aria-label*="Add files" i]'],
      modelPicker: ['[data-test-id="bard-mode-menu-button"]', 'bard-mode-switcher button', 'button[aria-label*="mode picker" i]', 'button[aria-label*="model" i][aria-haspopup]'],
      convMenu: ['.conversation.selected [data-test-id="actions-menu-button"]', '[data-test-id="conversation-actions-button"]', 'button[aria-label*="conversation actions" i]'],
      deleteConfirm: ['button[data-test-id="confirm-button"]', 'mat-dialog-actions button.confirm-button']
    },
    grok: {
      hosts: /(^|\.)grok\.com$|(^|\.)x\.com$/,
      composer: ['textarea[aria-label]', 'div.tiptap.ProseMirror[contenteditable="true"]', 'form textarea', 'div[contenteditable="true"]'],
      send: ['button[type="submit"][aria-label]', 'form button[type="submit"]', 'button[aria-label*="Submit" i]', 'button[aria-label*="Send" i]'],
      stop: ['button[aria-label*="Stop" i]', 'button[aria-label*="Cancel" i]'],
      response: ['div.message-bubble', '[class*="message-bubble"]', '[data-testid="message"]'],
      responseText: ['.response-content-markdown', '.prose', '[class*="markdown"]'],
      attach: ['button[aria-label*="Attach" i]', 'button[aria-label*="Upload" i]'],
      modelPicker: ['#model-select-trigger', 'button[aria-label*="Model select" i]', 'button[aria-label*="model" i][aria-haspopup]'],
      convMenu: [],
      deleteConfirm: []
    },
    claude: {
      hosts: /(^|\.)claude\.ai$/,
      composer: ['[data-testid="chat-input"] div.ProseMirror[contenteditable="true"]', 'div.ProseMirror[contenteditable="true"]', 'fieldset div[contenteditable="true"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]', 'fieldset button[type="submit"]'],
      // Câu trả lời đang được viết có data-is-streaming="true".
      stop: ['button[aria-label*="Stop" i]', '[data-is-streaming="true"]'],
      response: ['[data-is-streaming]', 'div.font-claude-response', '[data-testid="assistant-message"]'],
      responseText: ['.standard-markdown', '.font-claude-response', '.prose'],
      attach: ['button[aria-label*="Add files" i]', 'button[aria-label*="Attach" i]', '[data-testid="input-menu-plus"]', 'button[aria-label*="Upload" i]'],
      modelPicker: ['[data-testid="model-selector-dropdown"]', 'button[aria-label*="model" i][aria-haspopup]'],
      convMenu: ['[data-testid="chat-menu-trigger"]', 'button[aria-label*="conversation options" i]'],
      deleteConfirm: ['[data-testid="delete-modal-confirm"]', '[role="dialog"] button.bg-danger-200']
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
  function responseVideos(el) {
    return [...el.querySelectorAll('video')].map((v) => v.currentSrc || v.src || v.querySelector('source')?.src || '').filter((u) => u && !u.startsWith('blob:'));
  }
  function responseImages(el) {
    return [...el.querySelectorAll('img')].filter((img) => {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:image/svg')) return false;
      const big = Math.max(img.naturalWidth, img.naturalHeight) >= 256 || img.getBoundingClientRect().width >= 150;
      return big && img.complete && visible(img);
    }).map((img) => img.currentSrc || img.src);
  }
  // Ảnh lớn trong khung hội thoại (bỏ thanh bên, ô nhập, avatar). Dùng để nhận ảnh mới xuất hiện
  // sau khi gửi khi trang đặt ảnh ngoài phần tử câu trả lời.
  function pageImages() {
    return responseImages(document).filter((src) => {
      const img = [...document.querySelectorAll('img')].find((i) => (i.currentSrc || i.src) === src);
      // Thanh bên ChatGPT (GPT đã ghim, dự án) không nằm trong nav/aside.
      return img && !img.closest('nav, aside, header, form, [role="dialog"], [data-message-role="user"], [data-message-author-role="user"], [data-turn="user"], [data-app-action-sidebar-section], [data-sidebar-project-container-id], [data-sidebar-cycle-item]')
        && Math.max(img.naturalWidth, img.naturalHeight) >= 256;
    });
  }

  function classify(text) {
    const t = String(text || '').toLowerCase();
    if (/captcha|verify you are human|unusual activity/.test(t)) return 'captcha';
    if (/usage (cap|limit)|reached (the|your) (limit|maximum)|limit reached|out of (credits|messages)|try again (after|in) \d|hết lượt|upgrade to/.test(t)) return 'quota';
    if (/too many requests|rate limit|slow down/.test(t)) return 'rate_limit';
    if (/content polic|violat|can't (help|create|generate)|cannot (help|create|generate)|unable to (create|generate)|not able to (create|generate)|safety|không thể tạo/.test(t)) return 'policy';
    return null;
  }

  // Chọn model qua menu của trang (best effort): không chọn được thì giữ model hiện tại và cảnh báo.
  async function selectModel(model) {
    if (!model) return null;
    const re = new RegExp(model.match, model.flags || 'i');
    const picker = first(cfg.modelPicker || []);
    if (!picker) return `Không thấy nút chọn model, giữ model hiện tại (muốn: ${model.label})`;
    if (re.test(norm(picker.textContent || picker.getAttribute('aria-label')))) return null;
    picker.click();
    const items = () => [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]')].filter(visible);
    const item = await waitFor(() => items().find((el) => re.test(norm(el.textContent))), 2500);
    if (!item) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return `Không thấy model "${model.label}" trong menu, giữ model hiện tại`;
    }
    item.click();
    await sleep(400);
    return null;
  }

  // Xoá cuộc trò chuyện vừa tạo. Chỉ xoá khi trang vẫn ở đúng cuộc trò chuyện đó.
  async function deleteChat(conv) {
    if (!conv || location.pathname !== conv || !/\/(c|uc|app|chat)\/[\w-]+/.test(conv)) return { ok: false, error: 'Trang không còn ở cuộc trò chuyện vừa tạo' };
    const menu = first(cfg.convMenu || []);
    if (!menu) return { ok: false, error: 'Không thấy menu cuộc trò chuyện' };
    menu.click();
    const del = await waitFor(() => [...document.querySelectorAll('[role="menuitem"], button')].filter(visible).find((el) => /^(delete|xoá|xóa)\b/i.test(norm(el.textContent))), 2500);
    if (!del) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return { ok: false, error: 'Không thấy mục Xoá' }; }
    del.click();
    const ok = await waitFor(() => first(cfg.deleteConfirm || []) || [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].filter(visible).find((b) => /^(delete|xoá|xóa)$/i.test(norm(b.textContent))), 3000);
    if (!ok) return { ok: false, error: 'Không thấy nút xác nhận xoá' };
    ok.click();
    await waitFor(() => location.pathname !== conv, 5000);
    return { ok: true };
  }

  const jobs = new Map();
  let jobSeq = 0;
  const IMAGE_WAIT_MS = 240000;

  async function submitTask(task) {
    const c = await waitFor(composer, 15000, 300);
    if (!c) return { ok: false, error: 'Không tìm thấy ô nhập của trang chat (đã đăng nhập chưa?)', category: 'setup' };
    const warnings = [];
    const mw = await selectModel(task.model);
    if (mw) warnings.push(mw);
    if (task.refs?.length) {
      const a = await attach(task.refs);
      if (!a.ok) return { ok: false, error: a.error, category: 'error' };
    }
    const s = await setText(task.prompt);
    if (!s.ok) return { ok: false, error: s.error, category: 'error' };
    const token = `chat-${Date.now()}-${++jobSeq}`;
    jobs.set(token, {
      token, before: new Set(responses()), prompt: compact(task.prompt), wantImage: task.chatMode !== 'text', wantVideo: !!task.wantVideo,
      startedAt: Date.now(), sig: '', lastChange: Date.now(), beforeImgs: new Set(task.chatMode !== 'text' ? pageImages() : [])
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
    return { ok: true, token, warnings };
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
    const videos = el ? responseVideos(el) : [];
    let images = el ? (job.wantVideo && videos.length ? [] : responseImages(el)) : [];
    // Dự phòng: ảnh mới xuất hiện trong khung hội thoại kể từ lúc gửi (ảnh nằm ngoài phần tử câu trả lời).
    if (job.wantImage && !images.length && !(job.wantVideo && videos.length)) images = pageImages().filter((src) => !job.beforeImgs.has(src));
    const sig = `${text.length}|${images.join(',')}|${videos.join(',')}`;
    if (sig !== job.sig) { job.sig = sig; job.lastChange = now; }
    const stable = now - job.lastChange;
    const results = [...videos.map((url) => ({ url, kind: 'video' })), ...images.map((url) => ({ url, kind: 'image' }))];
    const base = { progress: null, results, text };

    if (!el && !results.length) {
      // Chưa nhận ra khung trả lời: trang vẫn đang trả lời (nút Dừng) hoặc đang vẽ ảnh thì chờ tiếp,
      // tránh báo lỗi rồi thử lại bằng cuộc trò chuyện mới trong khi câu trả lời cũ vẫn đang chạy.
      const limit = job.wantImage ? IMAGE_WAIT_MS : 90000;
      const failed = !streaming && now - job.startedAt > limit;
      return { status: failed ? 'failed' : 'running', ...base, error: 'Trang chat không trả lời', category: 'error' };
    }
    // Nút "Dừng" có thể còn hiện (hoặc selector khớp nhầm) dù ảnh đã xong: ảnh đứng yên 20s thì nhận.
    if (streaming && !(job.wantImage && results.length && stable >= 20000)) return { status: 'running', ...base };
    if (job.wantImage) {
      // Chờ video thì ảnh xem trước chưa phải kết quả cuối (trừ khi đứng yên 60s).
      if (results.length && stable >= 5000 && (!job.wantVideo || videos.length || stable >= 60000)) return { status: 'done', ...base };
      // Lời từ chối / hết lượt rõ ràng: báo ngay, không chờ ảnh.
      const quick = !results.length && text && stable >= 4000 ? classify(text) : null;
      if (quick) return { status: 'failed', ...base, error: text.slice(0, 300), category: quick };
      // Đang "Creating image": chưa có ảnh, văn bản ngắn. ChatGPT vẽ ảnh mất 1–3 phút và có thể
      // không hiện nút Dừng, nên chờ tối đa 4 phút sau khi chữ ngừng thay đổi (báo lỗi sớm sẽ khiến
      // hàng đợi thử lại bằng cuộc trò chuyện mới trong khi ảnh cũ vẫn đang được vẽ).
      if (!results.length && text && stable >= IMAGE_WAIT_MS) {
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
    return (results || []).map((r) => ({ ...r, thumb: r.kind === 'image' ? thumbOf(r.url) : '' }));
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
      found: { composer: !!composer(), send: !!first(cfg.send), stop: !!first(cfg.stop), responses: responses().length, pageImages: pageImages().length },
      matched: Object.fromEntries(['composer', 'send', 'stop'].map((k) => [k, first(cfg[k]) ? describe(first(cfg[k])) : null])),
      buttons: [...document.querySelectorAll('button')].filter(visible).slice(-60).map(describe),
      editables: [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible).map(describe),
      // Cấu trúc câu trả lời: chuỗi phần tử cha của ảnh lớn và của câu trả lời cuối (để chỉnh selector).
      images: [...document.querySelectorAll('img')].filter((i) => visible(i) && Math.max(i.naturalWidth, i.naturalHeight) >= 256).slice(-3).map((img) => ({ src: (img.currentSrc || img.src).slice(0, 120), alt: img.alt, ancestors: ancestors(img) })),
      lastResponse: (() => { const el = responses().at(-1); return el ? { ...describe(el), text: responseText(el).slice(0, 200), ancestors: ancestors(el) } : null; })(),
      thread: skeleton()
    };
  }
  // Khung xương vùng hội thoại: phần tử có thuộc tính data-* / role, và ảnh, kèm độ sâu (không gồm thanh bên, ô nhập).
  function skeleton() {
    const root = composer()?.closest('main') || document.querySelector('main') || document.body;
    const out = [];
    const walk = (el, depth) => {
      if (out.length >= 300 || depth > 22 || el.matches('form, nav, aside, script, style, svg')) return;
      const attrs = [...el.attributes].filter((a) => a.name.startsWith('data-') || ['role', 'aria-label', 'id'].includes(a.name));
      if (attrs.length || el.tagName === 'IMG' || /^(ARTICLE|SECTION|LI|OL|UL|CANVAS|VIDEO)$/.test(el.tagName)) {
        const leaf = !el.children.length;
        out.push(`${'  '.repeat(Math.min(depth, 12))}${el.tagName.toLowerCase()}${attrs.map((a) => `[${a.name}${a.value ? `="${a.value.slice(0, 30)}"` : ''}]`).join('')}`
          + (el.tagName === 'IMG' ? ` {${el.naturalWidth}x${el.naturalHeight} ${String(el.currentSrc || el.src).slice(0, 60)}}` : leaf ? ` "${norm(el.textContent).slice(0, 40)}"` : ''));
      }
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(root, 0);
    return out;
  }
  function ancestors(el) {
    const out = [];
    for (let p = el.parentElement, i = 0; p && i < 10; p = p.parentElement, i++) {
      out.push(`${p.tagName.toLowerCase()}${[...p.attributes].filter((a) => !['class', 'style'].includes(a.name)).map((a) => `[${a.name}${a.value ? `="${a.value.slice(0, 30)}"` : ''}]`).join('')}`);
    }
    return out;
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
    get provider() { return provider; }, setProvider, setOverrides, composer, setText, selectModel, deleteChat, attach, submitTask, pollJob, finalizeJob, fetchMedia, diagnose,
    ready: () => !!composer()
  };
})();

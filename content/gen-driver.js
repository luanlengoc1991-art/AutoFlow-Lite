// Điều khiển trang tạo ảnh/video Seedance trên Dreamina (CapCut): chọn model, tỉ lệ, thời lượng,
// tải khung đầu/cuối, nhập prompt, bấm Generate, chờ kết quả mới xuất hiện.
// Cùng giao diện với AFLChat để chat-main.js và bộ chạy hàng đợi dùng chung.
// Selector có thể ghi đè trong Cài đặt → Selector tuỳ chỉnh với khoá "seedance".
(function () {
  if (window.AFLChat) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/[​-‍﻿]/g, '').replace(/\s+/g, ' ').trim();
  const compact = (s) => String(s ?? '').replace(/[\s​-‍﻿]+/g, '');

  const BASE = {
    composer: ['textarea[class*="prompt" i]', 'div[class*="prompt" i] textarea', 'textarea[placeholder]', 'div[contenteditable="true"][class*="prompt" i]', 'div[contenteditable="true"]'],
    submit: ['button[class*="submit" i]', 'button[class*="generate" i]', '[class*="submit-button" i]', 'button[type="submit"]'],
    modelPicker: ['[class*="model-select" i]', '[class*="model" i][role="combobox"]', 'button[class*="model" i]', '[class*="select-model" i]'],
    results: ['[class*="record-list" i]', '[class*="history" i]', '[class*="result" i]', 'main'],
    toasts: ['[role="alert"]', '[class*="toast" i]', '[class*="message-content" i]', '[class*="error" i]'],
    login: ['[class*="login" i] button', 'button[class*="sign-in" i]']
  };
  const provider = 'seedance';
  let cfg = BASE;
  function setOverrides(all) {
    const o = all?.[provider];
    cfg = { ...BASE };
    if (o && typeof o === 'object') for (const k of Object.keys(o)) if (Array.isArray(o[k]) && o[k].length) cfg[k] = [...o[k], ...(BASE[k] || [])];
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }
  function first(list, root = document) {
    for (const sel of list) {
      try { const el = [...root.querySelectorAll(sel)].find(visible); if (el) return el; } catch (_) { /* selector sai */ }
    }
    return null;
  }
  async function waitFor(fn, timeout = 5000, step = 200) {
    const t0 = Date.now();
    do { const v = fn(); if (v) return v; await sleep(step); } while (Date.now() - t0 < timeout);
    return null;
  }
  const isDisabled = (b) => !b || b.disabled || b.getAttribute('aria-disabled') === 'true' || /disabled/i.test(b.className || '');
  // Phần tử nhỏ nhất có đúng chữ cần tìm (vd. "9:16", "5s", "Seedance 2.0").
  function byText(re, root = document) {
    const els = [...root.querySelectorAll('button, [role="button"], [role="option"], [role="menuitem"], [role="radio"], li, span, div')]
      .filter((el) => visible(el) && re.test(norm(el.textContent)) && norm(el.textContent).length < 40);
    return els.sort((a, b) => a.textContent.length - b.textContent.length)[0] || null;
  }

  // ---------- Ô nhập ----------
  const composer = () => first(cfg.composer);
  const composerText = (el) => (!el ? '' : el.tagName === 'TEXTAREA' ? el.value : el.innerText || '');
  async function setText(text) {
    const el = composer();
    if (!el) return { ok: false, error: 'Không tìm thấy ô nhập prompt của Dreamina' };
    el.focus();
    if (el.tagName === 'TEXTAREA') {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    }
    await sleep(200);
    return compact(composerText(composer())) === compact(text) ? { ok: true } : { ok: false, error: 'Không xác nhận được prompt' };
  }

  // ---------- Khung đầu / cuối, ảnh tham chiếu ----------
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
  async function attach(refs) {
    if (!refs?.length) return { ok: true };
    const files = refs.map(dataUrlToFile);
    const inputs = () => [...document.querySelectorAll('input[type="file"]')].filter((i) => !i.accept || /image|\*/.test(i.accept));
    const list = inputs();
    if (!list.length) return { ok: false, error: 'Không thấy ô tải ảnh khung đầu trên Dreamina' };
    // Một ô nhận nhiều ảnh: gửi hết; nếu có 2 ô (khung đầu / khung cuối): mỗi ô một ảnh.
    if (list[0].multiple) setInputFiles(list[0], files);
    else {
      setInputFiles(list[0], [files[0]]);
      if (files[1]) {
        const second = await waitFor(() => inputs().find((i) => i !== list[0]), 4000);
        if (second) setInputFiles(second, [files[1]]);
      }
    }
    // Chờ ảnh xem trước hiện ra và upload xong (nút Generate bật lại).
    await sleep(1500);
    await waitFor(() => { const b = first(cfg.submit); return b && !isDisabled(b); }, 30000, 400);
    return { ok: true };
  }

  // ---------- Tuỳ chọn ----------
  async function pickOption(label, re, pickerList) {
    if (!label) return null;
    const already = byText(new RegExp(`^${re.source}$`, re.flags));
    if (already && /active|selected|checked/i.test(`${already.className} ${already.getAttribute('aria-selected')} ${already.getAttribute('aria-checked')}`)) return null;
    const picker = pickerList ? first(pickerList) : null;
    if (picker) { picker.click(); await sleep(400); }
    const item = await waitFor(() => byText(new RegExp(`^${re.source}$`, re.flags)), 2500);
    if (!item) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return `Không chọn được "${label}" trên Dreamina, giữ lựa chọn hiện tại`;
    }
    item.click();
    await sleep(300);
    return null;
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------- Kết quả ----------
  const resultRoot = () => first(cfg.results) || document.body;
  function mediaUrls(wantVideo) {
    const root = resultRoot();
    const videos = [...root.querySelectorAll('video')].map((v) => v.currentSrc || v.src || v.querySelector('source')?.src || '').filter((u) => u && !u.startsWith('blob:'));
    if (wantVideo) return videos.map((url) => ({ url, kind: 'video' }));
    const imgs = [...root.querySelectorAll('img')].filter((img) => {
      const src = img.currentSrc || img.src || '';
      return src && !src.startsWith('data:image/svg') && img.complete && Math.max(img.naturalWidth, img.naturalHeight) >= 256 && visible(img);
    }).map((img) => ({ url: img.currentSrc || img.src, kind: 'image' }));
    return imgs;
  }
  function progressText() {
    const m = /(\d{1,3})\s?%/.exec(norm(resultRoot().innerText || '').slice(0, 4000));
    return m ? Math.min(99, +m[1]) : null;
  }
  function classify(text) {
    const t = String(text || '').toLowerCase();
    if (/captcha|verify/.test(t)) return 'captcha';
    if (/insufficient credit|not enough credit|out of credit|credits? (are )?not enough|không đủ (credit|điểm)|hết (credit|lượt)|积分不足/.test(t)) return 'quota';
    if (/too many|rate limit|busy|queue is full/.test(t)) return 'rate_limit';
    if (/violat|policy|sensitive|not allowed|vi phạm|违规/.test(t)) return 'policy';
    if (/fail|error|lỗi|失败/.test(t)) return 'error';
    return null;
  }
  const toastText = () => norm([...document.querySelectorAll(cfg.toasts.join(','))].filter(visible).map((e) => e.textContent).join(' ')).slice(0, 300);

  const jobs = new Map();
  let jobSeq = 0;

  async function submitTask(task) {
    const c = await waitFor(composer, 15000, 300);
    if (!c) return { ok: false, error: 'Không thấy ô nhập prompt của Dreamina (đã đăng nhập và mở trang AI Video chưa?)', category: 'setup' };
    const warnings = [];
    const wantVideo = task.genType !== 'image';
    if (task.model) { const w = await pickOption(task.model, new RegExp(escRe(task.model), 'i'), cfg.modelPicker); if (w) warnings.push(w); }
    if (task.ratio) { const w = await pickOption(task.ratio, new RegExp(escRe(task.ratio)), null); if (w) warnings.push(w); }
    if (wantVideo && task.duration) { const w = await pickOption(task.duration, new RegExp(escRe(task.duration), 'i'), null); if (w) warnings.push(w); }
    if (task.refs?.length) {
      const a = await attach(task.refs);
      if (!a.ok) return { ok: false, error: a.error, category: 'error' };
    }
    const s = await setText(task.prompt);
    if (!s.ok) return { ok: false, error: s.error, category: 'error' };
    const token = `gen-${Date.now()}-${++jobSeq}`;
    const before = new Set(mediaUrls(wantVideo).map((r) => r.url));
    const btn = await waitFor(() => { const b = first(cfg.submit) || byText(/^(generate|tạo|生成)$/i); return b && !isDisabled(b) ? b : null; }, 15000, 300);
    if (!btn) return { ok: false, error: toastText() || 'Nút Generate đang tắt (hết credit hoặc thiếu prompt?)', category: classify(toastText()) || 'error' };
    btn.click();
    await sleep(1500);
    const err = toastText();
    const cat = classify(err);
    if (cat && cat !== 'error') return { ok: false, error: err, category: cat };
    jobs.set(token, { token, before, wantVideo, startedAt: Date.now(), sig: '', lastChange: Date.now() });
    return { ok: true, token, warnings };
  }

  function pollJob(token) {
    const job = jobs.get(token);
    if (!job) return { status: 'lost' };
    const fresh = mediaUrls(job.wantVideo).filter((r) => !job.before.has(r.url));
    const sig = fresh.map((r) => r.url).join(',');
    const now = Date.now();
    if (sig !== job.sig) { job.sig = sig; job.lastChange = now; }
    const progress = progressText();
    // Đợi danh sách kết quả mới đứng yên 4 giây (Dreamina thường trả 1–4 kết quả mỗi lượt).
    if (fresh.length && now - job.lastChange >= 4000) return { status: 'done', results: fresh, progress: 100 };
    const t = toastText();
    const cat = classify(t);
    if (cat && cat !== 'error' && now - job.startedAt > 3000) return { status: 'failed', error: t, category: cat, results: [] };
    return { status: 'running', progress, results: [] };
  }

  function thumbOf(url) {
    const img = [...document.querySelectorAll('img')].find((i) => (i.currentSrc || i.src) === url);
    const vid = img ? null : [...document.querySelectorAll('video')].find((v) => (v.currentSrc || v.src) === url);
    const el = img || vid;
    const w = img ? img.naturalWidth : vid?.videoWidth, h = img ? img.naturalHeight : vid?.videoHeight;
    if (!el || !w) return '';
    try {
      const scale = 240 / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (_) { return ''; } // media khác origin làm "bẩn" canvas
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

  function account() {
    const loginBtn = first(cfg.login) || [...document.querySelectorAll('button, a')].filter(visible).find((b) => /^(log in|sign in|đăng nhập)$/i.test(norm(b.textContent)));
    const credits = /(\d[\d,.]*)\s*(credits?|điểm)/i.exec(norm(document.querySelector('header')?.innerText || ''))?.[0] || '';
    return { provider, ready: !!composer() && !loginBtn, loggedIn: !loginBtn, label: credits, plan: credits };
  }

  function diagnose() {
    const describe = (el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80), aria: el.getAttribute('aria-label'), text: norm(el.textContent).slice(0, 60) });
    return {
      url: location.href, provider, at: new Date().toISOString(),
      found: { composer: !!composer(), submit: !!first(cfg.submit), fileInputs: document.querySelectorAll('input[type="file"]').length, videos: mediaUrls(true).length },
      buttons: [...document.querySelectorAll('button')].filter(visible).slice(-60).map(describe),
      editables: [...document.querySelectorAll('textarea, [contenteditable="true"]')].filter(visible).map(describe)
    };
  }

  window.AFLChat = {
    account, provider, setOverrides, composer, setText, attach, submitTask, pollJob, finalizeJob, fetchMedia, diagnose,
    deleteChat: async () => ({ ok: false, error: 'Dreamina không có cuộc trò chuyện' }),
    ready: () => !!composer()
  };
})();

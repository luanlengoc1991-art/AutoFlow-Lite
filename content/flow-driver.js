// Điều khiển giao diện Google Flow qua DOM (isolated world).
// Flow dùng icon Google Symbols (chữ ligature trong <i>), Radix Tabs/Popover (id "...-trigger-VALUE",
// aria-selected / data-state) và phục vụ media cùng origin qua /asb/<mediaId>.
(function () {
  if (window.AFLDriver) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s ?? '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  const lower = (s) => norm(s).toLowerCase();
  const compact = (s) => String(s ?? "").replace(/[\s\u200B-\u200D\uFEFF]+/g, "");
  const stripLead = (s) => lower(s).normalize('NFKC').replace(/^[^\p{L}\p{N}]+/u, '');

  let overrides = {};
  function setOverrides(o) { overrides = o && typeof o === 'object' ? o : {}; }
  function fromOverride(key, root = document) {
    for (const sel of overrides[key] || []) {
      try {
        const el = [...root.querySelectorAll(sel)].find(visible);
        if (el) return el;
      } catch (_) { /* selector sai: bỏ qua */ }
    }
    return null;
  }

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity || '1') > 0.05;
  }

  // ---------- Icon (Google Symbols ligature) ----------
  const ICON_SEL = 'i, mat-icon, .material-icons, .material-symbols-outlined, .material-symbols-rounded, .google-symbols, [class*="symbol"]';
  const LIGATURE = /^[a-z][a-z0-9_]{1,40}$/;
  function iconsOf(el) {
    if (!el) return [];
    const out = [];
    for (const n of el.querySelectorAll(ICON_SEL)) {
      const t = norm(n.textContent);
      if (LIGATURE.test(t)) out.push(t);
    }
    return out;
  }
  function textOf(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(ICON_SEL).forEach((n) => { if (LIGATURE.test(norm(n.textContent))) n.remove(); });
    return norm(clone.textContent);
  }

  // ---------- Mô phỏng thao tác ----------
  function simulateClick(el) {
    if (!el) return false;
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerover', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.focus?.({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }
  function hover(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) {
      const Ctor = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, { ...opts, pointerType: 'mouse' }));
    }
  }
  async function pressEscape(times = 1) {
    for (let i = 0; i < times; i++) {
      const ev = () => new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true });
      (document.activeElement || document.body).dispatchEvent(ev());
      document.dispatchEvent(ev());
      await sleep(150);
    }
  }
  async function waitFor(fn, timeout = 3000, step = 100) {
    const t0 = Date.now();
    do {
      const v = fn();
      if (v) return v;
      await sleep(step);
    } while (Date.now() - t0 < timeout);
    return null;
  }

  // ---------- Bridge sang MAIN world ----------
  let bridgeSeq = 0;
  function callBridge(op, payload = {}, timeout = 4000) {
    const id = `afl-${Date.now()}-${++bridgeSeq}`;
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

  // ---------- Ô nhập, nút gửi, nút cài đặt ----------
  function findEditor() {
    const o = fromOverride('editor');
    if (o) return o;
    const slates = [...document.querySelectorAll('[data-slate-editor="true"]')].filter(visible);
    const withPlaceholder = slates.find((e) => e.querySelector('[data-slate-placeholder]'));
    if (withPlaceholder) return withPlaceholder;
    const withSubmit = slates.find((e) => composerOf(e, true));
    if (withSubmit) return withSubmit;
    if (slates.length) return slates[slates.length - 1];
    for (const sel of ['.ProseMirror[contenteditable="true"]', 'textarea', '[contenteditable="true"][role="textbox"]']) {
      const el = [...document.querySelectorAll(sel)].filter(visible).pop();
      if (el) return el;
    }
    return null;
  }

  const SUBMIT_ICONS = ['arrow_forward', 'arrow_upward', 'send'];
  function findSubmit() {
    const o = fromOverride('submit');
    if (o) return o;
    const editor = findEditor();
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const scored = buttons.map((btn) => {
      const icons = iconsOf(btn);
      let score = 0;
      if (icons.some((i) => SUBMIT_ICONS.includes(i))) score += 10;
      if (/^(create|generate|submit|send|tạo|gửi)\b/i.test(btn.getAttribute('aria-label') || '')) score += 6;
      if (btn.type === 'submit') score += 2;
      if (editor) {
        const a = btn.getBoundingClientRect(), b = editor.getBoundingClientRect();
        score += Math.max(0, 4 - Math.hypot(a.left - b.right, a.top - b.bottom) / 150);
      }
      return { btn, score };
    }).filter((c) => c.score >= 6).sort((x, y) => y.score - x.score);
    return scored[0]?.btn || null;
  }

  // Vùng soạn prompt: tổ tiên gần nhất của ô nhập có chứa nút gửi.
  function composerOf(editor, quiet) {
    let node = editor;
    for (let i = 0; i < 10 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const hasSubmit = [...node.querySelectorAll('button')].some((b) => iconsOf(b).some((x) => SUBMIT_ICONS.includes(x)));
      if (hasSubmit) return node;
    }
    return quiet ? null : editor?.parentElement || null;
  }
  const composer = () => { const e = findEditor(); return e ? composerOf(e) : null; };

  function findSettingsButton() {
    const o = fromOverride('settings');
    if (o) return o;
    const submit = findSubmit();
    const prev = submit?.previousElementSibling;
    if (prev?.tagName === 'BUTTON' && visible(prev)) return prev;
    const root = composer() || document;
    const buttons = [...root.querySelectorAll('button')].filter(visible);
    return buttons.find((b) => iconsOf(b).some((i) => i.startsWith('crop_')))
      || buttons.find((b) => b.getAttribute('aria-haspopup') && /\b[x×]\s?\d\b|\b\d\s?[x×]\b/.test(textOf(b)))
      || null;
  }

  function readComposerSettings() {
    const btn = findSettingsButton();
    if (!btn) return null;
    const ratioIcon = iconsOf(btn).find((i) => i.startsWith('crop_')) || null;
    const text = textOf(btn);
    const q = /(?:^|\s)[x×]\s?(\d)\b|\b(\d)\s?[x×](?:\s|$)/.exec(text);
    const model = norm(text.replace(/(?:^|\s)[x×]\s?\d\b|\b\d\s?[x×](?:\s|$)/, ' '));
    return { ratio: ICON_TO_RATIO[ratioIcon] || null, quantity: q ? +(q[1] || q[2]) : null, model, raw: text };
  }

  // ---------- Bảng cài đặt (popover) ----------
  const PANEL_SEL = '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]';
  const OPTION_SEL = '[role="tab"], [role="radio"], [role="menuitemradio"], [role="option"], [role="switch"], button';

  function openPanels() {
    return [...document.querySelectorAll(PANEL_SEL)].filter(visible).filter((p) => !p.closest('[data-afl-root]'));
  }
  function findSettingsPanel() {
    const o = fromOverride('settingsPanel');
    if (o) return o;
    const panels = openPanels().filter((p) => p.querySelector('[role="tab"], [role="radio"], [id*="-trigger-"]'));
    return panels[panels.length - 1] || null;
  }
  async function openSettingsPanel() {
    let panel = findSettingsPanel();
    for (let attempt = 0; !panel && attempt < 3; attempt++) {
      const btn = findSettingsButton();
      if (!btn) throw new Error('SETTINGS_BUTTON_NOT_FOUND');
      simulateClick(btn);
      panel = await waitFor(findSettingsPanel, 2500);
    }
    if (!panel) throw new Error('SETTINGS_PANEL_NOT_FOUND');
    return panel;
  }
  async function closePanels() {
    for (let i = 0; i < 3 && openPanels().length; i++) await pressEscape(1);
    if (findSettingsPanel()) {
      const btn = findSettingsButton();
      if (btn) { simulateClick(btn); await sleep(250); }
    }
    return !findSettingsPanel();
  }

  const isSelected = (el) => !!el && (
    el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-checked') === 'true' ||
    el.getAttribute('aria-pressed') === 'true' || ['active', 'checked', 'on'].includes(el.getAttribute('data-state')));

  function optionsIn(root) { return [...root.querySelectorAll(OPTION_SEL)].filter(visible); }

  // spec: { ids: Radix value suffix, icons: ligature, texts: chữ chính xác, re: RegExp chữ }
  function matchOption(el, spec) {
    const id = el.id || '';
    const controls = el.getAttribute('aria-controls') || '';
    if (spec.ids?.some((v) => new RegExp(`-(trigger|content)-${v}$`).test(id) || new RegExp(`-content-${v}$`).test(controls))) return true;
    const icons = iconsOf(el);
    if (spec.icons?.some((i) => icons.includes(i))) return true;
    const t = lower(textOf(el));
    if (spec.texts?.includes(t)) return true;
    return !!(spec.re && spec.re.test(t));
  }
  function findOption(root, spec) { return optionsIn(root).find((el) => matchOption(el, spec)) || null; }

  async function selectOption(spec, label) {
    const root = findSettingsPanel() || document;
    let el = await waitFor(() => findOption(findSettingsPanel() || root, spec), 1500);
    if (!el) return { ok: false, missing: true, label };
    if (!isSelected(el)) {
      simulateClick(el);
      await waitFor(() => { el = findOption(findSettingsPanel() || root, spec) || el; return isSelected(el); }, 1500);
    }
    // Một số nút không có trạng thái chọn: coi click là đủ.
    const hasState = el.hasAttribute('aria-selected') || el.hasAttribute('aria-checked') || el.hasAttribute('data-state') || el.hasAttribute('aria-pressed');
    return { ok: !hasState || isSelected(el), label };
  }

  const MODE_SPEC = {
    image: { ids: ['IMAGE'], icons: ['image', 'photo', 'imagesmode', 'photo_library'], texts: ['image', 'images', 'hình ảnh', 'ảnh'] },
    video: { ids: ['VIDEO'], icons: ['videocam', 'movie', 'video_library', 'smart_display'], texts: ['video', 'videos'] }
  };
  const VIDEO_SUB_SPEC = {
    frames: { ids: ['VIDEO_FRAMES'], texts: ['frames', 'frames to video', 'khung hình'], re: /^frames?\b/ },
    ingredients: { ids: ['VIDEO_REFERENCES'], texts: ['ingredients', 'ingredients to video', 'thành phần'], re: /^ingredients?\b/ }
  };
  const RATIO_SPEC = {
    '16:9': { ids: ['LANDSCAPE'], icons: ['crop_16_9'], texts: ['16:9'] },
    '9:16': { ids: ['PORTRAIT'], icons: ['crop_9_16'], texts: ['9:16'] },
    '1:1': { ids: ['SQUARE'], icons: ['crop_square'], texts: ['1:1'] },
    '4:3': { ids: ['LANDSCAPE_4_3'], icons: ['crop_landscape'], texts: ['4:3'] },
    '3:4': { ids: ['PORTRAIT_3_4'], icons: ['crop_portrait'], texts: ['3:4'] }
  };
  const ICON_TO_RATIO = Object.fromEntries(Object.entries(RATIO_SPEC).map(([k, v]) => [v.icons[0], k]));
  const quantitySpec = (n) => ({ re: new RegExp(`^([x×]\\s?${n}|${n}\\s?[x×])$`) });
  const durationSpec = (s) => ({ re: new RegExp(`^${parseInt(s, 10)}\\s?(s|sec|giây)$`) });
  const resolutionSpec = (r) => ({ texts: [String(r).toLowerCase()] });

  const MODEL_RE = /(veo|imagen|banana|gemini|lyria|flash|pro\b)/i;
  function findModelPicker(panel) {
    const o = fromOverride('modelPicker', panel);
    if (o) return o;
    const buttons = [...panel.querySelectorAll('button, [role="combobox"]')].filter(visible);
    return buttons.find((b) => b.getAttribute('aria-haspopup') && MODEL_RE.test(textOf(b)))
      || buttons.find((b) => MODEL_RE.test(textOf(b)) && iconsOf(b).some((i) => /arrow_drop_down|expand_more|keyboard_arrow_down|unfold_more/.test(i)))
      || buttons.find((b) => b.getAttribute('aria-haspopup') === 'menu' || b.getAttribute('aria-haspopup') === 'listbox')
      || null;
  }
  function modelMenu(exclude) {
    const menus = openPanels().filter((p) => p !== exclude && !p.contains(exclude));
    return menus[menus.length - 1] || null;
  }
  const modelItems = (menu) => [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button')]
    .filter(visible).filter((el) => textOf(el));
  const modelLabel = (el) => stripLead(textOf(el)).replace(/\s+/g, ' ');

  function modelMatches(label, wanted) {
    const a = stripLead(label), b = stripLead(wanted);
    if (!a || !b) return false;
    if (a === b) return true;
    if (!a.includes(b) && !b.includes(a)) return false;
    // "Veo 3.1 - Fast" không được khớp "Veo 3.1 - Quality".
    for (const tag of ['fast', 'quality', 'lite', 'pro', 'ultra']) {
      if (b.includes(tag) !== a.includes(tag)) return false;
    }
    return true;
  }

  async function selectModel(name) {
    const panel = findSettingsPanel();
    if (!panel) return { ok: false, error: 'SETTINGS_PANEL_NOT_FOUND' };
    const picker = findModelPicker(panel);
    if (!picker) return { ok: false, error: 'MODEL_PICKER_NOT_FOUND' };
    if (modelMatches(textOf(picker), name)) return { ok: true, already: true };
    simulateClick(picker);
    const menu = await waitFor(() => modelMenu(panel), 2000);
    if (!menu) return { ok: false, error: 'MODEL_MENU_NOT_FOUND' };
    const items = modelItems(menu);
    const item = items.find((el) => modelLabel(el) === stripLead(name)) || items.find((el) => modelMatches(modelLabel(el), name));
    if (!item) {
      await pressEscape(1);
      return { ok: false, error: `MODEL_NOT_FOUND: ${name}`, available: items.map((el) => textOf(el)) };
    }
    if (item.disabled || item.getAttribute('aria-disabled') === 'true') {
      await pressEscape(1);
      return { ok: false, error: `MODEL_UNAVAILABLE: ${name}` };
    }
    simulateClick(item);
    const ok = await waitFor(() => {
      const p = findSettingsPanel();
      const live = p ? findModelPicker(p) : null;
      return live && modelMatches(textOf(live), name);
    }, 2000);
    return ok ? { ok: true } : { ok: false, error: `MODEL_NOT_APPLIED: ${name}` };
  }

  // task: { genType, videoMode, model, ratio, quantity, duration, resolution }
  async function applySettings(task) {
    const warnings = [];
    const wantsAny = task.genType || task.model || task.ratio || task.quantity || task.duration || task.resolution;
    if (!wantsAny) return { ok: true, warnings };
    await openSettingsPanel();
    try {
      if (task.genType) {
        const r = await selectOption(MODE_SPEC[task.genType], `mode:${task.genType}`);
        if (!r.ok) throw new Error(r.missing ? `MODE_NOT_FOUND:${task.genType}` : `MODE_NOT_APPLIED:${task.genType}`);
      }
      if (task.genType === 'video' && task.videoMode) {
        const sub = task.videoMode === 'ingredients' ? 'ingredients' : 'frames';
        const r = await selectOption(VIDEO_SUB_SPEC[sub], `video:${sub}`);
        if (!r.ok) throw new Error(r.missing ? `VIDEO_MODE_NOT_FOUND:${sub}` : `VIDEO_MODE_NOT_APPLIED:${sub}`);
      }
      if (task.ratio && RATIO_SPEC[task.ratio]) {
        const r = await selectOption(RATIO_SPEC[task.ratio], `ratio:${task.ratio}`);
        if (!r.ok) warnings.push(r.missing ? `Model hiện tại không có tỉ lệ ${task.ratio}` : `Chưa xác nhận được tỉ lệ ${task.ratio}`);
      }
      if (task.quantity) {
        const r = await selectOption(quantitySpec(task.quantity), `x${task.quantity}`);
        if (!r.ok) warnings.push(`Không chọn được số lượng x${task.quantity}`);
      }
      if (task.model) {
        const r = await selectModel(task.model);
        const detail = r.error + (r.available ? ` (có: ${r.available.join(', ')})` : '');
        if (!r.ok && task.modelStrict) throw new Error(detail);
        if (!r.ok) warnings.push(`Model mặc định "${task.model}" không có trên Flow, giữ model hiện tại (${detail})`);
      }
      if (task.genType === 'video' && task.duration) {
        const r = await selectOption(durationSpec(task.duration), `duration:${task.duration}`);
        if (!r.ok) warnings.push(`Model hiện tại không có thời lượng ${task.duration}`);
      }
      if (task.genType === 'video' && task.resolution) {
        const r = await selectOption(resolutionSpec(task.resolution), `res:${task.resolution}`);
        if (!r.ok) warnings.push(`Không có độ phân giải ${task.resolution}`);
      }
    } finally {
      await closePanels();
    }
    return { ok: true, warnings };
  }

  // Đọc các tuỳ chọn thật đang có trên Flow (model, tỉ lệ, thời lượng...).
  async function scrapeOptions() {
    const out = { image: { models: [], ratios: [], quantities: [] }, video: { models: [], ratios: [], quantities: [], durations: [], resolutions: [], modes: [] }, current: readComposerSettings() };
    await openSettingsPanel();
    try {
      for (const mode of ['image', 'video']) {
        const r = await selectOption(MODE_SPEC[mode], mode);
        if (!r.ok) continue;
        await sleep(300);
        const panel = findSettingsPanel();
        if (!panel) continue;
        const bucket = out[mode];
        for (const el of optionsIn(panel)) {
          const t = lower(textOf(el));
          const ratio = Object.keys(RATIO_SPEC).find((k) => matchOption(el, RATIO_SPEC[k]));
          if (ratio && !bucket.ratios.includes(ratio)) bucket.ratios.push(ratio);
          const q = /^[x×]\s?(\d)$|^(\d)\s?[x×]$/.exec(t);
          if (q) bucket.quantities.push(+(q[1] || q[2]));
          if (mode === 'video') {
            if (/^\d{1,2}\s?(s|sec|giây)$/.test(t)) bucket.durations.push(`${parseInt(t, 10)}s`);
            if (/^\d{3,4}p$/.test(t)) bucket.resolutions.push(t);
            for (const k of Object.keys(VIDEO_SUB_SPEC)) if (matchOption(el, VIDEO_SUB_SPEC[k]) && !bucket.modes.includes(k)) bucket.modes.push(k);
          }
        }
        const picker = findModelPicker(panel);
        if (picker) {
          simulateClick(picker);
          const menu = await waitFor(() => modelMenu(panel), 2000);
          if (menu) {
            bucket.models = [...new Set(modelItems(menu).map((el) => textOf(el)).filter((t) => t.length < 60))];
            await pressEscape(1);
            await sleep(200);
            if (!findSettingsPanel()) await openSettingsPanel();
          }
        }
      }
    } finally {
      await closePanels();
    }
    for (const b of [out.image, out.video]) for (const k of Object.keys(b)) b[k] = [...new Set(b[k])];
    return out;
  }

  // ---------- Prompt ----------
  function editorText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[contenteditable="false"], [data-slate-placeholder]').forEach((n) => n.remove());
    return clone.textContent || '';
  }

  async function setPrompt(text) {
    const el = findEditor();
    if (!el) return { ok: false, error: 'EDITOR_NOT_FOUND' };
    // So sánh bỏ khoảng trắng: các đoạn Slate nối liền nhau trong textContent.
    const want = compact(text);
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return compact(el.value) === want ? { ok: true } : { ok: false, error: 'PROMPT_NOT_CONFIRMED' };
    }
    if (el.matches('[data-slate-editor="true"]')) {
      el.focus();
      const res = await callBridge('setPrompt', { text });
      await sleep(200);
      if (res.ok && compact(editorText(findEditor())) === want) return { ok: true };
    }
    el.focus();
    document.execCommand('selectAll', false);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, text);
    await sleep(200);
    return compact(editorText(findEditor())) === want ? { ok: true } : { ok: false, error: 'PROMPT_NOT_CONFIRMED' };
  }

  // ---------- Ảnh tham chiếu ----------
  function dataUrlToFile({ dataUrl, name, mime }) {
    const [head, b64] = dataUrl.split(',');
    const type = mime || /data:([^;]+)/.exec(head)?.[1] || 'image/png';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name || 'ref.png', { type });
  }

  function composerImages() {
    const root = composer();
    if (!root) return [];
    const editor = findEditor();
    return [...root.querySelectorAll('img, video')].filter((img) => visible(img) && !editor?.contains(img));
  }

  // Xoá ảnh tham chiếu và nhân vật/giọng nói của task trước (các chip có nút close trong vùng soạn).
  async function clearRefs() {
    for (let guard = 0; guard < 20; guard++) {
      const root = composer();
      if (!root) return;
      const editor = findEditor();
      const btn = [...root.querySelectorAll('button')].filter(visible).find((b) => {
        const icons = iconsOf(b);
        return (icons.includes('close') || icons.includes('cancel')) && !editor?.contains(b);
      });
      if (!btn) return;
      simulateClick(btn);
      await sleep(350);
    }
  }

  function setInputFiles(input, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clickConsentIfAny() {
    const dialog = openPanels().find((p) => p.getAttribute('role') === 'dialog');
    if (!dialog) return;
    const btn = [...dialog.querySelectorAll('button')].find((b) => /^(i agree|agree|accept|ok|got it|continue|đồng ý|tiếp tục)$/i.test(textOf(b)));
    if (btn) { simulateClick(btn); await sleep(400); }
  }

  const ADD_ICONS = ['add_2', 'add', 'add_photo_alternate', 'attach_file', 'add_circle', 'image'];
  async function pickInputVia(trigger) {
    // Chặn hộp thoại chọn file của hệ điều hành, lấy <input type=file> mà Flow định mở.
    await callBridge('armFilePick', { ms: 6000 });
    simulateClick(trigger);
    let input = await waitFor(() => document.querySelector('input[type="file"][data-afl-picked]'), 2500);
    if (!input) {
      // Nút mở menu: tìm mục "Upload".
      const menu = openPanels().pop();
      // Bỏ qua tab (vd. tab "Upload"): chỉ chọn mục thực hiện hành động.
      const item = menu && [...menu.querySelectorAll('[role="menuitem"], [role="option"], button:not([role="tab"])')].filter(visible)
        .find((el) => iconsOf(el).some((i) => /upload|file_upload|upload_file|add_photo_alternate/.test(i)) || /upload|tải lên/i.test(textOf(el)));
      if (item) {
        simulateClick(item);
        input = await waitFor(() => document.querySelector('input[type="file"][data-afl-picked]'), 2500);
      }
    }
    await callBridge('disarmFilePick');
    return input;
  }

  async function dropFiles(target, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    const r = target.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, opts));
      await sleep(80);
    }
  }

  async function attachRefs(refs, videoMode) {
    if (!refs?.length) return { ok: true, count: 0 };
    const files = refs.map(dataUrlToFile);
    const before = composerImages().length;
    const root = composer();
    if (!root) return { ok: false, error: 'COMPOSER_NOT_FOUND' };

    if (videoMode === 'frames') {
      // Frames → Video: ô khung đầu / khung cuối.
      const slots = [/start|first|begin|đầu|bắt đầu/i, /end|last|final|cuối|kết thúc/i];
      let used = 0;
      for (let i = 0; i < Math.min(2, files.length); i++) {
        const slot = [...root.querySelectorAll('button, [role="button"]')].filter(visible)
          .find((b) => slots[i].test(`${b.getAttribute('aria-label') || ''} ${textOf(b)}`));
        if (!slot) break;
        const input = await pickInputVia(slot);
        if (!input) break;
        setInputFiles(input, [files[i]]);
        used++;
        await clickConsentIfAny();
        await waitUploads(before + used);
      }
      if (used === Math.min(2, files.length)) return { ok: true, count: used };
    }

    const direct = [...root.querySelectorAll('input[type="file"]')][0];
    let input = direct;
    if (!input) {
      const addBtn = [...root.querySelectorAll('button')].filter(visible).find((b) => {
        const icons = iconsOf(b);
        return icons.some((i) => ADD_ICONS.includes(i)) && !icons.some((i) => SUBMIT_ICONS.includes(i) || i.startsWith('crop_'));
      });
      if (addBtn) input = await pickInputVia(addBtn);
    }
    if (input) {
      if (input.multiple || files.length === 1) setInputFiles(input, files);
      else for (const f of files) { setInputFiles(input, [f]); await sleep(600); }
    } else {
      await dropFiles(findEditor() || root, files);
    }
    await sleep(500);
    await clickConsentIfAny();
    const ok = await waitUploads(before + files.length);
    return ok ? { ok: true, count: files.length } : { ok: false, error: 'REF_UPLOAD_NOT_CONFIRMED' };
  }

  async function waitUploads(expected, timeout = 90000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const root = composer();
      const busy = root && (root.querySelector('[role="progressbar"]') || [...root.querySelectorAll('div, span')].some((d) => d.children.length === 0 && /^\d{1,3}%$/.test(norm(d.textContent))));
      if (composerImages().length >= expected && !busy) return true;
      await sleep(500);
    }
    return false;
  }

  // ---------- Gửi ----------
  const isDisabled = (b) => !b || b.disabled || b.getAttribute('aria-disabled') === 'true';
  async function submit() {
    let btn = await waitFor(() => { const b = findSubmit(); return b && !isDisabled(b) ? b : null; }, 20000, 250);
    if (!btn) return { ok: false, error: findSubmit() ? 'SUBMIT_DISABLED' : 'SUBMIT_NOT_FOUND' };
    const before = norm(editorText(findEditor()));
    simulateClick(btn);
    const accepted = await waitFor(() => norm(editorText(findEditor())) !== before || isDisabled(findSubmit()) || progressMarkers().length > 0, 5000, 150);
    if (!accepted) {
      const ed = findEditor();
      ed?.focus();
      ed?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      await sleep(1500);
    }
    return { ok: true };
  }

  // ---------- Kết quả (tile) ----------
  const MEDIA_RE = /\/asb\/|googleusercontent\.com|storage\.googleapis\.com|^blob:/;
  function mediaKey(url) {
    try {
      const u = new URL(url, location.href);
      if (u.protocol === 'blob:') return url;
      const i = u.pathname.indexOf('/asb/');
      if (i >= 0) return u.pathname.slice(i + 5).replace(/=[^/]*$/, '').replace(/\/(video|image|thumbnail|poster)$/i, '');
      return u.origin + u.pathname.replace(/=[^/]*$/, '');
    } catch (_) { return url; }
  }
  const outsideUi = (el) => !composer()?.contains(el) && !el.closest(PANEL_SEL) && !el.closest('[data-afl-root]');
  function mediaElements() {
    const out = [];
    for (const el of document.querySelectorAll('video, img')) {
      const src = el.currentSrc || el.src || el.querySelector?.('source')?.src || '';
      if (!src || !MEDIA_RE.test(src) || !outsideUi(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      out.push({ el, src, kind: el.tagName === 'VIDEO' ? 'video' : 'image', key: mediaKey(src) });
    }
    return out;
  }
  function tileOf(el) {
    let node = el;
    const vw = window.innerWidth;
    for (let i = 0; i < 8; i++) {
      const p = node.parentElement;
      if (!p || p === document.body) break;
      const media = p.querySelectorAll('video, img');
      if (media.length > 3 || p.querySelectorAll('video').length > 1) break;
      if (p.getBoundingClientRect().width > vw * 0.8) break;
      node = p;
    }
    return node;
  }
  function progressMarkers() {
    return [...document.querySelectorAll('div, span, p')].filter((d) => d.children.length <= 1 && /^\d{1,3}%$/.test(norm(d.textContent)) && visible(d) && outsideUi(d));
  }
  const ERROR_ICONS = ['warning', 'error', 'error_outline', 'report', 'report_problem', 'sentiment_dissatisfied', 'block'];
  const RETRY_ICONS = ['refresh', 'replay', 'restart_alt', 'autorenew'];
  function errorTiles() {
    const out = [];
    for (const i of document.querySelectorAll(ICON_SEL)) {
      const t = norm(i.textContent);
      if (!ERROR_ICONS.includes(t) && !RETRY_ICONS.includes(t)) continue;
      if (!visible(i) || !outsideUi(i)) continue;
      let box = i;
      for (let k = 0; k < 5 && box.parentElement; k++) {
        box = box.parentElement;
        if (box.getBoundingClientRect().width > window.innerWidth * 0.8) break;
        if (textOf(box).length > 12) break;
      }
      // Bỏ chữ trên nút (vd. "Retry") khỏi thông báo lỗi.
      const clone = box.cloneNode(true);
      clone.querySelectorAll('button, [role="button"]').forEach((b) => b.remove());
      const text = textOf(clone);
      if (RETRY_ICONS.includes(t) && !ERROR_ICONS.some((e) => iconsOf(box).includes(e)) && text.length < 12) continue;
      out.push({ el: box, text: text.slice(0, 300) });
    }
    return out;
  }

  function toastTexts() {
    const texts = [];
    for (const n of document.querySelectorAll('[data-sonner-toast], [role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"]')) {
      const t = norm(n.textContent);
      if (t && t.length < 400 && visible(n)) texts.push(t);
    }
    return texts;
  }
  function classifyError(text) {
    const t = lower(text);
    if (!t) return null;
    if (/captcha|recaptcha|unusual traffic|verify (that )?you|not a robot/.test(t)) return 'captcha';
    if (/quota|out of credits|not enough credits|insufficient credit|credit limit|daily limit|hết (lượt|credit|hạn mức)|upgrade/.test(t)) return 'quota';
    if (/too many requests|rate limit|try again later|slow down|high demand|busy|thử lại sau|quá nhiều/.test(t)) return 'rate_limit';
    if (/policy|violat|safety|unsafe|blocked|prohibited|guideline|celebrity|minor|sensitive|chính sách|vi phạm/.test(t)) return 'policy';
    if (/error|failed|unable|couldn.?t|something went wrong|lỗi|thất bại|không thể/.test(t)) return 'error';
    return null;
  }

  // ---------- Theo dõi job ----------
  const jobs = new Map();
  const claimed = new Map(); // mediaKey -> token
  let jobSeq = 0;

  function snapshot() {
    return {
      keys: new Set(mediaElements().map((m) => m.key)),
      errors: new Set(errorTiles().map((e) => e.el)),
      errorTexts: new Set(errorTiles().map((e) => e.text)),
      toasts: new Set(toastTexts())
    };
  }

  function promptProbe(prompt) { return lower(prompt).slice(0, 40); }

  function freshResults(job) {
    const groups = new Map();
    for (const m of mediaElements()) {
      if (job.before.keys.has(m.key)) continue;
      const owner = claimed.get(m.key);
      if (owner && owner !== job.token) continue;
      const tile = tileOf(m.el);
      const g = groups.get(tile) || { tile, items: [] };
      g.items.push(m);
      groups.set(tile, g);
    }
    let list = [...groups.values()].map((g) => {
      const video = g.items.find((i) => i.kind === 'video');
      const main = video || g.items[0];
      const tileText = lower(g.tile.textContent || '');
      return { key: main.key, url: main.src, kind: main.kind, tile: g.tile, el: main.el, poster: video ? (g.items.find((i) => i.kind === 'image')?.src || video.el.poster || '') : '', matchesPrompt: tileText.includes(job.probe) };
    });
    // Tile có hiện prompt của job khác thì bỏ qua.
    const others = [...jobs.values()].filter((j) => j.token !== job.token && !j.done).map((j) => j.probe);
    list = list.filter((r) => r.matchesPrompt || !others.some((p) => p && lower(r.tile.textContent || '').includes(p)));
    list.sort((a, b) => Number(b.matchesPrompt) - Number(a.matchesPrompt));
    return list.slice(0, job.quantity);
  }

  async function startJob(task) {
    const token = `job-${Date.now()}-${++jobSeq}`;
    jobs.set(token, { token, before: snapshot(), startedAt: Date.now(), quantity: task.quantity || 1, genType: task.genType, probe: promptProbe(task.prompt), lastCount: 0, lastChange: Date.now(), done: false });
    return token;
  }

  function pollJob(token) {
    const job = jobs.get(token);
    if (!job) return { status: 'lost' };
    const now = Date.now();
    const results = freshResults(job);
    const errors = errorTiles().filter((e) => !job.before.errors.has(e.el) && !job.before.errorTexts.has(e.text));
    const markers = progressMarkers();
    const pct = markers.map((m) => parseInt(norm(m.textContent), 10)).filter((n) => !isNaN(n));
    const count = results.length + errors.length;
    if (count !== job.lastCount) { job.lastCount = count; job.lastChange = now; }
    const stable = now - job.lastChange;
    const elapsed = now - job.startedAt;
    const newToasts = toastTexts().filter((t) => !job.before.toasts.has(t));
    const toastCat = newToasts.map((t) => ({ t, c: classifyError(t) })).find((x) => x.c);

    const base = { progress: pct.length ? Math.max(...pct) : null, pending: markers.length, results: results.map(({ key, url, kind, poster }) => ({ key, url, kind, poster })), errors: errors.map((e) => e.text) };
    let status = 'running';
    if (results.length >= job.quantity && stable >= 2500) status = 'done';
    else if (count >= job.quantity && errors.length && stable >= 2500) status = results.length ? 'done' : 'failed';
    else if (markers.length === 0 && count > 0 && elapsed > 15000 && stable >= 8000) status = results.length ? 'done' : 'failed';
    else if (toastCat && toastCat.c !== 'error' && results.length === 0) status = 'failed';
    else if (toastCat && results.length === 0 && markers.length === 0 && elapsed > 8000) status = 'failed';
    else if (markers.length === 0 && count === 0 && elapsed > 120000) status = 'failed';

    if (status === 'done') for (const r of results) claimed.set(r.key, token);
    if (status !== 'running') job.done = true;
    const errText = errors[0]?.text || toastCat?.t || (status === 'failed' && count === 0 ? 'Flow không trả về kết quả' : '');
    return { status, ...base, error: status === 'failed' ? errText : '', category: status === 'failed' ? (classifyError(errText) || toastCat?.c || 'error') : null };
  }

  // Video thường chỉ nạp <video src> khi rê chuột vào tile.
  async function resolveVideo(job, r) {
    if (r.kind === 'video' || job.genType !== 'video') return r;
    const m = mediaElements().find((x) => x.key === r.key);
    const tile = m ? tileOf(m.el) : null;
    if (!tile) return r;
    hover(tile);
    const v = await waitFor(() => tile.querySelector('video[src], video source[src]'), 4000);
    const src = v ? (v.currentSrc || v.src || v.getAttribute('src')) : '';
    return src ? { ...r, kind: 'video', url: new URL(src, location.href).href, poster: r.url } : r;
  }

  // Ưu tiên ảnh (poster) đã tải xong; <video> chỉ dùng khi đã có khung hình.
  function thumbOf(url) {
    const key = mediaKey(url);
    const ready = (m) => (m.kind === 'image' ? m.el.complete && m.el.naturalWidth : m.el.readyState >= 2);
    const cands = mediaElements().filter((m) => (m.src === url || m.key === key) && ready(m));
    const el = (cands.find((m) => m.kind === 'image') || cands[0])?.el;
    if (!el) return '';
    try {
      const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
      if (!w || !h) return '';
      const scale = 200 / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (_) { return ''; }
  }

  async function finalizeJob(token, results) {
    const job = jobs.get(token);
    const out = [];
    for (const r of results || []) {
      const resolved = job ? await resolveVideo(job, r) : r;
      out.push({ ...resolved, thumb: thumbOf(resolved.poster || resolved.url) || thumbOf(resolved.url) });
    }
    jobs.delete(token);
    return out;
  }

  // ---------- Project ----------
  const inProject = () => /\/project\//.test(location.pathname);
  async function ensureProject() {
    if (inProject() && findEditor()) return { ok: true };
    if (!inProject()) {
      const btn = [...document.querySelectorAll('button, a')].filter(visible)
        .find((b) => /new project|create project|dự án mới|tạo dự án/i.test(textOf(b)));
      if (!btn) return { ok: false, error: 'Hãy mở hoặc tạo một project trên Flow' };
      simulateClick(btn);
    }
    const ok = await waitFor(() => inProject() && findEditor(), 20000, 300);
    return ok ? { ok: true } : { ok: false, error: 'Chưa vào được project' };
  }

  // ---------- Nhân vật / giọng nói (@char:Tên, @voice:Tên, @char:[Tên có dấu cách]) ----------
  const MENTION_RE = /@(char|voice):(\[[^\]]+\]|[^\s,.;!?]+)/g;
  function parseMentions(text) {
    const mentions = [];
    const clean = String(text || '').replace(MENTION_RE, (_, kind, raw) => {
      mentions.push({ kind, name: raw.startsWith('[') ? raw.slice(1, -1).trim() : raw });
      return ' ';
    }).replace(/[ \t]{2,}/g, ' ').trim();
    return { clean, mentions };
  }
  const COMPONENT_TAB = {
    char: { re: /character|nhân vật|người/i, icons: ['person', 'face', 'group', 'account_circle', 'emoji_people', 'person_search'] },
    voice: { re: /voice|giọng|âm thanh/i, icons: ['record_voice_over', 'graphic_eq', 'mic', 'voice_selection', 'campaign'] }
  };
  function findAddButton() {
    const o = fromOverride('addButton');
    if (o) return o;
    const root = composer();
    if (!root) return null;
    return [...root.querySelectorAll('button')].filter(visible).find((b) => {
      const icons = iconsOf(b);
      return icons.some((i) => ADD_ICONS.includes(i)) && !icons.some((i) => SUBMIT_ICONS.includes(i) || i.startsWith('crop_'));
    }) || null;
  }
  async function openAddMenu() {
    const before = new Set(openPanels());
    const btn = findAddButton();
    if (!btn) throw new Error('ADD_BUTTON_NOT_FOUND');
    simulateClick(btn);
    const panel = await waitFor(() => openPanels().filter((p) => !before.has(p)).pop(), 2500);
    if (!panel) throw new Error('ADD_MENU_NOT_FOUND');
    return panel;
  }
  // Menu có thể vẽ lại khi đổi tab: luôn lấy panel đang hiển thị.
  const livePanel = (panel) => (panel?.isConnected ? panel : openPanels().pop() || null);
  async function switchComponentTab(panel, kind) {
    const spec = COMPONENT_TAB[kind];
    const tab = [...panel.querySelectorAll('[role="tab"], button, [role="menuitem"]')].filter(visible)
      .find((el) => spec.re.test(textOf(el)) || iconsOf(el).some((i) => spec.icons.includes(i)));
    if (!tab) return null;
    if (!isSelected(tab)) { simulateClick(tab); await sleep(400); }
    return livePanel(panel);
  }
  function componentList(panel) {
    const box = panel.querySelector('[role="listbox"], [role="list"], [role="grid"]') || panel;
    const opts = [...box.querySelectorAll('[role="option"], [role="listitem"], [role="gridcell"], [role="menuitem"]')].filter(visible);
    return { box, opts: opts.filter((el) => textOf(el) && !el.matches('[role="tab"]')) };
  }
  const componentName = (el) => textOf(el).split(/\s{2,}|\n/)[0].trim();
  async function walkComponents(panel, visit) {
    const seen = new Set();
    for (let step = 0, stable = 0; step < 40 && stable < 3; step++) {
      panel = livePanel(panel);
      if (!panel) break;
      const { box, opts } = componentList(panel);
      const size = seen.size;
      for (const el of opts) {
        const name = componentName(el);
        if (seen.has(name)) continue;
        seen.add(name);
        const r = await visit(el, name);
        if (r) return { found: r, seen: [...seen] };
      }
      stable = seen.size === size ? stable + 1 : 0;
      const top = box.scrollTop;
      box.scrollTop = top + Math.max(200, box.clientHeight * 0.8);
      await sleep(180);
      if (box.scrollTop === top && stable >= 1) break;
    }
    return { found: null, seen: [...seen] };
  }
  function chipCount() {
    const root = composer();
    if (!root) return 0;
    const editor = findEditor();
    const inline = editor ? editor.querySelectorAll('[data-slate-void="true"], [data-slate-inline="true"][contenteditable="false"]').length : 0;
    const bar = [...root.querySelectorAll('button')].filter((b) => visible(b) && !editor?.contains(b) && (iconsOf(b).includes('close') || iconsOf(b).includes('cancel'))).length;
    return inline + bar;
  }
  async function selectComponent(kind, name) {
    const before = chipCount();
    let panel = await openAddMenu();
    try {
      panel = await switchComponentTab(panel, kind);
      if (!panel) return { ok: false, error: `Không thấy tab ${kind === 'voice' ? 'giọng nói' : 'nhân vật'} trong menu +` };
      const want = name.toLowerCase();
      const walked = await walkComponents(panel, (el, n) => (n.toLowerCase() === want || n.toLowerCase().startsWith(want) ? el : null));
      if (!walked.found) return { ok: false, error: `Không tìm thấy ${kind === 'voice' ? 'giọng' : 'nhân vật'} "${name}"`, available: walked.seen };
      walked.found.scrollIntoView({ block: 'center' });
      simulateClick(walked.found);
      // Một số phiên bản mở trang chi tiết với nút Apply/Add.
      const apply = await waitFor(() => (chipCount() > before ? 'done' : openPanels().flatMap((p) => [...p.querySelectorAll('button')]).filter(visible)
        .find((b) => /^(apply|add|use|select|insert|áp dụng|thêm|dùng|chọn)$/i.test(textOf(b)))), 1500);
      if (apply && apply !== 'done') simulateClick(apply);
      const ok = await waitFor(() => chipCount() > before, 3000);
      return ok ? { ok: true } : { ok: false, error: `Chưa xác nhận được ${name} đã được thêm` };
    } finally {
      await closePanels();
    }
  }
  async function scrapeComponents() {
    const out = { characters: [], voices: [] };
    for (const [kind, key] of [['char', 'characters'], ['voice', 'voices']]) {
      try {
        const panel = await switchComponentTab(await openAddMenu(), kind);
        if (panel) out[key] = (await walkComponents(panel, () => null)).seen;
      } catch (_) { /* menu không có tab này */ }
      await closePanels();
    }
    return out;
  }

  // ---------- Tải qua menu chuột phải của Flow (bản upscale) ----------
  function resolutionRe(label) {
    const l = String(label).toLowerCase();
    if (l === 'original') return /original|gốc|1k\b|720p/i;
    return new RegExp(`(^|\\W)${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`, 'i');
  }
  async function downloadViaMenu(url, label) {
    const key = mediaKey(url);
    const m = mediaElements().find((x) => x.src === url || x.key === key);
    if (!m) return { ok: false, error: 'Không thấy tile trên trang (hãy mở đúng project)' };
    const tile = tileOf(m.el);
    tile.scrollIntoView({ block: 'center' });
    hover(tile);
    await sleep(250);
    const target = m.el.isConnected ? m.el : tile;
    const r = target.getBoundingClientRect();
    const before = new Set(openPanels());
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    let menu = await waitFor(() => openPanels().filter((p) => !before.has(p)).pop(), 2500);
    if (!menu) {
      const more = [...tile.querySelectorAll('button')].find((b) => iconsOf(b).some((i) => /more_vert|more_horiz/.test(i)));
      if (more) { simulateClick(more); menu = await waitFor(() => openPanels().filter((p) => !before.has(p)).pop(), 2500); }
    }
    if (!menu) return { ok: false, error: 'Không mở được menu của tile' };
    const items = [...menu.querySelectorAll('[role="menuitem"], button')].filter(visible);
    const dl = items.find((i) => iconsOf(i).some((x) => x === 'download' || x === 'file_download')) || items.find((i) => /download|tải xuống/i.test(textOf(i)));
    if (!dl) { await pressEscape(2); return { ok: false, error: 'Menu không có mục Download' }; }
    if (!dl.getAttribute('aria-haspopup')) { simulateClick(dl); return { ok: true, direct: true }; }
    const opened = new Set(openPanels());
    const rr = dl.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, clientX: rr.left + rr.width / 2, clientY: rr.top + rr.height / 2, pointerType: 'mouse' };
    for (const t of ['pointerover', 'pointerenter', 'pointermove']) dl.dispatchEvent(new PointerEvent(t, o));
    for (const t of ['mouseover', 'mouseenter', 'mousemove']) dl.dispatchEvent(new MouseEvent(t, o));
    dl.focus();
    let sub = await waitFor(() => openPanels().filter((p) => !opened.has(p)).pop(), 1200);
    if (!sub) {
      dl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      sub = await waitFor(() => openPanels().filter((p) => !opened.has(p)).pop(), 1500);
    }
    if (!sub) { await pressEscape(2); return { ok: false, error: 'Không mở được menu độ phân giải' }; }
    const re = resolutionRe(label);
    const options = [...sub.querySelectorAll('[role="menuitem"], button')].filter(visible);
    const item = options.find((i) => re.test(textOf(i)));
    if (!item) { await pressEscape(3); return { ok: false, error: `Không có lựa chọn ${label}`, available: options.map(textOf) }; }
    if (item.disabled || item.getAttribute('aria-disabled') === 'true') { await pressEscape(3); return { ok: false, error: `${label} không khả dụng cho file này` }; }
    simulateClick(item);
    return { ok: true, label: textOf(item) };
  }

  // ---------- Tài khoản Google đang dùng trên Flow ----------
  function account() {
    const btns = [...document.querySelectorAll('button, a')].filter(visible);
    const loginBtn = btns.find((b) => /^(sign in|log in|đăng nhập)$/i.test(textOf(b)));
    const prof = document.querySelector('[aria-label*="Google Account" i], [aria-label*="Tài khoản Google" i], img[alt*="@" i]');
    const raw = prof ? (prof.getAttribute('aria-label') || prof.getAttribute('alt') || '') : '';
    const label = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(raw)?.[0] || raw.replace(/^(Google Account|Tài khoản Google)[:：]?\s*/i, '').slice(0, 60);
    return { provider: 'flow', loggedIn: !loginBtn, ready: !loginBtn && inProject() && !!findEditor(), label, plan: /\bPRO\b|\bULTRA\b/.exec(document.body.innerText.slice(0, 4000))?.[0] || '' };
  }

  // ---------- Chẩn đoán ----------
  function describe(el) {
    const r = el.getBoundingClientRect();
    const attrs = {};
    for (const a of ['id', 'role', 'type', 'aria-label', 'aria-haspopup', 'aria-selected', 'aria-checked', 'aria-controls', 'aria-expanded', 'data-state', 'data-slate-editor', 'contenteditable']) {
      const v = el.getAttribute(a);
      if (v !== null) attrs[a] = v.slice(0, 80);
    }
    return { tag: el.tagName.toLowerCase(), cls: String(el.className?.baseVal ?? el.className ?? '').slice(0, 80), attrs, icons: iconsOf(el).slice(0, 4), text: textOf(el).slice(0, 80), rect: [r.x, r.y, r.width, r.height].map(Math.round) };
  }
  function diagnose() {
    const interesting = 'button, [role], input, textarea, [contenteditable="true"], [data-slate-editor], video';
    const list = (root) => (root ? [...root.querySelectorAll(interesting)].filter(visible).slice(0, 300).map(describe) : []);
    return {
      url: location.href,
      at: new Date().toISOString(),
      viewport: [innerWidth, innerHeight],
      found: {
        editor: !!findEditor(), submit: !!findSubmit(), settings: !!findSettingsButton(),
        settingsPanel: !!findSettingsPanel(), composerSettings: readComposerSettings()
      },
      composer: list(composer()),
      panels: openPanels().map((p) => ({ panel: describe(p), items: list(p) })),
      media: mediaElements().slice(0, 30).map((m) => ({ kind: m.kind, key: m.key, src: m.src.slice(0, 160) })),
      progress: progressMarkers().slice(0, 10).map((d) => norm(d.textContent)),
      errors: errorTiles().slice(0, 10).map((e) => e.text),
      toasts: toastTexts().slice(0, 10)
    };
  }

  // Khung cuối của video (cùng origin nên vẽ canvas được) → dùng làm khung đầu cho video tiếp theo.
  async function lastFrame(url) {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = url;
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('VIDEO_LOAD_TIMEOUT')), 30000);
      v.onloadedmetadata = () => { clearTimeout(t); resolve(); };
      v.onerror = () => { clearTimeout(t); reject(new Error('VIDEO_LOAD_FAILED')); };
    });
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('VIDEO_SEEK_TIMEOUT')), 20000);
      v.onseeked = () => { clearTimeout(t); resolve(); };
      v.currentTime = Math.max(0, v.duration - 0.05);
    });
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    const s = 240 / Math.max(c.width, c.height);
    const t = document.createElement('canvas');
    t.width = Math.round(c.width * s);
    t.height = Math.round(c.height * s);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return { dataUrl, thumb: t.toDataURL('image/jpeg', 0.7) };
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

  window.AFLDriver = {
    setOverrides, findEditor, findSubmit, findSettingsButton, readComposerSettings, inProject, ensureProject,
    applySettings, scrapeOptions, closePanels, setPrompt, clearRefs, attachRefs, submit,
    startJob, pollJob, finalizeJob, classifyError, diagnose, fetchMedia, toastTexts,
    parseMentions, selectComponent, scrapeComponents, downloadViaMenu, lastFrame, account
  };
})();

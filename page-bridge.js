// Chạy trong MAIN world của trang Flow: truy cập instance Slate editor qua React fiber
// để chèn prompt đúng cách (gõ DOM trực tiếp sẽ không cập nhật state của Slate).
(function () {
  if (window.__aflBridge) return;
  window.__aflBridge = true;

  function isSlateEditor(v) {
    return v && typeof v === 'object' && Array.isArray(v.children) &&
      typeof v.insertText === 'function' && typeof v.apply === 'function';
  }

  function findSlate(el) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let fiber = key ? el[key] : null;
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      const props = fiber.memoizedProps;
      if (props && isSlateEditor(props.editor)) return props.editor;
      for (let ctx = fiber.dependencies?.firstContext; ctx; ctx = ctx.next) {
        if (isSlateEditor(ctx.memoizedValue)) return ctx.memoizedValue;
        if (isSlateEditor(ctx.memoizedValue?.editor)) return ctx.memoizedValue.editor;
      }
    }
    return null;
  }

  function edgePoint(editor, last) {
    const path = [];
    let node = editor;
    while (node.children && node.children.length) {
      const i = last ? node.children.length - 1 : 0;
      path.push(i);
      node = node.children[i];
    }
    return { path, offset: last ? (node.text || '').length : 0 };
  }

  function setPrompt(text) {
    const el = document.querySelector('[data-slate-editor="true"]');
    if (!el) return { ok: false, error: 'SLATE_NOT_FOUND' };
    const editor = findSlate(el);
    if (!editor) return { ok: false, error: 'SLATE_INSTANCE_NOT_FOUND' };
    const range = { anchor: edgePoint(editor, false), focus: edgePoint(editor, true) };
    if (typeof editor.select === 'function') editor.select(range);
    else editor.apply({ type: 'set_selection', properties: editor.selection, newProperties: range });
    editor.deleteFragment();
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      if (i > 0 && typeof editor.insertSoftBreak === 'function') editor.insertSoftBreak();
      else if (i > 0) editor.insertText('\n');
      if (line) editor.insertText(line);
    });
    if (typeof editor.onChange === 'function') editor.onChange();
    return { ok: true, method: 'slate' };
  }

  // Bẫy chọn file: khi Flow gọi input.click() để mở hộp thoại, đánh dấu input thay vì mở hộp thoại,
  // để content script gán file trực tiếp.
  const nativeClick = HTMLInputElement.prototype.click;
  const nativeShowPicker = HTMLInputElement.prototype.showPicker;
  let disarmTimer = null;
  function trap() {
    if (this.type !== 'file') return nativeClick.apply(this, arguments);
    document.querySelectorAll('input[data-afl-picked]').forEach((n) => n.removeAttribute('data-afl-picked'));
    this.setAttribute('data-afl-picked', '1');
    if (!this.isConnected) {
      // Input tạo động chưa gắn vào DOM: gắn tạm (ẩn) để content script tìm thấy.
      this.style.display = 'none';
      document.body.appendChild(this);
    }
  }
  function arm(ms) {
    HTMLInputElement.prototype.click = trap;
    if (nativeShowPicker) HTMLInputElement.prototype.showPicker = function () { return this.type === 'file' ? trap.call(this) : nativeShowPicker.apply(this, arguments); };
    clearTimeout(disarmTimer);
    disarmTimer = setTimeout(disarm, ms || 6000);
    return { ok: true };
  }
  function disarm() {
    HTMLInputElement.prototype.click = nativeClick;
    if (nativeShowPicker) HTMLInputElement.prototype.showPicker = nativeShowPicker;
    clearTimeout(disarmTimer);
    return { ok: true };
  }

  // Theo dõi phản hồi API trên trang Flow: báo mã lỗi PUBLIC_ERROR_* (hết credit, hoạt động bất thường…)
  // cho content script, vì Flow không phải lúc nào cũng hiện lỗi trên giao diện.
  const NET_PAGES = ['flow.google.com', 'labs.google'];
  const reportCodes = (text, status) => {
    // Chỉ phản hồi lỗi (HTTP lỗi hoặc có trường "error"), không phải dữ liệu tình cờ chứa tên mã lỗi.
    if (status < 400 && !/"error"\s*:/.test(text)) return;
    const codes = [...new Set(String(text).match(/PUBLIC_ERROR_[A-Z_]+/g) || [])];
    if (codes.length) window.postMessage({ src: 'afl-net', codes, status, at: Date.now() }, '*');
  };
  if (NET_PAGES.includes(location.hostname)) {
    const nativeFetch = window.fetch;
    window.fetch = async function () {
      const res = await nativeFetch.apply(this, arguments);
      try {
        const ct = res.headers.get('content-type') || '';
        if (!/event-stream/.test(ct) && /json|text|protobuf/.test(ct) && +(res.headers.get('content-length') || 0) < 2e6) {
          res.clone().text().then((t) => reportCodes(t, res.status), () => {});
        }
      } catch (_) { /* phản hồi không đọc được */ }
      return res;
    };
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', () => {
        try { if (this.responseType === '' || this.responseType === 'text') reportCodes(this.responseText.slice(0, 2e6), this.status); } catch (_) { /* bỏ qua */ }
      });
      return nativeSend.apply(this, arguments);
    };
  }

  const OPS = {
    setPrompt: (d) => setPrompt(d.text),
    armFilePick: (d) => arm(d.ms),
    disarmFilePick: () => disarm()
  };

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.src !== 'afl-req') return;
    let result;
    try {
      const op = OPS[e.data.op];
      result = op ? op(e.data) : { ok: false, error: 'UNKNOWN_OP' };
    } catch (err) {
      result = { ok: false, error: String(err?.message || err) };
    }
    window.postMessage({ src: 'afl-res', id: e.data.id, ...result }, '*');
  });
})();

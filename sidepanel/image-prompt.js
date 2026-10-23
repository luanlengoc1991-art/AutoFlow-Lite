// Prompt từ ảnh: ảnh lấy từ menu chuột phải (hoặc chọn vùng) → AI (ChatGPT / Gemini / Grok / Claude) mô tả
// thành prompt → sửa → Đưa vào Gen (kèm ảnh làm tham chiếu nếu muốn) / Copy. Lưu 30 lượt gần nhất.
import { store } from './lib/store.js';
import { checkAccount, STATE_TEXT, connectAccount } from './lib/accounts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PROVIDERS = [['chatgpt', 'ChatGPT', '#10a37f'], ['gemini', 'Gemini', '#7c6cf2'], ['grok', 'Grok', '#e5e5e5'], ['claude', 'Claude', '#d97757']];
const HISTORY_KEY = 'aflImagePrompts';
const HISTORY_LIMIT = 30;
const OPTS_KEY = 'aflImagePromptOpts';

const DETAIL = {
  short: 'one concise sentence (under 40 words)',
  medium: 'one paragraph (60-120 words)',
  long: 'one rich, detailed paragraph (150-250 words)'
};

export function buildImagePromptRequest(o) {
  const lang = o.lang === 'vi' ? 'Vietnamese' : 'English';
  const what = o.kind === 'video'
    ? 'a prompt for an AI video generator (Veo). Describe the subject, setting and style, then a natural motion for about 8 seconds, the camera movement, lighting and mood'
    : 'a prompt for an AI image generator that recreates this image. Cover the subject, composition and framing, art style or medium, lighting, color palette, camera/lens feel and mood';
  return [
    `Look at the attached image and write ${what}.`,
    `Length: ${DETAIL[o.detail] || DETAIL.medium}. Write it in ${lang}.`,
    o.extra ? `Also: ${o.extra}` : '',
    'Return ONLY the prompt text: no title, no quotes, no markdown, no explanation.'
  ].filter(Boolean).join('\n');
}

// Bỏ phần thừa AI hay thêm: khối code, "Prompt:", ngoặc kép bao ngoài.
export function cleanPromptAnswer(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
  s = s.replace(/^(?:\*\*)?(?:prompt|image prompt|video prompt)(?:\*\*)?\s*[:：]\s*/i, '');
  if (/^["“].*["”]$/s.test(s)) s = s.slice(1, -1).trim();
  return s;
}

// Thu nhỏ ảnh để lưu lịch sử (không giữ ảnh gốc nặng).
function thumbnail(dataUrl, size = 160) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

async function loadHistory() { return (await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] || []; }
async function pushHistory(entry) {
  const list = await loadHistory();
  list.unshift(entry);
  await chrome.storage.local.set({ [HISTORY_KEY]: list.slice(0, HISTORY_LIMIT) });
}

export async function openImagePrompt({ image, ask, toast, log, onInsert }) {
  const saved = (await chrome.storage.local.get(OPTS_KEY))[OPTS_KEY] || {};
  const o = { provider: 'chatgpt', kind: 'image', lang: 'en', detail: 'medium', extra: '', ...saved };
  const status = {};
  let view = image ? 'form' : 'history';
  let result = '';
  let busy = false;
  let history = await loadHistory();

  document.querySelector('dialog.image-prompt')?.remove();
  const d = document.createElement('dialog');
  d.className = 'assistant image-prompt';
  document.body.appendChild(d);
  const close = () => { d.close(); d.remove(); };
  d.addEventListener('cancel', close);
  const saveOpts = () => chrome.storage.local.set({ [OPTS_KEY]: { provider: o.provider, kind: o.kind, lang: o.lang, detail: o.detail } });

  async function refreshStatus(p) {
    status[p] = { state: 'checking' };
    render();
    status[p] = await checkAccount(p).catch(() => ({ state: 'error' }));
    render();
  }

  const chips = () => PROVIDERS.map(([id, name, color]) => {
    const st = status[id]?.state;
    const badge = st === 'checking' ? '…' : st ? STATE_TEXT[st] : '';
    return `<button class="as-prov ${o.provider === id ? 'active' : ''}" data-prov="${id}"><i style="background:${color}"></i>${name}${badge ? `<span class="st ${st}">${esc(badge)}</span>` : ''}</button>`;
  }).join('');
  const seg = (key, items) => `<div class="ip-seg">${items.map(([v, label]) => `<button data-set="${key}" data-val="${v}" class="${o[key] === v ? 'active' : ''}">${label}</button>`).join('')}</div>`;
  const head = `<div class="dlg-head"><b>🖼 Prompt từ ảnh</b><span class="ip-head-actions"><button class="link" data-view="history">Lịch sử (${history.length})</button><button class="icon-btn" data-x>✕</button></span></div>`;

  function renderForm() {
    return `${head}
      <div class="ip-image"><img src="${image}" alt=""></div>
      <div class="as-row"><span class="muted">Phân tích bằng</span>${chips()}</div>
      <div class="grid2">
        <label>Prompt cho${seg('kind', [['image', 'Ảnh'], ['video', 'Video']])}</label>
        <label>Ngôn ngữ${seg('lang', [['en', 'English'], ['vi', 'Tiếng Việt']])}</label>
      </div>
      <label>Độ dài${seg('detail', [['short', 'Ngắn'], ['medium', 'Vừa'], ['long', 'Chi tiết']])}</label>
      <input type="text" data-o="extra" value="${esc(o.extra)}" placeholder="Yêu cầu thêm (vd. đổi bối cảnh sang mùa đông)">
      ${result || busy ? `<label>Prompt<textarea class="ip-result" data-o="result" rows="7" ${busy ? 'disabled' : ''}>${esc(busy ? 'AI đang đọc ảnh…' : result)}</textarea></label>` : ''}
      ${result && !busy
        ? `<button class="as-go" data-insert>✦ Đưa vào Gen</button>
           <div class="as-actions"><button class="link" data-insert-ref>Đưa vào Gen + ảnh tham chiếu</button><button class="link" data-copy>Copy</button><button class="link" data-go>Phân tích lại</button></div>`
        : `<button class="as-go" data-go ${busy ? 'disabled' : ''}>${busy ? 'Đang phân tích…' : '✦ Phân tích'}</button>`}`;
  }

  function renderHistory() {
    return `<div class="dlg-head"><b>🖼 Lịch sử prompt từ ảnh</b><span class="ip-head-actions">${image ? '<button class="link" data-view="form">Quay lại</button>' : ''}<button class="icon-btn" data-x>✕</button></span></div>
      ${history.length ? `<div class="as-list">${history.map((h, i) => `<div class="as-item ip-hist">
          ${h.thumb ? `<img src="${h.thumb}" alt="">` : ''}
          <div><b>${esc(h.providerName || h.provider)} · ${new Date(h.at).toLocaleString('vi-VN')}</b><div>${esc(h.prompt)}</div>
          <div class="as-actions"><button class="link" data-hins="${i}">Đưa vào Gen</button><button class="link" data-hcopy="${i}">Copy</button></div></div></div>`).join('')}</div>
        <div class="as-actions"><button class="link" data-hclear>Xoá tất cả</button></div>`
        : '<p class="muted">Chưa có lịch sử. Chuột phải vào một ảnh trên trang bất kỳ → AutoFlow → Tạo prompt từ ảnh này.</p>'}`;
  }

  function render() {
    const focus = document.activeElement?.dataset?.o;
    d.innerHTML = view === 'form' ? renderForm() : renderHistory();
    if (focus) d.querySelector(`[data-o="${focus}"]`)?.focus();
  }

  function confirmReady(name) {
    const st = status[o.provider]?.state;
    if (st === 'ready') return true;
    toast(`${name} chưa sẵn sàng (${STATE_TEXT[st] || 'chưa kiểm tra'}). Hãy đăng nhập rồi thử lại.`);
    connectAccount(o.provider);
    return false;
  }

  async function analyze() {
    const name = PROVIDERS.find((p) => p[0] === o.provider)[1];
    if (status[o.provider]?.state !== 'ready') status[o.provider] = await checkAccount(o.provider, { open: true }).catch(() => ({ state: 'error' }));
    if (!confirmReady(name)) { render(); return; }
    busy = true; render();
    try {
      const refId = store.addRef({ name: `anh_${Date.now()}.png`, mime: image.slice(5, image.indexOf(';')) || 'image/png', dataUrl: image });
      const answer = await ask(o.provider, buildImagePromptRequest(o), { refIds: [refId] });
      result = cleanPromptAnswer(answer);
      if (!result) throw new Error('AI không trả về prompt');
      log?.(`Prompt từ ảnh (${name}) xong`, 'ok');
      await pushHistory({ at: Date.now(), provider: o.provider, providerName: name, kind: o.kind, prompt: result, thumb: await thumbnail(image) });
      history = await loadHistory();
    } catch (err) {
      toast(err.message);
      log?.(`Prompt từ ảnh lỗi: ${err.message}`, 'error');
    } finally {
      busy = false; render();
    }
  }

  d.addEventListener('input', (e) => {
    const k = e.target.dataset.o;
    if (k === 'extra') o.extra = e.target.value;
    if (k === 'result') result = e.target.value;
  });

  d.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-x]')) { close(); return; }
    const v = t.closest('[data-view]')?.dataset.view;
    if (v) { view = v; render(); return; }
    const prov = t.closest('[data-prov]')?.dataset.prov;
    if (prov) { o.provider = prov; saveOpts(); refreshStatus(prov); return; }
    const set = t.closest('[data-set]');
    if (set) { o[set.dataset.set] = set.dataset.val; saveOpts(); render(); return; }
    if (t.closest('[data-go]')) { if (!busy) analyze(); return; }
    if (t.closest('[data-insert]')) { onInsert(result, o.kind, null); close(); return; }
    if (t.closest('[data-insert-ref]')) { onInsert(result, o.kind, image); close(); return; }
    if (t.closest('[data-copy]')) { navigator.clipboard.writeText(result); toast('Đã copy'); return; }
    const hi = t.closest('[data-hins]');
    if (hi) { const h = history[+hi.dataset.hins]; onInsert(h.prompt, h.kind, null); close(); return; }
    const hc = t.closest('[data-hcopy]');
    if (hc) { navigator.clipboard.writeText(history[+hc.dataset.hcopy].prompt); toast('Đã copy'); return; }
    if (t.closest('[data-hclear]')) { await chrome.storage.local.remove(HISTORY_KEY); history = []; render(); }
  });

  render();
  d.showModal();
  if (image) refreshStatus(o.provider);
}

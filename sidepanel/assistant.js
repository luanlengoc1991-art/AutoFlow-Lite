// Trợ lý prompt (theo quy trình bản gốc): nhập nội dung → chọn AI (Ready) + phong cách → xác nhận →
// AI viết danh sách prompt có tiêu đề + lời thoại → Đưa vào Gen / Copy / Copy phụ đề SRT.
import { store } from './lib/store.js';
import { checkAccount, STATE_TEXT, connectAccount } from './lib/accounts.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Phong cách nội dung theo danh mục; hướng dẫn được gửi kèm yêu cầu cho AI.
export const ASSISTANT_STYLES = [
  { cat: 'Storytelling', id: 'cinema-story', name: 'Kể chuyện điện ảnh', color: '#3b82f6', guide: 'cinematic storytelling, emotional beats, consistent characters, film lighting' },
  { cat: 'Storytelling', id: 'watercolor-story', name: 'Truyện màu nước', color: '#84cc16', guide: 'soft watercolor and ink storybook illustration, recurring protagonist, warm earth tones' },
  { cat: 'Animation', id: 'pixar', name: 'Hoạt hình 3D', color: '#f59e0b', guide: '3D animated feature style, expressive characters, soft global illumination' },
  { cat: 'Animation', id: 'clay', name: 'Đất sét 3D', color: '#ef4444', guide: 'stylized clay 3D animation, handmade textures, stop-motion feel' },
  { cat: 'Animation', id: 'anime', name: 'Anime', color: '#ec4899', guide: 'anime style, clean line art, vibrant colors, dynamic composition' },
  { cat: 'Lifestyle', id: 'vlog', name: 'Vlog đời thường', color: '#f97316', guide: 'handheld vlog look, natural light, candid everyday moments' },
  { cat: 'Lifestyle', id: 'food', name: 'Ẩm thực', color: '#eab308', guide: 'appetizing food cinematography, macro details, steam, warm tones' },
  { cat: 'Education', id: 'econ', name: 'Giải thích kinh tế', color: '#14b8a6', guide: 'friendly explainer illustration, simple charts and icons, short on-screen Vietnamese titles' },
  { cat: 'Education', id: 'space', name: 'Khoa học vũ trụ', color: '#6366f1', guide: 'awe-inspiring space visuals, accurate scale, documentary tone' },
  { cat: 'Education', id: 'psych', name: 'Tâm lý học', color: '#a855f7', guide: 'symbolic minimal illustration, metaphors for emotions, calm pacing' },
  { cat: 'Relax', id: 'nature', name: 'Thiên nhiên chill', color: '#22c55e', guide: 'serene nature scenes, slow camera, soft ambient light' },
  { cat: 'Relax', id: 'lofi', name: 'Lofi', color: '#8b5cf6', guide: 'cozy lofi illustration, warm lamp light, rain on window' },
  { cat: 'Fitness', id: 'fitness', name: 'Tập luyện', color: '#06b6d4', guide: 'energetic fitness shots, clear exercise form, gym or outdoor lighting' }
];

const PROVIDERS = [['chatgpt', 'ChatGPT', '#10a37f'], ['gemini', 'Gemini', '#7c6cf2'], ['grok', 'Grok', '#e5e5e5']];

function buildRequest(o) {
  const style = ASSISTANT_STYLES.find((s) => s.id === o.styleId);
  const count = o.count === 'auto' ? 'a suitable number of (3-10)' : `exactly ${o.count}`;
  const kind = o.kind === 'video'
    ? `video generation prompts (each scene about ${o.seconds} seconds: subject, action, camera movement, lighting, mood)`
    : 'image generation prompts (subject, composition, style, lighting, details)';
  return [
    `You are a prompt writer for Google Flow (Veo / Nano Banana). Based on the content below, write ${count} scenes as ${kind}.`,
    style ? `Visual style for every prompt: ${style.guide}.` : '',
    `Write each prompt in ${o.lang}. Keep the same characters and style across all prompts.`,
    o.voice ? 'For each scene also write a short Vietnamese voiceover line.' : '',
    o.extra ? `Extra requirements: ${o.extra}` : '',
    o.hasRefs ? 'Use the attached reference image(s) to describe the main subject consistently.' : '',
    'Return ONLY a JSON array, no markdown, like: [{"title":"short scene title","prompt":"...","voiceover":"..."}]',
    '',
    'CONTENT:',
    o.content
  ].filter((x) => x !== '').join('\n');
}

// Đọc JSON trong câu trả lời; nếu AI không trả JSON thì tách theo dòng / đoạn.
export function parseAnswer(text) {
  const raw = String(text || '');
  const start = raw.indexOf('['), end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const arr = JSON.parse(raw.slice(start, end + 1));
      const items = arr.map((x, i) => (typeof x === 'string' ? { title: `Cảnh ${i + 1}`, prompt: x } : { title: x.title || `Cảnh ${i + 1}`, prompt: x.prompt || x.text || '', voiceover: x.voiceover || x.voice || '' }))
        .filter((x) => x.prompt);
      if (items.length) return items;
    } catch (_) { /* không phải JSON hợp lệ */ }
  }
  const blocks = /\n\s*\n/.test(raw) ? raw.split(/\n\s*\n/) : raw.split('\n');
  return blocks.map((b) => b.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter((b) => b.length > 3)
    .map((p, i) => ({ title: `Cảnh ${i + 1}`, prompt: p }));
}

const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')},000`; };
export function toSrt(items, seconds) {
  return items.map((it, i) => `${i + 1}\n${ts(i * seconds)} --> ${ts((i + 1) * seconds)}\n${it.voiceover || it.title}\n`).join('\n');
}

export function openAssistant({ ask, onInsert, toast, log, defaultKind = 'image', defaultProvider = 'chatgpt' }) {
  const o = { provider: defaultProvider, content: '', styleId: '', cat: 'Storytelling', kind: defaultKind, count: 'auto', seconds: 8, lang: 'English', voice: false, extra: '', refs: [] };
  const status = {};
  let items = [];
  const d = document.createElement('dialog');
  d.className = 'assistant';
  document.body.appendChild(d);
  const close = () => { d.close(); d.remove(); };
  d.addEventListener('cancel', close);

  async function refreshStatus(p) {
    status[p] = { state: 'checking' };
    render();
    status[p] = await checkAccount(p).catch(() => ({ state: 'error' }));
    render();
  }

  function providerChips() {
    return PROVIDERS.map(([id, name, color]) => {
      const st = status[id]?.state;
      const badge = st === 'checking' ? '…' : st ? STATE_TEXT[st] : '';
      return `<button class="as-prov ${o.provider === id ? 'active' : ''}" data-prov="${id}"><i style="background:${color}"></i>${name}${badge ? `<span class="st ${st}">${esc(badge)}</span>` : ''}</button>`;
    }).join('');
  }

  function renderForm() {
    const cats = [...new Set(ASSISTANT_STYLES.map((s) => s.cat))];
    const styles = ASSISTANT_STYLES.filter((s) => s.cat === o.cat);
    return `<div class="dlg-head"><b>✦ Trợ lý prompt</b><button class="icon-btn" data-x>✕</button></div>
      <div class="as-row"><span class="muted">Tạo bằng</span>${providerChips()}</div>
      <textarea class="as-content" data-o="content" placeholder="Dán kịch bản / ý tưởng / nội dung bài viết…">${esc(o.content)}</textarea>
      <div class="as-cats">${cats.map((c) => `<button data-cat="${c}" class="${o.cat === c ? 'active' : ''}">${c}</button>`).join('')}</div>
      <div class="as-styles">
        <button class="as-style ${o.styleId ? '' : 'active'}" data-style=""><span class="sw none">⊘</span><small>Không</small></button>
        ${styles.map((s) => `<button class="as-style ${o.styleId === s.id ? 'active' : ''}" data-style="${s.id}"><span class="sw" style="background:linear-gradient(135deg, ${s.color}, #1d1d1d)">${esc(s.name.slice(0, 1))}</span><small>${esc(s.name)}</small></button>`).join('')}
      </div>
      <div class="grid2">
        <label>Loại<select data-o="kind"><option value="image" ${o.kind === 'image' ? 'selected' : ''}>Ảnh</option><option value="video" ${o.kind === 'video' ? 'selected' : ''}>Video</option></select></label>
        <label>Số lượng<select data-o="count">${['auto', 3, 4, 5, 6, 7, 8, 10, 12, 15, 20].map((n) => `<option value="${n}" ${String(o.count) === String(n) ? 'selected' : ''}>${n === 'auto' ? 'auto' : n}</option>`).join('')}</select></label>
      </div>
      <div class="as-refs"><span class="muted">Ảnh tham chiếu (tuỳ chọn, gửi kèm cho AI)</span>
        <div class="row">${o.refs.map((r, i) => `<span class="as-ref"><img src="${r.dataUrl}" alt=""><button data-rmref="${i}">✕</button></span>`).join('')}<button class="chip" data-addref>+ Chọn ảnh</button></div></div>
      <details class="as-adv"><summary>Nâng cao</summary>
        <div class="grid2">
          <label>Ngôn ngữ prompt<select data-o="lang"><option ${o.lang === 'English' ? 'selected' : ''} value="English">Tiếng Anh</option><option ${o.lang === 'Vietnamese' ? 'selected' : ''} value="Vietnamese">Tiếng Việt</option></select></label>
          <label>Độ dài mỗi cảnh video<select data-o="seconds">${[4, 6, 8, 10].map((n) => `<option ${o.seconds === n ? 'selected' : ''} value="${n}">${n}s</option>`).join('')}</select></label>
        </div>
        <label class="switch line"><input type="checkbox" data-o="voice" ${o.voice ? 'checked' : ''}><span></span>Viết lời thoại (để xuất phụ đề SRT)</label>
        <textarea data-o="extra" rows="2" placeholder="Yêu cầu thêm (vd. chữ tiếng Việt trên ảnh, tỉ lệ 9:16…)">${esc(o.extra)}</textarea>
      </details>
      <button class="as-go" data-go>✦ Tạo prompt</button>
      <input type="file" accept="image/*" multiple hidden data-file>`;
  }

  function renderResults() {
    return `<div class="dlg-head"><b>✦ Trợ lý prompt</b><button class="icon-btn" data-x>✕</button></div>
      <p class="muted">Đã tạo ${items.length} prompt</p>
      <div class="as-list">${items.map((it, i) => `<div class="as-item"><b>${i + 1}. ${esc(it.title)}</b>${it.voiceover ? `<em>🎙 ${esc(it.voiceover)}</em>` : ''}<div>${esc(it.prompt)}</div></div>`).join('')}</div>
      <button class="as-go" data-insert>✦ Đưa vào AutoFlow</button>
      <div class="as-actions"><button class="link" data-copy>Copy</button><button class="link" data-srt>Copy phụ đề (SRT)</button><button class="link" data-back>Quay lại</button></div>`;
  }

  let view = 'form';
  function render() {
    const focus = document.activeElement?.dataset?.o;
    d.innerHTML = view === 'form' ? renderForm() : renderResults();
    if (focus) d.querySelector(`[data-o="${focus}"]`)?.focus();
  }

  d.addEventListener('input', (e) => {
    const k = e.target.dataset.o;
    if (!k) return;
    o[k] = e.target.type === 'checkbox' ? e.target.checked : (k === 'seconds' ? +e.target.value : e.target.value);
  });
  d.addEventListener('change', (e) => { if (e.target.dataset.o === 'kind' || e.target.dataset.o === 'count') render(); });

  function confirmDialog() {
    const name = PROVIDERS.find((p) => p[0] === o.provider)[1];
    const st = status[o.provider]?.state;
    return new Promise((resolve) => {
      const c = document.createElement('div');
      c.className = 'as-confirm';
      c.innerHTML = `<div class="box"><div class="dlg-head"><b>Tạo prompt với ${name}</b></div>
        <div class="as-prov active" style="width:100%"><i style="background:${PROVIDERS.find((p) => p[0] === o.provider)[2]}"></i>${name}<span class="st ${st || ''}">${esc(STATE_TEXT[st] || 'Chưa kiểm tra')}</span></div>
        <p class="muted">${st === 'ready' ? `Sẽ mở tab ${name} và gửi yêu cầu tạo prompt tự động bằng tài khoản của bạn (tính vào hạn mức gói đang dùng). Tiếp tục?` : `${name} chưa sẵn sàng. Hãy đăng nhập ${name} trên trình duyệt rồi thử lại.`}</p>
        <div class="btn-row"><button class="btn" data-no>Huỷ</button>${st === 'ready' ? '<button class="btn primary" data-yes>Tạo prompt</button>' : `<button class="btn primary" data-login>Mở ${name} để đăng nhập</button>`}</div></div>`;
      d.appendChild(c);
      c.addEventListener('click', (e) => {
        if (e.target.closest('[data-yes]')) { c.remove(); resolve(true); }
        if (e.target.closest('[data-no]')) { c.remove(); resolve(false); }
        if (e.target.closest('[data-login]')) { connectAccount(o.provider); c.remove(); resolve(false); }
      });
    });
  }

  d.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.closest('[data-x]')) { close(); return; }
    const prov = t.closest('[data-prov]')?.dataset.prov;
    if (prov) { o.provider = prov; refreshStatus(prov); return; }
    const cat = t.closest('[data-cat]')?.dataset.cat;
    if (cat) { o.cat = cat; render(); return; }
    const st = t.closest('[data-style]');
    if (st) { o.styleId = st.dataset.style; render(); return; }
    if (t.closest('[data-addref]')) { d.querySelector('[data-file]').click(); return; }
    const rm = t.closest('[data-rmref]');
    if (rm) { o.refs.splice(+rm.dataset.rmref, 1); render(); return; }
    if (t.closest('[data-go]')) {
      if (!o.content.trim()) { toast('Nhập nội dung trước'); return; }
      if (!status[o.provider] || status[o.provider].state === 'checking') status[o.provider] = await checkAccount(o.provider, { open: true }).catch(() => ({ state: 'error' }));
      render();
      if (!(await confirmDialog())) return;
      const name = PROVIDERS.find((p) => p[0] === o.provider)[1];
      d.querySelector('[data-go]').disabled = true;
      d.querySelector('[data-go]').textContent = `Đang chờ ${name} trả lời…`;
      try {
        const refIds = o.refs.map((r) => store.addRef(r));
        const answer = await ask(o.provider, buildRequest({ ...o, hasRefs: refIds.length > 0 }), { refIds });
        items = parseAnswer(answer);
        if (!items.length) throw new Error('Không đọc được prompt nào từ câu trả lời');
        log?.(`Trợ lý (${name}) tạo ${items.length} prompt`, 'ok');
        view = 'results';
        render();
      } catch (err) {
        toast(err.message);
        log?.(`Trợ lý lỗi: ${err.message}`, 'error');
        render();
      }
      return;
    }
    if (t.closest('[data-insert]')) { onInsert(items.map((x) => x.prompt), o.kind); close(); return; }
    if (t.closest('[data-copy]')) { navigator.clipboard.writeText(items.map((x) => x.prompt).join('\n\n')); toast('Đã copy'); return; }
    if (t.closest('[data-srt]')) { navigator.clipboard.writeText(toSrt(items, o.kind === 'video' ? o.seconds : 4)); toast('Đã copy phụ đề SRT'); return; }
    if (t.closest('[data-back]')) { view = 'form'; render(); }
  });
  d.addEventListener('change', async (e) => {
    if (!e.target.matches('[data-file]')) return;
    for (const f of [...e.target.files].slice(0, 4)) {
      const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
      o.refs.push({ name: f.name, mime: f.type, dataUrl });
    }
    render();
  });

  render();
  d.showModal();
  refreshStatus(o.provider);
}

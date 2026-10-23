// Trình soạn workflow: canvas tự viết (pan/zoom, kéo node, nối cổng có kiểu, chọn khung, hoàn tác),
// panel cấu hình node, menu chuột phải. Lưu vào chrome.storage; việc chạy do side panel đảm nhận.
import { store } from './lib/store.js';
import {
  NODE_DEFS, PORT_TYPES, PROVIDER_LABEL, TEXT_AI, canConnect, portsOf, portType, createNode, newWorkflow, normalizeWorkflow, slugify, nid, splitMultiPrompt
} from './lib/workflow-nodes.js';
import { instantiateTemplate } from './lib/workflow-templates.js';
import { SEEDANCE_MODELS, SEEDANCE_RATIOS, SEEDANCE_DURATIONS, CHAT_MODELS, CHAT_RATIOS } from './lib/defaults.js';
import * as flow from './lib/flow.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const canvas = $('canvas'), world = $('world'), nodesEl = $('nodes'), edgesEl = $('edges');
const FALLBACK_MODELS = { image: ['Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'], video: ['Veo 3.1 - Fast', 'Veo 3.1 - Quality'] };
const RATIOS = { image: ['16:9', '9:16', '1:1', '4:3', '3:4'], video: ['16:9', '9:16'] };
const PROVIDER_COLOR = { flow: 'conic-gradient(#4285f4 0 25%, #ea4335 0 50%, #fbbc05 0 75%, #34a853 0)', chatgpt: '#10a37f', gemini: 'linear-gradient(135deg,#4285f4,#a142f4)', grok: '#e8e8e8', claude: '#d97757', seedance: 'linear-gradient(135deg,#00c2ff,#7b61ff)' };
const MAX_PROMPT = 40000;
const pages = new Map(); // nodeId -> kết quả đang xem (01/07)
const mediaInfo = new Map(); // url -> "1520 × 2688" / "00:05"

// ---------- Biểu tượng ----------
const I = {
  send: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 3L3 10.5l7 2.5 2.5 7z"/><path d="M21 3L10 13"/></svg>',
  image: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  video: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M22 8l-6 4 6 4z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>',
  text: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V5h16v2M12 5v14M9 19h6"/></svg>',
  prompt: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20L15 9M14 4v3M19 9h-3M17.5 5.5l-2 2"/></svg>',
  extract: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h10M4 18h6"/></svg>',
  generate: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></svg>',
  chat: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>',
  download: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg>',
  delay: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  note: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></svg>',
  play: '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4l14 8-14 8z"/></svg>',
  gear: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  branch: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/></svg>',
  copy: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/></svg>',
  trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg>',
  power: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3v9M6.3 7a8 8 0 1011.4 0"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  help: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01"/></svg>',
  tag: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 12V4a1 1 0 011-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/></svg>',
  plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  paste: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-4.5 4 3.5 3-2.5 4.5 3.5"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0115.5-6.4L21 8M21 3v5h-5M21 12a9 9 0 01-15.5 6.4L3 16M3 21v-5h5"/></svg>',
  lib: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h7M16 5h6M19 2v6"/></svg>',
  undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  redo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 000 11H13"/></svg>',
  fit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 8V5a2 2 0 012-2h3M16 3h3a2 2 0 012 2v3M21 16v3a2 2 0 01-2 2h-3M8 21H5a2 2 0 01-2-2v-3"/></svg>',
  arrange: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  list: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg>',
  assistant: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'
};
const portGlyph = (type) => (type === 'image' ? I.image : type === 'video' ? I.video : esc(PORT_TYPES[type]?.glyph || '*'));

// ---------- Trạng thái ----------
let wf, view = { x: 0, y: 0, zoom: 1 };
let selection = new Set(), selectedEdge = null, tool = 'select', spaceDown = false;
let runState = null;
const undoStack = [], redoStack = [];

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ---------- Lưu ----------
let saveTimer;
const snapshot = () => JSON.stringify({ nodes: wf.nodes, edges: wf.edges });
function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  updateUndoButtons();
}
function restore(snap) {
  const s = JSON.parse(snap);
  wf.nodes = s.nodes; wf.edges = s.edges;
  selection = new Set([...selection].filter((id) => wf.nodes.some((n) => n.id === id)));
  closeSide();
  renderAll();
  dirty();
}
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); updateUndoButtons(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); updateUndoButtons(); }
function updateUndoButtons() { $('tb-undo').disabled = !undoStack.length; $('tb-redo').disabled = !redoStack.length; }

function dirty() {
  $('save-state').textContent = 'Đang lưu…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
  updateStats();
}
async function save() {
  clearTimeout(saveTimer);
  wf.name = $('wf-title').value.trim() || wf.name;
  wf.viewport = { ...view };
  wf.updatedAt = Date.now();
  const { aflWorkflows = [] } = await chrome.storage.local.get('aflWorkflows');
  const i = aflWorkflows.findIndex((w) => w.id === wf.id);
  // Kết quả chạy do side panel ghi: giữ bản mới nhất trong storage.
  if (i >= 0) { wf.results = aflWorkflows[i].results || wf.results; wf.runs = aflWorkflows[i].runs || wf.runs; aflWorkflows[i] = wf; } else aflWorkflows.unshift(wf);
  selfWrite = true;
  await chrome.storage.local.set({ aflWorkflows });
  $('save-state').textContent = `Đã lưu ${new Date().toLocaleTimeString()}`;
  document.title = `${wf.name} · Workflow Editor`;
  history.replaceState(null, '', `?id=${wf.id}`);
}
let selfWrite = false;

// ---------- View ----------
function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
  const cp = nodesEl.querySelector('.composer');
  if (cp) cp.style.transform = `scale(${1 / view.zoom})`;
  const g = 22 * view.zoom;
  canvas.style.backgroundSize = `${g}px ${g}px`;
  canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('zoom-val').textContent = `${Math.round(view.zoom * 100)}%`;
}
const toWorld = (cx, cy) => ({ x: (cx - view.x) / view.zoom, y: (cy - view.y) / view.zoom });
function zoomAt(cx, cy, z) {
  const nz = Math.min(2.5, Math.max(0.15, z));
  const p = toWorld(cx, cy);
  view.zoom = nz;
  view.x = cx - p.x * nz;
  view.y = cy - p.y * nz;
  applyView();
  renderEdges();
}
function nodeBox(n) {
  const el = nodeEl(n.id);
  return { x: n.x, y: n.y, w: el ? el.offsetWidth : 300, h: el ? el.offsetHeight : 200 };
}
function fitView() {
  const list = wf.nodes;
  if (!list.length) { view = { x: innerWidth / 2 - 150, y: innerHeight / 2 - 120, zoom: 1 }; applyView(); return; }
  const boxes = list.map(nodeBox);
  const minX = Math.min(...boxes.map((b) => b.x)) - 60, minY = Math.min(...boxes.map((b) => b.y)) - 40;
  const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 60, maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 40;
  const W = innerWidth - 120, H = innerHeight - 160;
  const z = Math.min(1.2, Math.max(0.2, Math.min(W / (maxX - minX), H / (maxY - minY))));
  view.zoom = z;
  view.x = 60 + (W - (maxX - minX) * z) / 2 - minX * z;
  view.y = 70 + (H - (maxY - minY) * z) / 2 - minY * z;
  applyView();
  renderEdges();
}
function focusNode(id) {
  const n = wf.nodes.find((x) => x.id === id);
  if (!n) return;
  const b = nodeBox(n);
  view.x = innerWidth / 2 - (b.x + b.w / 2) * view.zoom;
  view.y = innerHeight / 2 - (b.y + b.h / 2) * view.zoom;
  applyView();
  select([id]);
}

// ---------- Render node ----------
const nodeEl = (id) => nodesEl.querySelector(`.node[data-node="${id}"]`);
const optionsFor = (kind) => (store.options?.[kind]?.models?.length ? store.options[kind].models : FALLBACK_MODELS[kind]);
const ratioClass = (r) => (r ? `r-${r.replace(':', '-')}` : '');

function chipSelect(key, value, options, label) {
  const opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  if (value && !opts.some(([v]) => String(v) === String(value))) opts.push([value, value]);
  return `<span class="chip" title="${esc(label)}"><span class="v">${esc(opts.find(([v]) => String(v) === String(value))?.[1] ?? value)}</span><span class="chip-arrow">▾</span>
    <select data-k="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></span>`;
}

// Kết quả trong node: xem từng cái, lật trang "03/07", góc trên hiện kích thước / thời lượng.
function previewHtml(n) {
  const res = statusOf(n)?.preview ? statusOf(n) : runReset ? null : wf.results?.[n.id];
  const media = (res?.preview || []).filter((p) => p.kind !== 'text');
  const isVid = n.type === 'seedance' || (n.type === 'generate' && n.data.genType === 'video');
  if (!media.length) return `<div class="viewer"><div class="ph">${isVid ? I.video.replace(/13/g, '30') : I.image.replace(/13/g, '30')}</div></div>`;
  const i = Math.min(pages.get(n.id) || 0, media.length - 1);
  const m = media[i];
  const pad = (k) => String(k).padStart(2, '0');
  const src = (m.kind !== 'video' && fullSrc.get(m.url)?.src) || m.thumb || (m.kind !== 'video' ? m.url : '');
  return `<div class="viewer has">${src ? `<img src="${esc(src)}" data-full="${esc(m.url || '')}" data-kind="${m.kind}" data-provider="${esc(m.provider || '')}" alt="">` : `<div class="ph">${m.kind === 'video' ? I.video : I.image}</div>`}
    ${m.kind === 'video' ? '<span class="play-badge">▶</span><span class="edit-btns"><button class="edit-btn" data-act="edit-inplace" title="Thêm prompt sửa nối vào node này: bấm ▶ trên prompt đó để tạo lại video với cùng thiết lập + nội dung sửa">✎ Sửa video</button></span>' : `<span class="edit-btns"><button class="edit-btn" data-act="edit-inplace" title="Thêm prompt sửa nối vào node này: bấm ▶ trên prompt đó để sửa chính ảnh đang có">✎ Sửa ảnh</button><button class="edit-btn" data-act="edit-result" title="Chép ảnh sang nhánh mới để sửa riêng (node này giữ nguyên)">⎇</button></span>`}
    <span class="dims" data-info="${esc(m.url || '')}" data-kind="${m.kind}">${esc(mediaInfo.get(m.url) || '')}</span>
    ${media.length > 1 ? `<div class="pager"><button data-act="page-prev" title="Trước">‹</button><span>${pad(i + 1)}/${pad(media.length)}</span><button data-act="page-next" title="Sau">›</button></div>` : ''}</div>`;
}

// Ảnh gốc đúng pixel cho node (ảnh thu nhỏ chỉ dùng tạm). Thử tải thẳng URL; trang cần đăng nhập
// (vd. ChatGPT) thì đọc qua chính tab của provider. Lưu trong phiên: url -> { src, w, h }.
const fullSrc = new Map();
const fullPending = new Map();
function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}
async function fetchFull(url, provider) {
  try {
    const img = await loadImage(url);
    return { src: url, w: img.naturalWidth, h: img.naturalHeight };
  } catch (_) {
    const tab = provider ? await flow.findTab(provider) : null;
    if (!tab) throw new Error('Không mở được ảnh gốc');
    const r = await flow.send(tab.id, { type: 'afl:fetch', url });
    if (!r?.ok) throw new Error(r?.error || 'Không đọc được ảnh gốc');
    const src = URL.createObjectURL(await (await fetch(r.dataUrl)).blob());
    const img = await loadImage(src);
    return { src, w: img.naturalWidth, h: img.naturalHeight };
  }
}
const pad2 = (k) => String(k).padStart(2, '0');
// Khung node theo đúng tỉ lệ ảnh/video (không cắt), góc trên hiện kích thước thật.
function fitMedia(el, w, h, label) {
  const box = el.closest('.nb-media');
  if (box && w && h) box.style.aspectRatio = `${w} / ${h}`;
  const dims = el.closest('.viewer, .lm, .res-item')?.querySelector('.dims');
  if (dims && label) dims.textContent = label;
}
function loadMediaInfo(root) {
  root.querySelectorAll('img[data-full]').forEach((img) => {
    const url = img.dataset.full;
    if (!url || img.dataset.kind === 'video') return;
    const apply = (f) => {
      if (!img.isConnected) return;
      if (img.src !== f.src) img.src = f.src;
      mediaInfo.set(url, `${f.w} × ${f.h}`);
      fitMedia(img, f.w, f.h, `${f.w} × ${f.h}`);
    };
    if (fullSrc.has(url)) { apply(fullSrc.get(url)); return; }
    if (!fullPending.has(url)) {
      fullPending.set(url, fetchFull(url, img.dataset.provider).then((f) => { fullSrc.set(url, f); return f; }).finally(() => fullPending.delete(url)));
    }
    // Không tải được bản gốc: giữ ảnh thu nhỏ nhưng vẫn đúng tỉ lệ.
    fullPending.get(url).then(apply, () => { if (img.naturalWidth) fitMedia(img, img.naturalWidth, img.naturalHeight, ''); });
  });
  root.querySelectorAll('.dims[data-info][data-kind="video"]').forEach((el) => {
    const url = el.dataset.info;
    if (!url) return;
    const known = mediaInfo.get(url);
    if (known) { el.textContent = known.text; fitMedia(el, known.w, known.h); return; }
    if (mediaInfo.has(url)) return;
    mediaInfo.set(url, '');
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      const s = Math.round(v.duration || 0);
      const info = { text: `${v.videoWidth} × ${v.videoHeight} · ${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`, w: v.videoWidth, h: v.videoHeight, toString() { return this.text; } };
      mediaInfo.set(url, info);
      document.querySelectorAll(`.dims[data-info="${CSS.escape(url)}"]`).forEach((x) => { x.textContent = info.text; fitMedia(x, info.w, info.h); });
      v.src = '';
    };
    v.src = url;
  });
}

function peekHtml(n) {
  const p = promptOf(n);
  return `<div class="prompt-peek ${p ? '' : 'empty'}" data-for="${n.id}" title="${esc(p)}">${esc(p || 'Chưa có prompt: nối node Prompt hoặc nhập trong ⚙')}</div>`;
}

function bodyHtml(n) {
  const d = n.data;
  switch (n.type) {
    case 'prompt': {
      // Kết quả AI của lần chạy gần nhất hiện ngay trong node (như bản gốc: "AI OUTPUT · ChatGPT").
      const res = statusOf(n) || (runReset ? null : wf.results?.[n.id]);
      const aiText = d.agent ? (res?.preview || []).filter((p) => p.kind === 'text').map((p) => p.text).join('\n') : '';
      return `<div class="nb-text"><textarea data-k="text" placeholder="Nhập prompt..." maxlength="${MAX_PROMPT}">${esc(d.text)}</textarea></div>
        ${aiText ? `<div class="ai-out"><span>✦ AI OUTPUT · ${esc(PROVIDER_LABEL[d.agentProvider])}</span><div>${esc(aiText.slice(0, 600))}</div></div>` : ''}
        <div class="chips">
          <span class="chip toggle ${d.multi ? 'on' : ''}" data-toggle="multi" title="Mỗi dòng là 1 prompt riêng">Multi-prompt</span>
          <span class="foot-mode" title="${d.agent ? 'AI Agent đang bật' : 'Văn bản nguyên văn, không gọi AI'}">${d.agent ? `AI · ${esc(PROVIDER_LABEL[d.agentProvider])}` : 'Plain'}</span>
          <span class="counter">${d.text.length}/${MAX_PROMPT.toLocaleString('vi')}</span>
          <span class="chip gear" data-act="config" title="Cấu hình">${I.gear}</span>
        </div>`;
    }
    case 'text':
      return `<div class="nb-text"><textarea data-k="text" placeholder="Văn bản tĩnh (dùng @${esc(d.slug || 'slug')} ở node khác)">${esc(d.text)}</textarea></div>
        <div class="chips"><span class="counter">${d.text.length}/${MAX_PROMPT.toLocaleString('vi')}</span><span class="chip gear" data-act="config">${I.gear}</span></div>`;
    case 'extract': {
      const res = statusOf(n) || (runReset ? null : wf.results?.[n.id]);
      const got = (res?.preview || []).filter((p) => p.kind === 'text').map((p) => p.text).join('\n');
      const how = { marker: `[${d.marker}]`, lines: 'Tách mỗi dòng', line: `Lấy dòng ${d.index || 1}`, regex: `Regex: ${d.pattern}`, between: `Giữa "${d.start}" và "${d.end}"`, json: `JSON: ${d.path}` }[d.mode];
      return `<div class="nb-small">${I.extract} ${esc(how)}<span class="chip gear" data-act="config">${I.gear}</span></div>
        ${got ? `<div class="ai-out extracted"><span>EXTRACTED</span><div>${esc(got.slice(0, 500))}</div></div>` : ''}`;
    }
    case 'image': {
      const m = d.media || [];
      return `<div class="nb-media" data-drop="1">${m.length
        ? `<div class="grid ${m.length === 1 ? 'one' : ''}">${m.slice(0, 4).map((x) => `<img src="${x.thumb || x.dataUrl}" alt="">`).join('')}</div>`
        : `<div class="ph">${I.image.replace(/13/g, '30')}<span>Bấm để tải lên, kéo thả<br>hoặc dán ảnh (Ctrl+V)</span></div>`}</div>
        ${m.length ? `<span class="media-count">${m.length} ${m[0].kind === 'video' ? 'video' : 'ảnh'}</span>` : ''}`;
    }
    case 'generate': {
      const kind = d.genType === 'video' ? 'video' : 'image';
      const chips = [
        chipSelect('quantity', d.quantity, [1, 2, 3, 4].map((q) => [q, `${q}x`]), 'Số kết quả'),
        chipSelect('genType', d.genType, [['image', 'Image'], ['video', 'Video']], 'Loại'),
        chipSelect('model', d.model, [['', 'Model Flow'], ...optionsFor(kind)], 'Model'),
        chipSelect('ratio', d.ratio, [['', 'Tỉ lệ'], ...RATIOS[kind]], 'Tỉ lệ')
      ];
      if (kind === 'video') {
        chips.push(chipSelect('videoMode', d.videoMode, [['frames', 'Frames'], ['ingredients', 'Ingredients'], ['text', 'Text']], 'Kiểu video'));
        chips.push(chipSelect('duration', d.duration, [['', 'Thời lượng'], '4s', '6s', '8s'], 'Thời lượng'));
      }
      return `<div class="nb-media ${ratioClass(d.ratio || (kind === 'video' ? '9:16' : '9:16'))}">
          <button class="corner-run" data-act="run-node" title="Chạy node">${I.play}</button>
          <button class="tog sm corner-tog ${d.enabled ? 'on' : ''}" data-act="toggle-enabled" title="Bật/tắt node"></button>
          ${previewHtml(n)}
        </div>
        ${peekHtml(n)}<div class="chips">${chips.join('')}<span class="chip gear" data-act="config">${I.gear}</span></div>`;
    }
    case 'assistant': {
      const res = statusOf(n) || (runReset ? null : wf.results?.[n.id]);
      const out = (res?.preview || []).filter((p) => p.kind === 'text').map((p, i) => (d.exportAs === 'list' ? `${i + 1}. ${p.text}` : p.text)).join('\n');
      return `<div class="nb-text"><textarea data-k="text" placeholder="Assistant là trợ lý sáng tạo: nhập yêu cầu, nối ảnh để AI xem. VD: cho tôi 10 bối cảnh quảng cáo cho sản phẩm này">${esc(d.text)}</textarea></div>
        ${out ? `<div class="ai-out"><span>✦ ${esc(PROVIDER_LABEL[d.provider] || '')}</span><div>${esc(out.slice(0, 1500))}</div></div>` : ''}
        <div class="chips">${chipSelect('provider', d.provider, TEXT_AI.map((p) => [p, PROVIDER_LABEL[p]]), 'AI trả lời')}
          ${chipSelect('exportAs', d.exportAs, [['text', 'Export as text'], ['list', 'Export as list']], 'Xuất kết quả')}
          <span class="chip gear" data-act="config">${I.gear}</span><button class="chip run-chip" data-act="run-node" title="Chạy">${I.play}</button></div>`;
    }
    case 'list':
      return listBodyHtml(n);
    case 'seedance': {
      const chips = [
        chipSelect('model', d.model, [['', 'Model mặc định'], ...SEEDANCE_MODELS], 'Model'),
        chipSelect('ratio', d.ratio, [['', 'Tỉ lệ'], ...SEEDANCE_RATIOS], 'Tỉ lệ'),
        chipSelect('duration', d.duration, [['', 'Thời lượng'], ...SEEDANCE_DURATIONS], 'Thời lượng')
      ];
      return `<div class="nb-media ${ratioClass(d.ratio || '9:16')}">
          <button class="corner-run" data-act="run-node" title="Chạy node">${I.play}</button>
          <button class="tog sm corner-tog ${d.enabled ? 'on' : ''}" data-act="toggle-enabled" title="Bật/tắt node"></button>
          ${previewHtml(n)}
        </div>
        ${peekHtml(n)}<div class="chips">${chips.join('')}<span class="chip gear" data-act="config">${I.gear}</span></div>`;
    }
    case 'chatgpt':
    case 'gemini':
    case 'grok':
      return `<div class="nb-media r-1-1">
          <button class="corner-run" data-act="run-node" title="Chạy node">${I.play}</button>
          <button class="tog sm corner-tog ${d.enabled ? 'on' : ''}" data-act="toggle-enabled" title="Bật/tắt node"></button>
          ${previewHtml(n)}
        </div>
        ${peekHtml(n)}<div class="chips"><span class="chip">${d.mode === 'video' && n.type !== 'chatgpt' ? 'Video' : 'Image'}</span>${d.ratio ? `<span class="chip">${esc(d.ratio)}</span>` : ''}${d.mode === 'video' && n.type === 'grok' ? `<span class="chip">${esc(d.duration || '6s')}</span>` : ''}${(d.refs || []).length ? `<span class="chip">${d.refs.length} ref</span>` : ''}<span class="chip toggle ${d.newChat !== false ? 'on' : ''}" data-toggle="newChat">Chat mới</span>${d.autoDownload ? `<span class="chip">${I.download}</span>` : ''}<span class="chip gear" data-act="config">${I.gear}</span></div>`;
    case 'download':
      return `<div class="nb-small">${I.download} Thư mục: <b>${esc(d.folder || '(theo workflow)')}</b>${d.collectFlow ? ' · gom Flow' : ''}${d.imageRes || d.videoRes ? ` · ${esc([d.imageRes, d.videoRes].filter(Boolean).join('/'))}` : ''}<span class="chip gear" data-act="config">${I.gear}</span></div>`;
    case 'telegram':
      return `<div class="nb-small">${I.send} ${d.chatId ? `Chat ${esc(d.chatId)}` : 'Chat đã liên kết'} · ${d.sendMode === 'group' ? 'gộp' : 'từng ảnh'}<span class="chip gear" data-act="config">${I.gear}</span></div>`;
    case 'delay':
      return `<div class="nb-small">${I.delay} Chờ <input type="number" min="0" max="3600" data-k="seconds" value="${esc(d.seconds)}"> giây</div>`;
    default:
      return '';
  }
}

// Node List: mỗi mục văn bản sửa trực tiếp; media hiện dạng lưới. Node phía sau chạy mỗi mục một lượt.
function listBodyHtml(n) {
  const d = n.data;
  const items = d.items || [];
  const nText = items.filter((i) => i.kind === 'text').length, nMedia = items.length - nText;
  const count = [nText && `${nText} text`, nMedia && `${nMedia} ${items.some((i) => i.kind === 'video') ? 'media' : 'ảnh'}`].filter(Boolean).join(' · ') || '0 mục';
  const add = `<button class="li-add" data-act="li-add-text">+ Text</button><button class="li-add" data-act="li-add-media">+ Media</button>`;
  if (!items.length) {
    return `<div class="list-empty" data-drop="1">${I.list.replace(/13/g, '28')}<b>Chưa có mục nào</b><span>Thêm mục, hoặc nối node khác vào để tự điền</span><div class="row">${add}</div></div>`;
  }
  const media = items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind !== 'text');
  const texts = items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'text');
  return `<div class="list-body">
      ${texts.map(({ it, i }) => `<div class="li"><textarea data-li="${i}" rows="2" spellcheck="false">${esc(it.text)}</textarea><button class="li-del" data-act="li-del" data-i="${i}" title="Xoá mục">${I.x}</button></div>`).join('')}
      ${media.length ? `<div class="li-grid">${media.map(({ it, i }) => `<div class="lm">${it.thumb || it.dataUrl ? `<img src="${it.thumb || it.dataUrl}" data-full="${esc(it.url || '')}" data-kind="${it.kind}" alt="">` : `<div class="ph">${it.kind === 'video' ? I.video : I.image}</div>`}
        ${it.kind === 'video' ? `<span class="dims sm" data-info="${esc(it.url || '')}" data-kind="video">${esc(mediaInfo.get(it.url) || '')}</span>` : ''}
        <button class="li-del" data-act="li-del" data-i="${i}" title="Xoá mục">${I.x}</button></div>`).join('')}</div>` : ''}
    </div>
    <div class="chips">${add}${chipSelect('keep', d.keep, [['replace', 'Thay mục'], ['append', 'Keep items']], 'Khi có dữ liệu mới')}<span class="counter">${count}</span></div>`;
}

function portsHtml(n) {
  const ins = portsOf(n, 'in'), outs = portsOf(n, 'out');
  const p = (port, dir, style) => {
    const type = portType(n, port);
    return `<div class="port ${dir} ${port.name === 'edit' ? 'edit-port' : ''}" data-dir="${dir}" data-port="${port.name}" data-type="${type}" style="${style}">${port.name === 'edit' ? '✎' : portGlyph(type)}<span class="tip">${esc(port.label)} · ${esc(PORT_TYPES[type].label)}</span></div>`;
  };
  return outs.map((port, i) => p(port, 'out', `top:${30 + i * 40}px`)).join('')
    + ins.map((port, i) => p(port, 'in', `bottom:${(n.type === 'generate' || NODE_DEFS[n.type].provider ? 46 : 16) + (ins.length - 1 - i) * 40}px`)).join('');
}

function statusOf(n) {
  const st = n?.id && runState?.workflowId === wf.id && !runReset ? runState.nodes[n.id] : null;
  return st || null;
}
let runReset = false;

function buildNode(n) {
  const def = NODE_DEFS[n.type];
  const el = document.createElement('div');
  el.className = 'node';
  el.dataset.node = n.id;
  el.style.left = `${n.x}px`;
  el.style.top = `${n.y}px`;
  if (n.type === 'note') {
    el.classList.add('note');
    el.style.setProperty('--nc', n.data.color);
    el.innerHTML = `<div class="card" style="width:${n.data.w}px;height:${n.data.h}px">
      <textarea class="note-text" data-k="text" placeholder="Ghi chú / tên nhóm" style="font-size:${+n.data.fontSize || 14}px">${esc(n.data.text)}</textarea>
      <button class="corner-run" data-act="run-group" title="Chạy các node trong nhóm">${I.play}</button>
      <div class="resize" data-resize="1"></div></div>`;
  } else {
    const icon = n.type === 'generate' ? (n.data.genType === 'video' ? I.video : I.image) : I[def.icon] || I.generate;
    const hasMedia = n.type === 'generate' || n.type === 'image' || def.provider;
    // Phóng to node media: 1× → 1.5× → 2×.
    if (hasMedia && n.data.nodeZoom > 1) el.style.width = `${300 * n.data.nodeZoom}px`;
    el.innerHTML = `<div class="label">${icon}<span>${esc(n.data.name || def.title)}</span><button class="rename-btn" data-act="rename" title="Đổi tên">✎</button></div>
      <div class="card">${bodyHtml(n)}</div>
      <div class="under">${def.provider ? `<span class="provider-pill"><i style="background:${PROVIDER_COLOR[def.provider]}"></i>${esc(PROVIDER_LABEL[def.provider])}</span>` : ''}
        ${n.data.slug ? `<span class="slug-badge" data-act="edit-slug" title="Dùng @${esc(n.data.slug)} ở node khác · bấm để sửa">@${esc(n.data.slug)}</span>` : ''}</div>
      ${hasMedia ? `<button class="zoom-node" data-act="zoom-node" title="Phóng to node (1× → 1.5× → 2×)">${n.data.nodeZoom > 1 ? `<span style="font-size:9px">${n.data.nodeZoom}×</span>` : I.fit}</button>` : ''}
      ${portsHtml(n)}`;
  }
  applyStatus(el, n);
  if (selection.has(n.id)) el.classList.add('selected');
  return el;
}

function applyStatus(el, n) {
  const st = statusOf(n);
  el.classList.toggle('disabled', n.data.enabled === false);
  el.classList.toggle('running', st?.status === 'running');
  el.classList.toggle('done', st?.status === 'done');
  el.classList.toggle('error', st?.status === 'error');
  el.querySelector(':scope > .status')?.remove();
  el.querySelector(':scope > .progress-pill')?.remove();
  el.querySelector('.nb-media > .spinner')?.remove();
  el.querySelectorAll('.gen-status').forEach((x) => x.remove());
  el.querySelector(':scope > .queued-pill')?.remove();
  // Đang chờ tới lượt: giữ kết quả cũ, chỉ hiện nhãn chờ.
  const waiting = queuedIds.has(n.id) && st?.status !== 'running' && n.type !== 'note';
  el.classList.toggle('queued', waiting);
  if (waiting) el.insertAdjacentHTML('beforeend', '<span class="queued-pill">⏳ Đang chờ tới lượt…</span>');
  if (!st || n.type === 'note') return;
  if (st.status === 'running') {
    // "Đang tạo video 3 / 7 · 1m 43s" (như "Generating video 3 of 7" của bản gốc).
    const host = el.querySelector('.nb-media:not([data-drop])') || (['assistant', 'prompt', 'list'].includes(n.type) ? el.querySelector('.card') : null);
    const what = n.type === 'seedance' || n.data.genType === 'video' ? 'video' : NODE_DEFS[n.type].provider ? 'ảnh' : '';
    host?.insertAdjacentHTML('beforeend', `<div class="gen-status" data-start="${st.startedAt || Date.now()}" data-what="${what}" data-done="${st.done || 0}" data-total="${st.total || 0}"></div>`);
    host && tickStatus(host.querySelector('.gen-status'));
  }
  if (st.status === 'running' && st.total) {
    // Thanh tiến độ "đã xong / tổng" phía trên node (như bản gốc).
    const p = document.createElement('div');
    p.className = 'progress-pill';
    p.innerHTML = `${st.done || 0} / ${st.total}<i><b style="width:${Math.round(((st.done || 0) / st.total) * 100)}%"></b></i>`;
    el.appendChild(p);
  }
  const media = el.querySelector('.nb-media:not([data-drop])');
  if (st.status === 'running' && media && !media.querySelector('.viewer.has')) {
    media.querySelector('.ph')?.remove();
    media.insertAdjacentHTML('beforeend', '<div class="spinner"></div>');
  }
  if (st.status === 'error' || st.status === 'skipped') {
    const b = document.createElement('span');
    b.className = `status ${st.status}`;
    b.textContent = st.status === 'error' ? 'lỗi' : 'bỏ qua';
    if (st.error) b.title = st.error;
    el.appendChild(b);
  }
}

function elapsed(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}
function tickStatus(el) {
  const { start, what, done, total } = el.dataset;
  const step = +total > 1 ? ` ${Math.min(+done + 1, +total)} / ${total}` : '';
  el.textContent = `${what ? `Đang tạo ${what}` : 'Đang chạy'}${step}… · ${elapsed(Date.now() - +start)}`;
}
setInterval(() => document.querySelectorAll('.gen-status').forEach(tickStatus), 1000);

// Canvas trống: thẻ bắt đầu nhanh (như "Your space is ready").
const QUICK_START = [['image', 'Media', 'Tải ảnh / video lên'], ['text', 'Text', 'Prompt, ý tưởng'], ['generate', 'Image Generator', 'Google Flow'],
  ['seedance', 'Video Generator', 'Seedance'], ['assistant', 'Assistant', 'ChatGPT / Claude…'], ['list', 'List', 'Danh sách mục']];
function renderQuickStart() {
  let el = document.querySelector('.quick-start');
  if (wf.nodes.length) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('div');
  el.className = 'quick-start';
  el.innerHTML = `<h2>Workflow đã sẵn sàng</h2><p>Chọn node đầu tiên, hoặc bấm đúp vào canvas để thêm node bất kỳ</p>
    <div class="qs-cards">${QUICK_START.map(([type, title, sub]) => `<button data-qs="${type}"><span class="ic">${I[NODE_DEFS[type].icon] || I.generate}</span><b>${title}</b><small>${sub}</small></button>`).join('')}</div>`;
  el.addEventListener('click', (e) => {
    const type = e.target.closest('[data-qs]')?.dataset.qs;
    if (!type) return;
    const c = toWorld(innerWidth / 2 - 150, innerHeight / 2 - 200);
    addNode(type, c.x, c.y);
  });
  document.body.appendChild(el);
}

function renderAll() {
  nodesEl.innerHTML = '';
  // Ghi chú nằm dưới các node khác.
  for (const n of [...wf.nodes.filter((x) => x.type === 'note'), ...wf.nodes.filter((x) => x.type !== 'note')]) nodesEl.appendChild(buildNode(n));
  pruneEdges();
  renderEdges();
  renderBar();
  updateStats();
  renderQuickStart();
  loadMediaInfo(nodesEl);
}
function rerenderNode(id) {
  const n = wf.nodes.find((x) => x.id === id);
  const old = nodeEl(id);
  if (!n || !old) return;
  const fresh = buildNode(n);
  old.replaceWith(fresh);
  pruneEdges();
  renderEdges();
  renderBar();
  loadMediaInfo(fresh);
}

// Bỏ cạnh trỏ tới cổng không còn hiển thị (vd. đổi Ảnh → Video).
function pruneEdges() {
  const has = (node, dir, port) => node && portsOf(node, dir).some((p) => p.name === port);
  const before = wf.edges.length;
  wf.edges = wf.edges.filter((e) => {
    const a = wf.nodes.find((n) => n.id === e.from.node), b = wf.nodes.find((n) => n.id === e.to.node);
    return has(a, 'out', e.from.port) && has(b, 'in', e.to.port);
  });
  return before !== wf.edges.length;
}

// ---------- Cạnh ----------
function portCenter(nodeId, dir, port) {
  const el = nodesEl.querySelector(`.node[data-node="${nodeId}"] .port[data-dir="${dir}"][data-port="${port}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return toWorld(r.left + r.width / 2, r.top + r.height / 2);
}
const curve = (a, b) => {
  const dx = Math.max(50, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
};
function renderEdges() {
  let html = '';
  for (const e of wf.edges) {
    const a = portCenter(e.from.node, 'out', e.from.port), b = portCenter(e.to.node, 'in', e.to.port);
    if (!a || !b) continue;
    const fromNode = wf.nodes.find((n) => n.id === e.from.node);
    const type = portType(fromNode, portsOf(fromNode, 'out').find((p) => p.name === e.from.port));
    const color = PORT_TYPES[type]?.color || '#888';
    const d = curve(a, b);
    // Dây "đang chảy": node nguồn đã có kết quả và node đích đang chạy.
    const src = statusOf(fromNode)?.status, dst = statusOf(wf.nodes.find((n) => n.id === e.to.node) || {})?.status;
    const flowing = dst === 'running' && (src === 'done' || !src);
    // Dây mang nhiều mục (List, nhiều kết quả): nét đứt.
    const count = fromNode.type === 'list' ? (fromNode.data.items || []).length : (statusOf(fromNode) || (runReset ? null : wf.results?.[fromNode.id]))?.count || 0;
    html += `<path class="wire ${flowing ? 'flow' : ''} ${count > 1 ? 'multi' : ''} ${selectedEdge === e.id ? 'selected' : ''}" d="${d}" stroke="${color}" style="color:${color}"/><path class="hit" data-edge="${e.id}" d="${d}"/>`;
  }
  if (drag?.kind === 'connect' && drag.to) html += `<path class="temp" d="${drag.reverse ? curve(drag.to, drag.from) : curve(drag.from, drag.to)}" stroke="${PORT_TYPES[drag.type].color}"/>`;
  html += mentionLines();
  edgesEl.innerHTML = html;
  // Cổng chưa nối: phát sáng nhẹ khi rê chuột vào node.
  const used = new Set(wf.edges.flatMap((e) => [`${e.from.node}|out|${e.from.port}`, `${e.to.node}|in|${e.to.port}`]));
  nodesEl.querySelectorAll('.port').forEach((p) => p.classList.toggle('empty', !used.has(`${p.closest('.node')?.dataset.node}|${p.dataset.dir}|${p.dataset.port}`)));
}

// Node đang chọn có @mention: đường nét đứt chạy từ node được nhắc tới, node được nhắc có huy hiệu "@".
function mentionLines() {
  const id = selection.size === 1 ? [...selection][0] : null;
  const n = id && wf.nodes.find((x) => x.id === id);
  const targets = new Set();
  if (n && n.type !== 'note') {
    const text = ['text', 'prompt', 'agentInstruction'].map((k) => n.data[k] || '').join(' ');
    for (const m of text.matchAll(/@([a-z0-9_]+)/gi)) {
      const src = wf.nodes.find((x) => x.id !== n.id && x.data.slug && x.data.slug.toLowerCase() === m[1].toLowerCase());
      if (src) targets.add(src.id);
    }
  }
  nodesEl.querySelectorAll('.node').forEach((el) => el.classList.toggle('being-mentioned', targets.has(el.dataset.node)));
  if (!targets.size) return '';
  const box = (nid) => { const r = nodeEl(nid)?.querySelector('.card')?.getBoundingClientRect(); return r ? { a: toWorld(r.right, r.top + r.height / 2), b: toWorld(r.left, r.top + r.height / 2) } : null; };
  const me = box(id);
  if (!me) return '';
  return [...targets].map((t) => { const s = box(t); return s ? `<path class="mention-line" d="${curve(s.a, me.b)}"/>` : ''; }).join('');
}

// ---------- Chọn & thanh nổi ----------
function select(ids, additive = false) {
  if (!additive) selection = new Set();
  ids.forEach((id) => selection.add(id));
  selectedEdge = null;
  nodesEl.querySelectorAll('.node').forEach((el) => el.classList.toggle('selected', selection.has(el.dataset.node)));
  renderEdges();
  renderBar();
}
function renderBar() {
  nodesEl.querySelector('.node-bar')?.remove();
  renderComposer();
  if (selection.size !== 1) return;
  const id = [...selection][0];
  const n = wf.nodes.find((x) => x.id === id);
  const el = nodeEl(id);
  if (!n || !el || n.type === 'note') return;
  const bar = document.createElement('div');
  bar.className = 'node-bar';
  // Node Ảnh/Video chỉ chứa media tải lên nên không cần nút Chạy.
  const runnable = n.type !== 'image';
  const hasMedia = mediaResults(n).length > 0;
  const prompt = promptOf(n);
  const kids = childrenOf(n.id), branch = descendantsOf(n.id);
  bar.innerHTML = `${runnable ? `<button data-bar="run" title="Chạy node">${I.play}</button>` : ''}
    ${kids.length ? `<button data-bar="run-next" class="wide" title="Chạy ${kids.length} node nối từ đây (dùng kết quả đang có của node này)">${I.play}<b>${kids.length}</b></button>` : ''}
    ${branch.length > kids.length ? `<button data-bar="run-branch" title="Chạy tiếp cả nhánh phía sau (${branch.length} node)">⏩</button>` : ''}
    <button data-bar="reset" title="Reset node (xoá kết quả, giữ cấu hình)">${I.refresh}</button>
    ${hasMedia ? `<button data-bar="download" title="Tải kết quả của node">${I.download.replace(/13/g, '15')}</button>` : ''}
    <button data-bar="config" title="Cấu hình">${I.gear}</button>
    <button data-bar="branch" title="Tạo nhánh (nhân bản giữ kết nối đầu vào)">${I.branch}</button>
    ${prompt ? `<button data-bar="copy-prompt" title="Copy prompt">${I.prompt.replace(/13/g, '15')}</button>` : ''}
    <button data-bar="dup" title="Nhân bản (Ctrl+D)">${I.copy}</button>
    <button data-bar="del" class="danger" title="Xoá (Delete)">${I.trash}</button>`;
  bar.style.top = `${n.y - 50}px`;
  nodesEl.appendChild(bar);
  bar.style.left = `${n.x + (el.offsetWidth - bar.offsetWidth) / 2}px`;
}

// Khung soạn prompt nổi dưới node tạo ảnh/video đang chọn: ảnh tham chiếu, prompt riêng, model, tỷ lệ, gửi (chạy node).
// Giữ cỡ cố định trên màn hình (scale ngược với zoom).
const COMPOSER_TYPES = new Set(['generate', 'seedance', 'chatgpt', 'gemini', 'grok']);
function renderComposer() {
  nodesEl.querySelector('.composer')?.remove();
  if (selection.size !== 1) return;
  const id = [...selection][0];
  const n = wf.nodes.find((x) => x.id === id);
  const el = nodeEl(id);
  if (!n || !el || !COMPOSER_TYPES.has(n.type)) return;
  const d = n.data, chat = ['chatgpt', 'gemini', 'grok'].includes(n.type);
  const kind = n.type === 'generate' ? (d.genType === 'video' ? 'video' : 'image') : (d.mode === 'video' ? 'video' : 'image');
  const models = n.type === 'generate' ? [['', 'Model Flow'], ...optionsFor(kind).map((m) => [m, m])]
    : n.type === 'grok' ? [['', 'Chất lượng'], ['fast', 'Speed'], ['quality', 'Quality']]
    : n.type === 'seedance' ? [['', 'Model'], ...SEEDANCE_MODELS.map((m) => [m, m])]
    : [['', 'Model'], ...(CHAT_MODELS[n.type] || []).map((m) => [m.value, m.label])];
  const modelKey = n.type === 'grok' ? 'quality' : 'model';
  const ratios = n.type === 'generate' ? RATIOS[kind] : n.type === 'seedance' ? SEEDANCE_RATIOS : (CHAT_RATIOS[n.type] || []).map((r) => r[0]);
  const glyph = (r) => { const [w, h] = r.split(':').map(Number); return w === h ? '□' : w > h ? '▭' : '▯'; };
  const own = d.useOwnPrompt !== false;
  const c = document.createElement('div');
  c.className = 'composer';
  c.dataset.composer = id;
  c.innerHTML = `${chat ? `<div class="cp-refs">${(d.refs || []).map((r, i) => `<span class="cp-ref"><img src="${r.dataUrl}" alt=""><button data-cp="rmref" data-i="${i}">✕</button></span>`).join('')}${(d.refs || []).length < 4 ? `<button class="cp-add" data-cp="ref-add" title="Thêm ảnh tham chiếu (tối đa 4)">${I.image}</button>` : ''}</div>` : ''}
    <textarea data-cp-k="prompt" placeholder="VD: A cute cat playing with yarn, cinematic lighting" ${own ? '' : 'disabled'}>${esc(d.prompt || '')}</textarea>
    <div class="cp-row"><label class="cp-own"><button class="tog sm ${own ? 'on' : ''}" data-cp="own"></button>Sử dụng Prompt riêng</label><span class="spacer"></span><span class="cp-count">${(d.prompt || '').length}/${MAX_PROMPT.toLocaleString('vi')}</span></div>
    <div class="cp-row">
      <select data-cp-k="${modelKey}">${models.map(([v, l]) => `<option value="${esc(v)}" ${String(d[modelKey] || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      ${ratios.map((r) => `<button class="cp-ratio ${d.ratio === r ? 'on' : ''}" data-cp="ratio" data-v="${r}">${glyph(r)} ${r}</button>`).join('')}
      <span class="spacer"></span><button class="cp-send" data-cp="run" title="Chạy node">↑</button>
    </div>`;
  nodesEl.appendChild(c);
  const w = 560;
  c.style.width = `${w}px`;
  c.style.left = `${n.x + el.offsetWidth / 2 - w / 2}px`;
  c.style.top = `${n.y + el.offsetHeight + 34}px`;
  c.style.transform = `scale(${1 / view.zoom})`;
  // Không để thao tác trong khung kéo node / đổi vùng chọn / zoom canvas.
  for (const ev of ['mousedown', 'pointerdown', 'dblclick', 'wheel']) c.addEventListener(ev, (e) => e.stopPropagation());
  let timer = null;
  c.addEventListener('input', (e) => {
    if (e.target.dataset.cpK !== 'prompt') return;
    c.querySelector('.cp-count').textContent = `${e.target.value.length}/${MAX_PROMPT.toLocaleString('vi')}`;
    clearTimeout(timer);
    timer = setTimeout(() => setData(id, { prompt: e.target.value }, { history: false }), 300);
  });
  c.addEventListener('change', (e) => { const k = e.target.dataset.cpK; if (k && k !== 'prompt') { setData(id, { [k]: e.target.value }); renderComposer(); } });
  c.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cp]');
    if (!b) return;
    const act = b.dataset.cp;
    if (act === 'own') { setData(id, { useOwnPrompt: !own }); renderComposer(); }
    if (act === 'ratio') { setData(id, { ratio: d.ratio === b.dataset.v ? '' : b.dataset.v }); renderComposer(); }
    if (act === 'rmref') { setData(id, { refs: (d.refs || []).filter((_, i) => i !== +b.dataset.i) }); renderComposer(); }
    if (act === 'run') { clearTimeout(timer); const ta = c.querySelector('[data-cp-k=prompt]'); if (ta) setData(id, { prompt: ta.value }, { history: false }); runWorkflow([id]); }
    if (act === 'ref-add') {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
      input.addEventListener('change', async () => {
        const refs = [...(d.refs || [])];
        for (const f of [...input.files].slice(0, 4 - refs.length)) refs.push({ name: f.name, mime: f.type, dataUrl: await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); }) });
        setData(id, { refs });
        renderComposer();
      });
      input.click();
    }
  });
}

// Node nối trực tiếp từ node này / toàn bộ node phía sau (không gồm khung ghi chú).
function childrenOf(id) {
  return [...new Set(wf.edges.filter((e) => e.from.node === id).map((e) => e.to.node))].filter((x) => wf.nodes.some((n) => n.id === x && n.type !== 'note'));
}
function descendantsOf(id) {
  const out = new Set(), stack = childrenOf(id);
  while (stack.length) { const x = stack.pop(); if (out.has(x)) continue; out.add(x); stack.push(...childrenOf(x)); }
  return [...out];
}
function runFrom(id, all) {
  const ids = all ? descendantsOf(id) : childrenOf(id);
  if (!ids.length) { toast('Chưa có node nào nối từ node này'); return; }
  runWorkflow(ids);
}

// Kết quả ảnh/video đang hiển thị của node (lượt đang chạy hoặc lần chạy đã lưu).
function mediaResults(n) {
  const res = statusOf(n)?.preview ? statusOf(n) : runReset ? null : wf.results?.[n.id];
  return (res?.preview || []).filter((p) => p.kind !== 'text');
}
// Prompt của node: nội dung tự gõ + văn bản từ node Prompt/Text nối vào (AI Agent thì chưa biết trước).
function promptOf(n) {
  if (!n) return '';
  const d = n.data;
  if (['prompt', 'text', 'assistant'].includes(n.type)) return String(d.text || '').trim();
  if (!['generate', 'seedance', 'chatgpt', 'gemini', 'grok'].includes(n.type)) return '';
  const ups = wf.edges.filter((e) => e.to.node === n.id && e.to.port === 'text').map((e) => wf.nodes.find((x) => x.id === e.from.node)).filter(Boolean)
    .map((src) => (src.type === 'prompt' && src.data.agent ? `(${PROVIDER_LABEL[src.data.agentProvider] || 'AI'} viết từ "${src.data.name}")` : String(src.data.text || src.data.name || '').trim()))
    .filter(Boolean);
  const own = String(d.prompt || '').trim();
  if (!ups.length) return own;
  return own ? (own.includes('{input}') ? ups.map((u) => own.replaceAll('{input}', u)).join('\n\n') : ups.map((u) => `${own} ${u}`).join('\n\n')) : ups.join('\n\n');
}
function clearNodeResult(id) {
  if (runState?.nodes?.[id]) delete runState.nodes[id];
  if (wf.results?.[id]) delete wf.results[id];
  pages.delete(id);
  rerenderNode(id);
  dirty();
}
async function downloadAll(n) {
  const count = mediaResults(n).length;
  for (let i = 0; i < count; i++) await downloadResult(n, i);
}
// Cập nhật đoạn prompt hiển thị trên node tạo ảnh/video khi prompt nguồn thay đổi.
function refreshPeeks() {
  nodesEl.querySelectorAll('.prompt-peek[data-for]').forEach((el) => {
    const p = promptOf(wf.nodes.find((x) => x.id === el.dataset.for));
    el.textContent = p || 'Chưa có prompt: nối node Prompt hoặc nhập trong ⚙';
    el.title = p;
    el.classList.toggle('empty', !p);
  });
}

// ---------- Thao tác dữ liệu ----------
// Tạo node (không ghi lịch sử hoàn tác, không vẽ): dùng chung cho addNode và các thao tác tạo nhiều node.
function placeNode(type, x, y, data) {
  const n = createNode(type, Math.round(x), Math.round(y), data);
  // Tên tự đánh số như "Text #1", "Image Generator #2".
  if (type !== 'note' && !data?.name) n.data.name = `${NODE_DEFS[type].title} #${wf.nodes.filter((m) => m.type === type).length + 1}`;
  if (type !== 'note') n.data.slug = uniqueSlug(n.data.name);
  wf.nodes.push(n);
  return n;
}
function addNode(type, x, y, data) {
  pushHistory();
  const n = placeNode(type, x, y, data);
  nodesEl.appendChild(buildNode(n));
  if (type === 'note') renderAll();
  renderQuickStart();
  select([n.id]);
  dirty();
  return n;
}

// "Sửa ảnh": chụp đúng ảnh đang xem thành node Ảnh riêng, nối sang node AI mới cùng loại + ô yêu cầu sửa.
// Node cũ không có dây ra node mới nên không bị chạy lại hay thay kết quả.
// "Sửa ảnh" ngay trong node: thêm Prompt nối vào cổng "Prompt sửa kết quả" của node.
// Bấm ▶ trên Prompt đó: node dùng ảnh đang có làm tham chiếu + nội dung sửa, kết quả mới hiện ở chính node này.
function editInPlace(src) {
  if (!portsOf(src, 'in').some((p) => p.name === 'edit')) { editResult(src); return; }
  pushHistory();
  const count = wf.edges.filter((e) => e.to.node === src.id && e.to.port === 'edit').length;
  const ask = placeNode('prompt', src.x - 380, src.y + 140 + count * 300, { name: `Sửa ${src.data.name || NODE_DEFS[src.type].title} #${count + 1}`, text: '' });
  wf.edges.push({ id: nid(), from: { node: ask.id, port: 'text' }, to: { node: src.id, port: 'edit' } });
  renderAll();
  select([ask.id]);
  dirty();
  const ta = nodeEl(ask.id)?.querySelector('textarea[data-k="text"]');
  const vid = src.type === 'seedance' || src.data.genType === 'video';
  if (ta) { ta.placeholder = vid ? 'Gõ nội dung sửa video, vd: camera quay chậm hơn, thêm mưa, nhân vật mỉm cười. Rồi bấm ▶ trên node này.' : 'Gõ nội dung sửa, vd: đổi chàng trai thành cô gái, giữ nguyên bối cảnh. Rồi bấm ▶ trên node này.'; ta.focus(); }
  toast('Gõ nội dung sửa rồi bấm ▶ trên node Prompt này: ảnh được sửa ngay trong node, không chạy lại từ đầu');
}

function editResult(src) {
  const res = statusOf(src)?.preview ? statusOf(src) : wf.results?.[src.id];
  const media = (res?.preview || []).filter((p) => p.kind === 'image');
  const m = media[Math.min(pages.get(src.id) || 0, media.length - 1)];
  if (!m) { toast('Node chưa có ảnh để sửa'); return; }
  pushHistory();
  const x = src.x + (nodeEl(src.id)?.offsetWidth || 300) + 120, y = src.y;
  const provider = NODE_DEFS[src.type].provider || 'flow';
  const shot = placeNode('image', x, y, { name: `Ảnh cần sửa #${wf.nodes.filter((n) => n.type === 'image').length + 1}`, media: [{ kind: 'image', url: m.url, thumb: m.thumb, provider: m.provider || provider }] });
  const ask = placeNode('prompt', x, y + 520, { name: `Yêu cầu sửa #${wf.nodes.filter((n) => n.type === 'prompt').length + 1}`, text: '' });
  const keep = src.type === 'generate' ? { genType: 'image', model: src.data.model, ratio: src.data.ratio, quantity: 1 } : { newChat: src.data.newChat };
  const gen = placeNode(src.type, x + 420, y, { name: `${src.data.name || NODE_DEFS[src.type].title} (sửa)`, ...keep });
  wf.edges.push({ id: nid(), from: { node: shot.id, port: 'media' }, to: { node: gen.id, port: 'image_ref' } },
    { id: nid(), from: { node: ask.id, port: 'text' }, to: { node: gen.id, port: 'text' } });
  renderAll();
  select([gen.id]);
  dirty();
  const ta = nodeEl(ask.id)?.querySelector('textarea[data-k="text"]');
  if (ta) { ta.placeholder = 'Gõ yêu cầu sửa, vd: đổi chàng trai thành cô gái, giữ nguyên bối cảnh'; ta.focus(); }
  toast('Gõ yêu cầu sửa rồi bấm ▶ trên node mới');
}
function uniqueSlug(name, selfId) {
  const base = slugify(name);
  let s = base, i = 2;
  while (wf.nodes.some((n) => n.id !== selfId && n.data.slug === s)) s = `${base}_${i++}`;
  return s;
}
function deleteSelection() {
  if (!selection.size && !selectedEdge) return;
  pushHistory();
  if (selectedEdge) wf.edges = wf.edges.filter((e) => e.id !== selectedEdge);
  wf.nodes = wf.nodes.filter((n) => !selection.has(n.id));
  wf.edges = wf.edges.filter((e) => !selection.has(e.from.node) && !selection.has(e.to.node));
  if (sideNodeId && selection.has(sideNodeId)) closeSide();
  selection.clear();
  selectedEdge = null;
  renderAll();
  dirty();
}
function duplicate(ids, { keepInputs = false, offset = 40 } = {}) {
  pushHistory();
  const map = {};
  const created = [];
  for (const id of ids) {
    const src = wf.nodes.find((n) => n.id === id);
    if (!src) continue;
    const copy = { ...structuredClone(src), id: nid(), x: src.x + offset, y: src.y + offset };
    if (copy.type !== 'note') copy.data.slug = uniqueSlug(copy.data.name);
    map[id] = copy.id;
    wf.nodes.push(copy);
    created.push(copy.id);
  }
  for (const e of [...wf.edges]) {
    const inside = map[e.from.node] && map[e.to.node];
    if (inside) wf.edges.push({ id: nid(), from: { node: map[e.from.node], port: e.from.port }, to: { node: map[e.to.node], port: e.to.port } });
    else if (keepInputs && map[e.to.node] && !map[e.from.node]) wf.edges.push({ id: nid(), from: { ...e.from }, to: { node: map[e.to.node], port: e.to.port } });
  }
  renderAll();
  select(created);
  dirty();
}
function connect(from, to) {
  const a = wf.nodes.find((n) => n.id === from.node), b = wf.nodes.find((n) => n.id === to.node);
  if (!a || !b || a.id === b.id) return false;
  const outPort = portsOf(a, 'out').find((p) => p.name === from.port), inPort = portsOf(b, 'in').find((p) => p.name === to.port);
  if (!outPort || !inPort || !canConnect(portType(a, outPort), portType(b, inPort))) { toast('Hai cổng khác kiểu, không nối được'); return false; }
  if (wf.edges.some((e) => e.from.node === from.node && e.from.port === from.port && e.to.node === to.node && e.to.port === to.port)) return false;
  // Không cho tạo vòng lặp.
  const reaches = (start, target) => {
    const stack = [start], seen = new Set();
    while (stack.length) { const id = stack.pop(); if (id === target) return true; if (seen.has(id)) continue; seen.add(id); wf.edges.filter((e) => e.from.node === id).forEach((e) => stack.push(e.to.node)); }
    return false;
  };
  if (reaches(b.id, a.id)) { toast('Không thể nối tạo vòng lặp'); return false; }
  pushHistory();
  if (!inPort.multi) wf.edges = wf.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port));
  wf.edges.push({ id: nid(), from, to });
  // List trống nhận kiểu theo nguồn nối vào (văn bản / ảnh / video) để nối tiếp đúng cổng.
  if (b.type === 'list' && !(b.data.items || []).length && b.data.kind === 'any') {
    const t = portType(a, outPort);
    b.data.kind = t === 'frame' ? 'image' : t;
    rerenderNode(b.id);
  }
  renderEdges();
  refreshPeeks();
  if (to.port === 'edit') toast('Bấm ▶ trên node Prompt này để sửa ảnh đang có của node, không chạy lại từ đầu');
  dirty();
  return true;
}
function setData(id, patch, { history = true, rerender = true } = {}) {
  const n = wf.nodes.find((x) => x.id === id);
  if (!n) return;
  if (history) pushHistory();
  Object.assign(n.data, patch);
  if (rerender) rerenderNode(id);
  dirty();
}

// ---------- Sắp xếp ----------
function arrange() {
  pushHistory();
  const list = wf.nodes.filter((n) => n.type !== 'note');
  const depth = new Map(list.map((n) => [n.id, 0]));
  for (let k = 0; k < list.length; k++) {
    for (const e of wf.edges) if (depth.has(e.from.node) && depth.has(e.to.node)) depth.set(e.to.node, Math.max(depth.get(e.to.node), depth.get(e.from.node) + 1));
  }
  const cols = new Map();
  for (const n of list) { const d = depth.get(n.id); if (!cols.has(d)) cols.set(d, []); cols.get(d).push(n); }
  for (const [d, col] of cols) {
    let y = 80;
    for (const n of col) { n.x = 80 + d * 420; n.y = y; y += nodeBox(n).h + 70; }
  }
  renderAll();
  fitView();
  dirty();
}

// ---------- Tương tác chuột ----------
let drag = null;
const INTERACTIVE = 'textarea, input, select, button, .chip, a';

canvas.addEventListener('mousedown', (e) => {
  closeMenus();
  const port = e.target.closest('.port');
  const nodeDiv = e.target.closest('.node');
  const edgeHit = e.target.closest('[data-edge]');
  if (e.button === 1 || tool === 'hand' || spaceDown) { startPan(e); return; }
  if (e.button !== 0) return;
  if (port) {
    const id = port.closest('.node').dataset.node;
    const dir = port.dataset.dir;
    const r = port.getBoundingClientRect();
    drag = { kind: 'connect', node: id, port: port.dataset.port, dir, type: port.dataset.type, reverse: dir === 'in', from: toWorld(r.left + r.width / 2, r.top + r.height / 2), to: null };
    markCompatible(drag);
    e.preventDefault();
    return;
  }
  if (edgeHit) { select([]); selectedEdge = edgeHit.dataset.edge; renderEdges(); return; }
  if (e.target.closest('.node-bar')) return;
  if (nodeDiv) {
    const id = nodeDiv.dataset.node;
    if (e.target.closest('[data-resize]')) {
      const n = wf.nodes.find((x) => x.id === id);
      pushHistory();
      drag = { kind: 'resize', id, sx: e.clientX, sy: e.clientY, w: n.data.w, h: n.data.h };
      e.preventDefault();
      return;
    }
    if (e.target.closest(INTERACTIVE)) {
      if (!selection.has(id)) select([id], e.shiftKey);
      return;
    }
    if (!selection.has(id)) select([id], e.shiftKey);
    else if (e.shiftKey) { selection.delete(id); select([...selection]); return; }
    const ids = new Set(selection);
    // Kéo khung ghi chú kéo theo các node bên trong.
    for (const nid0 of [...ids]) {
      const n = wf.nodes.find((x) => x.id === nid0);
      if (n?.type === 'note') wf.nodes.filter((m) => m.type !== 'note' && m.x >= n.x && m.y >= n.y && m.x < n.x + n.data.w && m.y < n.y + n.data.h).forEach((m) => ids.add(m.id));
    }
    drag = { kind: 'move', ids: [...ids], sx: e.clientX, sy: e.clientY, start: Object.fromEntries([...ids].map((i) => { const n = wf.nodes.find((x) => x.id === i); return [i, { x: n.x, y: n.y }]; })), moved: false, target: e.target, shift: e.shiftKey };
    return;
  }
  // Canvas trống: khung chọn.
  if (!e.shiftKey) select([]);
  selectedEdge = null;
  renderEdges();
  const box = document.createElement('div');
  box.className = 'marquee';
  document.body.appendChild(box);
  drag = { kind: 'marquee', sx: e.clientX, sy: e.clientY, box, base: new Set(selection) };
});

function startPan(e) {
  drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  canvas.classList.add('panning');
  e.preventDefault();
}

function markCompatible(d) {
  nodesEl.querySelectorAll('.port').forEach((p) => {
    const ok = p.dataset.dir !== d.dir && p.closest('.node').dataset.node !== d.node
      && (d.dir === 'out' ? canConnect(d.type, p.dataset.type) : canConnect(p.dataset.type, d.type));
    p.classList.toggle('compatible', ok);
    p.classList.toggle('dim', !ok && p.dataset.dir !== d.dir);
  });
}
const clearCompatible = () => nodesEl.querySelectorAll('.port').forEach((p) => p.classList.remove('compatible', 'dim'));

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    view.x = drag.vx + e.clientX - drag.sx;
    view.y = drag.vy + e.clientY - drag.sy;
    applyView();
  } else if (drag.kind === 'move') {
    const dx = (e.clientX - drag.sx) / view.zoom, dy = (e.clientY - drag.sy) / view.zoom;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!drag.moved) { pushHistory(); drag.moved = true; }
    for (const id of drag.ids) {
      const n = wf.nodes.find((x) => x.id === id);
      n.x = Math.round(drag.start[id].x + dx);
      n.y = Math.round(drag.start[id].y + dy);
      const el = nodeEl(id);
      el.style.left = `${n.x}px`;
      el.style.top = `${n.y}px`;
    }
    renderEdges();
    renderBar();
  } else if (drag.kind === 'resize') {
    const n = wf.nodes.find((x) => x.id === drag.id);
    n.data.w = Math.max(220, Math.round(drag.w + (e.clientX - drag.sx) / view.zoom));
    n.data.h = Math.max(140, Math.round(drag.h + (e.clientY - drag.sy) / view.zoom));
    const card = nodeEl(n.id).querySelector('.card');
    card.style.width = `${n.data.w}px`;
    card.style.height = `${n.data.h}px`;
  } else if (drag.kind === 'connect') {
    drag.to = toWorld(e.clientX, e.clientY);
    nodesEl.querySelectorAll('.port.hot').forEach((p) => p.classList.remove('hot'));
    document.elementFromPoint(e.clientX, e.clientY)?.closest('.port.compatible')?.classList.add('hot');
    renderEdges();
  } else if (drag.kind === 'marquee') {
    const x = Math.min(drag.sx, e.clientX), y = Math.min(drag.sy, e.clientY), w = Math.abs(e.clientX - drag.sx), h = Math.abs(e.clientY - drag.sy);
    Object.assign(drag.box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const ids = new Set(drag.base);
    nodesEl.querySelectorAll('.node').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > x && r.left < x + w && r.bottom > y && r.top < y + h) ids.add(el.dataset.node);
    });
    selection = ids;
    nodesEl.querySelectorAll('.node').forEach((el) => el.classList.toggle('selected', selection.has(el.dataset.node)));
  }
});

window.addEventListener('mouseup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  canvas.classList.remove('panning');
  if (d.kind === 'pan') { dirtyView(); return; }
  if (d.kind === 'move') {
    if (d.moved) dirty();
    else if (d.target.closest('.nb-media img, .lm img')) {
      const img = d.target.closest('.nb-media img, .lm img');
      openLightbox(img.dataset.full || img.src, img.dataset.kind, img.src);
    }
    else if (d.target.closest('.nb-media[data-drop]')) openFilePicker(d.ids[0]);
    // Bấm 1 lần (không kéo) vào node: mở bảng chi tiết của node đó (giữ tab đang xem).
    else if (!d.shift && !d.target.closest('.label, .list-empty')) {
      const id = d.target.closest('.node')?.dataset.node;
      if (id) openSide(id, sideNodeId ? sideTab : 'config');
    }
  }
  if (d.kind === 'resize') { dirty(); renderAll(); }
  if (d.kind === 'marquee') { d.box.remove(); renderBar(); }
  if (d.kind === 'connect') {
    clearCompatible();
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port');
    if (target && target.dataset.dir !== d.dir) {
      const other = { node: target.closest('.node').dataset.node, port: target.dataset.port };
      const self = { node: d.node, port: d.port };
      if (d.dir === 'out') connect(self, other); else connect(other, self);
    } else if (!target) {
      // Thả ra vùng trống: mở menu thêm node, rồi tự nối.
      openAddMenu(e.clientX, e.clientY, { pending: d });
    }
    renderEdges();
  }
});
let viewTimer;
function dirtyView() { clearTimeout(viewTimer); viewTimer = setTimeout(() => { wf.viewport = { ...view }; dirty(); }, 600); }

canvas.addEventListener('wheel', (e) => {
  if (e.target.closest('textarea') && e.target.scrollHeight > e.target.clientHeight && !e.ctrlKey) return;
  const scroller = e.target.closest('.list-body, .ai-out');
  if (scroller && scroller.scrollHeight > scroller.clientHeight && !e.ctrlKey) return;
  e.preventDefault();
  if (e.ctrlKey || !e.shiftKey) zoomAt(e.clientX, e.clientY, view.zoom * Math.exp(-e.deltaY * 0.0015));
  else { view.x -= e.deltaY; applyView(); }
  dirtyView();
}, { passive: false });

// Rê chuột lên dây: hiện node nguồn, cổng ra → cổng vào, node đích.
const edgeTip = document.createElement('div');
edgeTip.className = 'edge-tip';
edgeTip.hidden = true;
document.body.appendChild(edgeTip);
canvas.addEventListener('mousemove', (e) => {
  const hit = !drag && e.target.closest?.('[data-edge]');
  const edge = hit && wf.edges.find((x) => x.id === hit.dataset.edge);
  if (!edge) { edgeTip.hidden = true; return; }
  const a = wf.nodes.find((n) => n.id === edge.from.node), b = wf.nodes.find((n) => n.id === edge.to.node);
  const pa = a && portsOf(a, 'out').find((p) => p.name === edge.from.port), pb = b && portsOf(b, 'in').find((p) => p.name === edge.to.port);
  if (!pa || !pb) { edgeTip.hidden = true; return; }
  edgeTip.innerHTML = `<b>${esc(a.data.name || NODE_DEFS[a.type].title)}</b><div><span>${esc(pa.label)}</span> → <span>${esc(pb.label)}</span></div><b>${esc(b.data.name || NODE_DEFS[b.type].title)}</b>`;
  edgeTip.style.left = `${e.clientX + 14}px`;
  edgeTip.style.top = `${e.clientY + 14}px`;
  edgeTip.hidden = false;
});
canvas.addEventListener('mouseleave', () => { edgeTip.hidden = true; });

// Đổi tên node ngay trên tiêu đề (nhấp đúp).
function startRename(id) {
  const n = wf.nodes.find((x) => x.id === id);
  const span = nodeEl(id)?.querySelector(':scope > .label span');
  if (!n || !span) return;
  const input = document.createElement('input');
  input.className = 'label-edit';
  input.value = n.data.name || '';
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (ok) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (!ok || !v || v === n.data.name) { rerenderNode(id); return; }
    const patch = { name: v };
    if (!n.data.slug || n.data.slug === slugify(n.data.name)) patch.slug = uniqueSlug(v, id);
    setData(id, patch);
  };
  input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => finish(true));
}

canvas.addEventListener('dblclick', (e) => {
  const label = e.target.closest('.node > .label');
  if (label) { startRename(label.closest('.node').dataset.node); return; }
  const nodeDiv = e.target.closest('.node');
  if (nodeDiv && !e.target.closest(INTERACTIVE)) { openSide(nodeDiv.dataset.node); return; }
  if (!nodeDiv) openAddMenu(e.clientX, e.clientY);
});

// Sửa trực tiếp trong node.
let editSnap = null;
nodesEl.addEventListener('focusin', (e) => { if (e.target.matches('[data-k], [data-li]')) editSnap = snapshot(); });
nodesEl.addEventListener('input', (e) => {
  if (e.target.dataset.li !== undefined) {
    const n = wf.nodes.find((x) => x.id === e.target.closest('.node').dataset.node);
    const item = n?.data.items?.[+e.target.dataset.li];
    if (item) { item.text = e.target.value; dirty(); }
    return;
  }
  const k = e.target.dataset.k;
  if (!k || e.target.tagName === 'SELECT') return;
  const id = e.target.closest('.node').dataset.node;
  const n = wf.nodes.find((x) => x.id === id);
  n.data[k] = e.target.type === 'number' ? +e.target.value : e.target.value;
  const counter = nodeEl(id).querySelector('.counter');
  if (counter) counter.textContent = `${n.data[k].length}/${MAX_PROMPT.toLocaleString('vi')}`;
  if (k === 'text' || k === 'prompt') refreshPeeks();
  dirty();
});
nodesEl.addEventListener('change', (e) => {
  const k = e.target.dataset.k;
  if (!k) {
    if (e.target.dataset.li !== undefined && editSnap) { undoStack.push(editSnap); redoStack.length = 0; editSnap = null; updateUndoButtons(); }
    return;
  }
  const id = e.target.closest('.node').dataset.node;
  if (e.target.tagName === 'SELECT') {
    let v = e.target.value;
    if (k === 'quantity') v = +v;
    const patch = { [k]: v };
    if (k === 'genType') Object.assign(patch, { model: '', ratio: '' });
    setData(id, patch);
    if (sideNodeId === id) openSide(id, sideTab);
  } else if (editSnap) { undoStack.push(editSnap); redoStack.length = 0; editSnap = null; updateUndoButtons(); }
});
nodesEl.addEventListener('click', (e) => {
  const nodeDiv = e.target.closest('.node');
  const bar = e.target.closest('[data-bar]');
  if (bar) {
    const id = [...selection][0];
    const act = bar.dataset.bar;
    if (act === 'run') runWorkflow([id]);
    if (act === 'run-next') runFrom(id, false);
    if (act === 'run-branch') runFrom(id, true);
    if (act === 'reset') { clearNodeResult(id); toast('Đã xoá kết quả của node'); }
    if (act === 'download') downloadAll(wf.nodes.find((x) => x.id === id));
    if (act === 'copy-prompt') navigator.clipboard.writeText(promptOf(wf.nodes.find((x) => x.id === id))).then(() => toast('Đã copy prompt'), () => toast('Không copy được'));
    if (act === 'config') openSide(id);
    if (act === 'branch') duplicate([id], { keepInputs: true, offset: 60 });
    if (act === 'dup') duplicate([id]);
    if (act === 'del') deleteSelection();
    return;
  }
  if (!nodeDiv) return;
  const id = nodeDiv.dataset.node;
  const n = wf.nodes.find((x) => x.id === id);
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) {
    const k = toggle.dataset.toggle;
    setData(id, { [k]: k === 'newChat' ? n.data.newChat === false : !n.data[k] });
    if (k === 'agent' && n.data.agent) openSide(id);
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'config') openSide(id);
  if (act === 'run-node') runWorkflow([id]);
  if (act === 'toggle-enabled') setData(id, { enabled: !n.data.enabled });
  if (act === 'zoom-node') setData(id, { nodeZoom: ({ 1: 1.5, 1.5: 2, 2: 1 })[n.data.nodeZoom || 1] }, { history: false });
  if (act === 'run-group') runGroup(n);
  if (act === 'page-prev' || act === 'page-next') {
    const res = statusOf(n)?.preview ? statusOf(n) : wf.results?.[id];
    const total = (res?.preview || []).filter((p) => p.kind !== 'text').length;
    pages.set(id, ((pages.get(id) || 0) + (act === 'page-next' ? 1 : -1) + total) % Math.max(1, total));
    const media = nodeEl(id).querySelector('.nb-media');
    media.querySelector('.viewer')?.remove();
    media.insertAdjacentHTML('beforeend', previewHtml(n));
    loadMediaInfo(media);
  }
  if (act === 'li-del') {
    pushHistory();
    n.data.items = n.data.items.filter((_, i) => i !== +e.target.closest('[data-i]').dataset.i);
    rerenderNode(id);
    dirty();
  }
  if (act === 'li-add-text') {
    pushHistory();
    n.data.items = [...(n.data.items || []), { kind: 'text', text: '' }];
    if (n.data.kind === 'any') n.data.kind = 'text';
    rerenderNode(id);
    dirty();
    const tas = nodeEl(id).querySelectorAll('textarea[data-li]');
    tas[tas.length - 1]?.focus();
  }
  if (act === 'li-add-media') openFilePicker(id);
  if (act === 'edit-result') editResult(n);
  if (act === 'edit-inplace') editInPlace(n);
  if (act === 'rename') startRename(id);
  if (act === 'edit-slug') { openSide(id, 'config'); slugMode = true; openSide(id, 'config'); side.querySelector('[data-d=slug]')?.focus(); }
});

// Kéo thả file vào node Image/Video hoặc canvas.
canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.target.closest('.nb-media[data-drop]')?.classList.add('drop'); });
canvas.addEventListener('dragleave', (e) => e.target.closest('.nb-media[data-drop]')?.classList.remove('drop'));
canvas.addEventListener('drop', async (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])].filter((f) => /^(image|video)\//.test(f.type));
  if (!files.length) return;
  const target = e.target.closest('.node');
  const node = target && wf.nodes.find((n) => n.id === target.dataset.node && (n.type === 'image' || n.type === 'list'));
  if (node) { await addMediaToNode(node.id, files); return; }
  // Thả nhiều file ra canvas: mỗi file thành một node Image/Video (như bản gốc), có thanh tiến độ tải lên.
  const p = toWorld(e.clientX, e.clientY);
  const pill = uploadPill(files.length);
  for (let i = 0; i < files.length; i++) {
    const n = addNode('image', p.x + (i % 3) * 330, p.y + Math.floor(i / 3) * 420, { name: files[i].name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Image/Video' });
    await addMediaToNode(n.id, [files[i]], { quiet: true });
    pill.step(i + 1, files[i].name);
  }
  pill.done();
});

function uploadPill(total) {
  const el = document.createElement('div');
  el.className = 'upload-pill';
  document.body.appendChild(el);
  const set = (k, name) => { el.innerHTML = `<span class="spinner sm"></span>Tải lên ${k}/${total}${name ? ` · <span class="muted">${esc(name)}</span>` : ''}`; };
  set(0);
  return { step: set, done: () => { el.innerHTML = `✓ Đã thêm ${total} file`; setTimeout(() => el.remove(), 1600); } };
}

function openLightbox(src, kind, fallback) {
  const back = document.createElement('div');
  back.className = 'lightbox';
  back.innerHTML = `${kind === 'video' && src !== fallback ? `<video src="${esc(src)}" poster="${esc(fallback || '')}" controls autoplay loop></video>` : `<img src="${esc(src)}" alt="">`}<button class="icon-btn" title="Đóng (Esc)">${I.x}</button>`;
  // Không mở được file gốc (cần đăng nhập): hiện ảnh xem trước.
  const media = back.querySelector('img, video');
  media.addEventListener('error', () => { if (fallback && media.tagName === 'IMG' && media.src !== fallback) media.src = fallback; else if (media.tagName === 'VIDEO' && fallback) media.outerHTML = `<img src="${esc(fallback)}" alt="">`; }, { once: true });
  back.addEventListener('click', (e) => { if (!['IMG', 'VIDEO'].includes(e.target.tagName)) back.remove(); });
  document.body.appendChild(back);
}

// ---------- Media ----------
function readFile(f) {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsDataURL(f); });
}
function makeThumb(dataUrl, isVideo) {
  return new Promise((resolve) => {
    const el = document.createElement(isVideo ? 'video' : 'img');
    const done = () => {
      try {
        const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
        const s = 320 / Math.max(w, h);
        const c = document.createElement('canvas');
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(el, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.75));
      } catch (_) { resolve(''); }
    };
    if (isVideo) { el.muted = true; el.onloadeddata = done; el.onerror = () => resolve(''); } else { el.onload = done; el.onerror = () => resolve(''); }
    el.src = dataUrl;
  });
}
async function addMediaToNode(id, files, { quiet = false } = {}) {
  const n = wf.nodes.find((x) => x.id === id);
  const items = [];
  for (const f of files) {
    if (f.size > 25 * 1024 * 1024) { toast(`${f.name} quá lớn (>25MB)`); continue; }
    const dataUrl = await readFile(f);
    const kind = f.type.startsWith('video/') ? 'video' : 'image';
    items.push({ kind, dataUrl, mime: f.type, name: f.name, thumb: await makeThumb(dataUrl, kind === 'video') });
  }
  if (!items.length) return;
  if (n.type === 'list') {
    const all = [...(n.data.items || []), ...items];
    const kinds = new Set(all.map((i) => i.kind));
    setData(id, { items: all, kind: kinds.size === 1 ? [...kinds][0] : 'any' });
  } else setData(id, { media: [...(n.data.media || []), ...items] });
  if (sideNodeId === id) openSide(id, sideTab);
  if (!quiet) toast(`Đã thêm ${items.length} file`);
}
let pickTarget = null;
function openFilePicker(id) { pickTarget = id; $('file-pick').click(); }
$('file-pick').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  if (!pickTarget || !wf.nodes.some((n) => n.id === pickTarget)) { const c = toWorld(innerWidth / 2, innerHeight / 2); pickTarget = addNode('image', c.x - 150, c.y - 200).id; }
  await addMediaToNode(pickTarget, files);
});
async function pasteImageFromClipboard(at) {
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) for (const t of it.types) if (t.startsWith('image/')) files.push(new File([await it.getType(t)], 'paste.png', { type: t }));
    if (!files.length) { toast('Bộ nhớ tạm không có ảnh'); return; }
    const p = at || toWorld(innerWidth / 2, innerHeight / 2);
    const n = addNode('image', p.x, p.y);
    await addMediaToNode(n.id, files);
  } catch (_) { toast('Trình duyệt chặn đọc bộ nhớ tạm, hãy dùng Ctrl+V'); }
}
document.addEventListener('paste', async (e) => {
  if (e.target.closest?.('textarea, input')) return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => /^(image|video)\//.test(f.type));
  if (files.length) {
    e.preventDefault();
    const sel = [...selection].map((id) => wf.nodes.find((n) => n.id === id)).find((n) => n?.type === 'image');
    if (sel) await addMediaToNode(sel.id, files);
    else { const p = toWorld(lastMouse.x, lastMouse.y); const n = addNode('image', p.x, p.y); await addMediaToNode(n.id, files); }
    return;
  }
  const clip = localStorage.getItem('aflWfClip');
  if (clip) pasteNodes(JSON.parse(clip));
});
const lastMouse = { x: innerWidth / 2, y: innerHeight / 2 };
window.addEventListener('mousemove', (e) => { lastMouse.x = e.clientX; lastMouse.y = e.clientY; });

function copySelection() {
  const ids = new Set(selection);
  if (!ids.size) return;
  const nodes = wf.nodes.filter((n) => ids.has(n.id));
  const edges = wf.edges.filter((e) => ids.has(e.from.node) && ids.has(e.to.node));
  try { localStorage.setItem('aflWfClip', JSON.stringify({ nodes, edges })); } catch (_) { /* quá lớn */ }
  toast(`Đã sao chép ${nodes.length} node`);
}
function pasteNodes(clip) {
  if (!clip?.nodes?.length) return;
  pushHistory();
  const p = toWorld(lastMouse.x, lastMouse.y);
  const minX = Math.min(...clip.nodes.map((n) => n.x)), minY = Math.min(...clip.nodes.map((n) => n.y));
  const map = {};
  const created = [];
  for (const src of clip.nodes) {
    const n = { ...structuredClone(src), id: nid(), x: Math.round(p.x + src.x - minX), y: Math.round(p.y + src.y - minY) };
    if (n.type !== 'note') n.data.slug = uniqueSlug(n.data.name);
    map[src.id] = n.id;
    wf.nodes.push(n);
    created.push(n.id);
  }
  for (const e of clip.edges) wf.edges.push({ id: nid(), from: { node: map[e.from.node], port: e.from.port }, to: { node: map[e.to.node], port: e.to.port } });
  renderAll();
  select(created);
  dirty();
}

// ---------- Menu ----------
function closeMenus() { document.querySelectorAll('.menu, .add-pop').forEach((m) => m.remove()); }
function placeMenu(menu, x, y) {
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
}
function openAddMenu(x, y, opts = {}) {
  closeMenus();
  const at = toWorld(x, y);
  const menu = document.createElement('div');
  menu.className = 'add-pop';
  const pending = opts.pending;
  const fits = (type) => {
    if (!pending) return true;
    const probe = createNode(type, 0, 0);
    const ports = portsOf(probe, pending.dir === 'out' ? 'in' : 'out');
    return ports.some((p) => (pending.dir === 'out' ? canConnect(pending.type, portType(probe, p)) : canConnect(portType(probe, p), pending.type)));
  };
  const ORDER = ['image', 'text', 'prompt', 'assistant', 'list', 'generate', 'seedance', 'chatgpt', 'grok', 'gemini', 'download', 'telegram', 'extract', 'delay', 'note'];
  const all = ORDER.filter((t) => NODE_DEFS[t] && fits(t) && !(pending && t === 'note'));
  let active = 0, shown = all;
  const render = () => {
    menu.querySelector('.list').innerHTML = shown.map((type, i) => {
      const d = NODE_DEFS[type];
      return `<button class="it ${i === active ? 'active' : ''}" data-add="${type}"><span class="ic ${type === 'generate' ? 'flow' : ''}">${I[d.icon] || I.generate}</span><span><b>${esc(d.title)}</b><small>${esc(d.desc)}</small></span></button>`;
    }).join('') || '<p class="hint" style="padding:8px">Không có node phù hợp.</p>';
    menu.querySelector('.it.active')?.scrollIntoView({ block: 'nearest' });
  };
  menu.innerHTML = `<div class="head"><button class="icon-btn" data-close>${I.x}</button></div><input type="search" placeholder="Tìm node..."><div class="list"></div>
    <div class="foot"><span><kbd>↑↓</kbd> Di chuyển</span><span><kbd>Enter</kbd> Chọn</span><span><kbd>Esc</kbd> Đóng</span></div>`;
  const input = menu.querySelector('input');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    shown = all.filter((t) => !q || `${NODE_DEFS[t].title} ${NODE_DEFS[t].desc}`.toLowerCase().includes(q));
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    if (e.key === 'Enter' && shown[active]) { e.preventDefault(); choose(shown[active]); }
    if (e.key === 'Escape') closeMenus();
  });
  menu.addEventListener('mousedown', (e) => e.stopPropagation());
  menu.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeMenus(); return; }
    const type = e.target.closest('[data-add]')?.dataset.add;
    if (type) choose(type);
  });
  function choose(type) {
    closeMenus();
    const n = addNode(type, at.x - (pending?.dir === 'in' ? 300 : 0), at.y - 30);
    if (pending) {
      const ports = portsOf(n, pending.dir === 'out' ? 'in' : 'out');
      const p = ports.find((pp) => (pending.dir === 'out' ? canConnect(pending.type, portType(n, pp)) : canConnect(portType(n, pp), pending.type)));
      requestAnimationFrame(() => {
        if (pending.dir === 'out') connect({ node: pending.node, port: pending.port }, { node: n.id, port: p.name });
        else connect({ node: n.id, port: p.name }, { node: pending.node, port: pending.port });
      });
    }
  }
  document.body.appendChild(menu);
  render();
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x - r.width / 2, innerWidth - r.width - 8))}px`;
  menu.style.top = `${Math.max(66, Math.min(y - 40, innerHeight - r.height - 8))}px`;
  input.focus();
}

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  closeMenus();
  const at = toWorld(e.clientX, e.clientY);
  const nodeDiv = e.target.closest('.node');
  if (nodeDiv && !selection.has(nodeDiv.dataset.node)) select([nodeDiv.dataset.node]);
  const menu = document.createElement('div');
  menu.className = 'menu';
  const nodeItems = nodeDiv ? `<button data-m="run-sel">${I.play}Chạy node đã chọn</button>${childrenOf(nodeDiv.dataset.node).length ? `<button data-m="run-next">${I.play}Chạy các node nối từ đây (${childrenOf(nodeDiv.dataset.node).length})</button><button data-m="run-branch">⏩ Chạy tiếp cả nhánh phía sau</button>` : ''}<button data-m="config">${I.gear}Cấu hình node</button><button data-m="dup">${I.copy}Nhân bản (Ctrl+D)</button><button data-m="copy">${I.copy}Sao chép (Ctrl+C)</button><button data-m="del">${I.trash}Xoá (Delete)</button><div class="sep"></div>` : '';
  menu.innerHTML = `${nodeItems}
    <button data-m="add">${I.plus}Thêm node (N)</button>
    <button data-m="paste">${I.paste}Dán ảnh (Ctrl+V)</button>
    <button data-m="refresh">${I.refresh}Refresh</button>
    <button data-m="library">${I.lib}Thêm media từ thư viện</button>
    <button data-m="note">${I.note}Thêm ghi chú (khung group)</button>
    <div class="sep"></div>
    <button data-m="undo" ${undoStack.length ? '' : 'disabled'}>${I.undo}Hoàn tác (Ctrl+Z)</button>
    <button data-m="redo" ${redoStack.length ? '' : 'disabled'}>${I.redo}Làm lại (Ctrl+Shift+Z)</button>
    <div class="sep"></div>
    <button data-m="run">${I.play}Chạy workflow (Ctrl+Enter)</button>
    <button data-m="log">${I.note}Log & tiến độ</button>
    <button data-m="fit">${I.fit}Vừa màn hình</button>
    <button data-m="arrange">${I.arrange}Sắp xếp lại nodes</button>
    <div class="sep"></div>
    <button data-m="settings">${I.gear}Cài đặt workflow</button>
    <button data-m="export">${I.lib}Xuất workflow</button>`;
  menu.addEventListener('mousedown', (ev) => ev.stopPropagation());
  menu.addEventListener('click', (ev) => {
    const m = ev.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    closeMenus();
    ({
      'run-sel': () => runWorkflow([...selection]),
      'run-next': () => runFrom(nodeDiv.dataset.node, false),
      'run-branch': () => runFrom(nodeDiv.dataset.node, true),
      config: () => openSide([...selection][0]),
      dup: () => duplicate([...selection]),
      copy: copySelection,
      del: deleteSelection,
      add: () => openAddMenu(e.clientX, e.clientY),
      paste: () => pasteImageFromClipboard(at),
      refresh: reloadFromStorage,
      library: () => openLibrary(at),
      note: () => addNote(at),
      undo, redo, fit: fitView, arrange, settings: openSettings,
      run: () => runWorkflow(),
      log: () => { logpanel.hidden = false; renderLog(); },
      export: exportJson
    })[m]?.();
  });
  placeMenu(menu, e.clientX, e.clientY);
});
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.menu, .add-pop')) closeMenus(); });

function addNote(at) {
  const p = at || toWorld(innerWidth / 2 - 230, innerHeight / 2 - 160);
  const sel = [...selection].map((id) => wf.nodes.find((n) => n.id === id)).filter((n) => n && n.type !== 'note');
  if (sel.length) {
    // Bao quanh các node đang chọn.
    const boxes = sel.map(nodeBox);
    const x = Math.min(...boxes.map((b) => b.x)) - 40, y = Math.min(...boxes.map((b) => b.y)) - 70;
    const w = Math.max(...boxes.map((b) => b.x + b.w)) - x + 40, h = Math.max(...boxes.map((b) => b.y + b.h)) - y + 30;
    addNode('note', x, y, { w, h, text: 'Nhóm mới' });
  } else addNode('note', p.x, p.y);
}

// ---------- Thư viện media (từ lịch sử) ----------
function modal(html) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal">${html}</div>`;
  back.addEventListener('mousedown', (e) => { if (e.target === back) back.remove(); });
  document.body.appendChild(back);
  return back;
}
async function openLibrary(at) {
  await store.load();
  const items = store.history.flatMap((h) => h.results.filter((r) => r.thumb).map((r) => ({ ...r, prompt: h.prompt, provider: h.provider || 'flow' }))).slice(0, 120);
  const back = modal(`<h3>Thêm media từ thư viện</h3>
    ${items.length ? `<div class="lib-grid">${items.map((r, i) => `<button data-i="${i}" title="${esc(r.prompt)}"><img src="${r.thumb}" alt=""></button>`).join('')}</div>` : '<p class="hint">Chưa có kết quả nào trong lịch sử.</p>'}
    <div class="row"><span class="spacer"></span><button class="btn-white" data-ok ${items.length ? '' : 'disabled'}>Thêm vào canvas</button></div>`);
  const chosen = new Set();
  back.addEventListener('click', (e) => {
    const b = e.target.closest('[data-i]');
    if (b) { const i = +b.dataset.i; chosen.has(i) ? chosen.delete(i) : chosen.add(i); b.classList.toggle('sel'); return; }
    if (e.target.closest('[data-ok]') && chosen.size) {
      const p = at || toWorld(innerWidth / 2 - 150, innerHeight / 2 - 200);
      addNode('image', p.x, p.y, { media: [...chosen].map((i) => ({ kind: items[i].kind, url: items[i].url, provider: items[i].provider, thumb: items[i].thumb })) });
      back.remove();
    }
  });
}

function openSearch() {
  const back = modal(`<h3>Tìm node</h3><input class="inp" type="search" placeholder="Tên hoặc @slug"><div class="search-list"></div>`);
  const input = back.querySelector('input');
  const list = back.querySelector('.search-list');
  const render = () => {
    const q = input.value.trim().toLowerCase().replace(/^@/, '');
    list.innerHTML = wf.nodes.filter((n) => !q || `${n.data.name} ${n.data.slug}`.toLowerCase().includes(q))
      .map((n) => `<button data-id="${n.id}">${I[NODE_DEFS[n.type].icon] || ''}<span>${esc(n.data.name || n.data.text || NODE_DEFS[n.type].title)}</span><span class="muted">${n.data.slug ? '@' + esc(n.data.slug) : ''}</span></button>`).join('') || '<p class="hint">Không có node phù hợp.</p>';
  };
  input.addEventListener('input', render);
  list.addEventListener('click', (e) => { const id = e.target.closest('[data-id]')?.dataset.id; if (id) { back.remove(); focusNode(id); } });
  render();
  input.focus();
}

function openSettings() {
  const back = modal(`<h3>Cài đặt workflow</h3>
    <div class="field"><span class="lbl">Tên workflow</span><input class="inp" data-s="name" value="${esc(wf.name)}"></div>
    <label class="row"><button class="tog ${wf.maxSpeed ? 'on' : ''}" data-s="maxSpeed"></button>Max Speed: chạy song song tối đa 3 task Flow</label>
    <label class="row"><button class="tog ${wf.enabled !== false ? 'on' : ''}" data-s="enabled"></button>Bật workflow</label>
    <p class="hint">Kết quả của node Download được lưu vào <code>AutoFlow/${esc(wf.name)}/</code> (hoặc thư mục riêng đặt trong node).</p>
    <div class="row"><span class="spacer"></span><button class="btn-white" data-ok>Xong</button></div>`);
  back.addEventListener('click', (e) => {
    const t = e.target.closest('.tog[data-s]');
    if (t) t.classList.toggle('on');
    if (e.target.closest('[data-ok]')) {
      wf.name = back.querySelector('[data-s=name]').value.trim() || wf.name;
      wf.maxSpeed = back.querySelector('[data-s=maxSpeed]').classList.contains('on');
      wf.enabled = back.querySelector('[data-s=enabled]').classList.contains('on');
      renderHeader();
      dirty();
      back.remove();
    }
  });
}

// ---------- Panel cấu hình ----------
let sideNodeId = null, sideTab = 'config', draft = null, slugMode = false;
const side = $('side');
function closeSide() { side.hidden = true; sideNodeId = null; draft = null; }

function slugHints(selfId) {
  const others = wf.nodes.filter((n) => n.id !== selfId && n.data.slug && n.type !== 'note');
  return others.length ? `<div class="row" style="flex-wrap:wrap;gap:6px">${others.map((n) => `<span class="chip" data-insert="@${esc(n.data.slug)}">@${esc(n.data.slug)}</span>`).join('')}</div>` : '';
}
function configFields(n) {
  const d = draft;
  const sel = (k, opts, v) => `<select data-d="${k}">${opts.map((o) => (Array.isArray(o) ? o : [o, o])).map(([val, l]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const tog = (k, on) => `<button class="tog ${on ? 'on' : ''}" data-dt="${k}"></button>`;
  const providerOpts = TEXT_AI.map((p) => [p, PROVIDER_LABEL[p]]);
  const modeOpts = [['auto', 'Auto'], ['all', 'All'], ['mention', 'Mention']];
  // Mention Mode (Nâng cao): cách lấy prompt / ảnh tham chiếu từ node phía trước.
  const mentionHtml = (text = 'prompt') => `<details class="adv"><summary>Mention Mode (Nâng cao)</summary>
      <div class="grid2"><div class="field"><span class="lbl">Prompt</span>${sel('promptMode', modeOpts, d.promptMode || 'auto')}</div>
        <div class="field"><span class="lbl">Ref</span>${sel('refMode', modeOpts, d.refMode || 'auto')}</div></div>
      <p class="hint"><b>Auto</b>: có @mention thì chỉ dùng node được nhắc, không thì dùng tất cả. <b>All</b>: dùng mọi node nối vào. <b>Mention</b>: chỉ node được @mention trong ${text}. Gõ <code>@slug</code> của node Ảnh để chọn ảnh tham chiếu đó.</p>${slugHints(n.id)}</details>`;
  // Ảnh tham chiếu chọn sẵn trong node (tối đa 4).
  const refsHtml = () => `<div class="field"><span class="lbl">Ảnh tham chiếu (tối đa 4)</span>
      <div class="results">${(d.refs || []).map((r, i) => `<div class="r"><img src="${r.dataUrl}" alt=""><a href="#" data-rmref="${i}">Xoá</a></div>`).join('')}</div>
      ${(d.refs || []).length < 4 ? '<button class="btn-white sm" data-side="ref-add">Chọn / Tải ảnh lên</button>' : ''}</div>`;
  const autoDl = () => `<label class="row">${tog('autoDownload', d.autoDownload)}Tự tải kết quả</label>`;
  const advanced = (extra = '') => `<details class="adv"><summary>Cài đặt nâng cao</summary>
      <p class="hint">Hiếm khi cần đổi. Chỉ chỉnh khi gặp lỗi / hết thời gian chờ.</p>${extra}
      <div class="field"><span class="lbl">Thời gian chờ tối đa (giây, 0 = theo Cài đặt)</span><input class="inp" type="number" min="0" max="3600" data-d="timeoutSec" value="${esc(d.timeoutSec || 0)}"></div></details>`;
  switch (n.type) {
    case 'assistant':
      return `<div class="field"><span class="lbl">Yêu cầu cho AI (dùng @slug để chèn văn bản node khác)</span><textarea data-d="text">${esc(d.text)}</textarea>${slugHints(n.id)}</div>
        <div class="grid2"><div class="field"><span class="lbl">AI trả lời</span>${sel('provider', providerOpts, d.provider)}</div>
          <div class="field"><span class="lbl">Xuất kết quả</span>${sel('exportAs', [['list', 'Danh sách (mỗi dòng 1 mục)'], ['text', 'Một đoạn văn bản']], d.exportAs)}</div></div>
        <p class="hint">Chạy trên trang AI đã đăng nhập, tính vào hạn mức gói của bạn. Nối ảnh vào cổng "Ảnh cho AI xem" để AI phân tích ảnh. "Danh sách" + node List: sửa từng mục trước khi tạo ảnh/video.</p>`;
    case 'list':
      return `<div class="grid2"><div class="field"><span class="lbl">Loại mục</span>${sel('kind', [['any', 'Tự nhận'], ['text', 'Văn bản'], ['image', 'Ảnh'], ['video', 'Video']], d.kind)}</div>
          <div class="field"><span class="lbl">Khi node phía trước chạy lại</span>${sel('keep', [['replace', 'Thay toàn bộ mục'], ['append', 'Keep items (giữ và thêm)']], d.keep)}</div></div>
        <p class="hint">${(d.items || []).length} mục. Node nối phía sau chạy <b>mỗi mục một lượt</b> (vd. 8 bối cảnh → 8 ảnh). Sửa / xoá mục ngay trên node; chạy riêng node phía sau sẽ dùng đúng danh sách đang hiển thị, không gọi lại AI.</p>`;
    case 'seedance':
      return `<div class="field"><span class="lbl">Prompt riêng (tuỳ chọn, dùng {input} và @slug)</span><textarea class="short" data-d="prompt">${esc(d.prompt)}</textarea>${slugHints(n.id)}</div>
        <div class="grid2">
          <div class="field"><span class="lbl">Model</span>${sel('model', [['', 'Theo Cài đặt'], ...SEEDANCE_MODELS], d.model)}</div>
          <div class="field"><span class="lbl">Tỉ lệ</span>${sel('ratio', [['', 'Theo Cài đặt'], ...SEEDANCE_RATIOS], d.ratio)}</div>
          <div class="field"><span class="lbl">Thời lượng</span>${sel('duration', [['', 'Theo Cài đặt'], ...SEEDANCE_DURATIONS], d.duration)}</div>
        </div>
        ${mentionHtml()}${autoDl()}${advanced()}
        <p class="hint">Chạy trên Dreamina (dreamina.capcut.com) bằng credit tài khoản của bạn. Nối List ảnh vào "Khung đầu": mỗi ảnh ra một video. Cùng số prompt và ảnh thì ghép 1-1.</p>`;
    case 'prompt': {
      const count = d.multi ? splitMultiPrompt(d.text).length : 0;
      return `<div class="field"><div class="lbl"><span>${I.prompt} Nội dung Prompt</span><label class="row">${tog('multi', d.multi)}<b>Multi-prompt</b></label></div>
        <textarea data-d="text" maxlength="${MAX_PROMPT}" placeholder="VD: A cute cat playing with yarn, cinematic lighting">${esc(d.text)}</textarea>
        <div class="row"><span class="hint">${d.multi ? `${count} prompt · Cách nhau 1 dòng trống (hoặc mỗi dòng 1 prompt). Lưu node tạo mỗi prompt một cổng ra; bớt prompt thì nhánh thừa bị ngắt.` : 'Toàn bộ là 1 prompt.'}</span><span class="spacer"></span><span class="hint">${d.text.length}/${MAX_PROMPT.toLocaleString('vi')}</span></div></div>
        ${mentionHtml('nội dung prompt')}
        <div class="box agent"><label class="row">${tog('agent', d.agent)}<b>Dùng AI</b><span class="spacer"></span><span class="hint">ChatGPT / Claude / Gemini / Grok</span></label>
          ${d.agent ? `<div class="field"><span class="lbl">AI</span>${sel('agentProvider', providerOpts, d.agentProvider)}</div>
          <div class="field"><span class="lbl">Yêu cầu cho AI</span><textarea class="short" data-d="agentInstruction">${esc(d.agentInstruction)}</textarea></div>
          <div class="field"><span class="lbl">Thời gian chờ AI trả lời (giây, tăng lên nếu prompt dài)</span><input class="inp" type="number" min="10" max="900" data-d="agentTimeout" value="${esc(d.agentTimeout || 60)}"></div>
          ${refsHtml()}<p class="hint">Ảnh gửi kèm prompt để AI hiểu bối cảnh. ChatGPT được khuyên dùng; Gemini đôi khi trả ảnh thay vì chữ.</p>
          <label class="row">${tog('agentSplit', d.agentSplit)}Tách mỗi dòng trả lời thành 1 prompt</label>
          <details class="adv"><summary>Cài đặt nâng cao</summary>
            <label class="row">${tog('agentFallback', d.agentFallback !== false)}Dùng văn bản gốc nếu AI lỗi</label>
            <p class="hint">Tự dùng nguyên văn bản nếu AI không trả lời (hết giờ / lỗi).</p>
            <label class="row">${tog('agentDelete', d.agentDelete)}Xoá cuộc trò chuyện sau khi AI chạy</label></details>` : ''}</div>
        <p class="hint">${d.agent ? 'Output = câu trả lời của AI (chạy trên trang chat đã đăng nhập).' : 'Output = văn bản nguyên văn (không gọi AI, không tốn quota).'}</p>`;
    }
    case 'text':
      return `<div class="field"><div class="lbl">Văn bản</div><textarea data-d="text">${esc(d.text)}</textarea></div><p class="hint">Node khác dùng <code>@${esc(d.slug)}</code> để chèn văn bản này.</p>`;
    case 'extract':
      return `<div class="field"><span class="lbl">Cách tách</span>${sel('mode', [['marker', 'Theo mốc [tên_mốc]'], ['lines', 'Mỗi dòng thành 1 mục'], ['line', 'Lấy 1 dòng'], ['regex', 'Regex'], ['between', 'Giữa 2 mốc'], ['json', 'JSON path']], d.mode)}</div>
        ${d.mode === 'marker' ? `<div class="field"><span class="lbl">Tên mốc (AI viết dạng [image_prompt_01] … )</span><input class="inp" data-d="marker" value="${esc(d.marker)}" placeholder="image_prompt_01"></div>` : ''}
        ${d.mode === 'line' ? `<div class="field"><span class="lbl">Dòng số</span><input class="inp" data-d="index" value="${esc(d.index)}"></div>` : ''}
        ${d.mode === 'regex' ? `<div class="field"><span class="lbl">Regex (nhóm 1 nếu có)</span><input class="inp" data-d="pattern" value="${esc(d.pattern)}"></div>` : ''}
        ${d.mode === 'between' ? `<div class="grid2"><div class="field"><span class="lbl">Mốc đầu</span><input class="inp" data-d="start" value="${esc(d.start)}"></div><div class="field"><span class="lbl">Mốc cuối</span><input class="inp" data-d="end" value="${esc(d.end)}"></div></div>` : ''}
        ${d.mode === 'json' ? `<div class="field"><span class="lbl">Đường dẫn (vd. prompts hoặc data.0.text)</span><input class="inp" data-d="path" value="${esc(d.path)}"></div>` : ''}
        ${['marker', 'regex'].includes(d.mode) ? `<label class="row">${tog('strict', d.strict)}Strict mode (phân biệt hoa thường)</label>` : ''}
        <div class="grid2"><div class="field"><span class="lbl">Khi khớp nhiều</span>${sel('multiMatch', [['all', 'Tất cả (mỗi mục 1 lượt)'], ['first', 'Đầu tiên'], ['last', 'Cuối cùng'], ['concat', 'Nối tất cả']], d.multiMatch || 'all')}</div>
          <div class="field"><span class="lbl">Khi không tìm thấy</span>${sel('onFail', [['error', 'Báo lỗi'], ['empty', 'Trả văn bản rỗng'], ['skip', 'Bỏ qua nhánh sau'], ['fail', 'Dừng workflow']], d.onFail || 'error')}</div></div>
        <p class="hint">Regex: nhóm 1 (nếu có) là văn bản đầu ra.</p>`;
    case 'image':
      return `<div class="results">${(d.media || []).map((m, i) => `<div class="r"><img src="${m.thumb || m.dataUrl}" alt=""><a href="#" data-rm="${i}">Xoá</a></div>`).join('') || '<p class="hint">Chưa có media.</p>'}</div>
        <div class="row"><button class="btn-white" data-side="upload">Tải lên</button><button class="btn-white" data-side="library">Từ thư viện</button></div>
        <p class="hint">Có thể kéo thả file vào node hoặc dán ảnh (Ctrl+V).</p>`;
    case 'generate': {
      const kind = d.genType === 'video' ? 'video' : 'image';
      return `<div class="field"><span class="lbl">Prompt riêng (tuỳ chọn, dùng {input} và @slug)</span><textarea class="short" data-d="prompt">${esc(d.prompt)}</textarea>${slugHints(n.id)}</div>
        <div class="grid2">
          <div class="field"><span class="lbl">Loại</span>${sel('genType', [['image', 'Ảnh'], ['video', 'Video']], d.genType)}</div>
          <div class="field"><span class="lbl">Số kết quả</span>${sel('quantity', [1, 2, 3, 4], d.quantity)}</div>
          <div class="field"><span class="lbl">Model</span>${sel('model', [['', 'Giữ như Flow'], ...optionsFor(kind)], d.model)}</div>
          <div class="field"><span class="lbl">Tỉ lệ</span>${sel('ratio', [['', 'Giữ như Flow'], ...RATIOS[kind]], d.ratio)}</div>
          ${kind === 'video' ? `<div class="field"><span class="lbl">Kiểu video</span>${sel('videoMode', [['frames', 'Frames (khung đầu/cuối)'], ['ingredients', 'Ingredients (thành phần)'], ['text', 'Chỉ văn bản']], d.videoMode)}</div>
          <div class="field"><span class="lbl">Thời lượng</span>${sel('duration', [['', 'Giữ như Flow'], '4s', '6s', '8s'], d.duration)}</div>` : ''}
        </div>
        ${kind === 'image' || d.videoMode === 'ingredients' ? `<label class="row">${tog('perImage', d.perImage)}Mỗi ảnh tham chiếu một lượt (List 7 ảnh → 7 kết quả)</label>` : ''}
        ${mentionHtml()}${autoDl()}${advanced()}
        <p class="hint">Mỗi prompt đầu vào tạo 1 lượt. Cổng ảnh tham chiếu nhận nhiều ảnh; video Frames dùng cổng Khung đầu / Khung cuối. Cổng ra "Khung cuối video" lấy frame cuối để nối sang video tiếp theo.</p>`;
    }
    case 'chatgpt':
    case 'gemini':
    case 'grok': {
      const p = n.type, video = p !== 'chatgpt' && d.mode === 'video';
      const models = (CHAT_MODELS[p] || []).map((m) => [m.value, m.label]);
      const ratios = CHAT_RATIOS[p] || [];
      return `<div class="field"><span class="lbl">Prompt riêng (tuỳ chọn, dùng {input} và @slug)</span><textarea class="short" data-d="prompt" placeholder="VD: A futuristic robot with neon lights, cinematic">${esc(d.prompt)}</textarea></div>
        ${mentionHtml()}
        <div class="grid2">
          <div class="field"><span class="lbl">Chế độ</span>${p === 'chatgpt' ? sel('mode', [['image', 'Ảnh']], 'image') : sel('mode', [['image', 'Ảnh'], ['video', 'Video']], d.mode || 'image')}</div>
          <div class="field"><span class="lbl">Tỷ lệ</span>${sel('ratio', [['', 'Theo Cài đặt'], ...ratios], d.ratio || '')}</div>
          ${p === 'grok'
            ? `<div class="field"><span class="lbl">Chất lượng ảnh</span>${sel('quality', [['', 'Theo Cài đặt'], ['fast', 'Speed'], ['quality', 'Quality']], d.quality || '')}</div>
               ${video ? `<div class="field"><span class="lbl">Thời lượng video</span>${sel('duration', ['6s', '10s'], d.duration || '6s')}</div>
               <div class="field"><span class="lbl">Độ phân giải</span>${sel('resolution', ['480p', '720p'], d.resolution || '720p')}</div>` : ''}`
            : `<div class="field"><span class="lbl">Model</span>${sel('model', [['', 'Theo Cài đặt'], ...models], d.model || '')}</div>`}
        </div>
        ${refsHtml()}
        <label class="row">${tog('newChat', d.newChat !== false)}Mở cuộc trò chuyện mới cho mỗi prompt</label>
        ${autoDl()}
        ${advanced(`${p === 'chatgpt' ? `<div class="field"><span class="lbl">Cách tạo ảnh</span>${sel('prefix', [['auto', 'Auto (gửi nguyên prompt)'], ['always', 'Luôn thêm "Generate an image:"']], d.prefix || 'auto')}</div>` : ''}
          ${p !== 'grok' ? `<div class="field"><span class="lbl">Xoá cuộc trò chuyện sau khi tạo</span>${sel('deleteAfter', [['', 'Theo Cài đặt'], ['yes', 'Có'], ['no', 'Không']], d.deleteAfter || '')}</div>` : ''}`)}
        <p class="hint">Chạy trên trang ${esc(PROVIDER_LABEL[p])} đã đăng nhập (hạn mức gói của bạn).${video ? ' Cổng ra "Khung cuối video" lấy frame cuối để nối tiếp.' : ''}</p>`;
    }
    case 'download':
      return `<div class="grid2">
          <div class="field"><span class="lbl">Độ phân giải ảnh</span>${sel('imageRes', [['', 'Theo Cài đặt'], ['original', 'Gốc'], ['2k', '2K'], ['4k', '4K']], d.imageRes || '')}</div>
          <div class="field"><span class="lbl">Độ phân giải video</span>${sel('videoRes', [['', 'Theo Cài đặt'], ['original', 'Gốc 720p'], ['1080p', '1080p'], ['4k', '4K']], d.videoRes || '')}</div></div>
        <label class="row">${tog('collectFlow', d.collectFlow)}Gom tất cả ảnh trên Flow</label>
        <p class="hint">Tự lấy mọi ảnh/video trong project Google Flow đang mở (kể cả không nối vào node).</p>
        <div class="field"><span class="lbl">Tên thư mục</span><input class="inp" data-d="folder" value="${esc(d.folder)}" placeholder="để trống = AutoFlow/${esc(wf.name)}"><span class="hint">Biến: {workflow}, {date}, {time}</span></div>
        <div class="field"><span class="lbl">Tên file</span><input class="inp" data-d="filePattern" value="${esc(d.filePattern || '')}" placeholder="để trống = theo Cài đặt"><span class="hint">Biến: {prompt}, {node}, {index}, {date}, {time}, {n}</span></div>
        <p class="hint">Tải kết quả từ node phía trước. Bản 2K/4K/1080p tải qua menu Download của Google Flow.</p>`;
    case 'telegram':
      return `<div class="field"><span class="lbl">Chat ID (để trống = chat đã liên kết)</span><input class="inp" data-d="chatId" value="${esc(d.chatId || '')}" placeholder="VD: 123456789"></div>
        <div class="field"><span class="lbl">Gửi ảnh</span>${sel('sendMode', [['single', 'Từng ảnh (nhiều tin nhắn)'], ['group', 'Gộp (1 tin nhắn)']], d.sendMode || 'single')}</div>
        <div class="field"><span class="lbl">Chú thích (tuỳ chọn, dùng {prompt})</span><input class="inp" data-d="caption" value="${esc(d.caption)}" placeholder="VD: Kết quả workflow..."></div>
        <p class="hint">Ảnh / video gửi kèm chú thích, văn bản gửi thành tin nhắn. Cần token bot và chat đã liên kết (/start) trong Cài đặt → AI Agent / Bot. Cổng ra chuyển tiếp nguyên dữ liệu cho node sau.</p>`;
    case 'delay':
      return `<div class="field"><span class="lbl">Số giây chờ</span><input class="inp" type="number" min="0" max="3600" data-d="seconds" value="${esc(d.seconds)}"></div>`;
    case 'note':
      return `<div class="field"><span class="lbl">Nội dung</span><textarea class="short" data-d="text">${esc(d.text)}</textarea></div>
        <div class="field"><span class="lbl">Màu khung</span><div class="row">${['#c6f432', '#3b82f6', '#a855f7', '#f5a524', '#ff6b6b', '#14b8a6'].map((c) => `<button class="tog" style="background:${c};width:22px;height:22px" data-color="${c}"></button>`).join('')}</div></div>
        <div class="field"><span class="lbl">Cỡ chữ</span>${sel('fontSize', [12, 14, 18, 24, 32, 48, 64], d.fontSize || 14)}</div>`;
    default:
      return '';
  }
}

// Tab "Kết quả": trạng thái, thời gian chạy, AI/model/tỉ lệ, prompt đã gửi, từng ảnh/video gốc (kích thước, mở, tải về).
function resultsHtml(n) {
  const live = statusOf(n), saved = runReset ? null : wf.results?.[n.id];
  const res = live?.preview || live?.status === 'running' || live?.status === 'error' ? live : saved || live;
  const waiting = queuedIds.has(n.id) && live?.status !== 'running';
  if (!res) return `<p class="hint">${waiting ? '⏳ Đang chờ tới lượt chạy.' : 'Chưa chạy node này. Bấm ▶ trên node hoặc chạy cả workflow.'}</p>`;
  const items = res.preview || [];
  const info = res.info || saved?.info;
  const start = res.startedAt || saved?.startedAt, end = res.finishedAt || saved?.finishedAt;
  const status = { pending: 'chờ', running: 'đang chạy', done: 'xong', error: 'lỗi', skipped: 'bỏ qua' }[res.status] || res.status;
  const row = (k, v) => (v ? `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>` : '');
  const meta = [
    row('Trạng thái', `${status}${res.count ? ` · ${res.count} kết quả` : ''}${waiting ? ' · đang chờ lượt mới' : ''}`),
    row('Thời gian chạy', start && end ? elapsed(end - start) : res.status === 'running' && start ? `${elapsed(Date.now() - start)} (đang chạy)` : ''),
    row('Hoàn thành lúc', end ? new Date(end).toLocaleString() : ''),
    row('AI', info?.provider ? PROVIDER_LABEL[info.provider] || info.provider : ''),
    row('Loại', info?.genType === 'video' ? 'Video' : info?.genType === 'image' ? 'Ảnh' : ''),
    row('Model', info?.model || (info?.genType ? 'Mặc định' : '')),
    row('Tỉ lệ', info?.ratio), row('Thời lượng', info?.duration), row('Kiểu video', info?.videoMode),
    row('Ảnh tham chiếu', info?.refs ? `${info.refs} ảnh mỗi lượt` : '')
  ].join('');
  const prompts = info?.prompts?.filter(Boolean) || [];
  const media = items.filter((it) => it.kind !== 'text');
  const texts = items.filter((it) => it.kind === 'text');
  return `<div class="kv-box">${meta}</div>
    ${res.error ? `<div class="err-box">${esc(res.error)}</div>` : ''}
    ${prompts.length ? `<div class="field"><span class="lbl">Prompt đã gửi (${prompts.length})</span>${prompts.map((p) => `<div class="t">${esc(p)}</div>`).join('')}</div>` : ''}
    ${media.length ? `<div class="field"><span class="lbl">Ảnh / video (${media.length})</span><div class="res-list">${media.map((it, i) => {
      const src = (it.kind !== 'video' && fullSrc.get(it.url)?.src) || it.thumb || (it.kind !== 'video' ? it.url : '');
      return `<div class="res-item">${src ? `<img src="${esc(src)}" data-full="${esc(it.url || '')}" data-kind="${it.kind}" data-provider="${esc(it.provider || '')}" data-lb="1" alt="">` : `<div class="ph">${it.kind === 'video' ? I.video : I.image}</div>`}
        <div class="res-meta"><b>#${i + 1} ${it.kind === 'video' ? 'Video' : 'Ảnh'}</b><span class="dims" data-info="${esc(it.url || '')}" data-kind="${it.kind}">${esc(mediaInfo.get(it.url) || '')}</span>
          ${it.prompt ? `<span class="muted">${esc(it.prompt.slice(0, 160))}</span>` : ''}
          <span class="row">${it.url ? `<button class="btn-white sm" data-side="res-dl" data-i="${i}">${I.download} Tải về</button><a href="${esc(it.url)}" target="_blank" rel="noopener">Mở tab mới</a>` : ''}</span></div></div>`;
    }).join('')}</div></div>` : ''}
    ${texts.length ? `<div class="field"><span class="lbl">Văn bản (${texts.length})</span>${texts.map((it) => `<div class="t">${esc(it.text)}</div>`).join('')}</div>` : ''}`;
}

function openSide(id, tab = 'config') {
  const n = wf.nodes.find((x) => x.id === id);
  if (!n) return;
  if (sideNodeId !== id) { draft = structuredClone(n.data); slugMode = false; }
  sideNodeId = id;
  sideTab = tab;
  select([id]);
  side.hidden = false;
  side.style.width = `${sideWidth()}px`;
  side.innerHTML = `<div class="side-resize" title="Kéo để đổi độ rộng"></div><div class="side-head">
      <div class="tabs"><button data-tab="config" class="${tab === 'config' ? 'active' : ''}">Cấu hình</button><button data-tab="result" class="${tab === 'result' ? 'active' : ''}">Kết quả</button></div>
      <button class="icon-btn" title="${esc(NODE_DEFS[n.type].desc)}">${I.help}</button><span class="spacer"></span>
      ${n.type !== 'note' ? `<button class="icon-btn" data-side="run" title="Chạy node" style="color:#22c55e">${I.play}</button>
      <button class="icon-btn" data-side="clear" title="Reset node (xoá kết quả)" style="color:#f59e0b">${I.refresh}</button>` : ''}
      ${mediaResults(n).length ? `<button class="icon-btn" data-side="download-all" title="Tải kết quả của node" style="color:var(--accent)">${I.download.replace(/13/g, '15')}</button>` : ''}
      ${n.type !== 'note' ? `<button class="icon-btn" data-side="power" title="${draft.enabled ? 'Tắt node' : 'Bật node'}" style="color:${draft.enabled ? 'var(--accent)' : 'var(--muted)'}">${I.power}</button>` : ''}
      <button class="icon-btn" data-side="delete" title="Xoá node" style="color:var(--danger)">${I.trash}</button>
      <button class="icon-btn" data-side="close" title="Đóng">${I.x}</button></div>
    <div class="side-body">${tab === 'config' ? `
      ${n.type !== 'note' ? `<div class="seg2"><button data-slugmode="0" class="${slugMode ? '' : 'active'}">${I.tag} Tên Node</button><button data-slugmode="1" class="${slugMode ? 'active' : ''}">@Slug (@mention)</button></div>
      ${slugMode ? `<input class="inp round" data-d="slug" value="${esc(draft.slug)}" placeholder="vd: nhan_vat">` : `<input class="inp round" data-d="name" value="${esc(draft.name)}">`}` : ''}
      ${configFields(n)}` : resultsHtml(n)}</div>
    ${tab === 'config' ? `<div class="side-foot"><button data-side="close">Đóng</button><button class="reset" data-side="reset" title="Đưa cấu hình về mặc định">${I.refresh} Reset</button><button class="primary" data-side="save">Lưu Node</button></div>` : ''}`;
  loadMediaInfo(side);
}

side.addEventListener('input', (e) => {
  const k = e.target.dataset.d;
  if (!k || !draft) return;
  draft[k] = e.target.type === 'number' ? +e.target.value : e.target.value;
});
side.addEventListener('change', (e) => {
  const k = e.target.dataset.d;
  if (!k || !draft || e.target.tagName !== 'SELECT') return;
  draft[k] = k === 'quantity' || k === 'fontSize' ? +e.target.value : e.target.value;
  if (k === 'genType') { draft.model = ''; draft.ratio = ''; }
  if (['genType', 'mode', 'agentProvider', 'videoMode'].includes(k)) openSide(sideNodeId, 'config');
});
side.addEventListener('click', (e) => {
  const n = wf.nodes.find((x) => x.id === sideNodeId);
  if (!n) return;
  const tab = e.target.closest('[data-tab]')?.dataset.tab;
  if (tab) { openSide(n.id, tab); return; }
  const sm = e.target.closest('[data-slugmode]');
  if (sm) { slugMode = sm.dataset.slugmode === '1'; openSide(n.id, 'config'); return; }
  const dt = e.target.closest('[data-dt]');
  if (dt) { const k = dt.dataset.dt; draft[k] = ['newChat', 'agentFallback'].includes(k) ? draft[k] === false : !draft[k]; openSide(n.id, 'config'); return; }
  const color = e.target.closest('[data-color]');
  if (color) { draft.color = color.dataset.color; return; }
  const ins = e.target.closest('[data-insert]');
  if (ins) {
    const ta = side.querySelector('textarea[data-d]');
    if (ta) { ta.setRangeText(`${ins.dataset.insert} `, ta.selectionStart, ta.selectionEnd, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); }
    return;
  }
  const rmref = e.target.closest('[data-rmref]');
  if (rmref) { e.preventDefault(); draft.refs = (draft.refs || []).filter((_, i) => i !== +rmref.dataset.rmref); openSide(n.id, 'config'); return; }
  const rm = e.target.closest('[data-rm]');
  if (rm) { e.preventDefault(); draft.media = draft.media.filter((_, i) => i !== +rm.dataset.rm); openSide(n.id, 'config'); return; }
  const lb = e.target.closest('img[data-lb]');
  if (lb) { openLightbox(lb.dataset.full && lb.dataset.kind === 'video' ? lb.dataset.full : lb.src, lb.dataset.kind, lb.src); return; }
  const act = e.target.closest('[data-side]')?.dataset.side;
  if (act === 'res-dl') { downloadResult(n, +e.target.closest('[data-i]').dataset.i); return; }
  if (act === 'close') closeSide();
  if (act === 'delete') { select([n.id]); deleteSelection(); }
  if (act === 'power') { draft.enabled = !draft.enabled; setData(n.id, { enabled: draft.enabled }); openSide(n.id, sideTab); }
  if (act === 'run') { if (n.type === 'image') runFrom(n.id, false); else runWorkflow([n.id]); }
  if (act === 'clear') { clearNodeResult(n.id); openSide(n.id, sideTab); }
  if (act === 'download-all') downloadAll(n);
  if (act === 'reset') {
    const keep = { name: draft.name, slug: draft.slug, enabled: draft.enabled };
    draft = { ...structuredClone(NODE_DEFS[n.type].data), ...keep };
    if (n.type === 'image') draft.media = [];
    openSide(n.id, 'config');
  }
  if (act === 'upload') openFilePicker(n.id);
  if (act === 'ref-add') {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
    input.addEventListener('change', async () => {
      for (const f of [...input.files].slice(0, 4 - (draft.refs || []).length)) {
        const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
        draft.refs = [...(draft.refs || []), { name: f.name, mime: f.type, dataUrl }];
      }
      openSide(n.id, 'config');
    });
    input.click();
  }
  if (act === 'library') openLibrary({ x: n.x + 40, y: n.y + 40 });
  if (act === 'save') {
    if (n.type !== 'note') {
      draft.slug = draft.slug ? uniqueSlug(draft.slug, n.id) : '';
      if (draft.name !== n.data.name && (!n.data.slug || n.data.slug === slugify(n.data.name))) draft.slug = uniqueSlug(draft.name, n.id);
    }
    setData(n.id, structuredClone(draft));
    // Multi-prompt bớt prompt: ngắt dây của cổng ra không còn.
    const outNames = new Set(portsOf(n, 'out').map((p) => p.name));
    const before = wf.edges.length;
    wf.edges = wf.edges.filter((e) => e.from.node !== n.id || outNames.has(e.from.port));
    if (wf.edges.length !== before) dirty();
    if (n.type === 'note' || n.type === 'prompt' || wf.edges.length !== before) renderAll();
    toast('Đã lưu node');
    closeSide();
  }
});

// Độ rộng bảng chi tiết: kéo cạnh trái để đổi, nhớ cho lần sau.
function sideWidth() {
  let w = 380;
  try { w = +localStorage.getItem('aflSideW') || 380; } catch (_) { /* mặc định */ }
  return Math.min(Math.max(320, w), Math.max(320, innerWidth - 120));
}
side.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.side-resize')) return;
  e.preventDefault();
  const startX = e.clientX, startW = side.offsetWidth;
  const move = (ev) => { side.style.width = `${Math.min(Math.max(320, startW + startX - ev.clientX), innerWidth - 120)}px`; };
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    try { localStorage.setItem('aflSideW', String(side.offsetWidth)); } catch (_) { /* không lưu được */ }
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

// Tải 1 kết quả về máy (bản gốc; ảnh cần đăng nhập thì dùng bản đã đọc qua tab của provider).
async function downloadResult(n, i) {
  const res = statusOf(n)?.preview ? statusOf(n) : wf.results?.[n.id];
  const it = (res?.preview || []).filter((p) => p.kind !== 'text')[i];
  if (!it?.url) return;
  const ext = it.kind === 'video' ? 'mp4' : 'png';
  const name = `${store.settings.folder || 'AutoFlow'}/${wf.name}/${slugify(n.data.name || n.type)}_${i + 1}.${ext}`;
  let url = it.url;
  const full = fullSrc.get(it.url);
  if (full?.src?.startsWith('blob:')) url = await new Promise((resolve) => { fetch(full.src).then((r) => r.blob()).then((b) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(b); }); });
  const r = await chrome.runtime.sendMessage({ type: 'afl:download', url, filename: name }).catch((e) => ({ ok: false, error: e.message }));
  toast(r?.ok ? `Đã tải về ${name}` : `Không tải được: ${r?.error || 'lỗi'}`);
}

// ---------- Chạy (side panel thực hiện) ----------
async function sendToPanel(msg) {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (_) {
    // Side panel chưa mở: mở rồi thử lại.
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      await new Promise((r) => setTimeout(r, 1500));
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, error: 'Hãy mở side panel AutoFlow (bấm icon extension) rồi chạy lại' };
    }
  }
}
// Nút chạy chung khi đang chạy = Dừng. Chạy riêng node khi đang có lượt khác = vào hàng đợi, tự chạy khi tới lượt.
async function runWorkflow(only) {
  if (!only?.length && runState?.running && runState.workflowId === wf.id) {
    await sendToPanel({ type: 'afl:stopWorkflow' });
    toast('Đang dừng workflow…');
    return;
  }
  if (wf.enabled === false) { toast('Workflow đang tắt (công tắc cạnh tên)'); return; }
  await save();
  const r = await sendToPanel({ type: 'afl:runWorkflow', id: wf.id, only: only?.length ? only : undefined });
  if (!r?.ok) { toast(r?.error || 'Không chạy được'); return; }
  toast(r.queued ? 'Node đã vào hàng đợi, sẽ tự chạy khi tới lượt. Kết quả cũ vẫn hiển thị trong lúc chờ.' : only?.length ? 'Đang chạy node đã chọn…' : 'Đang chạy workflow…');
}

// Node đang chờ tới lượt (theo hàng đợi của side panel).
let queuedIds = new Set();
function applyQueue(queue) {
  const ids = new Set();
  for (const q of queue || []) if (q.id === wf.id) (q.only || wf.nodes.map((n) => n.id)).forEach((id) => ids.add(id));
  queuedIds = ids;
  for (const n of wf.nodes) { const el = nodeEl(n.id); if (el) applyStatus(el, n); }
}
function runGroup(note) {
  const ids = wf.nodes.filter((n) => n.type !== 'note' && n.x >= note.x && n.y >= note.y && n.x < note.x + note.data.w && n.y < note.y + note.data.h).map((n) => n.id);
  if (!ids.length) { toast('Nhóm chưa có node nào'); return; }
  runWorkflow(ids);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'afl:workflowState' && msg.state?.workflowId === wf.id) applyRunState(msg.state);
  if (msg?.type === 'afl:workflowQueue') applyQueue(msg.queue);
});
function renderRunProgress() {
  let el = document.querySelector('.run-progress');
  const st = runState?.workflowId === wf.id && !runReset ? runState : null;
  if (!st?.running) { el?.remove(); return; }
  const nodes = Object.values(st.nodes);
  const done = nodes.filter((x) => ['done', 'error', 'skipped'].includes(x.status)).length;
  if (!el) { el = document.createElement('div'); el.className = 'run-progress'; document.body.appendChild(el); }
  el.innerHTML = `${done} / ${nodes.length}<i><b style="width:${Math.round((done / Math.max(1, nodes.length)) * 100)}%"></b></i>`;
}
const listSynced = new Map(); // nodeId -> finishedAt đã nhận
const seenDone = new Map(); // nodeId -> finishedAt đã hiển thị (về trang 01 khi có kết quả mới)
// initial: trạng thái của lần chạy cũ khi vừa mở trình soạn; side panel đã lưu các mục List
// vào workflow, nên không ghi đè các mục người dùng sửa sau đó.
function applyRunState(state, initial = false) {
  if (initial) for (const [id, s] of Object.entries(state.nodes || {})) if (s.listItems) listSynced.set(id, s.finishedAt);
  runState = state;
  runReset = false;
  const listChanged = [];
  for (const n of wf.nodes) {
    const el = nodeEl(n.id);
    if (!el) continue;
    const st = state.nodes[n.id];
    if (st?.status === 'done' && st.finishedAt && seenDone.get(n.id) !== st.finishedAt) { seenDone.set(n.id, st.finishedAt); pages.delete(n.id); }
    // List nhận các mục vừa chạy ra (lưu vào node để sửa tay và chạy tiếp).
    if (n.type === 'list' && st?.status === 'done' && st.listItems && listSynced.get(n.id) !== st.finishedAt) {
      listSynced.set(n.id, st.finishedAt);
      n.data.items = st.listItems;
      if (st.listKind) n.data.kind = st.listKind;
      listChanged.push(n.id);
      continue;
    }
    applyStatus(el, n);
    const media = el.querySelector('.nb-media:not([data-drop])');
    if (media && (n.type === 'generate' || NODE_DEFS[n.type].provider)) {
      media.querySelector('.viewer')?.remove();
      media.insertAdjacentHTML('beforeend', previewHtml(n));
      loadMediaInfo(media);
    }
    // Hiện "AI OUTPUT" / "EXTRACTED" khi node văn bản chạy xong (không vẽ lại khi người dùng đang gõ).
    if (['prompt', 'extract', 'assistant'].includes(n.type) && st?.status === 'done' && !el.contains(document.activeElement)) {
      el.querySelector('.card').innerHTML = bodyHtml(n);
    }
  }
  if (listChanged.length) { listChanged.forEach(rerenderNode); dirty(); }
  const run = $('tb-run');
  renderRunProgress();
  run.classList.toggle('stop', !!runState.running);
  run.dataset.tip = runState.running ? 'Dừng workflow' : 'Chạy workflow';
  run.innerHTML = runState.running
    ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
    : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M7 4.5v15l12-7.5z"/></svg>';
  if (sideNodeId && sideTab === 'result') openSide(sideNodeId, 'result');
  renderEdges();
  renderLog();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.aflWorkflows) return;
  if (selfWrite) { selfWrite = false; return; }
  const remote = (changes.aflWorkflows.newValue || []).find((w) => w.id === wf.id);
  if (remote) { wf.results = remote.results || {}; wf.runs = remote.runs; updateStats(); }
});

async function reloadFromStorage() {
  const { aflWorkflows = [] } = await chrome.storage.local.get('aflWorkflows');
  const remote = aflWorkflows.find((w) => w.id === wf.id);
  if (remote) wf = normalizeWorkflow(remote);
  await store.load();
  renderHeader();
  renderAll();
  toast('Đã tải lại');
}

// ---------- Header, thanh công cụ, phím tắt ----------
function renderHeader() {
  $('wf-title').value = wf.name;
  $('wf-enabled').classList.toggle('on', wf.enabled !== false);
  $('max-speed').classList.toggle('on', !!wf.maxSpeed);
  document.title = `${wf.name} · Workflow Editor`;
}
function updateStats() {
  $('stat-nodes').textContent = wf.nodes.filter((n) => n.type !== 'note').length;
  const today = new Date().toISOString().slice(0, 10);
  $('stat-runs').textContent = wf.runs?.date === today ? wf.runs.count : 0;
}
$('wf-title').addEventListener('input', () => { wf.name = $('wf-title').value; dirty(); });
$('wf-enabled').addEventListener('click', () => { wf.enabled = wf.enabled === false; renderHeader(); dirty(); });
$('max-speed').addEventListener('click', (e) => { e.preventDefault(); wf.maxSpeed = !wf.maxSpeed; renderHeader(); dirty(); toast(wf.maxSpeed ? 'Max Speed: tối đa 3 task Flow song song' : 'Max Speed tắt'); });
$('btn-save').addEventListener('click', () => save().then(() => toast('Đã lưu')));
$('btn-reset').addEventListener('click', () => {
  // Xoá trạng thái chạy + kết quả hiển thị trên canvas (không xoá node).
  runReset = true;
  wf.results = {};
  renderAll();
  dirty();
  toast('Đã xoá kết quả trên canvas');
});
$('btn-saveas').addEventListener('click', () => {
  const back = modal(`<h3>Lưu bản sao</h3><div class="field"><span class="lbl">Tên workflow mới</span><input class="inp" value="${esc(wf.name)} (bản sao)"></div>
    <div class="row"><span class="spacer"></span><button class="btn-ghost" data-cancel>Huỷ</button><button class="btn-white" data-ok>Lưu</button></div>`);
  const input = back.querySelector('input');
  input.select();
  back.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cancel]')) back.remove();
    if (!e.target.closest('[data-ok]')) return;
    await save();
    wf = { ...structuredClone(wf), id: `wf${Date.now().toString(36)}`, name: input.value.trim() || `${wf.name} (bản sao)`, results: {}, runs: null };
    $('wf-title').value = wf.name;
    await save();
    back.remove();
    toast('Đã lưu thành workflow mới');
  });
});
function exportJson() {
  const blob = new Blob([JSON.stringify({ format: 'autoflow-workflow', version: 1, name: wf.name, nodes: wf.nodes, edges: wf.edges, maxSpeed: wf.maxSpeed }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${wf.name.replace(/[\\/:*?"<>|]+/g, '_')}.workflow.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('btn-share').addEventListener('click', () => { exportJson(); toast('Đã xuất file workflow để chia sẻ'); });
$('btn-export').addEventListener('click', exportJson);
$('btn-import').addEventListener('click', () => $('import-pick').click());
$('import-pick').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('bad');
    pushHistory();
    wf.nodes = data.nodes;
    wf.edges = data.edges;
    if (data.name && !wf.nodes.length) wf.name = data.name;
    renderHeader();
    renderAll();
    fitView();
    dirty();
    toast('Đã nhập workflow');
  } catch (_) { toast('File không phải workflow hợp lệ'); }
});

// Bảng Log & tiến độ: kết quả từng node của lần chạy gần nhất.
const logpanel = $('logpanel');
function renderLog() {
  if (logpanel.hidden) return;
  const st = runState?.workflowId === wf.id && !runReset ? runState : null;
  const rows = wf.nodes.filter((n) => n.type !== 'note').map((n) => ({ n, s: statusOf(n) || (runReset ? null : wf.results?.[n.id]) })).filter((r) => r.s);
  logpanel.innerHTML = `<header>Log & tiến độ<span class="spacer"></span><button class="icon-btn" data-close-log>${I.x}</button></header>
    <div class="body">${st ? `<div class="hint">${st.running ? 'Đang chạy…' : `Kết thúc lúc ${new Date(st.finishedAt || Date.now()).toLocaleTimeString()}`}${st.errors?.length ? ` · ${st.errors.length} lỗi` : ''}</div>` : ''}
    ${rows.length ? rows.map(({ n, s }) => `<div class="grp"><b>${esc(n.data.name)}</b> <span class="st">${esc({ pending: 'chờ', running: 'đang chạy', done: `xong · ${s.count}`, error: 'lỗi', skipped: 'bỏ qua' }[s.status] || s.status)}</span>
      ${s.error ? `<div class="txt" style="color:#ffb3b3">${esc(s.error)}</div>` : ''}
      ${(s.preview || []).some((p) => p.kind !== 'text') ? `<div class="thumbs">${s.preview.filter((p) => p.kind !== 'text').map((p) => (p.thumb ? `<img src="${p.thumb}" alt="">` : '')).join('')}</div>` : ''}
      ${(s.preview || []).filter((p) => p.kind === 'text').slice(0, 3).map((p) => `<div class="txt">${esc(p.text)}</div>`).join('')}</div>`).join('') : '<p class="hint">Chưa có lần chạy nào.</p>'}
    ${st?.errors?.length ? `<div class="grp"><b>Lỗi</b>${st.errors.map((x) => `<div class="txt" style="color:#ffb3b3">${esc(x)}</div>`).join('')}</div>` : ''}</div>`;
}
$('btn-log').addEventListener('click', () => { logpanel.hidden = !logpanel.hidden; renderLog(); });
logpanel.addEventListener('click', (e) => { if (e.target.closest('[data-close-log]')) logpanel.hidden = true; });
$('btn-close').addEventListener('click', async () => { await save(); window.close(); });
$('zoom-in').addEventListener('click', () => zoomAt(innerWidth / 2, innerHeight / 2, view.zoom * 1.2));
$('zoom-out').addEventListener('click', () => zoomAt(innerWidth / 2, innerHeight / 2, view.zoom / 1.2));
$('zoom-reset').addEventListener('click', () => zoomAt(innerWidth / 2, innerHeight / 2, 1));
$('btn-center').addEventListener('click', fitView);

function setTool(t) {
  tool = t;
  document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  canvas.classList.toggle('hand', t === 'hand');
}
$('toolbar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tool) { setTool(b.dataset.tool); return; }
  const r = b.getBoundingClientRect();
  ({
    add: () => openAddMenu(innerWidth / 2, innerHeight * 0.3),
    note: () => addNote(),
    library: () => openLibrary(),
    run: () => runWorkflow(),
    undo, redo,
    refresh: reloadFromStorage,
    search: openSearch,
    arrange,
    settings: openSettings
  })[b.dataset.act]?.();
});

document.addEventListener('keydown', (e) => {
  const typing = e.target.closest?.('textarea, input, select, [contenteditable="true"]');
  const mod = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { closeMenus(); document.querySelector('.modal-back, .lightbox')?.remove(); if (!typing) closeSide(); return; }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save().then(() => toast('Đã lưu')); return; }
  if (mod && e.key === 'Enter') { e.preventDefault(); runWorkflow(selection.size && !typing ? [...selection] : undefined); return; }
  if (typing) return;
  if (e.code === 'Space') { spaceDown = true; canvas.classList.add('hand'); e.preventDefault(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'c') { copySelection(); return; }
  if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate([...selection]); return; }
  if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); select(wf.nodes.map((n) => n.id)); return; }
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); return; }
  if (e.key.toLowerCase() === 'n') { e.preventDefault(); openAddMenu(lastMouse.x, lastMouse.y); return; }
  if (e.key.toLowerCase() === 'v') setTool('select');
  if (e.key.toLowerCase() === 'h') setTool('hand');
  if (e.key.toLowerCase() === 'f') fitView();
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space') { spaceDown = false; canvas.classList.toggle('hand', tool === 'hand'); } });
window.addEventListener('resize', () => renderEdges());

// ---------- Khởi động ----------
await store.load();
const params = new URLSearchParams(location.search);
const found = store.workflows.find((w) => w.id === params.get('id'));
wf = found ? normalizeWorkflow(found) : (params.get('template') && instantiateTemplate(params.get('template'))) || newWorkflow(params.get('name') || undefined);
view = { ...(wf.viewport || { x: 0, y: 0, zoom: 1 }) };
renderHeader();
applyView();
renderAll();
updateUndoButtons();
if (!found || !wf.viewport || (wf.viewport.x === 0 && wf.viewport.y === 0)) requestAnimationFrame(fitView);
requestAnimationFrame(() => renderEdges());
if (!found) save();
// Nhận trạng thái chạy hiện tại nếu side panel đang mở (không tự mở panel khi chưa có thao tác).
chrome.runtime.sendMessage({ type: 'afl:getWorkflowState' }).then((r) => { if (r?.state?.workflowId === wf.id) applyRunState(r.state, !r.state.running); applyQueue(r?.queue); }).catch(() => {});

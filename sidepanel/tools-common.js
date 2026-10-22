// Phần dùng chung cho trang Effects / Angles: ảnh nguồn, gửi task sang side panel, theo dõi kết quả.
import { store } from './lib/store.js';

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const FALLBACK_MODELS = ['Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'];

let toastTimer;
export function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

export async function init() {
  await store.load();
  return store;
}
export const imageModels = () => (store.options?.image?.models?.length ? store.options.image.models : FALLBACK_MODELS);

function readFile(f) {
  return new Promise((resolve, reject) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => reject(fr.error); fr.readAsDataURL(f); });
}

// Vùng chọn ảnh nguồn: bấm / kéo thả / dán, hoặc chọn từ lịch sử.
export function sourcePicker(zone, fileInput, onChange) {
  let source = null; // { dataUrl, mime, name } hoặc { url, provider, thumb }
  const render = () => {
    zone.classList.toggle('has', !!source);
    zone.innerHTML = source
      ? `<img src="${source.dataUrl || source.thumb}" alt=""><button class="x" data-clear title="Bỏ ảnh">✕</button>`
      : '<div class="ph"><b>Chọn ảnh / kéo thả vào đây</b><span>hoặc dán (Ctrl+V) · <a href="#" data-history>chọn từ lịch sử</a></span></div>';
  };
  const set = (s) => { source = s; render(); onChange(source); };
  const fromFile = async (f) => {
    if (!f || !f.type.startsWith('image/')) return;
    if (f.size > 20 * 1024 * 1024) { toast('Ảnh quá lớn (>20MB)'); return; }
    set({ dataUrl: await readFile(f), mime: f.type, name: f.name });
  };
  zone.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear]')) { e.stopPropagation(); set(null); return; }
    if (e.target.closest('[data-history]')) { e.preventDefault(); e.stopPropagation(); historyPicker(set); return; }
    if (!source) fileInput.click();
  });
  fileInput.addEventListener('change', () => { fromFile(fileInput.files[0]); fileInput.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); fromFile(e.dataTransfer.files[0]); });
  document.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) fromFile(f); });
  render();
  return { get: () => source, set };
}

function historyPicker(onPick) {
  const items = store.history.flatMap((h) => h.results.filter((r) => r.thumb && r.kind !== 'video').map((r) => ({ ...r, provider: h.provider || 'flow', prompt: h.prompt }))).slice(0, 120);
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal"><h3>Chọn ảnh từ lịch sử</h3>${items.length ? `<div class="lib-grid">${items.map((r, i) => `<button data-i="${i}" title="${esc(r.prompt)}"><img src="${r.thumb}" alt=""></button>`).join('')}</div>` : '<p class="hint">Chưa có ảnh nào trong lịch sử.</p>'}</div>`;
  back.addEventListener('click', (e) => {
    if (e.target === back) { back.remove(); return; }
    const b = e.target.closest('[data-i]');
    if (b) { const r = items[+b.dataset.i]; onPick({ url: r.url, provider: r.provider, thumb: r.thumb }); back.remove(); }
  });
  document.body.appendChild(back);
}

// Gửi task sang side panel (nơi có hàng đợi và kết nối Flow). Mở side panel nếu chưa mở.
export async function submitToPanel(payload) {
  const msg = { type: 'afl:enqueueTasks', ...payload };
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (_) {
    try {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: win.id });
      await new Promise((r) => setTimeout(r, 1500));
      return await chrome.runtime.sendMessage(msg);
    } catch (e) {
      return { ok: false, error: 'Hãy mở side panel AutoFlow (bấm icon extension) rồi thử lại' };
    }
  }
}

// Theo dõi trạng thái task trong storage để hiển thị kết quả.
export function watchTasks(getIds, render) {
  const update = async () => {
    const ids = getIds();
    if (!ids.length) { render([]); return; }
    const { aflTasks = [] } = await chrome.storage.local.get('aflTasks');
    render(ids.map((id) => aflTasks.find((t) => t.id === id)).filter(Boolean));
  };
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.aflTasks) update(); });
  update();
  return update;
}

export function resultCards(tasks, labelOf) {
  return tasks.map((t) => {
    const media = (t.results || []).filter((r) => r.thumb);
    const status = { pending: 'Đang chờ', running: `Đang tạo${t.progress != null ? ` ${t.progress}%` : '…'}`, done: 'Xong', error: 'Lỗi', cancelled: 'Đã huỷ' }[t.status] || t.status;
    return `<div class="res-card ${t.status}">
      <div class="res-media">${media.length ? media.map((r) => `<img src="${r.thumb}" alt="" title="${esc(r.filename || '')}">`).join('') : `<div class="res-ph">${t.status === 'running' ? '<div class="spinner"></div>' : ''}${esc(status)}</div>`}</div>
      <div class="res-meta"><b>${esc(labelOf(t))}</b><span class="st ${t.status}">${esc(status)}</span>${t.error ? `<small class="err">${esc(t.error)}</small>` : ''}</div></div>`;
  }).join('');
}

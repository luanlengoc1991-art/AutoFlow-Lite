// Tab Ảnh → Album (bộ ảnh đặt tên, lưu cục bộ, dùng lại làm ảnh tham chiếu) và Tìm ảnh (mở trang tìm kiếm;
// chuột phải vào ảnh → AutoFlow để thêm làm tham chiếu / vào album / tạo prompt).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ALBUMS_KEY = 'aflAlbums';
const SEARCH_KEY = 'aflImageSearch';
const MAX_FILE = 20 * 1024 * 1024;

export const SEARCH_CHANNELS = [
  ['pinterest', 'Pinterest', (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`],
  ['youtube', 'Youtube', (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`],
  ['tiktok', 'Tiktok', (q) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`],
  ['google', 'Google', (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`],
  ['facebook', 'Facebook', (q) => `https://www.facebook.com/search/photos/?q=${encodeURIComponent(q)}`],
  ['unsplash', 'Unsplash', (q) => `https://unsplash.com/s/photos/${encodeURIComponent(q.trim().replace(/\s+/g, '-'))}`],
  ['etsy', 'Etsy', (q) => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`],
  ['pixabay', 'Pixabay', (q) => `https://pixabay.com/images/search/${encodeURIComponent(q.trim())}/`],
  ['amazon', 'Amazon', (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`]
];
export function searchUrl(channel, q) {
  const c = SEARCH_CHANNELS.find(([id]) => id === channel);
  return c && q.trim() ? c[2](q) : '';
}

// ---------- Lưu trữ ----------
let albums = null;
async function load() {
  if (!albums) albums = (await chrome.storage.local.get(ALBUMS_KEY))[ALBUMS_KEY] || [];
  return albums;
}
function persist() { return chrome.storage.local.set({ [ALBUMS_KEY]: albums }); }
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const mimeOf = (dataUrl) => dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/png';

export async function listAlbums() { return load(); }
export async function createAlbum(name, images = []) {
  await load();
  const n = name.trim();
  if (!n) throw new Error('Nhập tên album');
  if (albums.some((a) => sameName(a.name, n))) throw new Error('Tên album đã tồn tại');
  const album = { id: uid(), name: n, createdAt: Date.now(), items: [] };
  albums.unshift(album);
  addItems(album, images);
  await persist();
  return album;
}
function addItems(album, images) {
  const have = new Set(album.items.map((i) => i.dataUrl));
  let added = 0;
  for (const img of images) {
    if (!img?.dataUrl || have.has(img.dataUrl)) continue;
    have.add(img.dataUrl);
    album.items.push({ id: uid(), name: img.name || `anh_${album.items.length + 1}.png`, mime: img.mime || mimeOf(img.dataUrl), dataUrl: img.dataUrl, at: Date.now() });
    added++;
  }
  return added;
}
export async function addToAlbum(id, images) {
  await load();
  const album = albums.find((a) => a.id === id);
  if (!album) throw new Error('Không tìm thấy album');
  const added = addItems(album, images);
  await persist();
  return added;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}
async function filesToImages(files, toast) {
  const out = [];
  for (const f of [...files].filter((x) => x.type.startsWith('image/'))) {
    if (f.size > MAX_FILE) { toast(`${f.name} quá lớn (>20MB)`); continue; }
    out.push({ name: f.name, mime: f.type, dataUrl: await readFile(f) });
  }
  return out;
}
function pickFiles() {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
    input.addEventListener('change', () => resolve(input.files));
    input.click();
  });
}
function dropZone(el, onFiles) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('over'); });
  el.addEventListener('dragleave', () => el.classList.remove('over'));
  el.addEventListener('drop', (e) => { e.preventDefault(); el.classList.remove('over'); onFiles(e.dataTransfer.files); });
}

// ---------- Hộp thoại ----------
function dialog(cls, html) {
  const d = document.createElement('dialog');
  d.className = cls;
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  return d;
}

// Tạo album: tên + ảnh (chọn / kéo thả); `images` là ảnh có sẵn (từ Ảnh Flow hoặc menu chuột phải).
export function openCreateAlbum({ images = [], toast }) {
  return new Promise((resolve) => {
    const picked = [...images];
    const d = dialog('album-modal', `<div class="dlg-head"><b>Tạo album</b><button class="icon-btn small" data-x title="Đóng">✕</button></div>
      <label class="stack">Tên album<input type="text" data-name placeholder="VD: Nhân vật chính" maxlength="60"></label>
      <p class="album-err" data-err hidden></p>
      <div class="dropzone album-zone" data-zone tabindex="0">Chọn ảnh / Kéo thả vào đây</div>
      <div class="album-pick" data-grid></div>
      <div class="btn-row"><button class="btn" data-x>Huỷ</button><button class="btn primary" data-ok>Tạo album</button></div>`);
    const q = (s) => d.querySelector(s);
    const renderPicked = () => {
      q('[data-grid]').innerHTML = picked.map((p, i) => `<div class="thumb"><img src="${p.dataUrl}" alt=""><button data-rm="${i}" title="Bỏ ảnh">✕</button></div>`).join('')
        || '<p class="muted">Chưa có ảnh. Có thể thêm ảnh sau khi tạo.</p>';
    };
    const add = async (files) => { picked.push(...await filesToImages(files, toast)); renderPicked(); };
    renderPicked();
    q('[data-zone]').addEventListener('click', async () => add(await pickFiles()));
    dropZone(q('[data-zone]'), add);
    q('[data-grid]').addEventListener('click', (e) => { const i = e.target.closest('[data-rm]')?.dataset.rm; if (i !== undefined) { picked.splice(+i, 1); renderPicked(); } });
    let result = null;
    d.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => d.close()));
    const submit = async () => {
      try {
        result = await createAlbum(q('[data-name]').value, picked);
        d.close();
      } catch (e) {
        q('[data-err]').textContent = e.message;
        q('[data-err]').hidden = false;
        q('[data-name]').focus();
      }
    };
    q('[data-ok]').onclick = submit;
    q('[data-name]').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    q('[data-name]').focus();
    d.addEventListener('close', () => resolve(result));
  });
}

// Chọn album để thêm ảnh (hoặc tạo album mới với các ảnh đó).
export async function openAddToAlbum({ images, toast }) {
  const list = await load();
  return new Promise((resolve) => {
    const d = dialog('album-modal', `<div class="dlg-head"><b>Thêm ${images.length} ảnh vào album</b><button class="icon-btn small" data-x title="Đóng">✕</button></div>
      <div class="album-choose">${list.map((a) => `<button class="album-row" data-id="${a.id}">${a.items[0] ? `<img src="${a.items[0].dataUrl}" alt="">` : '<span class="ph">🖼</span>'}<b>${esc(a.name)}</b><small>${a.items.length} ảnh</small></button>`).join('')
        || '<p class="muted">Chưa có album nào.</p>'}</div>
      <div class="btn-row"><button class="btn" data-x>Huỷ</button><button class="btn primary" data-new>+ Album mới</button></div>`);
    let result = null;
    d.querySelectorAll('[data-x]').forEach((b) => (b.onclick = () => d.close()));
    d.querySelector('.album-choose').addEventListener('click', async (e) => {
      const id = e.target.closest('[data-id]')?.dataset.id;
      if (!id) return;
      const added = await addToAlbum(id, images);
      result = list.find((a) => a.id === id);
      toast(added ? `Đã thêm ${added} ảnh vào "${result.name}"` : `Ảnh đã có trong "${result.name}"`);
      d.close();
    });
    d.querySelector('[data-new]').onclick = async () => {
      d.close();
      result = await openCreateAlbum({ images, toast });
      if (result) toast(`Đã tạo album "${result.name}" (${result.items.length} ảnh)`);
    };
    d.addEventListener('close', () => setTimeout(() => resolve(result), 0));
  });
}

// ---------- Giao diện trong tab Ảnh ----------
// ctx: { toast, log, onUseRefs(images), onPrompt(dataUrl), onDownload(album, items) }
export function mountAlbums(root, ctx) {
  let openId = '';
  const selected = new Set();

  async function render() {
    const list = await load();
    const album = list.find((a) => a.id === openId);
    if (!album) {
      openId = '';
      selected.clear();
      root.innerHTML = `<div class="row-head"><b class="grow">Album <span class="muted">${list.length || ''}</span></b><button class="link" data-act="new">+ Tạo album</button></div>
        ${list.length ? `<div class="album-grid">${list.map((a) => `<button class="album-card" data-open="${a.id}">
          <span class="album-cover">${a.items.slice(0, 4).map((i) => `<img src="${i.dataUrl}" alt="">`).join('') || '<span class="ph">🖼</span>'}</span>
          <b>${esc(a.name)}</b><small>${a.items.length} ảnh</small></button>`).join('')}</div>`
        : '<p class="empty">Chưa có album. Tạo album để gom ảnh nhân vật, bối cảnh, sản phẩm… rồi dùng lại làm ảnh tham chiếu bất cứ lúc nào.</p>'}`;
      return;
    }
    root.innerHTML = `<div class="row-head"><button class="icon-btn small" data-act="back" title="Quay lại">‹</button><b class="grow album-title">${esc(album.name)} <span class="muted">${album.items.length} ảnh</span></b>
        <button class="link" data-act="add">+ Thêm ảnh</button><button class="link" data-act="rename">Đổi tên</button><button class="link danger" data-act="delete">Xoá album</button></div>
      <div class="dropzone album-zone small" data-zone>Kéo thả ảnh vào đây để thêm vào album</div>
      ${album.items.length ? `<div class="ph-grid">${album.items.map((i) => `<button class="ph-item ${selected.has(i.id) ? 'sel' : ''}" data-item="${i.id}" title="${esc(i.name)}"><img src="${i.dataUrl}" alt=""><span class="ph-check">✓</span></button>`).join('')}</div>`
        : '<p class="empty">Album trống. Bấm "+ Thêm ảnh", kéo thả ảnh, hoặc chuột phải vào ảnh trên trang web → AutoFlow → Thêm vào album.</p>'}
      <div class="ph-bar">
        <b>${selected.size ? `${selected.size} đã chọn` : 'Tất cả ảnh'}</b><span class="spacer"></span>
        <button class="chip" data-act="ref">Làm tham chiếu</button>
        <button class="chip" data-act="dl">Tải về</button>
        <button class="chip" data-act="prompt">Prompt từ ảnh</button>
        ${selected.size ? '<button class="chip" data-act="remove">Bỏ khỏi album</button><button class="icon-btn small" data-act="clear" title="Bỏ chọn">✕</button>' : ''}
      </div>`;
    dropZone(root.querySelector('[data-zone]'), async (files) => {
      const added = await addToAlbum(album.id, await filesToImages(files, ctx.toast));
      ctx.toast(`Đã thêm ${added} ảnh`);
      render();
    });
  }

  root.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]')?.dataset.open;
    if (open) { openId = open; selected.clear(); render(); return; }
    const item = e.target.closest('[data-item]')?.dataset.item;
    if (item) { selected.has(item) ? selected.delete(item) : selected.add(item); render(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const album = albums?.find((a) => a.id === openId);
    const targets = album ? (selected.size ? album.items.filter((i) => selected.has(i.id)) : album.items) : [];
    try {
      switch (act) {
        case 'new': {
          const a = await openCreateAlbum({ toast: ctx.toast });
          if (a) { ctx.log?.(`Album: tạo "${a.name}" (${a.items.length} ảnh)`); openId = a.id; }
          break;
        }
        case 'back': openId = ''; break;
        case 'add': {
          const added = await addToAlbum(album.id, await filesToImages(await pickFiles(), ctx.toast));
          ctx.toast(`Đã thêm ${added} ảnh`);
          break;
        }
        case 'rename': {
          const name = prompt('Tên album mới', album.name)?.trim();
          if (!name || name === album.name) return;
          if (albums.some((a) => a !== album && sameName(a.name, name))) { ctx.toast('Tên album đã tồn tại'); return; }
          album.name = name;
          await persist();
          break;
        }
        case 'delete':
          if (!confirm(`Xoá album "${album.name}" và ${album.items.length} ảnh trong đó?`)) return;
          albums.splice(albums.indexOf(album), 1);
          await persist();
          openId = '';
          break;
        case 'remove':
          album.items = album.items.filter((i) => !selected.has(i.id));
          selected.clear();
          await persist();
          break;
        case 'clear': selected.clear(); break;
        case 'ref':
          if (!targets.length) { ctx.toast('Album chưa có ảnh'); return; }
          ctx.onUseRefs(targets);
          selected.clear();
          break;
        case 'dl':
          if (!targets.length) { ctx.toast('Album chưa có ảnh'); return; }
          await ctx.onDownload(album, targets);
          return;
        case 'prompt':
          if (!targets.length) { ctx.toast('Album chưa có ảnh'); return; }
          ctx.onPrompt(targets[0].dataUrl);
          return;
      }
    } catch (err) { ctx.toast(err.message || String(err)); }
    render();
  });

  // Tải lại khi album đổi ở nơi khác (menu chuột phải, cửa sổ khác).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[ALBUMS_KEY]) return;
    albums = changes[ALBUMS_KEY].newValue || [];
    render();
  });
  return { render, open: (id) => { openId = id; selected.clear(); render(); } };
}

export function mountImageSearch(root, { toast, log }) {
  let state = { q: '', channel: 'pinterest' };
  chrome.storage.local.get(SEARCH_KEY).then((d) => { state = { ...state, ...(d[SEARCH_KEY] || {}) }; render(); });
  const save = () => chrome.storage.local.set({ [SEARCH_KEY]: state });

  function render() {
    root.innerHTML = `<form class="row-head img-search" data-form>
        <input class="search grow" type="search" data-q placeholder="Tìm ảnh mẫu, VD: cozy coffee shop interior" value="${esc(state.q)}">
        <button class="btn primary" type="submit">Tìm</button></form>
      <p class="muted search-label">Chọn kênh để tìm:</p>
      <div class="search-channels">${SEARCH_CHANNELS.map(([id, name]) => `<button type="button" class="chip ${state.channel === id ? 'on' : ''}" data-ch="${id}">${name}</button>`).join('')}</div>
      <div class="search-hint">
        <b>Lấy ảnh về AutoFlow</b>
        <ol><li>Bấm <b>Tìm</b>: trang kết quả mở ở tab mới.</li>
        <li>Chuột phải vào ảnh → <b>AutoFlow</b> → <i>Thêm làm ảnh tham chiếu</i>, <i>Thêm vào album</i> hoặc <i>Tạo prompt từ ảnh này</i>.</li>
        <li>Ảnh nằm trong video / khó lấy: chuột phải → <i>Chọn vùng để tạo prompt</i>.</li></ol>
      </div>`;
  }
  root.addEventListener('click', (e) => {
    const ch = e.target.closest('[data-ch]')?.dataset.ch;
    if (!ch) return;
    state.channel = ch;
    state.q = root.querySelector('[data-q]').value;
    save();
    render();
    if (state.q.trim()) go();
  });
  root.addEventListener('submit', (e) => { e.preventDefault(); state.q = root.querySelector('[data-q]').value; save(); go(); });
  function go() {
    const url = searchUrl(state.channel, state.q);
    if (!url) { toast('Nhập từ khoá cần tìm'); root.querySelector('[data-q]').focus(); return; }
    chrome.tabs.create({ url });
    log?.(`Tìm ảnh: ${state.q} (${state.channel})`);
  }
  render();
}

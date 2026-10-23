// Service worker: mở side panel, tải file (chờ đến khi xong), đổi tên file do Flow tự tải,
// tải media khác origin, thông báo, phím tắt.

const enablePanel = () => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
chrome.runtime.onInstalled.addListener(enablePanel);
chrome.runtime.onStartup.addListener(enablePanel);

function sanitizePath(path) {
  return path
    .split('/')
    .map((part) => part.replace(/[<>:"\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120))
    .filter(Boolean)
    .join('/');
}

// Resolve khi file tải xong hoặc bị gián đoạn.
function waitComplete(id, timeoutMs = 180000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { chrome.downloads.onChanged.removeListener(onChanged); resolve({ ok: true, id, pending: true }); }, timeoutMs);
    function onChanged(delta) {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current !== 'complete' && delta.state.current !== 'interrupted') return;
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChanged);
      if (delta.state.current === 'complete') resolve({ ok: true, id });
      else chrome.downloads.search({ id }, ([item]) => resolve({ ok: false, id, error: item?.error || 'INTERRUPTED' }));
    }
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

// Khi có listener onDeterminingFilename, mọi lượt tải (kể cả của chính extension) đều đi qua nó;
// phải trả lại đúng tên đã chọn, nếu không Chrome dùng tên theo URL.
const ownNames = new Map(); // url -> filename

function download(url, filename) {
  const name = sanitizePath(filename);
  ownNames.set(url, name);
  return new Promise((resolve) => {
    chrome.downloads.download({ url, filename: name, conflictAction: 'uniquify', saveAs: false }, (id) => {
      setTimeout(() => ownNames.delete(url), 30000);
      const err = chrome.runtime.lastError;
      if (err || id === undefined) { resolve({ ok: false, error: err?.message || 'DOWNLOAD_FAILED' }); return; }
      waitComplete(id).then(resolve);
    });
  });
}

// ---------- File do trang Flow tự tải (menu Download → độ phân giải) ----------
const FLOW_ORIGINS = ['flow.google.com', 'labs.google'];
const expected = []; // { filename, resolve, timer }

function fromFlow(item) {
  return [item.referrer, item.url, item.finalUrl].some((u) => u && FLOW_ORIGINS.some((o) => u.includes(o)));
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId === chrome.runtime.id) {
    const name = ownNames.get(item.url);
    if (name) suggest({ filename: name, conflictAction: 'uniquify' }); else suggest();
    return;
  }
  if (!expected.length || !fromFlow(item)) { suggest(); return; }
  const job = expected.shift();
  clearTimeout(job.timer);
  const ext = /\.([a-z0-9]{2,5})$/i.exec(item.filename || '')?.[1] || (item.mime?.includes('video') ? 'mp4' : 'png');
  const filename = sanitizePath(`${job.filename}.${ext}`);
  suggest({ filename, conflictAction: 'uniquify' });
  waitComplete(item.id, 600000).then((r) => job.resolve({ ...r, filename }));
});

function expectDownload(filename, timeoutMs) {
  return new Promise((resolve) => {
    const job = { filename, resolve };
    job.timer = setTimeout(() => {
      const i = expected.indexOf(job);
      if (i >= 0) expected.splice(i, 1);
      resolve({ ok: false, error: 'Flow không tạo file tải xuống (hết thời gian chờ)' });
    }, timeoutMs || 300000);
    expected.push(job);
  });
}
function cancelExpect() {
  while (expected.length) {
    const job = expected.shift();
    clearTimeout(job.timer);
    job.resolve({ ok: false, error: 'CANCELLED' });
  }
}

async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

// Tải media khác origin bằng quyền host của extension (không bị CORS).
async function bgFetch(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return { ok: true, dataUrl: await blobToDataUrl(blob), mime: blob.type, size: blob.size };
}

// ---------- Prompt từ ảnh (menu chuột phải trên mọi trang) ----------
// Lấy ảnh rồi giao cho side panel (chrome.storage.session + tin nhắn); side panel hỏi AI viết prompt.
const MENU = { root: 'afl-img', analyze: 'afl-img-analyze', region: 'afl-img-region', ref: 'afl-img-ref', album: 'afl-img-album', page: 'afl-page-region' };

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU.root, title: 'AutoFlow', contexts: ['image'] });
    chrome.contextMenus.create({ id: MENU.analyze, parentId: MENU.root, title: 'Tạo prompt từ ảnh này', contexts: ['image'] });
    chrome.contextMenus.create({ id: MENU.region, parentId: MENU.root, title: 'Chọn vùng để tạo prompt', contexts: ['image'] });
    chrome.contextMenus.create({ id: MENU.ref, parentId: MENU.root, title: 'Thêm làm ảnh tham chiếu trong Gen', contexts: ['image'] });
    chrome.contextMenus.create({ id: MENU.album, parentId: MENU.root, title: 'Thêm vào album', contexts: ['image'] });
    chrome.contextMenus.create({ id: MENU.page, title: 'AutoFlow: chọn vùng để tạo prompt', contexts: ['page', 'selection', 'link', 'frame', 'video'] });
  });
}
chrome.runtime.onInstalled.addListener(createMenus);

const isRestricted = (url) => !url || /^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(url) || url.startsWith('https://chromewebstore.google.com');

// Chụp vùng nhìn thấy rồi cắt theo khung (toạ độ CSS px của viewport).
async function captureRect(tab, rect) {
  const shot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  const bmp = await createImageBitmap(await (await fetch(shot)).blob());
  const scale = bmp.width / rect.vw;
  const x = Math.max(0, Math.round(rect.x * scale)), y = Math.max(0, Math.round(rect.y * scale));
  const w = Math.min(bmp.width - x, Math.round(rect.w * scale)), h = Math.min(bmp.height - y, Math.round(rect.h * scale));
  if (w < 8 || h < 8) throw new Error('Vùng chọn quá nhỏ');
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
  return blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));
}

// Khung kéo chọn vùng chạy trong trang; trả về toạ độ sau khi đã gỡ lớp phủ (để ảnh chụp sạch).
function pickRegionInPage() {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.35)';
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;border:2px solid #c6f432;background:rgba(198,244,50,.08);box-shadow:0 0 0 9999px rgba(0,0,0,.35);display:none';
    const hint = document.createElement('div');
    hint.textContent = 'Kéo chọn vùng để tạo prompt · Esc để huỷ';
    hint.style.cssText = 'position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#18181b;color:#fff;font:600 13px system-ui;padding:8px 14px;border-radius:999px';
    root.append(box, hint);
    document.documentElement.appendChild(root);
    let sx = 0, sy = 0, drag = false;
    const done = (rect) => {
      removeEventListener('keydown', onKey, true);
      root.remove();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect)));
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };
    addEventListener('keydown', onKey, true);
    root.addEventListener('mousedown', (e) => { drag = true; sx = e.clientX; sy = e.clientY; root.style.background = 'transparent'; box.style.display = 'block'; e.preventDefault(); });
    root.addEventListener('mousemove', (e) => {
      if (!drag) return;
      Object.assign(box.style, { left: `${Math.min(sx, e.clientX)}px`, top: `${Math.min(sy, e.clientY)}px`, width: `${Math.abs(e.clientX - sx)}px`, height: `${Math.abs(e.clientY - sy)}px` });
    });
    root.addEventListener('mouseup', (e) => {
      if (!drag) return;
      const w = Math.abs(e.clientX - sx), h = Math.abs(e.clientY - sy);
      done(w < 8 || h < 8 ? null : { x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY), w, h, vw: innerWidth });
    });
  });
}

// Ảnh trong trang: đưa vào giữa màn hình, trả về toạ độ để chụp khi không tải trực tiếp được.
function locateImageInPage(src) {
  const img = [...document.images].find((i) => i.currentSrc === src || i.src === src);
  if (!img) return null;
  img.scrollIntoView({ block: 'center', inline: 'center' });
  return new Promise((resolve) => setTimeout(() => {
    const r = img.getBoundingClientRect();
    resolve({ x: r.left, y: r.top, w: r.width, h: r.height, vw: innerWidth });
  }, 300));
}

async function fetchInPage(src) {
  const res = await fetch(src);
  if (!res.ok) return null;
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) return null;
  return new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
}

async function runInTab(tab, frameId, func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [frameId || 0] }, func, args });
  return r?.result;
}

// Thứ tự: data URL có sẵn → tải trong trang (cùng origin, blob:) → tải bằng quyền host → chụp màn hình.
async function grabImage(src, tab, frameId) {
  if (src?.startsWith('data:image/')) return src;
  const inPage = await runInTab(tab, frameId, fetchInPage, [src]).catch(() => null);
  if (inPage) return inPage;
  if (/^https?:/i.test(src)) {
    const r = await bgFetch(src).catch(() => null);
    if (r?.ok && r.mime?.startsWith('image/')) return r.dataUrl;
  }
  const rect = await runInTab(tab, frameId, locateImageInPage, [src]).catch(() => null);
  if (!rect) throw new Error('Không lấy được ảnh này');
  return captureRect(tab, rect);
}

async function deliverImage(action, dataUrl, tab) {
  await chrome.storage.session.set({ aflImageIntent: { action, dataUrl, source: tab?.url || '', at: Date.now() } });
  chrome.runtime.sendMessage({ type: 'afl:imageIntent' }).catch(() => {});
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !Object.values(MENU).includes(info.menuItemId)) return;
  // Mở side panel ngay trong cử chỉ người dùng (không được await trước lệnh này).
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  (async () => {
    try {
      if (isRestricted(tab.url)) throw new Error('Chrome không cho phép thao tác trên trang này');
      let dataUrl;
      if (info.menuItemId === MENU.region || info.menuItemId === MENU.page) {
        const rect = await runInTab(tab, 0, pickRegionInPage);
        if (!rect) return;
        dataUrl = await captureRect(tab, rect);
      } else {
        dataUrl = await grabImage(info.srcUrl, tab, info.frameId);
      }
      await deliverImage(info.menuItemId === MENU.ref ? 'ref' : info.menuItemId === MENU.album ? 'album' : 'analyze', dataUrl, tab);
    } catch (e) {
      chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title: 'AutoFlow', message: String(e?.message || e) });
    }
  })();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'afl:download':
      download(msg.url, msg.filename).then(sendResponse);
      return true;
    case 'afl:expectDownload':
      expectDownload(msg.filename, msg.timeoutMs).then(sendResponse);
      return true;
    case 'afl:cancelExpect':
      cancelExpect();
      return false;
    case 'afl:bgFetch':
      bgFetch(msg.url).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) }));
      return true;
    case 'afl:notify':
      chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon-128.png', title: msg.title || 'AutoFlow', message: msg.message || '' });
      return false;
    case 'afl:showDownload':
      chrome.downloads.show(msg.id);
      return false;
    default:
      return false;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-run') chrome.runtime.sendMessage({ type: 'afl:control', action: 'toggleRun' }).catch(() => {});
});

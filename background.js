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

// Tải media khác origin bằng quyền host của extension (không bị CORS).
async function bgFetch(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { ok: true, dataUrl: `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`, mime: blob.type, size: blob.size };
}

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

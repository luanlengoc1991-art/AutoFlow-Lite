// Kết nối với tab của từng provider (Google Flow, ChatGPT, Gemini, Grok).
import { store } from './store.js';
import { PROVIDERS } from './providers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function findTab(provider = 'flow') {
  const p = PROVIDERS[provider];
  const tabs = await chrome.tabs.query({ url: p.urls });
  if (!tabs.length) return null;
  const preferred = provider === 'flow' ? tabs.filter((t) => /\/project\//.test(t.url || '')) : tabs;
  const pool = preferred.length ? preferred : tabs;
  return pool.find((t) => t.active) || pool.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
}
export const findFlowTab = () => findTab('flow');

export function send(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, { ...msg, selectors: store.selectors() });
}

export async function ensureContent(tabId, provider = 'flow') {
  try {
    return await send(tabId, { type: 'afl:ping' });
  } catch (_) {
    // Tab mở trước khi cài extension: tiêm script thủ công.
    await chrome.scripting.executeScript({ target: { tabId }, files: PROVIDERS[provider].scripts });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['page-bridge.js'], world: 'MAIN' });
    await sleep(300);
    return await send(tabId, { type: 'afl:ping' });
  }
}

function waitLoaded(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(on); resolve(false); }, timeout);
    function on(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(on);
      resolve(true);
    }
    chrome.tabs.onUpdated.addListener(on);
  });
}

// Trả về tab sẵn sàng nhận lệnh, hoặc ném lỗi có thông báo dễ hiểu.
// opts.newChat: mở cuộc trò chuyện mới trước khi gửi (chỉ provider chat).
export async function ready(provider = 'flow', opts = {}) {
  const p = PROVIDERS[provider];
  let tab = await findTab(provider);
  if (!tab && p.kind === 'chat') {
    tab = await chrome.tabs.create({ url: p.home, active: false });
    await waitLoaded(tab.id);
  }
  if (!tab) throw Object.assign(new Error(`Chưa mở ${p.name}. Bấm "Mở Flow" và vào một project.`), { category: 'setup' });
  if (opts.newChat && p.newChat) {
    await chrome.tabs.update(tab.id, { url: p.newChat });
    await waitLoaded(tab.id);
    await sleep(1500);
  }
  let ping = null;
  for (let i = 0; i < 10 && !ping?.editor; i++) {
    ping = await ensureContent(tab.id, provider).catch(() => null);
    if (!ping?.editor) await sleep(1000);
  }
  if (!ping?.ok) throw Object.assign(new Error(`Không kết nối được ${p.name}, hãy tải lại trang.`), { category: 'setup' });
  if (p.kind === 'chat' && !ping.editor) throw Object.assign(new Error(`${p.name}: không thấy ô nhập (đã đăng nhập chưa?)`), { category: 'setup' });
  return { tab, ping };
}

export async function openProvider(provider = 'flow') {
  const tab = await findTab(provider);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: PROVIDERS[provider].home });
  }
}
export const openFlow = () => openProvider('flow');

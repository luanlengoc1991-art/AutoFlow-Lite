// Kiểm tra tài khoản AI (Flow / ChatGPT / Gemini / Grok) qua chính phiên đăng nhập trên trình duyệt.
// Mọi lượt tạo chạy trên trang web của provider nên dùng đúng hạn mức gói của tài khoản đó.
import { PROVIDERS } from './providers.js';
import * as flow from './flow.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// state: ready (dùng được) · login (cần đăng nhập) · closed (chưa mở trang) · project (Flow: chưa vào project) · error
export async function checkAccount(provider, { open = false } = {}) {
  let tab = await flow.findTab(provider);
  if (!tab && open) {
    tab = await chrome.tabs.create({ url: PROVIDERS[provider].home, active: false });
    await waitLoaded(tab.id);
    await sleep(1500);
  }
  if (!tab) return { provider, state: 'closed', label: '' };
  let ping = null;
  for (let i = 0; i < 4 && !ping; i++) {
    ping = await flow.ensureContent(tab.id, provider).catch(() => null);
    if (!ping) await sleep(800);
  }
  if (!ping?.ok) return { provider, state: 'error', label: '', tabId: tab.id };
  const acc = ping.account || {};
  let state = acc.loggedIn === false ? 'login' : 'ready';
  if (provider === 'flow' && state === 'ready' && !ping.editor) state = 'project';
  if (provider !== 'flow' && state === 'ready' && !ping.editor) state = 'login';
  return { provider, state, label: acc.label || '', plan: acc.plan || '', tabId: tab.id };
}

export async function checkAll(opts) {
  return Promise.all(Object.keys(PROVIDERS).map((p) => checkAccount(p, opts).catch(() => ({ provider: p, state: 'error', label: '' }))));
}

export const STATE_TEXT = {
  ready: '✓ Ready',
  login: 'Cần đăng nhập',
  closed: 'Chưa mở',
  project: 'Chưa vào project',
  error: 'Không kết nối được'
};

// Mở trang đăng nhập / trang chính của provider để người dùng kết nối tài khoản.
export async function connectAccount(provider) {
  const tab = await flow.findTab(provider);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: PROVIDERS[provider].home, active: true });
  }
}

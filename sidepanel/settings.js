// Cửa sổ Cài đặt: cài đặt chung, tài khoản AI, cầu nối MCP / Telegram, bộ nhớ, giới thiệu.
import { store, DEFAULT_SETTINGS } from './lib/store.js';
import { checkAccount, checkAll, STATE_TEXT, connectAccount } from './lib/accounts.js';
import { PROVIDERS } from './lib/providers.js';
import * as flow from './lib/flow.js';
import { FLOW_IMAGE_MODELS, FLOW_VIDEO_MODELS, FLOW_RATIOS, FLOW_DURATIONS, CHAT_MODELS, CHAT_RATIOS, SEEDANCE_MODELS, SEEDANCE_RATIOS, SEEDANCE_DURATIONS } from './lib/defaults.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = { flow: 'conic-gradient(#4285f4 0 25%, #ea4335 0 50%, #fbbc05 0 75%, #34a853 0)', chatgpt: '#10a37f', gemini: 'linear-gradient(135deg,#4285f4,#a142f4)', grok: '#e5e5e5', claude: '#d97757', seedance: 'linear-gradient(135deg,#00c2ff,#7b61ff)' };
const NOTES = {
  claude: 'Viết prompt, phân tích ảnh bằng Claude (không tạo ảnh). Hạn mức theo gói Claude (Free / Pro / Max).',
  seedance: 'Tạo video/ảnh Seedance trên Dreamina (CapCut). Tính vào credit của tài khoản Dreamina.',
  flow: 'Tạo ảnh/video bằng Veo, Nano Banana… Hạn mức theo gói Google AI (Free / Pro / Ultra).',
  chatgpt: 'Viết prompt, tạo ảnh bằng ChatGPT. Hạn mức theo gói ChatGPT (Free / Plus / Pro).',
  gemini: 'Viết prompt, tạo ảnh bằng Gemini. Hạn mức theo gói Google AI.',
  grok: 'Viết prompt, tạo ảnh bằng Grok. Hạn mức theo gói X / SuperGrok.'
};

let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

await store.load();
const s = store.settings;
if (!s.mcpToken) s.mcpToken = newToken();
const ver = chrome.runtime.getManifest().version;
$('version').textContent = `AutoFlow Lite v${ver}`;
$('version2').textContent = `v${ver}`;

function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return `afl_${[...a].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// ---------- Tabs ----------
document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${b.dataset.tab}`));
  if (b.dataset.tab === 'accounts') renderAccounts(true);
  if (b.dataset.tab === 'storage') renderStorage();
}));
const params = new URLSearchParams(location.search);
if (params.get('tab')) document.querySelector(`#tabs [data-tab="${params.get('tab')}"]`)?.click();
document.querySelectorAll('#general-sub [data-sub]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#general-sub [data-sub]').forEach((x) => x.classList.toggle('active', x === b));
  for (const id of ['chung', 'platform', 'advanced']) $(`sub-${id}`).hidden = b.dataset.sub !== id;
  try { localStorage.setItem('aflSettingsSub', b.dataset.sub); } catch (_) { /* không lưu được */ }
}));
let lastSub = 'platform';
try { lastSub = localStorage.getItem('aflSettingsSub') || 'platform'; } catch (_) { /* mặc định */ }
document.querySelector(`#general-sub [data-sub="${params.get('sub') || lastSub}"]`)?.click();
document.querySelectorAll('#agent-sub [data-sub]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#agent-sub [data-sub]').forEach((x) => x.classList.toggle('active', x === b));
  $('sub-mcp').hidden = b.dataset.sub !== 'mcp';
  $('sub-telegram').hidden = b.dataset.sub !== 'telegram';
}));

// ---------- Danh sách lựa chọn của Nền tảng AI ----------
// Flow: ưu tiên danh sách thật đã đồng bộ, bổ sung gợi ý mặc định.
const RATIO_ICON = { '16:9': '▭', '4:3': '▭', '3:2': '▭', '1:1': '□', '3:4': '▯', '2:3': '▯', '9:16': '▯' };
const ratioLabel = (r, text = r) => `${RATIO_ICON[r] || '▯'} ${text}`;
function label(v) {
  if (RATIO_ICON[v]) return ratioLabel(v);
  if (/nano banana/i.test(v) && !/🍌/.test(v)) return `🍌 ${v}`;
  return v;
}
function listOptions(name) {
  const o = store.options || {};
  // Trùng tên khi bỏ emoji/ký hiệu (vd. "🍌 Nano Banana Pro" từ Flow và gợi ý "Nano Banana Pro"): giữ bản đầu.
  const key = (v) => v.replace(/[^\p{L}\p{N}.:\s-]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const merge = (...lists) => {
    const seen = new Set();
    return lists.flat().filter((v) => v && !seen.has(key(v)) && seen.add(key(v))).map((v) => [v, label(v)]);
  };
  if (name === 'imageModels') return merge(o.image?.models || [], FLOW_IMAGE_MODELS);
  if (name === 'videoModels') return merge(o.video?.models || [], FLOW_VIDEO_MODELS);
  if (name === 'ratios') return merge(o.image?.ratios || [], o.video?.ratios || [], FLOW_RATIOS);
  if (name === 'durations') return merge(o.video?.durations || [], FLOW_DURATIONS);
  if (name === 'seedanceModels') return SEEDANCE_MODELS.map((v) => [v, v]);
  if (name === 'seedanceRatios') return SEEDANCE_RATIOS.map((v) => [v, ratioLabel(v)]);
  if (name === 'seedanceDurations') return SEEDANCE_DURATIONS.map((v) => [v, v]);
  const [kind, p] = name.split(':');
  if (kind === 'model') return CHAT_MODELS[p].map((m) => [m.value, m.label]);
  if (kind === 'ratio') return CHAT_RATIOS[p].map(([v, l]) => [v, ratioLabel(v, l)]);
  return [];
}
document.querySelectorAll('select[data-list]').forEach((sel) => {
  sel.innerHTML = [['', 'Giữ như trang'], ...listOptions(sel.dataset.list)].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
});
function renderVoices() {
  const n = store.components?.voices?.length || 0;
  $('voices-state').textContent = n ? `Đã sync ${n} giọng` : 'Chưa sync — click Quét lại để bắt đầu';
}
$('scan-voices').addEventListener('click', async () => {
  $('voices-state').textContent = 'Đang quét…';
  const r = await chrome.runtime.sendMessage({ type: 'afl:syncFlow' }).catch(() => null);
  if (!r) { $('voices-state').textContent = 'Mở side panel AutoFlow rồi thử lại'; return; }
  if (!r.ok) { $('voices-state').textContent = r.error || 'Không quét được'; return; }
  await store.load();
  renderVoices();
});

// ---------- Ràng buộc trường ----------
function fill() {
  document.querySelectorAll('[data-s]').forEach((el) => {
    const v = s[el.dataset.s] ?? DEFAULT_SETTINGS[el.dataset.s];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
  renderMcpConfig();
}
function readFields() {
  document.querySelectorAll('[data-s]').forEach((el) => {
    const k = el.dataset.s;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number') v = Math.min(+el.max || Infinity, Math.max(+el.min || 0, parseFloat(v) || 0));
    s[k] = typeof v === 'string' ? v.trim() : v;
  });
}
document.addEventListener('input', (e) => { if (e.target.dataset.s) { readFields(); renderMcpConfig(); } });

async function saveAll() {
  readFields();
  if (s.selectors) { try { JSON.parse(s.selectors); } catch (_) { toast('Selector JSON không hợp lệ'); return false; } }
  // Chỉ ghi các trường có trên form (+ token MCP): giá trị side panel đổi trong lúc cửa sổ này mở
  // (vd. chat ID Telegram vừa liên kết, Parallel) không bị bản cũ ghi đè.
  const keys = new Set([...document.querySelectorAll('[data-s]')].map((el) => el.dataset.s));
  keys.add('mcpToken');
  const patch = Object.fromEntries([...keys].map((k) => [k, s[k]]));
  const { aflSettings = {} } = await chrome.storage.local.get('aflSettings');
  if (aflSettings.tgChatId && !patch.tgChatId) patch.tgChatId = aflSettings.tgChatId;
  await chrome.storage.local.set({ aflSettings: { ...aflSettings, ...patch } });
  chrome.runtime.sendMessage({ type: 'afl:settingsChanged' }).catch(() => {});
  return true;
}
$('save').addEventListener('click', async () => { if (await saveAll()) toast('Đã lưu tất cả cài đặt'); });
$('close').addEventListener('click', () => window.close());
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => chrome.tabs.create({ url: b.dataset.open })));
$('test-sound').addEventListener('click', (e) => { e.preventDefault(); beep(); });

export function beep() {
  const ctx = new AudioContext();
  [660, 880].forEach((f, i) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
    o.connect(g).connect(ctx.destination);
    o.start(ctx.currentTime + i * 0.18);
    o.stop(ctx.currentTime + i * 0.18 + 0.17);
  });
}

// ---------- Tài khoản AI ----------
let accState = {};
function accMini() {
  $('acc-strip').innerHTML = Object.keys(PROVIDERS).map((p) => {
    const st = accState[p];
    return `<div class="acc-mini" data-goacc><b><span class="dot" style="background:${COLORS[p]}"></span>${esc(PROVIDERS[p].name)}</b>
      <span class="${st?.state || ''}">${esc(st ? STATE_TEXT[st.state] : '…')}</span>${st?.label ? `<span>${esc(st.label)}</span>` : ''}</div>`;
  }).join('');
}
function renderFlowConn() {
  const st = accState.flow?.state;
  $('flow-conn').textContent = st === 'ready' ? '● Kết nối 1/1' : st ? STATE_TEXT[st] : 'Đang kiểm tra…';
  $('flow-conn').className = `pill ${st === 'ready' ? 'on' : 'warn'}`;
}
async function renderAccounts(refresh) {
  if (refresh) {
    accState = Object.fromEntries((await checkAll()).map((r) => [r.provider, r]));
    accMini();
    renderFlowConn();
  }
  $('acc-list').innerHTML = Object.keys(PROVIDERS).map((p) => {
    const st = accState[p];
    const state = st?.state || 'closed';
    return `<div class="acc" data-p="${p}"><div class="av" style="background:${COLORS[p]}">${esc(PROVIDERS[p].name[0])}</div>
      <div class="body"><b>${esc(PROVIDERS[p].name)}</b> <span class="pill ${state === 'ready' ? 'on' : 'warn'}">${esc(STATE_TEXT[state])}</span>
        <div class="lbl">${st?.label ? `Tài khoản: ${esc(st.label)}` : state === 'ready' ? 'Đã đăng nhập' : 'Chưa kết nối'}${st?.plan ? ` · gói ${esc(st.plan)}` : ''}</div>
        <div class="note">${esc(NOTES[p])}</div>
        <button class="link" data-act="diag" title="Lưu cấu trúc trang đang mở ra file JSON để gửi hỗ trợ">🩺 Chẩn đoán (xuất file)</button></div>
      <button class="btn" data-act="connect">${state === 'ready' ? 'Mở trang' : 'Kết nối'}</button>
      <button class="btn" data-act="check">Kiểm tra</button></div>`;
  }).join('');
}
$('acc-list').addEventListener('click', async (e) => {
  const p = e.target.closest('[data-p]')?.dataset.p;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!p || !act) return;
  if (act === 'connect') { await connectAccount(p); toast(`Đăng nhập ${PROVIDERS[p].name} trong tab vừa mở, rồi bấm Kiểm tra`); }
  if (act === 'diag') await diagnose(p);
  if (act === 'check') {
    e.target.textContent = '…';
    accState[p] = await checkAccount(p, { open: p !== 'flow' }).catch(() => ({ provider: p, state: 'error' }));
    renderAccounts(false);
    accMini();
  }
});
$('check-all').addEventListener('click', () => renderAccounts(true));

// Chẩn đoán đúng tab đang mở (không mở trang mới, không đổi cuộc trò chuyện), lưu JSON vào thư mục tải.
async function diagnose(p) {
  const tab = await flow.findTab(p);
  if (!tab) { toast(`Chưa mở ${PROVIDERS[p].name}: bấm Kết nối / Mở trang trước`); return; }
  try {
    await flow.ensureContent(tab.id, p);
    const r = await flow.send(tab.id, { type: 'afl:diagnose' });
    if (!r?.ok) throw new Error(r?.error || 'Trang không trả lời');
    const report = { extension: chrome.runtime.getManifest().version, ...r.report };
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
    const res = await chrome.runtime.sendMessage({ type: 'afl:download', url, filename: `${s.folder || 'AutoFlow'}/chan-doan-${p}-${Date.now()}.json` });
    toast(res?.ok ? `Đã lưu file chẩn đoán ${PROVIDERS[p].name} vào thư mục Tải xuống/${s.folder || 'AutoFlow'}` : 'Không lưu được file');
  } catch (e) { toast(`Chẩn đoán lỗi: ${e.message}`); }
}
$('acc-strip').addEventListener('click', () => document.querySelector('#tabs [data-tab="accounts"]').click());

// ---------- MCP ----------
function renderMcpConfig() {
  const dir = (s.extDir || '<thư mục extension>').replace(/[\\/]+$/, '');
  const script = `${dir}${dir.includes('/') && !dir.includes('\\') ? '/' : '\\'}mcp${dir.includes('/') && !dir.includes('\\') ? '/' : '\\'}autoflow-mcp.mjs`;
  const cfg = { mcpServers: { autoflow: { command: 'node', args: [script], env: { AUTOFLOW_TOKEN: s.mcpToken, AUTOFLOW_PORT: String(s.mcpPort || 17321) } } } };
  $('cfg-json').textContent = JSON.stringify(cfg, null, 2);
  $('cfg-cli').textContent = `claude mcp add autoflow -e AUTOFLOW_TOKEN=${s.mcpToken} -e AUTOFLOW_PORT=${s.mcpPort || 17321} -- node "${script}"`;
}
$('mcp-newtoken').addEventListener('click', async () => {
  s.mcpToken = newToken();
  fill();
  await saveAll();
  toast('Đã tạo token mới, token cũ bị thu hồi');
});
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => { navigator.clipboard.writeText($(b.dataset.copy).textContent); toast('Đã copy'); }));

function renderBridge(st) {
  const m = st?.mcp, t = st?.tg;
  $('mcp-status').textContent = !s.mcpEnabled ? 'Tắt' : m?.state === 'connected' ? 'Đã kết nối' : m?.state === 'waiting' ? 'Đang chờ máy chủ MCP' : 'Mở side panel để chạy';
  $('mcp-status').className = `pill ${m?.state === 'connected' ? 'on' : s.mcpEnabled ? 'warn' : ''}`;
  $('tg-status').textContent = !s.tgEnabled ? 'Tắt' : t?.state === 'running' ? `Đang chạy${t.bot ? ` · @${t.bot}` : ''}` : t?.error ? `Lỗi: ${t.error}` : 'Mở side panel để chạy';
  $('tg-status').className = `pill ${t?.state === 'running' ? 'on' : s.tgEnabled ? 'warn' : ''}`;
  if (t?.chatId && !s.tgChatId) { s.tgChatId = String(t.chatId); fill(); }
}
chrome.storage.local.get('aflBridgeStatus').then(({ aflBridgeStatus }) => renderBridge(aflBridgeStatus));
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.aflBridgeStatus) renderBridge(c.aflBridgeStatus.newValue); });

$('tg-test').addEventListener('click', async () => {
  readFields();
  if (!s.tgToken) { toast('Nhập bot token'); return; }
  const base = s.tgApiBase || 'https://api.telegram.org';
  try {
    const me = await (await fetch(`${base}/bot${s.tgToken}/getMe`)).json();
    if (!me.ok) throw new Error(me.description || 'Token sai');
    if (!s.tgChatId) { $('tg-test-res').textContent = `Bot @${me.result.username} hợp lệ. Gửi /start cho bot để liên kết chat.`; return; }
    const r = await (await fetch(`${base}/bot${s.tgToken}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: s.tgChatId, text: '✦ AutoFlow đã kết nối với chat này.' }) })).json();
    $('tg-test-res').textContent = r.ok ? `Đã gửi tới chat ${s.tgChatId} qua @${me.result.username}` : (r.description || 'Không gửi được');
  } catch (err) { $('tg-test-res').textContent = err.message; }
});

// ---------- Bộ nhớ ----------
async function renderStorage() {
  const used = await chrome.storage.local.getBytesInUse(null);
  const d = await chrome.storage.local.get(['aflTasks', 'aflHistory', 'aflRefs', 'aflWorkflows', 'aflLibrary', 'aflSavedTasks']);
  const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;
  $('usage-text').textContent = `${mb(used)} đang dùng (không giới hạn)`;
  $('usage-bar').style.width = `${Math.min(100, (used / (200 * 1024 * 1024)) * 100)}%`;
  const stat = (n, label) => `<div><b>${n}</b><span>${label}</span></div>`;
  $('storage-stats').innerHTML = stat((d.aflTasks || []).length, 'lượt trong hàng đợi') + stat((d.aflHistory || []).length, 'kết quả lịch sử')
    + stat(Object.keys(d.aflRefs || {}).length, 'ảnh tham chiếu') + stat((d.aflWorkflows || []).length, 'workflow')
    + stat((d.aflSavedTasks || []).length, 'task đã lưu') + stat((d.aflLibrary || []).length, 'prompt thư viện');
}
document.querySelectorAll('[data-clean]').forEach((b) => b.addEventListener('click', async () => {
  const what = b.dataset.clean;
  if (what === 'all' && !confirm('Xoá toàn bộ dữ liệu AutoFlow (cài đặt, workflow, lịch sử, task)?')) return;
  // Side panel giữ dữ liệu trong bộ nhớ: nhờ nó dọn để không bị ghi đè lại.
  const r = await chrome.runtime.sendMessage({ type: 'afl:clean', what }).catch(() => null);
  if (!r?.ok) {
    if (what === 'all') await chrome.storage.local.clear();
    if (what === 'history') await chrome.storage.local.set({ aflHistory: [] });
    if (what === 'queue') { const { aflTasks = [] } = await chrome.storage.local.get('aflTasks'); await chrome.storage.local.set({ aflTasks: aflTasks.filter((t) => t.status !== 'done') }); }
  }
  toast('Đã dọn dữ liệu');
  renderStorage();
}));
// Token (Telegram, MCP) không đi theo file sao lưu: file hay được gửi/chia sẻ đi nơi khác.
const SECRET_SETTINGS = ['tgToken', 'mcpToken'];
$('backup').addEventListener('click', async () => {
  const data = await chrome.storage.local.get(null);
  if (data.aflSettings) data.aflSettings = Object.fromEntries(Object.entries(data.aflSettings).filter(([k]) => !SECRET_SETTINGS.includes(k)));
  const blob = new Blob([JSON.stringify({ format: 'autoflow-backup', version: 1, at: Date.now(), data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `autoflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$('restore-btn').addEventListener('click', () => $('restore').click());
$('restore').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.format !== 'autoflow-backup' || !j.data || typeof j.data !== 'object') throw new Error('bad');
    // Chỉ nhận dữ liệu của AutoFlow; giữ token đang có trên máy (file sao lưu không chứa token).
    const data = Object.fromEntries(Object.entries(j.data).filter(([k, v]) => /^afl[A-Z]\w*$/.test(k) && v !== null && typeof v === 'object'));
    if (!Object.keys(data).length) throw new Error('bad');
    if (!confirm('Khôi phục sẽ ghi đè dữ liệu hiện tại. Tiếp tục?')) return;
    if (data.aflSettings) {
      const { aflSettings: cur = {} } = await chrome.storage.local.get('aflSettings');
      data.aflSettings = { ...Object.fromEntries(Object.entries(data.aflSettings).filter(([k]) => !SECRET_SETTINGS.includes(k))), ...Object.fromEntries(SECRET_SETTINGS.filter((k) => cur[k]).map((k) => [k, cur[k]])) };
    }
    await chrome.storage.local.set(data);
    chrome.runtime.sendMessage({ type: 'afl:reload' }).catch(() => {});
    toast('Đã khôi phục. Side panel sẽ tải lại.');
    renderStorage();
  } catch (_) { toast('File sao lưu không hợp lệ'); }
});

fill();
renderVoices();
accMini();
renderAccounts(true);

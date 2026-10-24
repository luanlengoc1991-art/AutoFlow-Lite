import { store, uid } from './lib/store.js';
import * as flow from './lib/flow.js';
import { Runner } from './lib/runner.js';
import { splitPrompts, csvToTasks } from './lib/prompts.js';
import { buildPrompts, buildQueueTasks, allStyles } from './lib/batch.js';
import { PROVIDERS } from './lib/providers.js';
import { WorkflowRunner, splitLines } from './lib/workflow.js';
import { newWorkflow, normalizeWorkflow } from './lib/workflow-nodes.js';
import { TEMPLATES, instantiateTemplate } from './lib/workflow-templates.js';
import { openAssistant } from './assistant.js';
import { openImagePrompt } from './image-prompt.js';
import { mountAlbums, mountImageSearch, openAddToAlbum } from './albums.js';
import { McpBridge, TelegramBot } from './lib/bridges.js';
import { createNode, nid } from './lib/workflow-nodes.js';
import { checkAll, checkAccount, STATE_TEXT } from './lib/accounts.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name) => `<svg><use href="#i-${name}"/></svg>`;

// Gợi ý khi chưa đồng bộ từ Flow; bấm "Đồng bộ từ Flow" để lấy danh sách thật.
const FALLBACK = {
  image: { models: ['Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'], quantities: [1, 2, 3, 4] },
  video: { models: ['Veo 3.1 - Fast', 'Veo 3.1 - Quality'], ratios: ['16:9', '9:16'], quantities: [1, 2, 3, 4], durations: ['4s', '6s', '8s'], resolutions: ['720p', '1080p'], modes: ['frames', 'ingredients'] }
};
const STATUS = { pending: 'Chờ', running: 'Đang tạo', done: 'Xong', error: 'Lỗi', cancelled: 'Huỷ', unknown: 'Chưa rõ' };

// ---------- Log & toast ----------
const logs = [];
function log(msg, level = '') {
  logs.unshift({ t: new Date().toLocaleTimeString(), msg, level });
  if (logs.length > 500) logs.length = 500;
  renderLogs();
}
let toastTimer;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

const runner = new Runner({ log, onChange: () => { renderTasks(); renderRunState(); renderHistory(); renderSavedTasks(); if (wfRunner?.state?.running && wfRunner.refreshProgress()) renderWorkflowRun(); } });
const wfRunner = new WorkflowRunner({ runner, log, onUpdate: () => { renderTasks(); renderWorkflowRun(); } });

// ---------- Tabs ----------
let currentTab = 'gen';
function showTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === `pane-${name}`));
  $('bottombar').hidden = name !== 'gen';
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
$('btn-settings').addEventListener('click', () => openSettingsWindow());
$('open-full-settings').addEventListener('click', () => openSettingsWindow());
$('settings-back').addEventListener('click', () => showTab('gen'));
$('btn-quick-settings').addEventListener('click', () => showTab('settings'));

// ---------- Gen form ----------
const g = () => store.gen;
function saveGen() { store.save('gen'); }

function optionsFor(type) {
  const synced = store.options?.[type];
  const fb = FALLBACK[type];
  const pick = (k) => (synced?.[k]?.length ? synced[k] : fb[k] || []);
  return { models: pick('models'), ratios: pick('ratios'), quantities: pick('quantities'), durations: pick('durations'), resolutions: pick('resolutions'), synced: !!synced?.models?.length };
}

function fillSelect(sel, values, current, keepLabel) {
  const opts = [`<option value="">${keepLabel}</option>`, ...values.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)];
  if (current && !values.includes(current)) opts.push(`<option value="${esc(current)}">${esc(current)}</option>`);
  sel.innerHTML = opts.join('');
  sel.value = current || '';
}

function renderGen() {
  const s = g();
  const isChat = PROVIDERS[s.provider]?.kind === 'chat';
  document.querySelectorAll('#provider-row [data-provider]').forEach((b) => b.classList.toggle('active', b.dataset.provider === s.provider));
  $('flow-controls').hidden = isChat;
  $('chat-controls').hidden = !isChat;
  document.querySelectorAll('#chat-mode [data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === s.chatMode));
  $('chat-newchat').checked = s.newChat ?? store.settings.chatNewChat;
  $('gen-text').value = s.text;
  $('gen-multi').checked = s.multi;
  $('split-row').hidden = !s.multi;
  document.querySelectorAll('#split-row [data-split]').forEach((b) => b.classList.toggle('active', b.dataset.split === s.split));
  document.querySelectorAll('#gen-type [data-type]').forEach((b) => b.classList.toggle('active', b.dataset.type === s.genType));
  const o = optionsFor(s.genType);
  const st = store.settings, video = s.genType === 'video';
  const defModel = video ? st.flowVideoModel : st.flowImageModel, defRatio = video ? st.flowVideoRatio : st.flowImageRatio;
  fillSelect($('gen-model'), o.models, s.model, defModel ? `Model: mặc định (${defModel})` : 'Model: giữ như Flow');
  fillSelect($('gen-ratio'), o.ratios, s.ratio, defRatio ? `Tỉ lệ: mặc định (${defRatio})` : 'Tỉ lệ');
  $('qty-val').textContent = s.quantity;
  $('video-controls').hidden = s.genType !== 'video';
  $('gen-vmode').value = s.videoMode;
  fillSelect($('gen-duration'), o.durations, s.duration, st.flowDuration ? `Thời lượng: mặc định (${st.flowDuration})` : 'Thời lượng');
  fillSelect($('gen-resolution'), o.resolutions, s.resolution, 'Độ phân giải');
  $('gen-repeat').value = s.repeat;
  $('gen-spin').value = s.spin;
  $('gen-refmode').value = s.refMode;
  $('gen-autodl').checked = s.autoDownload;
  $('gen-chain').checked = !!s.chainPrev;
  $('gen-chainmode').value = s.chainMode || 'last';
  $('gen-chainmode').disabled = !s.chainPrev;
  $('gen-folder').value = store.settings.folder || 'AutoFlow';
  const isVideo = s.genType === 'video' && !isChat;
  $('gen-dlres').innerHTML = isVideo
    ? '<option value="original">Gốc 720p</option><option value="1080p">1080p</option><option value="4k">4K</option>'
    : '<option value="original">Gốc</option><option value="2k">2K</option><option value="4k">4K</option>';
  $('gen-dlres').value = (isVideo ? store.settings.dlVideoRes : store.settings.dlImageRes) || 'original';
  $('gen-dlres').disabled = isChat;
  $('btn-parallel').classList.toggle('on', store.settings.concurrency > 1);
  renderStyleChip();
  renderRefs();
  updateCounts();
  renderRunState();
}
$('gen-chain').addEventListener('change', (e) => { g().chainPrev = e.target.checked; saveGen(); renderGen(); });
$('gen-chainmode').addEventListener('change', (e) => { g().chainMode = e.target.value; saveGen(); });
$('gen-folder').addEventListener('change', (e) => { store.settings.folder = e.target.value.trim() || 'AutoFlow'; store.save('settings'); renderSettings(); });
$('gen-dlres').addEventListener('change', (e) => {
  store.settings[g().genType === 'video' ? 'dlVideoRes' : 'dlImageRes'] = e.target.value;
  store.save('settings');
  renderSettings();
});
function toggleParallel() {
  store.settings.concurrency = store.settings.concurrency > 1 ? 1 : 3;
  store.save('settings');
  renderSettings();
  renderGen();
  renderSavedTasks();
  toast(store.settings.concurrency > 1 ? 'Parallel: tối đa 3 task Flow chạy song song' : 'Chạy lần lượt từng task');
}
$('btn-parallel').addEventListener('click', toggleParallel);

function updateCounts() {
  const s = g();
  const total = buildPrompts(s).length;
  const outputs = PROVIDERS[s.provider]?.kind === 'chat' ? total : total * (s.quantity || 1);
  $('prompt-count').textContent = `${total} prompt → ${outputs} output(s)`;
  $('char-count').textContent = `${s.text.length} ký tự`;
  $('prompt-hint').hidden = !(s.multi && s.split === 'blank');
}

$('gen-text').addEventListener('input', (e) => { g().text = e.target.value; saveGen(); updateCounts(); updateMentionMenu(); });
document.querySelectorAll('#provider-row [data-provider]').forEach((b) => b.addEventListener('click', () => { g().provider = b.dataset.provider; saveGen(); renderGen(); }));
document.querySelectorAll('#chat-mode [data-mode]').forEach((b) => b.addEventListener('click', () => { g().chatMode = b.dataset.mode; saveGen(); renderGen(); }));
$('chat-newchat').addEventListener('change', (e) => { g().newChat = e.target.checked; saveGen(); });
$('btn-open-provider').addEventListener('click', () => flow.openProvider(g().provider));

// ---------- Gợi ý @mention (nhân vật / giọng nói đã đồng bộ từ Flow) ----------
let mentionIdx = 0;
function mentionContext() {
  const ta = $('gen-text');
  const before = ta.value.slice(0, ta.selectionStart);
  const m = /@(?:(char|voice):)?([^\s@]*)$/.exec(before);
  return m && g().provider === 'flow' ? { start: before.length - m[0].length, kind: m[1], q: m[2].toLowerCase() } : null;
}
function mentionItems(ctx) {
  const c = store.components || {};
  const list = [...(c.characters || []).map((name) => ({ kind: 'char', name })), ...(c.voices || []).map((name) => ({ kind: 'voice', name }))];
  return list.filter((i) => (!ctx.kind || i.kind === ctx.kind) && i.name.toLowerCase().includes(ctx.q)).slice(0, 12);
}
function updateMentionMenu() {
  const menu = $('mention-menu');
  const ctx = mentionContext();
  const items = ctx ? mentionItems(ctx) : [];
  if (!items.length) { menu.hidden = true; return; }
  mentionIdx = Math.min(mentionIdx, items.length - 1);
  menu.innerHTML = items.map((i, k) => `<button data-k="${k}" class="${k === mentionIdx ? 'active' : ''}">${esc(i.name)}<span class="kind">${i.kind === 'char' ? 'nhân vật' : 'giọng'}</span></button>`).join('');
  menu.hidden = false;
  menu._items = items;
}
function applyMention(item) {
  const ta = $('gen-text');
  const ctx = mentionContext();
  if (!ctx) return;
  const token = `@${item.kind}:${/\s/.test(item.name) ? `[${item.name}]` : item.name} `;
  ta.value = ta.value.slice(0, ctx.start) + token + ta.value.slice(ta.selectionStart);
  const pos = ctx.start + token.length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
  g().text = ta.value; saveGen(); updateCounts();
  $('mention-menu').hidden = true;
}
$('mention-menu').addEventListener('mousedown', (e) => {
  const k = e.target.closest('[data-k]')?.dataset.k;
  if (k !== undefined) { e.preventDefault(); applyMention($('mention-menu')._items[+k]); }
});
$('gen-text').addEventListener('keydown', (e) => {
  const menu = $('mention-menu');
  if (menu.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = Math.max(0, mentionIdx + (e.key === 'ArrowDown' ? 1 : -1)); updateMentionMenu(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(menu._items[mentionIdx]); }
  else if (e.key === 'Escape') menu.hidden = true;
});
$('gen-text').addEventListener('blur', () => setTimeout(() => { $('mention-menu').hidden = true; }, 150));
$('gen-multi').addEventListener('change', (e) => { g().multi = e.target.checked; saveGen(); renderGen(); });
document.querySelectorAll('#split-row [data-split]').forEach((b) => b.addEventListener('click', () => { g().split = b.dataset.split; saveGen(); renderGen(); }));
document.querySelectorAll('#gen-type [data-type]').forEach((b) => b.addEventListener('click', () => {
  if (g().genType === b.dataset.type) return;
  Object.assign(g(), { genType: b.dataset.type, model: '', ratio: '', duration: '', resolution: '' });
  saveGen(); renderGen();
}));
for (const [id, key] of [['gen-model', 'model'], ['gen-ratio', 'ratio'], ['gen-vmode', 'videoMode'], ['gen-duration', 'duration'], ['gen-resolution', 'resolution'], ['gen-spin', 'spin'], ['gen-refmode', 'refMode']]) {
  $(id).addEventListener('change', (e) => { g()[key] = e.target.value; saveGen(); updateCounts(); renderRefs(); });
}
$('gen-repeat').addEventListener('input', (e) => { g().repeat = Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)); saveGen(); updateCounts(); });
$('gen-autodl').addEventListener('change', (e) => { g().autoDownload = e.target.checked; saveGen(); });
$('qty-dec').addEventListener('click', () => { g().quantity = Math.max(1, g().quantity - 1); $('qty-val').textContent = g().quantity; saveGen(); });
$('qty-inc').addEventListener('click', () => { g().quantity = Math.min(4, g().quantity + 1); $('qty-val').textContent = g().quantity; saveGen(); });

// ---------- Ảnh tham chiếu ----------
function renderRefs() {
  const ids = g().refIds || [];
  $('ref-count').textContent = ids.length ? `(${ids.length})` : '';
  $('ref-thumbs').innerHTML = ids.map((id, i) => {
    const r = store.refs[id];
    if (!r) return '';
    return `<div class="thumb" title="${esc(r.name)}"><img src="${r.dataUrl}" alt=""><span class="idx">${i + 1}</span><button data-rm="${id}" title="Bỏ ảnh">${icon('x')}</button></div>`;
  }).join('');
  const s = g();
  let hint = '';
  if (ids.length && s.genType === 'video' && s.videoMode === 'frames') hint = 'Frames → Video: ảnh 1 là khung đầu, ảnh 2 là khung cuối.';
  else if (ids.length && s.genType === 'video' && s.videoMode === 'text') hint = 'Text → Video không dùng ảnh. Chọn Frames hoặc Ingredients để dùng ảnh tham chiếu.';
  else if (ids.length && s.refMode === 'each') hint = 'Thứ tự: ảnh thứ i dùng cho prompt thứ i (lặp lại vòng nếu ít ảnh hơn prompt).';
  else if (ids.length && s.refMode === 'mention') hint = 'Mention: viết @img1, @img2… trong prompt để chọn ảnh tương ứng cho prompt đó.';
  else if (ids.length) hint = 'Tất cả: mỗi prompt dùng toàn bộ ảnh tham chiếu.';
  $('ref-hint').textContent = hint;
}
$('ref-thumbs').addEventListener('click', (e) => {
  const id = e.target.closest('[data-rm]')?.dataset.rm;
  if (!id) return;
  g().refIds = g().refIds.filter((x) => x !== id);
  saveGen(); store.gcRefs(); renderRefs();
});

function readFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}
async function addRefFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  for (const f of imgs) {
    if (f.size > 20 * 1024 * 1024) { toast(`${f.name} quá lớn (>20MB)`); continue; }
    const id = store.addRef({ name: f.name, mime: f.type, dataUrl: await readFile(f) });
    g().refIds.push(id);
  }
  saveGen(); renderRefs();
  if (imgs.length) toast(`Đã thêm ${imgs.length} ảnh`);
}
$('ref-drop').addEventListener('click', () => $('ref-file').click());
// Chụp vùng nhìn thấy của tab đang mở trong cửa sổ hiện tại làm ảnh tham chiếu.
$('ref-capture').addEventListener('click', async () => {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'png' });
    g().refIds.push(store.addRef({ name: `chup_${Date.now()}.png`, mime: 'image/png', dataUrl }));
    saveGen(); renderRefs(); toast('Đã thêm ảnh chụp màn hình');
  } catch (e) { toast('Không chụp được tab này: ' + (e.message || e)); }
});
$('ref-file').addEventListener('change', (e) => { addRefFiles(e.target.files); e.target.value = ''; });
const dz = $('ref-drop');
dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('over'));
dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); addRefFiles(e.dataTransfer.files); });
document.addEventListener('paste', (e) => {
  if (currentTab !== 'gen') return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addRefFiles(files); }
});

// ---------- Import ----------
$('btn-import').addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const text = await file.text();
  if (/\.csv$/i.test(file.name)) {
    const rows = csvToTasks(text);
    const hasSettings = rows.some((r) => Object.keys(r).length > 1);
    if (hasSettings) {
      const list = rows.flatMap((r) => Array.from({ length: r.repeat || 1 }, () => r));
      list.provider = 'flow'; // cột CSV là cài đặt của Flow
      const n = enqueue(list);
      toast(`Đã thêm ${n} task từ CSV vào hàng đợi`);
      showTab('queue');
      return;
    }
    g().text = rows.map((r) => r.prompt).join(promptSep());
  } else {
    g().text = text.replace(/\r/g, '').trim();
    // File mỗi dòng một prompt (không có dòng trống): tách theo dòng.
    if (!/\n\s*\n/.test(g().text) && g().text.includes('\n')) g().split = 'line';
  }
  g().multi = true;
  saveGen(); renderGen();
  toast(`Đã nhập ${splitPrompts(g().text, true, g().split).length} prompt`);
});

// ---------- Tạo task ----------
function nextIndex() { return store.tasks.reduce((m, t) => Math.max(m, t.index || 0), 0) + 1; }

// Đưa vào hàng đợi theo một cấu hình Gen (form hiện tại hoặc task đã lưu). rows: tuỳ chọn (CSV).
function enqueueConfig(cfg, rows) {
  const tasks = buildQueueTasks({ ...cfg, newChat: cfg.newChat ?? store.settings.chatNewChat }, { startIndex: nextIndex(), styles: store.styles, rows });
  store.tasks.push(...tasks);
  store.save('tasks');
  renderTasks();
  return tasks.length;
}
const enqueue = (rows) => enqueueConfig({ ...g(), provider: rows.provider || g().provider }, rows);

function addFromGen() {
  if (!buildPrompts(g()).length) { toast('Chưa có prompt'); return 0; }
  const n = enqueueConfig(g());
  log(`Thêm ${n} task vào hàng đợi`);
  return n;
}
function startQueue(n) {
  toast(`Đã thêm ${n} lượt${runner.running ? '' : ', bắt đầu chạy'}`);
  showTab('queue');
  if (!runner.running) runner.start();
}
// Nút + : lưu cấu hình Gen hiện tại thành task (tab Tasks).
$('btn-add').addEventListener('click', () => saveCurrentAsTask());
$('btn-generate').addEventListener('click', async () => {
  if (!buildPrompts(g()).length) { toast('Chưa có prompt'); return; }
  const isFlow = PROVIDERS[g().provider]?.kind === 'flow';
  if (!runner.running && store.settings.confirmRun && !(await confirmRun())) return;
  const n = addFromGen();
  if (!n) return;
  if (!runner.running && isFlow && store.settings.reloadBeforeRun) await reloadFlowTab();
  startQueue(n);
});

// Hộp "Xác nhận chạy": tóm tắt lượt tạo, trạng thái tài khoản, cách chạy / cách gửi.
function confirmRun() {
  const s = g(), st = store.settings;
  const p = PROVIDERS[s.provider];
  const isFlow = p.kind === 'flow';
  const prompts = buildPrompts(s).length;
  const qty = isFlow ? (s.quantity || 1) : 1;
  const ratio = s.ratio || (isFlow ? (s.genType === 'video' ? st.flowVideoRatio : st.flowImageRatio) : st[`${s.provider}Ratio`]) || 'như trang';
  const seg = (key, items) => `<div class="ip-seg">${items.map(([v, label]) => `<button type="button" data-k="${key}" data-v="${v}">${label}</button>`).join('')}</div>`;
  const o = { run: st.concurrency > 1 ? 'parallel' : 'seq', submit: st.submitMode || 'auto', reload: !!st.reloadBeforeRun, ask: true };
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'assistant confirm-run';
    d.innerHTML = `<div class="dlg-head"><b>Xác nhận chạy</b><button class="icon-btn" data-x>${icon('x')}</button></div>
      <div class="cr-grid">
        <span>Prompt</span><b>${prompts} · ${prompts > 1 ? 'Multi-Prompt' : 'Single'}</b>
        <span>Nền tảng</span><b>${esc(p.name)} <span class="cr-acc muted">Đang kiểm tra…</span></b>
        <span>Loại</span><b>${isFlow ? (s.genType === 'video' ? 'Video' : 'Ảnh') : (s.chatMode === 'text' ? 'Văn bản' : 'Ảnh')}</b>
        <span>Tỷ lệ</span><b>${esc(ratio)}</b>
        <span>Số lượng</span><b>${qty} / prompt → ${prompts * qty} kết quả</b>
        <span>Tải xuống</span><b>${s.autoDownload !== false && st.autoDownload !== false ? `Tự tải vào ${esc(st.folder || 'AutoFlow')}` : 'Không tự tải'}</b>
      </div>
      ${isFlow ? `<label>Cách chạy${seg('run', [['parallel', 'Song song'], ['seq', 'Lần lượt']])}</label>
      <label>Cách gửi${seg('submit', [['auto', 'Tự gửi'], ['manual', 'Gửi tay']])}</label>
      <p class="muted cr-hint"></p>
      <label class="switch line"><input type="checkbox" data-c="reload" ${o.reload ? 'checked' : ''}><span></span>Tải lại trang Flow trước khi chạy</label>` : ''}
      <label class="switch line"><input type="checkbox" data-c="noask"><span></span>Không hỏi lại (bật lại trong Cài đặt)</label>
      <div class="btn-row"><button class="btn" data-no>Huỷ</button><button class="btn primary" data-yes>${icon('play')}Chạy</button></div>`;
    document.body.appendChild(d);
    const paint = () => {
      d.querySelectorAll('[data-k]').forEach((b) => b.classList.toggle('active', o[b.dataset.k] === b.dataset.v));
      const hint = d.querySelector('.cr-hint');
      if (hint) hint.textContent = o.submit === 'manual'
        ? 'AutoFlow điền prompt + ảnh tham chiếu rồi chờ bạn tự bấm Tạo trên Flow (từng lượt một).'
        : 'AutoFlow tự bấm Tạo sau khi điền prompt + ảnh tham chiếu.';
    };
    const finish = (ok) => {
      if (ok) {
        if (isFlow) {
          st.concurrency = o.run === 'parallel' ? Math.max(2, st.concurrency > 1 ? st.concurrency : 3) : 1;
          st.submitMode = o.submit;
          st.reloadBeforeRun = d.querySelector('[data-c=reload]').checked;
        }
        if (d.querySelector('[data-c=noask]').checked) st.confirmRun = false;
        store.save('settings'); renderSettings(); renderGen();
      }
      d.close(); d.remove(); resolve(ok);
    };
    d.addEventListener('cancel', () => finish(false));
    d.addEventListener('click', (e) => {
      const k = e.target.closest('[data-k]');
      if (k) { o[k.dataset.k] = k.dataset.v; paint(); return; }
      if (e.target.closest('[data-x], [data-no]')) finish(false);
      if (e.target.closest('[data-yes]')) finish(true);
    });
    paint();
    d.showModal();
    checkAccount(s.provider).then((a) => {
      const el = d.querySelector('.cr-acc');
      if (el) { el.textContent = STATE_TEXT[a.state] || ''; el.className = `cr-acc st ${a.state}`; }
    }).catch(() => {});
  });
}

async function reloadFlowTab() {
  const tab = await flow.findTab('flow');
  if (!tab) return;
  log('Tải lại trang Flow trước khi chạy');
  await chrome.tabs.reload(tab.id);
  await new Promise((resolve) => {
    const timer = setTimeout(done, 30000);
    function done() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    function on(id, info) { if (id === tab.id && info.status === 'complete') done(); }
    chrome.tabs.onUpdated.addListener(on);
  });
  await new Promise((r) => setTimeout(r, 2500));
}

// ---------- Nhân vật & phong cách ----------
function openPicker(title, bodyHtml, onReady) {
  const d = document.createElement('dialog');
  d.innerHTML = `<div class="dlg-head"><b>${esc(title)}</b><button class="icon-btn" data-x>${icon('x')}</button></div>${bodyHtml}`;
  document.body.appendChild(d);
  const close = () => { d.close(); d.remove(); };
  d.querySelector('[data-x]').onclick = close;
  d.addEventListener('cancel', close);
  d.showModal();
  onReady(d, close);
}
function renderStyleChip() {
  const st = g().styleId ? allStyles(store.styles).find((s) => s.id === g().styleId) : null;
  $('style-label').textContent = st ? st.name : 'Phong cách';
  $('btn-style').classList.toggle('set', !!st);
  const chars = g().characters || [];
  $('character-label').textContent = chars.length ? `Nhân vật: ${chars.join(', ')}` : 'Nhân vật';
  $('btn-character').classList.toggle('set', chars.length > 0);
}
$('btn-style').addEventListener('click', () => {
  openPicker('Chọn phong cách', `<input type="search" placeholder="Tìm phong cách…" style="margin-top:8px" data-q><div class="style-list" data-list></div>
    <details style="margin-top:8px"><summary class="muted">+ Tạo phong cách riêng</summary>
      <input type="text" data-name placeholder="Tên phong cách" style="margin-top:6px"><textarea data-prompt rows="3" placeholder="Mô tả phong cách (được nối vào cuối mỗi prompt)" style="margin-top:6px"></textarea>
      <div class="btn-row"><button class="btn primary" data-create>Lưu phong cách</button></div></details>`, (d, close) => {
    const render = () => {
      const q = d.querySelector('[data-q]').value.trim().toLowerCase();
      const list = allStyles(store.styles).filter((s) => !q || `${s.name} ${s.prompt}`.toLowerCase().includes(q));
      const groups = {};
      list.forEach((s) => (groups[s.cat] ||= []).push(s));
      d.querySelector('[data-list]').innerHTML = `<button class="style-item ${g().styleId ? '' : 'active'}" data-pick=""><span class="sw" style="background:#3a3a6a;color:#ddd">∅</span><span><b>Không dùng phong cách</b></span></button>`
        + Object.entries(groups).map(([cat, items]) => `<h6>${esc(cat)}</h6>${items.map((s) => `<button class="style-item ${g().styleId === s.id ? 'active' : ''}" data-pick="${esc(s.id)}">
          <span class="sw" style="background:linear-gradient(135deg, ${s.color || '#c6f432'}, #222)">${esc(s.name.slice(0, 1))}</span><span><b>${esc(s.name)}</b><small>${esc(s.prompt)}</small></span>
          ${s.cat === 'Của tôi' ? `<span class="spacer"></span><span class="icon-btn small" data-del="${esc(s.id)}" title="Xoá">${icon('trash')}</span>` : ''}</button>`).join('')}`).join('');
    };
    d.querySelector('[data-q]').addEventListener('input', render);
    d.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); store.styles = store.styles.filter((s) => s.id !== del.dataset.del); if (g().styleId === del.dataset.del) g().styleId = ''; store.save('styles'); saveGen(); render(); renderStyleChip(); return; }
      const pick = e.target.closest('[data-pick]');
      if (pick) { g().styleId = pick.dataset.pick; saveGen(); renderStyleChip(); close(); return; }
      if (e.target.closest('[data-create]')) {
        const name = d.querySelector('[data-name]').value.trim(), prompt = d.querySelector('[data-prompt]').value.trim();
        if (!name || !prompt) { toast('Nhập tên và mô tả phong cách'); return; }
        const st = { id: `my-${uid()}`, name, prompt, color: '#c6f432' };
        store.styles.unshift(st);
        store.save('styles');
        g().styleId = st.id;
        saveGen(); renderStyleChip(); close();
        toast('Đã tạo phong cách');
      }
    });
    render();
  });
});
$('btn-character').addEventListener('click', () => {
  const chars = store.components?.characters || [];
  openPicker('Chọn nhân vật (Flow)', chars.length
    ? `<p class="hint">Nhân vật được thêm vào mọi prompt Flow. Có thể chọn nhiều.</p><div class="style-list">${chars.map((c) => `<label class="style-item"><input type="checkbox" value="${esc(c)}" ${g().characters?.includes(c) ? 'checked' : ''}><b>${esc(c)}</b></label>`).join('')}</div>
       <div class="btn-row"><button class="btn" data-clear>Bỏ chọn</button><button class="btn primary" data-ok>Xong</button></div>`
    : '<p class="hint">Chưa có nhân vật. Tạo nhân vật trên Google Flow rồi bấm "Đồng bộ từ Flow".</p><div class="btn-row"><button class="btn primary" data-sync>Đồng bộ từ Flow</button></div>', (d, close) => {
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-sync]')) { close(); syncFromFlow(); }
      if (e.target.closest('[data-clear]')) d.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; });
      if (e.target.closest('[data-ok]')) {
        g().characters = [...d.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
        saveGen(); renderStyleChip(); close();
      }
    });
  });
});

// ---------- Tasks ----------
function renderTasks() {
  const tasks = store.tasks;
  const c = (st) => tasks.filter((t) => t.status === st).length;
  const done = c('done'), err = c('error'), run = c('running'), pend = c('pending');
  $('task-stats').innerHTML = `
    <div class="stat"><b>${tasks.length}</b><span>Tổng</span></div>
    <div class="stat run"><b>${run}</b><span>Đang tạo</span></div>
    <div class="stat ok"><b>${done}</b><span>Xong</span></div>
    <div class="stat err"><b>${err}</b><span>Lỗi</span></div>`;
  const finished = done + err + c('cancelled') + c('unknown');
  $('task-progress').style.width = tasks.length ? `${(finished / tasks.length) * 100}%` : '0';
  const badge = $('tasks-badge');
  badge.hidden = !(run + pend);
  badge.textContent = run + pend;
  $('task-empty').hidden = tasks.length > 0;
  $('task-list').innerHTML = tasks.map((t) => {
    const isChat = PROVIDERS[t.provider || 'flow']?.kind === 'chat';
    const meta = (isChat
      ? [PROVIDERS[t.provider].name, t.chatMode === 'text' ? 'Văn bản' : 'Tạo ảnh', t.refIds?.length ? `${t.refIds.length} ảnh đính kèm` : '', t.workflowRun ? 'workflow' : '', t.attempts > 1 ? `lần ${t.attempts}` : '']
      : [t.genType === 'video' ? `Video${t.videoMode !== 'text' ? ' · ' + t.videoMode : ''}` : 'Ảnh', t.model || 'model Flow', t.ratio, `x${t.quantity}`, t.duration, t.refIds?.length ? `${t.refIds.length} ảnh ref` : '', t.workflowRun ? 'workflow' : '', t.attempts > 1 ? `lần ${t.attempts}` : ''])
      .filter(Boolean).join(' · ');
    const retryIn = t.status === 'pending' && t.retryAt > Date.now() ? ` · thử lại sau ${Math.ceil((t.retryAt - Date.now()) / 1000)}s` : '';
    const res = (t.results || []).filter((r) => r.thumb).map((r) => `<img src="${r.thumb}" alt="" title="${esc(r.filename || '')}">`).join('');
    return `<li class="task ${t.status}" data-id="${t.id}">
      <span class="st">${STATUS[t.status] || t.status}${t.status === 'running' && t.progress != null ? ` ${t.progress}%` : ''}</span>
      <div class="body">
        <div class="txt">#${t.index} ${esc(t.prompt)}</div>
        <div class="meta">${esc(meta)}${retryIn}</div>
        ${t.error && t.status !== 'done' ? `<div class="err">${esc(t.error)}</div>` : ''}
        ${t.note ? `<div class="note">${esc(t.note)}</div>` : ''}
        ${t.chatMode === 'text' && t.text ? `<div class="meta">${esc(t.text.slice(0, 160))}${t.text.length > 160 ? '…' : ''}</div>` : ''}
      </div>
      <div class="acts">
        ${t.status === 'pending' ? `<button class="icon-btn small" data-act="up" title="Đưa lên đầu">${icon('up')}</button>` : ''}
        ${['error', 'cancelled', 'done', 'unknown'].includes(t.status) ? `<button class="icon-btn small" data-act="retry" title="${t.status === 'unknown' ? 'Gửi lại (kiểm tra trang trước: có thể đã tạo rồi)' : 'Chạy lại'}">${icon('retry')}</button>` : ''}
        <button class="icon-btn small" data-act="copy" title="Sao chép prompt">${icon('copy')}</button>
        ${t.status !== 'running' ? `<button class="icon-btn small" data-act="rm" title="Xoá">${icon('trash')}</button>` : ''}
      </div>
      ${t.status === 'running' ? `<div class="bar"><div style="width:${t.progress || 3}%"></div></div>` : ''}
      ${res ? `<div class="res">${res}</div>` : ''}
    </li>`;
  }).join('');
}
$('task-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]').dataset.id;
  const i = store.tasks.findIndex((t) => t.id === id);
  const t = store.tasks[i];
  if (!t) return;
  if (btn.dataset.act === 'rm') { store.tasks.splice(i, 1); store.gcRefs(); }
  if (btn.dataset.act === 'retry') Object.assign(t, { status: 'pending', attempts: 0, error: '', note: '', retryAt: 0, results: [], submittedAt: 0, token: '' });
  if (btn.dataset.act === 'up') { store.tasks.splice(i, 1); const first = store.tasks.findIndex((x) => x.status === 'pending'); store.tasks.splice(first < 0 ? store.tasks.length : first, 0, t); }
  if (btn.dataset.act === 'copy') { navigator.clipboard.writeText(t.prompt); toast('Đã sao chép prompt'); }
  store.save('tasks');
  renderTasks();
});
$('retry-failed').addEventListener('click', () => {
  let n = 0;
  for (const t of store.tasks) if (t.status === 'error' || t.status === 'cancelled') { Object.assign(t, { status: 'pending', attempts: 0, error: '', retryAt: 0 }); n++; }
  store.save('tasks'); renderTasks(); toast(`Đặt lại ${n} task`);
});
$('clear-done').addEventListener('click', () => { store.tasks = store.tasks.filter((t) => t.status !== 'done'); store.save('tasks'); store.gcRefs(); renderTasks(); });
$('clear-all').addEventListener('click', () => {
  if (runner.running) { toast('Dừng hàng đợi trước khi xoá tất cả'); return; }
  if (!confirm('Xoá toàn bộ hàng đợi?')) return;
  store.tasks = []; store.save('tasks'); store.gcRefs(); renderTasks();
});

function renderRunState() {
  $('run-start').disabled = runner.running && !runner.paused;
  $('run-start').innerHTML = `${icon('play')}${runner.running && runner.paused ? 'Tiếp tục' : 'Chạy'}`;
  $('run-pause').disabled = !runner.running || runner.paused;
  $('run-stop').disabled = !runner.running;
  const banner = $('run-message');
  banner.hidden = !runner.message;
  banner.textContent = runner.message;
  banner.className = `banner ${runner.level === 'error' ? '' : 'warn'}`;
  const gen = $('btn-generate');
  gen.classList.toggle('running', runner.running);
  gen.querySelector('span').textContent = runner.running ? (runner.paused ? 'Đang tạm dừng · Thêm vào hàng đợi' : 'Đang chạy · Thêm vào hàng đợi') : (g().provider === 'flow' ? 'Tạo' : `Tạo bằng ${PROVIDERS[g().provider]?.name || ''}`);
}
$('run-start').addEventListener('click', () => {
  if (!store.tasks.some((t) => t.status === 'pending') && !runner.running) { toast('Không có task đang chờ'); return; }
  runner.start();
});
$('run-pause').addEventListener('click', () => runner.pause());
$('run-stop').addEventListener('click', () => runner.stop());

// ---------- Task đã lưu (tab Tasks) ----------
const CONFIG_KEYS = ['provider', 'chatMode', 'newChat', 'text', 'multi', 'split', 'genType', 'model', 'ratio', 'quantity', 'videoMode', 'duration', 'resolution',
  'repeat', 'spin', 'refIds', 'refMode', 'autoDownload', 'styleId', 'characters', 'chainPrev', 'chainMode'];
const pickConfig = (src) => structuredClone(Object.fromEntries(CONFIG_KEYS.map((k) => [k, src[k]])));

async function saveCurrentAsTask() {
  if (!buildPrompts(g()).length) { toast('Chưa có prompt để lưu'); return; }
  const first = buildPrompts(g())[0];
  const name = await askText('Tên task', first.slice(0, 40) || 'Task mới', 'Lưu');
  if (!name) return;
  store.savedTasks.unshift({ id: uid(), name, enabled: true, createdAt: Date.now(), updatedAt: Date.now(), config: pickConfig(g()) });
  store.save('savedTasks');
  renderSavedTasks();
  toast('Đã lưu task');
}

function relTime(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} giờ trước` : `${Math.round(h / 24)} ngày trước`;
}

function savedTaskStatus(st) {
  const qs = store.tasks.filter((t) => t.savedTaskId === st.id && t.runAt === st.lastRunAt);
  if (!qs.length) return st.lastStatus || '';
  if (qs.some((t) => t.status === 'running' || t.status === 'pending')) return 'running';
  return qs.some((t) => t.status === 'error') ? 'error' : 'ok';
}

function renderSavedTasks() {
  const q = $('st-search').value.trim().toLowerCase();
  const f = $('st-filter').value;
  $('st-parallel').classList.toggle('on', store.settings.concurrency > 1);
  const list = store.savedTasks.filter((t) => (!f || (t.config.provider || 'flow') === f) && (!q || `${t.name} ${t.config.text}`.toLowerCase().includes(q)));
  $('st-empty').hidden = list.length > 0;
  const groups = new Map();
  for (const t of list) {
    const day = new Date(t.updatedAt).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(t);
  }
  $('st-list').innerHTML = [...groups].map(([day, items]) => `<div class="st-group">${esc(day)} (${items.length})</div>${items.map((t) => {
    const c = t.config;
    const prompts = buildPrompts(c);
    const status = savedTaskStatus(t);
    if ((status === 'ok' || status === 'error') && t.lastStatus !== status) { t.lastStatus = status; store.save('savedTasks'); }
    const isChat = PROVIDERS[c.provider || 'flow'].kind === 'chat';
    const meta = isChat ? [c.chatMode === 'text' ? 'Văn bản' : 'Tạo ảnh'] : [c.model || 'model Flow', c.ratio, `x${c.quantity}`];
    return `<div class="st-card ${status === 'ok' ? 'ok' : status === 'running' ? 'running' : ''}" data-id="${t.id}">
      <input type="checkbox" data-check title="Chọn để chạy">
      <span class="stat-ic ${status === 'ok' ? 'ok' : status === 'error' ? 'err' : ''}">${status === 'ok' ? '✓' : status === 'error' ? '!' : ''}</span>
      <div class="body"><div class="title">${esc(t.name)}<span class="tag flow">${esc(PROVIDERS[c.provider || 'flow'].name)}</span>${isChat ? '' : `<span class="tag ${c.genType === 'video' ? 'video' : ''}">${c.genType === 'video' ? 'Video' : 'Ảnh'}</span>`}</div>
        <div class="prev">${prompts.length} prompt · ${esc(prompts[0] || '')}</div>
        <div class="meta">${esc(meta.filter(Boolean).join(' · '))}${c.refIds?.length ? ` · ${c.refIds.length} ảnh ref` : ''} · ${relTime(t.lastRunAt || t.updatedAt)}${t.lastRunAt ? ' (chạy)' : ''}</div></div>
      <button class="mini-tog ${t.enabled !== false ? 'on' : ''}" data-st="toggle" title="Bật/tắt"></button>
      <button class="icon-btn small" data-st="more" title="Thêm">⋮</button></div>`;
  }).join('')}`).join('');
}

function runSavedTasks(list) {
  let n = 0;
  for (const t of list) {
    const runAt = Date.now();
    t.lastRunAt = runAt;
    const before = store.tasks.length;
    n += enqueueConfig({ ...t.config, savedTaskId: t.id });
    store.tasks.slice(before).forEach((x) => { x.runAt = runAt; });
  }
  store.save('savedTasks');
  store.save('tasks');
  renderSavedTasks();
  if (n) startQueue(n); else toast('Không có task nào để chạy');
}

$('st-search').addEventListener('input', renderSavedTasks);
$('st-filter').addEventListener('change', renderSavedTasks);
$('st-parallel').addEventListener('click', toggleParallel);
$('st-add').addEventListener('click', saveCurrentAsTask);
$('st-runall').addEventListener('click', () => {
  const checked = [...document.querySelectorAll('#st-list [data-check]:checked')].map((c) => c.closest('[data-id]').dataset.id);
  const list = checked.length ? store.savedTasks.filter((t) => checked.includes(t.id)) : store.savedTasks.filter((t) => t.enabled !== false);
  runSavedTasks(list);
});
$('st-list').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-id]');
  const t = card && store.savedTasks.find((x) => x.id === card.dataset.id);
  if (!t || e.target.closest('[data-check]')) return;
  const act = e.target.closest('[data-st]')?.dataset.st;
  if (act === 'toggle') { t.enabled = t.enabled === false; store.save('savedTasks'); renderSavedTasks(); return; }
  if (act !== 'more') return;
  closePop();
  const m = document.createElement('div');
  m.className = 'pop-menu';
  m.innerHTML = `<button data-m="run">${icon('play')}Chạy</button><button data-m="load">${icon('edit')}Mở trong Gen để sửa</button>
    <button data-m="update">${icon('sync')}Cập nhật từ Gen hiện tại</button><button data-m="dup">${icon('copy')}Nhân bản</button>
    <button data-m="rename">${icon('edit')}Đổi tên</button><button data-m="del" class="danger">${icon('trash')}Xoá</button>`;
  document.body.appendChild(m);
  const r = e.target.closest('[data-st]').getBoundingClientRect();
  m.style.left = `${Math.min(r.left - 150, innerWidth - 190)}px`;
  m.style.top = `${r.bottom + 4}px`;
  m.addEventListener('click', async (ev) => {
    const k = ev.target.closest('[data-m]')?.dataset.m;
    if (!k) return;
    closePop();
    if (k === 'run') runSavedTasks([t]);
    if (k === 'load') { Object.assign(store.gen, structuredClone(t.config)); saveGen(); renderGen(); showTab('gen'); toast(`Đã mở "${t.name}" trong Gen`); }
    if (k === 'update') { t.config = pickConfig(g()); t.updatedAt = Date.now(); toast('Đã cập nhật task từ Gen'); }
    if (k === 'dup') store.savedTasks.unshift({ ...structuredClone(t), id: uid(), name: `${t.name} (bản sao)`, createdAt: Date.now(), updatedAt: Date.now(), lastRunAt: 0 });
    if (k === 'rename') { const name = await askText('Đổi tên task', t.name, 'Lưu'); if (name) t.name = name; }
    if (k === 'del' && confirm(`Xoá task "${t.name}"?`)) { store.savedTasks = store.savedTasks.filter((x) => x !== t); store.gcRefs(); }
    store.save('savedTasks');
    renderSavedTasks();
  });
});

// ---------- Công cụ (Angles / Effects mở cửa sổ riêng) ----------
async function openToolWindow(page) {
  const url = chrome.runtime.getURL(`sidepanel/${page}.html`);
  const [open] = await chrome.tabs.query({ url });
  if (open) { await chrome.windows.update(open.windowId, { focused: true }); return; }
  const w = Math.min(1280, screen.availWidth - 80), h = Math.min(900, screen.availHeight - 80);
  await chrome.windows.create({ url, type: 'popup', width: w, height: h, left: Math.round((screen.availWidth - w) / 2), top: Math.round((screen.availHeight - h) / 2) });
}
document.querySelector('.tool-grid').addEventListener('click', (e) => {
  const t = e.target.closest('[data-tool]')?.dataset.tool;
  if (t === 'angles' || t === 'effects') openToolWindow(t);
  if (t === 'assistant') { showTab('gen'); $('btn-assistant').click(); }
  if (t === 'workflow') showTab('workflow');
});
// Trang Effects / Angles gửi task sang đây (hàng đợi + kết nối Flow nằm ở side panel).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'afl:enqueueTasks') return false;
  (async () => {
    let refId = null;
    const img = msg.image;
    if (img?.dataUrl) refId = store.addRef({ name: img.name || 'nguon.png', mime: img.mime, dataUrl: img.dataUrl });
    else if (img?.url) {
      const { dataUrl, mime } = await runner.mediaToDataUrl({ provider: img.provider || 'flow' }, img);
      refId = store.addRef({ name: 'nguon.png', mime, dataUrl });
    }
    const created = msg.tasks.map((t) => wfRunner.enqueue({
      provider: 'flow', prompt: t.prompt, label: t.label, source: msg.source, genType: t.genType || 'image', videoMode: 'text',
      model: t.model || '', ratio: t.ratio || '', quantity: t.quantity || 1, duration: '', resolution: '', refIds: refId ? [refId] : [],
      folder: `${store.settings.folder || 'AutoFlow'}/${msg.source === 'angles' ? 'Angles' : 'Effects'}`
    }));
    renderTasks();
    if (!runner.running) runner.start();
    log(`${msg.source === 'angles' ? 'Angles' : 'Effects'}: thêm ${created.length} lượt vào hàng đợi`);
    sendResponse({ ok: true, ids: created.map((t) => t.id) });
  })().catch((e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

// ---------- Lịch sử ----------
function renderHistory() {
  const q = $('hist-search').value.trim().toLowerCase();
  const list = store.history.filter((h) => !q || h.prompt.toLowerCase().includes(q));
  $('hist-empty').hidden = list.length > 0;
  $('hist-list').innerHTML = list.slice(0, 200).map((h) => `
    <div class="hist" data-id="${h.id}">
      <div class="thumbs">${h.results.map((r, i) => r.thumb
        ? `<img src="${r.thumb}" alt="" data-open="${i}" title="${esc(r.filename || 'Mở trong thư mục tải')}">`
        : `<div class="ph" title="${esc(r.kind)}">${icon(r.kind === 'video' ? 'video' : 'image')}</div>`).join('')}</div>
      <div class="txt">${esc(h.prompt)}</div>
      ${h.text ? `<div class="answer">${esc(h.text)}</div>` : ''}
      <div class="meta">
        <span>${new Date(h.at).toLocaleString()} · ${esc(PROVIDERS[h.provider || 'flow']?.name || 'Flow')}${h.provider && h.provider !== 'flow' ? '' : ` · ${h.genType === 'video' ? 'Video' : 'Ảnh'}`}${h.model ? ' · ' + esc(h.model) : ''} · ${h.results.length} file</span>
        <span class="spacer"></span>
        <button class="icon-btn small" data-act="dl" title="Tải lại (cần mở project chứa kết quả)">${icon('download')}</button>
        <button class="icon-btn small" data-act="rerun" title="Tạo lại">${icon('retry')}</button>
        <button class="icon-btn small" data-act="copy" title="Sao chép prompt">${icon('copy')}</button>
        <button class="icon-btn small" data-act="rm" title="Xoá khỏi lịch sử">${icon('trash')}</button>
      </div>
    </div>`).join('');
}
$('hist-search').addEventListener('input', renderHistory);
$('hist-clear').addEventListener('click', () => { if (confirm('Xoá toàn bộ lịch sử?')) { store.history = []; store.save('history'); renderHistory(); } });
$('hist-list').addEventListener('click', async (e) => {
  const card = e.target.closest('[data-id]');
  if (!card) return;
  const h = store.history.find((x) => x.id === card.dataset.id);
  if (!h) return;
  const open = e.target.closest('[data-open]');
  if (open) {
    const r = h.results[+open.dataset.open];
    if (r?.downloadId) chrome.runtime.sendMessage({ type: 'afl:showDownload', id: r.downloadId });
    return;
  }
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'copy') { navigator.clipboard.writeText(h.text || h.prompt); toast(h.text ? 'Đã sao chép câu trả lời' : 'Đã sao chép prompt'); }
  if (act === 'rm') { store.history = store.history.filter((x) => x !== h); store.save('history'); renderHistory(); }
  if (act === 'rerun') {
    const id = uid();
    const provider = h.provider || 'flow';
    const base = { id, index: nextIndex(), prompt: h.prompt, provider, refIds: [], autoDownload: true, status: 'pending', attempts: 0, createdAt: Date.now() };
    store.tasks.push(provider === 'flow'
      ? { ...base, genType: h.genType, videoMode: 'text', model: h.model || '', ratio: h.ratio || '', quantity: Math.max(1, h.results.length), duration: '', resolution: '' }
      : { ...base, chatMode: h.text ? 'text' : 'image', newChat: true });
    store.save('tasks'); renderTasks(); toast('Đã thêm vào hàng đợi');
  }
  if (act === 'dl') {
    try {
      const { tab } = await flow.ready(h.provider || 'flow');
      const fake = { index: 0, prompt: h.prompt, provider: h.provider || 'flow', genType: h.genType, model: h.model, createdAt: h.at };
      let ok = 0;
      for (let i = 0; i < h.results.length; i++) if ((await runner.download(tab.id, fake, h.results[i], i + 1)).downloaded) ok++;
      toast(`Đã tải ${ok}/${h.results.length} file`);
    } catch (err) { toast(err.message); }
  }
});

// ---------- Ảnh trong Flow (ảnh/video của project đang mở) ----------
const photos = { items: [], kind: '', selected: new Set(), loading: false };
function renderPhotos() {
  const q = $('ph-search').value.trim().toLowerCase();
  const list = photos.items.filter((p) => (!photos.kind || p.kind === photos.kind) && (!q || p.prompt.toLowerCase().includes(q)));
  $('ph-total').textContent = photos.items.length ? `${list.length}/${photos.items.length}` : '';
  $('ph-empty').hidden = list.length > 0;
  if (photos.items.length && !list.length) $('ph-empty').textContent = 'Không có mục phù hợp.';
  $('ph-grid').innerHTML = list.map((p) => `<button class="ph-item ${photos.selected.has(p.key) ? 'sel' : ''}" data-key="${esc(p.key)}" title="${esc(p.prompt)}">
      ${p.thumb ? `<img src="${p.thumb}" alt="">` : `<span class="ph">${icon(p.kind === 'video' ? 'video' : 'image')}</span>`}
      ${p.kind === 'video' ? `<i class="ph-kind">${icon('video')}</i>` : ''}<span class="ph-check">✓</span></button>`).join('');
  $('ph-bar').hidden = photos.selected.size === 0;
  $('ph-count').textContent = `${photos.selected.size} đã chọn`;
  $('ph-filter').querySelectorAll('[data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === photos.kind));
}
async function loadPhotos() {
  if (photos.loading) return;
  photos.loading = true;
  $('ph-load').disabled = true;
  $('ph-empty').hidden = false;
  $('ph-empty').textContent = 'Đang đọc thư viện Flow…';
  try {
    const { tab } = await flow.ready('flow');
    const r = await flow.send(tab.id, { type: 'afl:listMedia', opts: { scroll: true } });
    if (!r?.ok) throw new Error(r?.error || 'Không đọc được thư viện Flow');
    photos.items = r.items;
    photos.selected.clear();
    $('ph-empty').textContent = 'Project này chưa có ảnh/video nào.';
    log(`Tab Ảnh: ${r.items.length} mục từ Flow`);
  } catch (e) {
    $('ph-empty').textContent = e.message;
  } finally {
    photos.loading = false;
    $('ph-load').disabled = false;
    renderPhotos();
  }
}
$('ph-load').addEventListener('click', loadPhotos);
$('ph-search').addEventListener('input', renderPhotos);
$('ph-filter').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) { photos.kind = b.dataset.kind; renderPhotos(); } });
$('ph-grid').addEventListener('click', (e) => {
  const key = e.target.closest('[data-key]')?.dataset.key;
  if (!key) return;
  photos.selected.has(key) ? photos.selected.delete(key) : photos.selected.add(key);
  renderPhotos();
});
document.querySelector('[data-tab=photos]').addEventListener('click', () => { if (phSub === 'flow' && !photos.items.length) loadPhotos(); });
$('ph-bar').addEventListener('click', async (e) => {
  const act = e.target.closest('[data-ph]')?.dataset.ph;
  if (!act) return;
  const picked = photos.items.filter((p) => photos.selected.has(p.key));
  if (act === 'clear') { photos.selected.clear(); renderPhotos(); return; }
  if (act === 'dl') {
    try {
      const { tab } = await flow.ready('flow');
      let ok = 0;
      for (let i = 0; i < picked.length; i++) {
        const p = picked[i];
        const fake = { index: i + 1, prompt: p.prompt || 'flow', provider: 'flow', genType: p.kind, createdAt: Date.now() };
        if ((await runner.download(tab.id, fake, p, 1)).downloaded) ok++;
      }
      toast(`Đã tải ${ok}/${picked.length} file`);
    } catch (err) { toast(err.message); }
    return;
  }
  const images = picked.filter((p) => p.kind === 'image');
  if (!images.length) { toast('Chọn ít nhất một ảnh (video không dùng được ở đây)'); return; }
  try {
    if (act === 'ref') {
      for (const p of images) {
        const { dataUrl, mime } = await runner.mediaToDataUrl({ provider: 'flow' }, p);
        g().refIds.push(store.addRef({ name: 'flow.png', mime, dataUrl }));
      }
      saveGen(); renderRefs(); showTab('gen');
      toast(`Đã thêm ${images.length} ảnh tham chiếu`);
    }
    if (act === 'prompt') {
      const { dataUrl } = await runner.mediaToDataUrl({ provider: 'flow' }, images[0]);
      showImagePrompt(dataUrl);
    }
    if (act === 'album') {
      const list = [];
      for (const p of images) list.push({ name: 'flow.png', ...(await runner.mediaToDataUrl({ provider: 'flow' }, p)) });
      if (await openAddToAlbum({ images: list, toast })) { photos.selected.clear(); renderPhotos(); }
    }
  } catch (err) { toast(err.message); }
});

// ---------- Album + Tìm ảnh (module albums.js) ----------
let phSub = 'flow';
function useAlbumRefs(items) {
  for (const i of items) g().refIds.push(store.addRef({ name: i.name, mime: i.mime, dataUrl: i.dataUrl }));
  saveGen(); renderRefs(); showTab('gen');
  toast(`Đã thêm ${items.length} ảnh tham chiếu`);
}
const albumsView = mountAlbums($('ph-albums'), {
  toast, log,
  onUseRefs: useAlbumRefs,
  onPrompt: (dataUrl) => showImagePrompt(dataUrl),
  onDownload: async (album, items) => {
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const ext = (items[i].mime.split('/')[1] || 'png').replace('jpeg', 'jpg');
      const base = items[i].name.replace(/\.[a-z0-9]{2,5}$/i, '') || `anh_${i + 1}`;
      const r = await chrome.runtime.sendMessage({ type: 'afl:download', url: items[i].dataUrl, filename: `${store.settings.folder || 'AutoFlow'}/Album/${album.name}/${String(i + 1).padStart(2, '0')}_${base}.${ext}` });
      if (r?.ok) ok++;
    }
    toast(`Đã tải ${ok}/${items.length} ảnh`);
  }
});
mountImageSearch($('ph-websearch'), { toast, log });
function showPhotosSub(sub) {
  phSub = sub;
  document.querySelectorAll('#ph-subtabs [data-sub]').forEach((b) => b.classList.toggle('active', b.dataset.sub === sub));
  $('ph-flow').hidden = sub !== 'flow';
  $('ph-albums').hidden = sub !== 'albums';
  $('ph-websearch').hidden = sub !== 'search';
  if (sub === 'albums') albumsView.render();
  if (sub === 'flow' && !photos.items.length) loadPhotos();
}
document.querySelectorAll('#ph-subtabs [data-sub]').forEach((b) => b.addEventListener('click', () => showPhotosSub(b.dataset.sub)));

// ---------- Thư viện prompt ----------
function libMatches(q) { return store.library.filter((p) => !q || `${p.title} ${p.text}`.toLowerCase().includes(q)); }
function libItem(p, actions) {
  return `<div class="lib" data-id="${p.id}"><div class="body">${p.title ? `<b>${esc(p.title)}</b>` : ''}<div class="txt">${esc(p.text)}</div></div><div class="acts">${actions}</div></div>`;
}
function renderLibrary() {
  const q = $('lib-search').value.trim().toLowerCase();
  const list = libMatches(q);
  $('lib-list').innerHTML = list.length ? list.map((p) => libItem(p,
    `<button class="icon-btn small" data-act="use" title="Chèn vào Gen">${icon('plus')}</button>
     <button class="icon-btn small" data-act="copy" title="Sao chép">${icon('copy')}</button>
     <button class="icon-btn small" data-act="rm" title="Xoá">${icon('trash')}</button>`)).join('') : '<p class="empty">Thư viện trống.</p>';
}
// Ký tự nối giữa các prompt theo cách tách đang chọn (dòng trống / mỗi dòng).
const promptSep = () => (g().split === 'blank' ? '\n\n' : '\n');
function insertPrompt(text) {
  const s = g();
  s.text = s.text.trim() ? `${s.text.replace(/\s+$/, '')}${promptSep()}${text}` : text;
  if (s.text.includes('\n')) s.multi = true;
  saveGen(); renderGen();
}
$('lib-add').addEventListener('click', () => {
  const text = $('lib-text').value.trim();
  if (!text) { toast('Nhập nội dung prompt'); return; }
  store.library.unshift({ id: uid(), title: $('lib-title').value.trim(), text, at: Date.now() });
  store.save('library');
  $('lib-title').value = ''; $('lib-text').value = '';
  renderLibrary(); toast('Đã lưu');
});
$('lib-search').addEventListener('input', renderLibrary);
$('lib-list').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  const p = store.library.find((x) => x.id === e.target.closest('[data-id]')?.dataset.id);
  if (!act || !p) return;
  if (act === 'use') { insertPrompt(p.text); showTab('gen'); toast('Đã chèn vào Gen'); }
  if (act === 'copy') { navigator.clipboard.writeText(p.text); toast('Đã sao chép'); }
  if (act === 'rm') { store.library = store.library.filter((x) => x !== p); store.save('library'); renderLibrary(); }
});
$('btn-save-prompt').addEventListener('click', () => {
  const text = g().text.trim();
  if (!text) { toast('Chưa có prompt để lưu'); return; }
  const items = g().multi ? splitPrompts(text, true, g().split) : [text];
  for (const t of items) store.library.unshift({ id: uid(), title: '', text: t, at: Date.now() });
  store.save('library'); renderLibrary(); toast(`Đã lưu ${items.length} prompt vào thư viện`);
});
$('lib-export').addEventListener('click', () => {
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(store.library, null, 2))}`;
  chrome.runtime.sendMessage({ type: 'afl:download', url, filename: `${store.settings.folder || 'AutoFlow'}/thu-vien-prompt.json` });
});
$('lib-import-btn').addEventListener('click', () => $('lib-import').click());
$('lib-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = (Array.isArray(data) ? data : []).filter((p) => p && typeof p.text === 'string')
      .map((p) => ({ id: uid(), title: String(p.title || ''), text: p.text, at: Date.now() }));
    store.library.unshift(...items);
    store.save('library'); renderLibrary(); toast(`Đã nhập ${items.length} prompt`);
  } catch (_) { toast('File JSON không hợp lệ'); }
});
// Hộp chọn nhanh từ tab Gen
const picker = $('lib-picker');
function renderPicker() {
  const list = libMatches($('pick-search').value.trim().toLowerCase());
  $('pick-list').innerHTML = list.length ? list.map((p) => libItem(p, `<button class="icon-btn small" data-act="use" title="Chèn">${icon('plus')}</button>`)).join('') : '<p class="empty">Thư viện trống. Lưu prompt ở tab Prompts.</p>';
}
$('btn-library').addEventListener('click', () => { $('pick-search').value = ''; renderPicker(); picker.showModal(); });
$('pick-search').addEventListener('input', renderPicker);
picker.querySelector('[data-close]').addEventListener('click', () => picker.close());
$('pick-list').addEventListener('click', (e) => {
  const p = store.library.find((x) => x.id === e.target.closest('[data-id]')?.dataset.id);
  if (p && e.target.closest('[data-act]')) { insertPrompt(p.text); picker.close(); toast('Đã chèn'); }
});

// ---------- Nhật ký ----------
function renderLogs() {
  $('log-list').innerHTML = logs.map((l) => `<div class="${l.level}"><span class="t">${l.t}</span> ${esc(l.msg)}</div>`).join('') || '<p class="empty">Chưa có nhật ký.</p>';
}
$('log-clear').addEventListener('click', () => { logs.length = 0; renderLogs(); });

// ---------- Cài đặt ----------
function renderSettings() {
  document.querySelectorAll('[data-setting]').forEach((el) => {
    const v = store.settings[el.dataset.setting];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
}
document.querySelectorAll('[data-setting]').forEach((el) => el.addEventListener('change', () => {
  const k = el.dataset.setting;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.type === 'number') v = Math.min(+el.max || Infinity, Math.max(+el.min || 0, parseFloat(v) || 0));
  if (k === 'selectors' && v.trim()) {
    try { JSON.parse(v); } catch (_) { toast('Selector JSON không hợp lệ'); return; }
  }
  store.settings[k] = v;
  store.save('settings');
}));

async function syncFromFlow() {
  try {
    await syncFlowOptions();
  } catch (e) {
    log(`Đồng bộ thất bại: ${e.message}`, 'error');
    toast(`Đồng bộ thất bại: ${e.message}`);
  }
}
async function syncFlowOptions() {
  const { tab } = await flow.ready();
  toast('Đang đọc tuỳ chọn từ Flow…');
  const r = await flow.send(tab.id, { type: 'afl:scrape' });
  if (!r?.ok) throw new Error(r?.error || 'Không đọc được');
  store.options = { ...r.options, at: Date.now() };
  store.save('options');
  const c = await flow.send(tab.id, { type: 'afl:scrapeComponents' }).catch(() => null);
  if (c?.ok) { store.components = c.components; await chrome.storage.local.set({ aflComponents: c.components }); }
  renderGen(); renderFlowInfo();
  const o = r.options;
  const comp = store.components || {};
  log(`Đồng bộ Flow: ảnh [${o.image.models.join(', ')}], video [${o.video.models.join(', ')}], ${comp.characters?.length || 0} nhân vật, ${comp.voices?.length || 0} giọng`, 'ok');
  toast(`Đã đồng bộ ${o.image.models.length + o.video.models.length} model, ${comp.characters?.length || 0} nhân vật`);
  return { voices: comp.voices?.length || 0 };
}
$('btn-sync').addEventListener('click', syncFromFlow);
$('btn-sync2').addEventListener('click', syncFromFlow);
function renderFlowInfo() {
  const o = store.options;
  const c = store.components || {};
  $('flow-info').textContent = o?.at
    ? `Đã đồng bộ lúc ${new Date(o.at).toLocaleString()} · ảnh: ${o.image.models.join(', ') || '—'} · video: ${o.video.models.join(', ') || '—'} · nhân vật: ${c.characters?.join(', ') || '—'} · giọng: ${c.voices?.join(', ') || '—'}`
    : 'Chưa đồng bộ model từ Flow (đang dùng danh sách gợi ý).';
}

$('btn-diagnose').addEventListener('click', async () => {
  try {
    const provider = $('diag-provider').value;
    const { tab } = await flow.ready(provider);
    const r = await flow.send(tab.id, { type: 'afl:diagnose' });
    const report = { extension: chrome.runtime.getManifest().version, ...r.report };
    const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`;
    const res = await chrome.runtime.sendMessage({ type: 'afl:download', url, filename: `${store.settings.folder || 'AutoFlow'}/chan-doan-${provider}-${Date.now()}.json` });
    const f = report.found;
    log(`Chẩn đoán ${PROVIDERS[provider].name}: ${Object.entries(f).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${v}`).join(' ')}`, f.editor || f.composer ? 'ok' : 'warn');
    toast(res?.ok ? 'Đã lưu file chẩn đoán vào thư mục tải' : 'Không lưu được file');
  } catch (e) { toast(e.message); }
});

// ---------- Trợ lý prompt (module assistant.js) ----------
$('btn-assistant').addEventListener('click', () => openAssistant({
  ask: (provider, prompt, extra) => wfRunner.ask(provider, prompt, extra),
  toast, log,
  defaultKind: g().genType === 'video' ? 'video' : 'image',
  defaultProvider: PROVIDERS[g().provider]?.kind === 'chat' ? g().provider : 'chatgpt',
  onInsert: (prompts, kind) => {
    const s = g();
    if (s.provider === 'flow' && kind) s.genType = kind;
    s.split = 'blank';
    s.text = [s.text.trim(), ...prompts].filter(Boolean).join('\n\n');
    s.multi = true;
    saveGen(); renderGen(); showTab('gen');
    toast(`Đã đưa ${prompts.length} prompt vào Gen`);
  }
}));

// ---------- Prompt từ ảnh (module image-prompt.js; ảnh đến từ menu chuột phải qua background) ----------
function showImagePrompt(image) {
  openImagePrompt({
    image, toast, log,
    ask: (provider, prompt, extra) => wfRunner.ask(provider, prompt, extra),
    onInsert: (prompt, kind, refImage) => {
      const s = g();
      if (s.provider === 'flow' && kind) s.genType = kind;
      s.split = 'blank';
      s.text = [s.text.trim(), prompt].filter(Boolean).join('\n\n');
      if (refImage) s.refIds.push(store.addRef({ name: `anh_${Date.now()}.png`, mime: 'image/png', dataUrl: refImage }));
      saveGen(); renderGen(); showTab('gen');
      toast(refImage ? 'Đã đưa prompt và ảnh tham chiếu vào Gen' : 'Đã đưa prompt vào Gen');
    }
  });
}
$('btn-image-prompt').addEventListener('click', (e) => {
  // Shift+bấm: chỉ mở lịch sử.
  if (e.shiftKey) { showImagePrompt(null); return; }
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
  input.addEventListener('change', async () => { if (input.files[0]) showImagePrompt(await readFile(input.files[0])); });
  input.click();
});
async function takeImageIntent() {
  const { aflImageIntent: it } = await chrome.storage.session.get('aflImageIntent');
  if (!it) return;
  await chrome.storage.session.remove('aflImageIntent');
  if (Date.now() - it.at > 120000 || !it.dataUrl) return;
  if (it.action === 'ref') {
    g().refIds.push(store.addRef({ name: `anh_${Date.now()}.png`, mime: it.dataUrl.slice(5, it.dataUrl.indexOf(';')) || 'image/png', dataUrl: it.dataUrl }));
    saveGen(); renderRefs(); showTab('gen');
    toast('Đã thêm ảnh tham chiếu');
  } else if (it.action === 'album') {
    showTab('photos'); showPhotosSub('albums');
    await openAddToAlbum({ images: [{ name: `anh_${Date.now()}.png`, mime: it.dataUrl.slice(5, it.dataUrl.indexOf(';')) || 'image/png', dataUrl: it.dataUrl }], toast });
  } else {
    showImagePrompt(it.dataUrl);
  }
}
chrome.runtime.onMessage.addListener((msg) => { if (msg?.type === 'afl:imageIntent') takeImageIntent(); });

// ---------- Workflow ----------
let wfSub = 'templates';
const STATE_LABEL = { pending: 'chờ', running: 'đang chạy', done: 'xong', error: 'lỗi', skipped: 'bỏ qua' };
const vizHtml = (n) => `<div class="nodes-viz">${Array.from({ length: Math.min(5, Math.max(2, n)) }, (_, i) => `${i ? '<b></b>' : ''}<i></i>`).join('')}</div>`;

// Hộp nhập tên (dùng chung).
function askText(title, value, okLabel = 'Tạo') {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `<div class="dlg-head"><b>${esc(title)}</b></div><input type="text" value="${esc(value)}" style="margin:10px 0">
      <div class="btn-row"><button class="btn" data-x>Huỷ</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`;
    document.body.appendChild(d);
    const input = d.querySelector('input');
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.querySelector('[data-x]').onclick = () => done(null);
    d.querySelector('[data-ok]').onclick = () => done(input.value.trim() || value);
    input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value.trim() || value); };
    d.addEventListener('cancel', () => done(null));
    d.showModal();
    input.select();
  });
}

function renderWorkflows() {
  const q = $('wf-search').value.trim().toLowerCase();
  const cat = $('wf-cat').value;
  document.querySelectorAll('#wf-subtabs [data-sub]').forEach((b) => b.classList.toggle('active', b.dataset.sub === wfSub));
  $('wf-templates').hidden = wfSub !== 'templates';
  $('wf-list').hidden = wfSub !== 'workflows';
  $('wf-mine').hidden = wfSub !== 'mine';
  const cats = [...new Set(TEMPLATES.map((t) => t.category))];
  if ($('wf-cat').options.length !== cats.length + 1) $('wf-cat').innerHTML = `<option value="">Tất cả</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}`;
  $('wf-cat').hidden = wfSub !== 'templates';
  $('wf-run-all').hidden = wfSub !== 'workflows';
  let empty = '';
  if (wfSub === 'templates') {
    const list = TEMPLATES.filter((t) => (!cat || t.category === cat) && (!q || `${t.name} ${t.desc}`.toLowerCase().includes(q)));
    $('wf-templates').innerHTML = list.map((t) => {
      const count = t.make().nodes.length;
      return `<div class="tpl" data-tpl="${t.id}"><div class="cover" style="background:linear-gradient(135deg, ${t.color}55, #1b1b1b)">${vizHtml(count)}<button class="use" data-use="${t.id}">✦ Dùng mẫu</button></div>
        <div class="meta2"><b>${esc(t.name)}</b><span>${esc(t.category)} · ${count} nodes</span><p>${esc(t.desc)}</p></div></div>`;
    }).join('');
    if (!list.length) empty = 'Không có template phù hợp.';
  } else if (wfSub === 'workflows') {
    const list = store.workflows.filter((w) => !w.isTemplate && (!q || w.name.toLowerCase().includes(q)));
    $('wf-list').innerHTML = list.map((w) => {
      const n = (w.nodes || []).filter((x) => x.type !== 'note').length;
      const running = wfRunner.state?.running && wfRunner.state.workflowId === w.id;
      return `<div class="wf-row" data-id="${w.id}"><div class="body"><b>${esc(w.name)}</b><div class="muted">${n} node · ${running ? 'đang chạy…' : `sửa ${new Date(w.updatedAt).toLocaleString()}`}</div></div>
        <button class="icon-btn small" data-act="run" title="${running ? 'Dừng' : 'Chạy'}">${icon(running ? 'stop' : 'play')}</button>
        <button class="icon-btn small" data-act="edit" title="Mở trình soạn">${icon('edit')}</button>
        <button class="mini-tog ${w.enabled !== false ? 'on' : ''}" data-act="toggle" title="Bật/tắt"></button>
        <button class="icon-btn small" data-act="more" title="Thêm">⋮</button></div>`;
    }).join('');
    if (!list.length) empty = 'Chưa có workflow. Bấm "Tạo" để tạo mới, hoặc vào Templates để dùng mẫu.';
  } else {
    const list = store.workflows.filter((w) => w.isTemplate && (!q || w.name.toLowerCase().includes(q)));
    $('wf-mine').innerHTML = list.map((w) => `<div class="tpl" data-mine="${w.id}"><div class="cover" style="background:linear-gradient(135deg,#c6f43255,#1b1b1b)">${vizHtml((w.nodes || []).length)}<button class="use" data-use-mine="${w.id}">✦ Dùng mẫu</button></div>
      <div class="meta2"><b>${esc(w.name)}</b><span>${(w.nodes || []).length} nodes</span><p><a href="#" data-del-mine="${w.id}" style="color:var(--danger)">Xoá mẫu</a></p></div></div>`).join('');
    if (!list.length) empty = 'Chưa có mẫu riêng. Trong danh sách Workflows, bấm ⋮ → "Lưu làm mẫu".';
  }
  $('wf-empty').hidden = !empty;
  $('wf-empty').textContent = empty;
}

function renderWorkflowRun() {
  const st = wfRunner.state;
  const box = $('wf-run');
  if (!st) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="row-head" style="margin:0"><b>${esc(st.name)}</b><span class="muted">${st.running ? 'đang chạy' : 'đã kết thúc'}</span>
      ${st.running ? `<button class="btn danger" id="wf-stop" style="flex:none;padding:4px 10px">${icon('stop')}Dừng</button>` : ''}</div>
    ${Object.values(st.nodes).map((n) => `<div class="node"><span>${esc(n.title)}</span><span class="s ${n.status}" title="${esc(n.error || '')}">${STATE_LABEL[n.status] || n.status}${n.status === 'running' && n.total ? ` ${n.done || 0}/${n.total}` : ''}${n.status === 'done' ? ` · ${n.count}` : ''}</span></div>`).join('')}
    ${st.errors?.length ? `<div class="err">${esc(st.errors.slice(0, 3).join('; '))}</div>` : ''}`;
  box.querySelector('#wf-stop')?.addEventListener('click', () => wfRunner.cancel());
  chrome.runtime.sendMessage({ type: 'afl:workflowState', state: st }).catch(() => {});
  if (wfSub === 'workflows') renderWorkflows();
}

async function saveWorkflows() { await chrome.storage.local.set({ aflWorkflows: store.workflows }); }

// Trình soạn mở trong cửa sổ popup riêng (như bản gốc).
async function openEditor(id) {
  const url = chrome.runtime.getURL(`sidepanel/workflow.html?id=${id}`);
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('sidepanel/workflow.html*') });
  const open = tabs.find((t) => t.url.includes(`id=${id}`));
  if (open) { await chrome.windows.update(open.windowId, { focused: true }); return; }
  const w = Math.min(1500, screen.availWidth - 80), h = Math.min(950, screen.availHeight - 80);
  await chrome.windows.create({ url, type: 'popup', width: w, height: h, left: Math.round((screen.availWidth - w) / 2), top: Math.round((screen.availHeight - h) / 2) });
}

let wfDone = Promise.resolve();
// Lượt chạy chờ tới lượt (bấm chạy node khi đang có lượt khác): chạy lần lượt, kết quả cũ vẫn hiển thị.
const wfQueue = [];
let wfBusy = false;
function broadcastQueue() {
  chrome.runtime.sendMessage({ type: 'afl:workflowQueue', queue: wfQueue }).catch(() => {});
}
async function runNextQueued() {
  const next = wfQueue.shift();
  broadcastQueue();
  if (!next) return;
  // Đọc lại workflow lúc tới lượt (người dùng có thể đã sửa trong lúc chờ).
  const { aflWorkflows = [] } = await chrome.storage.local.get('aflWorkflows');
  store.workflows = aflWorkflows;
  runWorkflow(next.id, next.only).catch((e) => { log(`Workflow lỗi: ${e.message}`, 'error'); runNextQueued(); });
}
async function runWorkflow(id, only) {
  const raw = store.workflows.find((x) => x.id === id);
  if (!raw) throw new Error('Không tìm thấy workflow');
  const w = normalizeWorkflow(raw);
  if (w.enabled === false) throw new Error('Workflow đang tắt');
  // wfBusy bật ngay khi bắt đầu (trước khi bộ chạy kịp đặt state.running) để lệnh chạy liền sau vào hàng đợi.
  if (wfBusy || wfRunner.state?.running) {
    wfQueue.push({ id, only: only?.length ? only : null });
    broadcastQueue();
    log(`Workflow "${w.name}": đã vào hàng đợi (${wfQueue.length}), sẽ tự chạy khi tới lượt`);
    return { queued: wfQueue.length };
  }
  showTab('workflow');
  wfBusy = true;
  wfDone = wfRunner.run(w, { only }).then(async () => {
    // Lưu kết quả để trình soạn hiển thị lại khi mở.
    const { aflWorkflows = [] } = await chrome.storage.local.get('aflWorkflows');
    const cur = aflWorkflows.find((x) => x.id === id);
    if (cur && wfRunner.state) {
      cur.results = { ...(cur.results || {}) };
      for (const [nodeId, s] of Object.entries(wfRunner.state.nodes)) {
        cur.results[nodeId] = { status: s.status, count: s.count, error: s.error || '', preview: s.preview || [], info: s.info || null, startedAt: s.startedAt || 0, finishedAt: s.finishedAt || 0, ...(s.sig ? { sig: s.sig } : {}) };
        // Node List giữ các mục vừa nhận để sửa tay và chạy lại các node phía sau.
        const node = s.listItems && cur.nodes?.find((n) => n.id === nodeId);
        if (node) Object.assign(node.data, { items: s.listItems, ...(s.listKind ? { kind: s.listKind } : {}) });
      }
      const today = new Date().toISOString().slice(0, 10);
      cur.runs = { date: today, count: (cur.runs?.date === today ? cur.runs.count : 0) + 1 };
      store.workflows = aflWorkflows;
      await saveWorkflows();
    }
  }).catch((e) => { log(`Workflow lỗi: ${e.message}`, 'error'); toast(e.message); })
    .finally(() => { wfBusy = false; if (!wfRunner.state?.running) runNextQueued(); });
  return { queued: 0 };
}

async function useTemplateWorkflow(wf) {
  const name = await askText('Tên workflow', wf.name, 'Tạo');
  if (!name) return;
  Object.assign(wf, { id: `wf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, isTemplate: false, results: {}, runs: null, updatedAt: Date.now() });
  store.workflows.unshift(wf);
  await saveWorkflows();
  wfSub = 'workflows';
  renderWorkflows();
  openEditor(wf.id);
}

document.querySelectorAll('#wf-subtabs [data-sub]').forEach((b) => b.addEventListener('click', () => { wfSub = b.dataset.sub; renderWorkflows(); }));
$('wf-search').addEventListener('input', renderWorkflows);
$('wf-cat').addEventListener('change', renderWorkflows);
// Chạy tất cả: đưa mọi workflow đang bật vào hàng đợi, chạy lần lượt.
$('wf-run-all').addEventListener('click', async () => {
  const list = store.workflows.filter((w) => w.enabled !== false && (w.nodes || []).length);
  if (!list.length) { toast('Không có workflow nào đang bật'); return; }
  for (const w of list) await runWorkflow(w.id).catch((e) => log(`Workflow "${w.name}": ${e.message}`, 'error'));
  toast(`Đã đưa ${list.length} workflow vào hàng chạy`);
});
$('wf-new').addEventListener('click', async () => {
  const d = new Date();
  const name = await askText('Tên workflow mới', `Workflow mới - ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`, 'Tạo');
  if (!name) return;
  const w = newWorkflow(name);
  store.workflows.unshift(w);
  await saveWorkflows();
  wfSub = 'workflows';
  renderWorkflows();
  openEditor(w.id);
});
$('wf-templates').addEventListener('click', (e) => {
  const id = e.target.closest('[data-use]')?.dataset.use || e.target.closest('[data-tpl]')?.dataset.tpl;
  if (id) useTemplateWorkflow(instantiateTemplate(id));
});
$('wf-mine').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del-mine]');
  if (del) {
    e.preventDefault();
    store.workflows = store.workflows.filter((w) => w.id !== del.dataset.delMine);
    await saveWorkflows();
    renderWorkflows();
    return;
  }
  const id = e.target.closest('[data-use-mine]')?.dataset.useMine || e.target.closest('[data-mine]')?.dataset.mine;
  const src = store.workflows.find((w) => w.id === id);
  if (src) useTemplateWorkflow(structuredClone(src));
});

function closePop() { document.querySelectorAll('.pop-menu').forEach((m) => m.remove()); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('.pop-menu')) closePop(); });
$('wf-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  const row = e.target.closest('[data-id]');
  const w = row && store.workflows.find((x) => x.id === row.dataset.id);
  if (!w) return;
  if (!btn) { openEditor(w.id); return; }
  const act = btn.dataset.act;
  if (act === 'run') {
    if (wfRunner.state?.running && wfRunner.state.workflowId === w.id) wfRunner.cancel();
    else runWorkflow(w.id).catch((err) => toast(err.message));
  }
  if (act === 'edit') openEditor(w.id);
  if (act === 'toggle') { w.enabled = w.enabled === false; await saveWorkflows(); renderWorkflows(); }
  if (act === 'more') {
    closePop();
    const m = document.createElement('div');
    m.className = 'pop-menu';
    m.innerHTML = `<button data-m="dup">${icon('copy')}Nhân bản</button><button data-m="rename">${icon('edit')}Đổi tên</button>
      <button data-m="tpl">${icon('book')}Lưu làm mẫu</button><button data-m="export">${icon('download')}Xuất .json</button>
      <button data-m="del" class="danger">${icon('trash')}Xoá</button>`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.left = `${Math.min(r.left - 140, innerWidth - 180)}px`;
    m.style.top = `${r.bottom + 4}px`;
    m.addEventListener('click', async (ev) => {
      const k = ev.target.closest('[data-m]')?.dataset.m;
      if (!k) return;
      closePop();
      if (k === 'dup') { store.workflows.unshift({ ...structuredClone(w), id: `wf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: `${w.name} (bản sao)`, results: {}, runs: null, updatedAt: Date.now() }); }
      if (k === 'rename') { const name = await askText('Đổi tên workflow', w.name, 'Lưu'); if (name) w.name = name; }
      if (k === 'tpl') { store.workflows.push({ ...structuredClone(w), id: `wf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, isTemplate: true, results: {}, runs: null }); toast('Đã lưu vào "Mẫu của tôi"'); }
      if (k === 'export') {
        const url = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify({ format: 'autoflow-workflow', version: 1, name: w.name, nodes: w.nodes, edges: w.edges }, null, 2))}`;
        chrome.runtime.sendMessage({ type: 'afl:download', url, filename: `${store.settings.folder || 'AutoFlow'}/${w.name.replace(/[\\/:*?"<>|]+/g, '_')}.workflow.json` });
      }
      if (k === 'del' && confirm(`Xoá workflow "${w.name}"?`)) store.workflows = store.workflows.filter((x) => x !== w);
      await saveWorkflows();
      renderWorkflows();
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'afl:getWorkflowState') { sendResponse({ ok: true, state: wfRunner.state, queue: wfQueue }); return false; }
  // Dừng: huỷ cả các lượt đang chờ.
  if (msg?.type === 'afl:stopWorkflow') { wfQueue.length = 0; broadcastQueue(); wfRunner.cancel(); sendResponse({ ok: true }); return false; }
  if (msg?.type !== 'afl:runWorkflow') return false;
  chrome.storage.local.get('aflWorkflows').then(({ aflWorkflows = [] }) => {
    store.workflows = aflWorkflows;
    renderWorkflows();
    runWorkflow(msg.id, msg.only).then((r) => sendResponse({ ok: true, queued: r?.queued || 0 }), (e) => sendResponse({ ok: false, error: e.message }));
  });
  return true;
});

// Trình soạn workflow (tab khác) lưu trực tiếp vào storage: đồng bộ lại.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.aflWorkflows) { store.workflows = changes.aflWorkflows.newValue || []; renderWorkflows(); }
});


// ---------- Cửa sổ Cài đặt, âm thanh, dọn dữ liệu ----------
async function openSettingsWindow(tab) {
  const url = chrome.runtime.getURL(`sidepanel/settings.html${tab ? `?tab=${tab}` : ''}`);
  const [open] = await chrome.tabs.query({ url: chrome.runtime.getURL('sidepanel/settings.html*') });
  if (open) { await chrome.windows.update(open.windowId, { focused: true }); return; }
  await chrome.windows.create({ url, type: 'popup', width: 600, height: Math.min(1000, screen.availHeight - 60), top: 30, left: Math.max(0, screen.availWidth - 700) });
}
function beep() {
  try {
    const ctx = new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.frequency.value = f;
      gn.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.18);
      gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.18 + 0.16);
      o.connect(gn).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
  } catch (_) { /* không phát được âm thanh */ }
}
runner.onFinish = (summary) => {
  if (store.settings.sound) beep();
  if (store.settings.tgEnabled && store.settings.tgNotify) telegram.send(`✦ AutoFlow chạy xong: ${summary.done} xong, ${summary.failed} lỗi`);
};
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'afl:settingsChanged') {
    chrome.storage.local.get('aflSettings').then(({ aflSettings }) => {
      store.settings = { ...store.settings, ...(aflSettings || {}) };
      renderSettings(); renderGen();
    });
    return false;
  }
  if (msg?.type === 'afl:reload') { location.reload(); return false; }
  if (msg?.type === 'afl:syncFlow') {
    syncFlowOptions().then((r) => sendResponse({ ok: true, ...r }), (e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg?.type === 'afl:clean') {
    if (msg.what === 'queue') { store.tasks = store.tasks.filter((t) => t.status !== 'done'); store.save('tasks', 0); store.gcRefs(); renderTasks(); }
    if (msg.what === 'history') { store.history = []; store.save('history', 0); renderHistory(); }
    if (msg.what === 'refs') store.gcRefs();
    if (msg.what === 'all') { chrome.storage.local.clear().then(() => location.reload()); }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// ---------- Cầu nối MCP: công cụ cho AI Agent ----------
function waitWithTimeout(promise, sec) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r('timeout'), sec * 1000))]);
}
const taskSummary = (t) => ({
  index: t.index, prompt: t.prompt, provider: t.provider || 'flow', status: t.status, error: t.error || undefined,
  files: (t.results || []).map((r) => r.filename).filter(Boolean), urls: (t.results || []).map((r) => r.url), text: t.text || undefined
});
const mcpHandlers = {
  autoflow_status: async () => {
    const c = (st) => store.tasks.filter((t) => t.status === st).length;
    const acc = await checkAll().catch(() => []);
    return {
      queue: { running: c('running'), pending: c('pending'), done: c('done'), error: c('error'), unknown: c('unknown'), active: runner.running, paused: runner.paused },
      accounts: Object.fromEntries(acc.map((a) => [a.provider, a.state])),
      workflows: store.workflows.filter((w) => !w.isTemplate).length,
      workflow_running: wfRunner.state?.running ? wfRunner.state.name : null
    };
  },
  autoflow_generate: async (a) => {
    const prompts = (a.prompts || []).map((p) => String(p).trim()).filter(Boolean);
    if (!prompts.length) throw new Error('prompts trống');
    const provider = a.provider || 'flow';
    const cfg = {
      ...g(), provider, chatMode: 'image', genType: a.type === 'video' ? 'video' : 'image', model: a.model || '', ratio: a.ratio || '',
      quantity: Math.min(4, Math.max(1, a.quantity || 1)), videoMode: a.video_mode || 'text', duration: a.duration || '', resolution: '',
      refIds: [], styleId: '', characters: [], chainPrev: false, autoDownload: true
    };
    const tasks = buildQueueTasks(cfg, { startIndex: nextIndex(), styles: store.styles, rows: prompts.map((prompt) => ({ prompt })) });
    for (const t of tasks) { t.source = 'mcp'; t.folder = store.settings.mcpFolder || 'AutoFlow_mcp'; }
    store.tasks.push(...tasks);
    store.save('tasks');
    renderTasks();
    log(`MCP: thêm ${tasks.length} lượt vào hàng đợi`);
    if (!runner.running) runner.start();
    if (a.wait === false) return { queued: tasks.length, indexes: tasks.map((t) => t.index) };
    const r = await waitWithTimeout(wfRunner.waitTasks(tasks), a.timeout_sec || 1200);
    return { finished: r !== 'timeout', results: tasks.map(taskSummary) };
  },
  autoflow_list_workflows: async () => store.workflows.filter((w) => !w.isTemplate).map((w) => ({ id: w.id, name: w.name, nodes: (w.nodes || []).filter((n) => n.type !== 'note').length, enabled: w.enabled !== false })),
  autoflow_run_workflow: async (a) => {
    const w = store.workflows.find((x) => x.id === a.id) || store.workflows.find((x) => x.name.toLowerCase() === String(a.name || '').toLowerCase());
    if (!w) throw new Error('Không tìm thấy workflow');
    if (wfRunner.state?.running) throw new Error('Đang chạy một workflow khác');
    await runWorkflow(w.id);
    if (a.wait === false) return { started: true, id: w.id };
    const r = await waitWithTimeout(wfDone, a.timeout_sec || 3600);
    const st = wfRunner.state;
    return { finished: r !== 'timeout', name: w.name, nodes: Object.values(st?.nodes || {}).map((n) => ({ node: n.title, status: n.status, count: n.count, error: n.error || undefined })), errors: st?.errors || [] };
  },
  autoflow_create_workflow: async (a) => {
    const wf = newWorkflow(a.name || 'Workflow từ AI');
    const byKey = {};
    (a.nodes || []).forEach((n, i) => {
      const node = createNode(n.type, 80 + (i % 4) * 420, 80 + Math.floor(i / 4) * 520, n.data || {});
      node.data.slug = String(n.key).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      byKey[n.key] = node;
      wf.nodes.push(node);
    });
    for (const e of a.edges || []) {
      const [fk, fp] = String(e.from).split('.'), [tk, tp] = String(e.to).split('.');
      if (!byKey[fk] || !byKey[tk]) throw new Error(`Cạnh trỏ tới node không có: ${e.from} → ${e.to}`);
      wf.edges.push({ id: nid(), from: { node: byKey[fk].id, port: fp }, to: { node: byKey[tk].id, port: tp } });
    }
    store.workflows.unshift(wf);
    await saveWorkflows();
    renderWorkflows();
    if (a.run) await runWorkflow(wf.id);
    return { id: wf.id, name: wf.name, nodes: wf.nodes.length, edges: wf.edges.length, started: !!a.run };
  },
  autoflow_recent_results: async (a) => store.history.slice(0, a.limit || 10).map((h) => ({ prompt: h.prompt, provider: h.provider || 'flow', type: h.genType || '', at: new Date(h.at).toISOString(), files: h.results.map((r) => r.filename).filter(Boolean), text: h.text || undefined }))
};
const mcp = new McpBridge({ getSettings: () => store.settings, handlers: mcpHandlers, log });

// ---------- Bot Telegram ----------
const telegram = new TelegramBot({
  getSettings: () => store.settings,
  saveSettings: async (patch) => { Object.assign(store.settings, patch); store.save('settings', 0); renderSettings(); },
  log,
  onCommand: async (cmd, arg) => {
    if (cmd === '/start' || cmd === '/help') return 'Lệnh AutoFlow:\n/gen <prompt> – tạo ảnh bằng Google Flow\n/video <prompt> – tạo video\n/status – trạng thái hàng đợi\n/stop – dừng hàng đợi';
    if (cmd === '/status') {
      const c = (st) => store.tasks.filter((t) => t.status === st).length;
      return `Hàng đợi: ${c('running')} đang tạo, ${c('pending')} chờ, ${c('done')} xong, ${c('error')} lỗi${c('unknown') ? `, ${c('unknown')} chưa rõ` : ''}${runner.paused ? ' (tạm dừng)' : ''}`;
    }
    if (cmd === '/stop') { runner.stop(); return 'Đã dừng hàng đợi'; }
    if (cmd === '/gen' || cmd === '/video') {
      if (!arg) return `Cách dùng: ${cmd} <prompt>`;
      const cfg = { ...g(), provider: 'flow', genType: cmd === '/video' ? 'video' : 'image', videoMode: 'text', text: arg, multi: false, refIds: [], chainPrev: false, styleId: g().styleId };
      const tasks = buildQueueTasks(cfg, { startIndex: nextIndex(), styles: store.styles, rows: [{ prompt: arg }] });
      tasks.forEach((t) => { t.source = 'telegram'; });
      store.tasks.push(...tasks);
      store.save('tasks');
      renderTasks();
      if (!runner.running) runner.start();
      return `Đã nhận #${tasks[0].index}, đang tạo ${cmd === '/video' ? 'video' : 'ảnh'}…`;
    }
    return 'Không hiểu lệnh. Gửi /help';
  }
});
wfRunner.telegram = telegram; // node Telegram trong workflow
// Gửi kết quả của lệnh Telegram về chat.
runner.onSettled(async (t) => {
  if (t.source !== 'telegram' || !store.settings.tgEnabled) return;
  if (t.status !== 'done') { telegram.send(`#${t.index} lỗi: ${t.error || t.status}`); return; }
  for (const r of t.results || []) {
    try {
      const { dataUrl } = await runner.mediaToDataUrl(t, r);
      await telegram.sendMedia(dataUrl, r.kind, `#${t.index} ${t.prompt.slice(0, 200)}`);
    } catch (e) { telegram.send(`#${t.index}: không gửi được file (${e.message})`); }
  }
});

// ---------- Trạng thái Flow ----------
async function refreshFlowStatus() {
  const pill = $('flow-status');
  const dot = pill.querySelector('.dot');
  const label = pill.querySelector('.label');
  try {
    const tab = await flow.findFlowTab();
    // Dòng project: tên project (tiêu đề tab Flow, bỏ phần " - Flow").
    $('project-name').textContent = tab && /\/project\//.test(tab.url || '') ? (tab.title || '').replace(/\s*[-|–]\s*(Google )?Flow.*$/i, '').trim() || 'Project' : '—';
    if (!tab) { dot.className = 'dot'; label.textContent = 'Mở Flow'; pill.title = 'Chưa mở Google Flow'; return; }
    const p = await flow.ensureContent(tab.id);
    if (p?.editor && p?.submit) { dot.className = 'dot ok'; label.textContent = 'Flow'; pill.title = `Đã kết nối${p.settings?.model ? ' · ' + p.settings.model : ''}`; }
    else if (!p?.inProject) { dot.className = 'dot warn'; label.textContent = 'Chọn project'; pill.title = 'Hãy mở một project trên Flow'; }
    else { dot.className = 'dot err'; label.textContent = 'Flow?'; pill.title = 'Không tìm thấy ô prompt/nút tạo. Xem Cài đặt → Chẩn đoán.'; }
  } catch (_) {
    dot.className = 'dot err'; label.textContent = 'Flow?'; pill.title = 'Không kết nối được, hãy tải lại trang Flow';
  }
}
$('flow-status').addEventListener('click', () => flow.openFlow());
$('status-ver').textContent = `AutoFlow v${chrome.runtime.getManifest().version}`;
$('project-new').addEventListener('click', () => chrome.tabs.create({ url: 'https://flow.google.com/' }));
$('btn-top-capture').addEventListener('click', () => { showTab('gen'); $('ref-capture').click(); });
$('btn-top-image').addEventListener('click', (e) => $('btn-image-prompt').dispatchEvent(new MouseEvent('click', { shiftKey: e.shiftKey })));

// ---------- Lệnh từ bảng nổi / phím tắt ----------
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'afl:control') return;
  if (msg.action === 'togglePause') runner.togglePause();
  if (msg.action === 'stop') runner.stop();
  if (msg.action === 'toggleRun') {
    if (!runner.running) { if (store.tasks.some((t) => t.status === 'pending')) runner.start(); else $('btn-generate').click(); }
    else runner.togglePause();
  }
});

// ---------- Khởi động ----------
function applyGenDefaults() {
  const st = store.settings, gen = g();
  if (st.defProvider && PROVIDERS[st.defProvider]) gen.provider = st.defProvider;
  if (st.flowType && gen.genType !== st.flowType) Object.assign(gen, { genType: st.flowType, model: '', ratio: '', duration: '', resolution: '' });
  if (gen.provider === 'grok') gen.chatMode = 'image';
  saveGen();
}

(async function init() {
  await store.load();
  // Task "đang tạo" từ phiên trước: chưa gửi thì về hàng chờ; đã gửi thì nối lại với tab (không gửi lại).
  const rec = await runner.recover();
  if (rec.requeued) log(`${rec.requeued} task chưa kịp gửi ở phiên trước đã được đưa lại vào hàng chờ`, 'warn');
  if (rec.unknown) log(`${rec.unknown} task đã gửi nhưng không còn theo dõi được: đánh dấu "Chưa rõ", không tự gửi lại`, 'warn');
  if (rec.reattached) {
    log(`Đã nối lại ${rec.reattached} task đang tạo từ phiên trước`, 'ok');
    // Chỉ theo dõi tiếp các task đã gửi; hàng chờ còn lại tạm dừng tới khi người dùng bấm Tiếp tục.
    runner.start();
    if (store.tasks.some((t) => t.status === 'pending')) { runner.pause(); runner.setMessage('Đã nối lại task đang tạo; hàng đợi tạm dừng — bấm Tiếp tục để chạy tiếp', 'warn'); }
  }
  applyGenDefaults();
  renderGen(); renderTasks(); renderRunState(); renderHistory(); renderLibrary(); renderLogs(); renderSettings(); renderFlowInfo(); renderWorkflows(); renderSavedTasks();
  mcp.start();
  telegram.start();
  showTab('gen');
  takeImageIntent();
  refreshFlowStatus();
  setInterval(refreshFlowStatus, 4000);
  setInterval(() => { if (store.tasks.some((t) => t.retryAt > Date.now())) renderTasks(); }, 1000);
  chrome.tabs.onActivated.addListener(refreshFlowStatus);
  chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') refreshFlowStatus(); });
})();

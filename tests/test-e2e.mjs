// E2E: bản sao extension trỏ tới mock Flow + mock chat → thao tác trên side panel → kiểm tra kết quả, file tải về.
// node test-e2e.mjs <extDir> <workDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

const [extDir, workDir] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1) Bản sao extension cho test: Flow → /project/*, ChatGPT → /chat*
const testExt = path.join(workDir, 'ext-test');
fs.rmSync(testExt, { recursive: true, force: true });
fs.cpSync(extDir, testExt, { recursive: true, filter: (src) => !src.includes(`${path.sep}tests`) });
const patch = (file, pairs) => {
  const p = path.join(testExt, file);
  let s = fs.readFileSync(p, 'utf8');
  for (const [a, b] of pairs) { if (!s.includes(a)) throw new Error(`patch miss ${file}: ${a}`); s = s.replaceAll(a, b); }
  fs.writeFileSync(p, s);
};
patch('manifest.json', [['https://flow.google.com/*', 'http://127.0.0.1:8765/project/*'], ['"https://chatgpt.com/*"', '"http://127.0.0.1:8765/chat*"']]);
patch('sidepanel/lib/providers.js', [['https://flow.google.com/*', 'http://127.0.0.1:8765/project/*'], ["'https://chatgpt.com/*'", "'http://127.0.0.1:8765/chat*'"], ["'https://chatgpt.com/'", "'http://127.0.0.1:8765/chat'"]]);
patch('manifest.json', [['https://dreamina.capcut.com/*', 'http://127.0.0.1:8765/dreamina*']]);
patch('sidepanel/lib/providers.js', [["'https://dreamina.capcut.com/*'", "'http://127.0.0.1:8765/dreamina*'"], ["'https://dreamina.capcut.com/ai-tool/generate?type=video'", "'http://127.0.0.1:8765/dreamina'"]]);
patch('background.js', [["'flow.google.com'", "'127.0.0.1:8765'"]]);

const dlDir = path.join(workDir, 'downloads');
fs.rmSync(dlDir, { recursive: true, force: true });
fs.mkdirSync(dlDir, { recursive: true });
const server = spawn(process.execPath, [path.join(here, 'server.mjs'), '8765'], { stdio: 'ignore' });
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpe2e-'));
fs.mkdirSync(path.join(prof, 'Default'), { recursive: true });
// Như khi người dùng bấm "Cho phép tải nhiều file" trên Flow.
fs.writeFileSync(path.join(prof, 'Default', 'Preferences'), JSON.stringify({
  download: { default_directory: dlDir, prompt_for_download: false },
  profile: { content_settings: { exceptions: { automatic_downloads: { 'http://127.0.0.1:8765,*': { setting: 1 } } } } }
}));
const port = 9500 + Math.floor(Math.random() * 400);
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [`--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--headless=new',
  `--disable-extensions-except=${testExt}`, `--load-extension=${testExt}`, '--disable-features=DisableLoadExtensionCommandLineSwitch', '--window-size=1200,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });

let targets = [];
for (let i = 0; i < 40; i++) { await sleep(500); try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.url.endsWith('/background.js'))) break; } catch {} }
const extId = new URL(targets.find((t) => t.url.endsWith('/background.js')).url).host;

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
  let seq = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
  return { ws, send, ev };
}
const newTab = async (url) => (await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json());
const files = () => { const out = []; const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(path.join(d, f.name)) : out.push(path.relative(dlDir, path.join(d, f.name)).replace(/\\/g, '/')); }; walk(dlDir); return out; };

let pass = 0, fail = 0;
const check = (name, cond, detail) => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 3000) : ''}`); };

try {
  const flowTab = await newTab('http://127.0.0.1:8765/project/0b6f4c1e-1111-4222-8333-944455556666');
  const flowPage = await connect(flowTab.webSocketDebuggerUrl);
  await flowPage.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  for (let i = 0; i < 40 && !(await flowPage.ev('!!document.querySelector("[data-slate-editor]")').catch(() => false)); i++) await sleep(500);
  await sleep(1500);

  const panelTab = await newTab(`chrome-extension://${extId}/sidepanel/index.html`);
  const panel = await connect(panelTab.webSocketDebuggerUrl);
  await sleep(2500);
  await fetch(`http://127.0.0.1:${port}/json/activate/${flowTab.id}`);
  await sleep(4500);
  const P = (js) => panel.ev(js);
  const tasks = () => P(`(async()=>{const d=await chrome.storage.local.get('aflTasks');return d.aflTasks||[]})()`);
  async function waitTasks(n, timeout = 90000) {
    const t0 = Date.now(); let list = [];
    while (Date.now() - t0 < timeout) { await sleep(1500); list = await tasks(); if (list.length >= n && list.every((t) => ['done', 'error', 'cancelled'].includes(t.status))) break; }
    return list;
  }
  const setVal = (id, v) => `(()=>{const e=document.getElementById('${id}');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));})()`;
  const setSetting = (k, v) => `(()=>{const e=document.querySelector('[data-setting=${k}]');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('change'));})()`;

  await P(`(async()=>{const {store,PLATFORM_DEFAULTS}=await import('./lib/store.js');for(const k of Object.keys(PLATFORM_DEFAULTS))store.settings[k]=typeof PLATFORM_DEFAULTS[k]==='boolean'?false:'';store.settings.grokMode='image';store.settings.confirmRun=false;await chrome.storage.local.set({aflSettings:store.settings});return 1})()`);
  const pill = await P(`document.querySelector('#flow-status .label').textContent + '|' + document.querySelector('#flow-status').title`);
  check('side panel nhận diện tab Flow', /^Flow\|Đã kết nối/.test(pill), pill);

  // ---- Đồng bộ model + nhân vật ----
  await P(`document.getElementById('btn-sync').click()`);
  await sleep(14000);
  const synced = await P(`(async()=>{const d=await chrome.storage.local.get(['aflComponents']);return {models:[...document.getElementById('gen-model').options].map(o=>o.value).filter(Boolean), comp:d.aflComponents}})()`);
  check('đồng bộ model vào dropdown', synced.models.join('|') === '🍌 Nano Banana Pro|Nano Banana 2|Imagen 4', synced.models);
  check('đồng bộ nhân vật/giọng', synced.comp?.characters?.length === 17 && synced.comp?.voices?.length === 2, synced.comp);

  // ---- Gợi ý @mention ----
  await P(`(()=>{const t=document.getElementById('gen-text');t.focus();t.value='a cat @char:Mè';t.setSelectionRange(t.value.length,t.value.length);t.dispatchEvent(new Event('input'));})()`);
  const menuItems = await P(`[...document.querySelectorAll('#mention-menu button')].map(b=>b.textContent)`);
  check('gợi ý @mention khi gõ', menuItems.length === 1 && /Mèo Cam/.test(menuItems[0]), menuItems);
  await P(`document.getElementById('gen-text').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  const afterMention = await P(`document.getElementById('gen-text').value`);
  check('chèn @mention dạng [tên có dấu cách]', afterMention === 'a cat @char:[Mèo Cam] ', afterMention);

  // ---- 2 prompt ảnh + nhân vật, tải upscale 2K qua menu Flow ----
  await P(setSetting('delayMin', '0')); await P(setSetting('delayMax', '1')); await P(setSetting('dlImageRes', '2k'));
  await P(setVal('gen-text', '@char:[Mèo Cam] a cozy cabin at night\n\na lighthouse in fog'));
  await P(setVal('gen-model', 'Nano Banana 2')); await P(setVal('gen-ratio', '1:1'));
  await P(`document.getElementById('qty-inc').click(); document.getElementById('btn-generate').click()`);
  let list = await waitTasks(2);
  check('2 task Flow chạy xong', list.length === 2 && list.every((t) => t.status === 'done'), list.map((t) => ({ s: t.status, e: t.error, r: t.results?.length })));
  const subs = await flowPage.ev('window.mock.submits');
  check('Flow nhận prompt đã bỏ @mention + nhân vật được chọn', subs[0]?.text === 'a cozy cabin at night' && subs[0].chars.join() === 'Mèo Cam' && subs[1]?.chars.length === 0, subs.map((s) => ({ t: s.text, c: s.chars })));
  check('Flow nhận đúng cài đặt', subs.every((s) => s.mode === 'IMAGE' && s.model === 'Nano Banana 2' && s.ratio === 'SQUARE' && s.qty === 2), subs);
  await sleep(2500);
  const dlsMenu = await flowPage.ev('window.mock.downloads.map(d=>d.res)');
  check('tải bằng menu Flow "Upscaled (2K)" cho 4 ảnh', dlsMenu.length === 4 && dlsMenu.every((r) => r === 'Upscaled (2K)'), dlsMenu);
  const f1 = files();
  check('file upscale được đổi tên theo mẫu', f1.filter((f) => /AutoFlow\/\d{4}-\d\d-\d\d\/00[12]_.+_[12]\.png$/.test(f)).length === 4, f1);
  check('task ghi nhận độ phân giải 2k', list.every((t) => t.results.every((r) => r.downloaded && r.resolution === '2k')), list.map((t) => t.results.map((r) => r.resolution)));

  // ---- Tab Ảnh: liệt kê ảnh trong project Flow, chọn làm tham chiếu ----
  await P(`document.querySelector('[data-tab=photos]').click()`);
  let phCount = 0;
  for (let i = 0; i < 20 && !phCount; i++) { await sleep(1000); phCount = await P(`document.querySelectorAll('#ph-grid .ph-item').length`); }
  const phInfo = await P(`({ n: document.querySelectorAll('#ph-grid .ph-item').length, thumbs: document.querySelectorAll('#ph-grid .ph-item img').length })`);
  check('Tab Ảnh: liệt kê 4 ảnh của project kèm thumbnail', phInfo.n === 4 && phInfo.thumbs === 4, phInfo);
  await P(`(()=>{const s=document.getElementById('ph-search');s.value='lighthouse';s.dispatchEvent(new Event('input'));})()`);
  const phFiltered = await P(`document.querySelectorAll('#ph-grid .ph-item').length`);
  check('Tab Ảnh: tìm theo prompt', phFiltered === 2, phFiltered);
  const refsBeforePh = await P(`(async()=>{const {store}=await import('./lib/store.js');return store.gen.refIds.length})()`);
  await P(`(()=>{document.querySelector('#ph-grid .ph-item').click();document.querySelector('#ph-bar [data-ph=ref]').click();})()`);
  await sleep(2500);
  const refsAfterPh = await P(`(async()=>{const {store}=await import('./lib/store.js');const ids=store.gen.refIds;const r=ids.length;store.gen.refIds=[];store.save('gen',0);return r})()`);
  check('Tab Ảnh: "Làm tham chiếu" thêm ảnh vào Gen', refsAfterPh === refsBeforePh + 1, { refsBeforePh, refsAfterPh });
  await P(`(()=>{const s=document.getElementById('ph-search');s.value='';s.dispatchEvent(new Event('input'));document.querySelector('[data-tab=gen]').click();})()`);

  // ---- ChatGPT: tạo ảnh ----
  await P(setSetting('dlImageRes', 'original'));
  await P(`document.querySelector('[data-provider=chatgpt]').click()`);
  const chatUi = await P(`({flowHidden: document.getElementById('flow-controls').hidden, chatShown: !document.getElementById('chat-controls').hidden})`);
  check('chọn ChatGPT: đổi sang điều khiển chat', chatUi.flowHidden && chatUi.chatShown, chatUi);
  await P(setVal('gen-text', 'Draw a red apple on a table'));
  await P(`document.getElementById('btn-generate').click()`);
  list = await waitTasks(3, 120000);
  const chatTask = list[2];
  check('task ChatGPT tạo ảnh xong + tải ảnh', chatTask?.status === 'done' && chatTask.results?.length === 1 && chatTask.results[0].downloaded, chatTask);
  const chatTabs = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.url.includes('/chat'));
  const chatPage = chatTabs.length ? await connect(chatTabs[0].webSocketDebuggerUrl) : null;
  const sent = chatPage ? await chatPage.ev('window.chatMock.sent') : [];
  check('trang chat nhận đúng prompt (tự mở tab chat)', sent.at(-1)?.text === 'Draw a red apple on a table', sent);

  // ---- ChatGPT: văn bản bị từ chối → lỗi chính sách (không thử lại vì đây là trả lời văn bản? kiểm tra ảnh) ----
  await P(setVal('gen-text', 'Please refuse to make this picture'));
  await P(`document.getElementById('btn-generate').click()`);
  list = await waitTasks(4, 150000);
  check('ChatGPT từ chối tạo ảnh → lỗi chính sách', list[3]?.status === 'error' && /chính sách/i.test(list[3].error), list[3]);

  // ---- Trợ lý prompt (quy trình 3 bước: biểu mẫu → xác nhận Ready → kết quả) ----
  await P(`(()=>{document.querySelector('[data-provider=flow]').click();const t=document.getElementById('gen-text');t.value='';t.dispatchEvent(new Event('input'));document.getElementById('btn-assistant').click();})()`);
  await sleep(3000);
  const provBadge = await P(`document.querySelector('dialog.assistant .as-prov.active')?.innerText || ''`);
  check('Trợ lý: ChatGPT hiện trạng thái Ready', /Ready/.test(provBadge), provBadge);
  await P(`(()=>{const d=document.querySelector('dialog.assistant');const ta=d.querySelector('[data-o=content]');ta.value='Câu chuyện quảng cáo cà phê';ta.dispatchEvent(new Event('input',{bubbles:true}));
    d.querySelector('[data-cat=Education]').click();})()`);
  await sleep(200);
  await P(`(()=>{const d=document.querySelector('dialog.assistant');d.querySelector('[data-style=econ]').click();const c=d.querySelector('[data-o=count]');c.value='4';c.dispatchEvent(new Event('input',{bubbles:true}));c.dispatchEvent(new Event('change',{bubbles:true}));d.querySelector('[data-go]').click();})()`);
  await sleep(1500);
  const confirmTxt = await P(`document.querySelector('.as-confirm')?.innerText || ''`);
  check('Trợ lý: hộp xác nhận "Tạo prompt với ChatGPT"', /Tạo prompt với ChatGPT/.test(confirmTxt) && /Ready/.test(confirmTxt), confirmTxt.slice(0, 200));
  await P(`document.querySelector('.as-confirm [data-yes]').click()`);
  let asItems = 0;
  for (let i = 0; i < 40 && asItems < 4; i++) { await sleep(1500); asItems = await P(`document.querySelectorAll('dialog.assistant .as-item').length`); }
  check('Trợ lý: hiện 4 prompt có tiêu đề + lời thoại', asItems === 4 && /Cảnh 1/.test(await P(`document.querySelector('.as-item').innerText`)), asItems);
  const sentReq = chatPage ? (await chatPage.ev('window.chatMock.sent')).slice(-1)[0]?.text || '' : '';
  check('Trợ lý: yêu cầu gửi AI có phong cách + số lượng', /exactly 4 scenes/.test(sentReq) && /explainer illustration/.test(sentReq), sentReq.slice(0, 160));
  await P(`document.querySelector('dialog.assistant [data-insert]').click()`);
  await sleep(500);
  const assistantText = await P(`document.getElementById('gen-text').value`);
  const parts = assistantText.split(/\n\s*\n/).filter(Boolean);
  check('Trợ lý: "Đưa vào AutoFlow" chèn 4 prompt cách nhau dòng trống', parts.length === 4 && parts.every((p) => /^Scene \d: a cinematic shot/.test(p)), parts);

  // ---- Prompt từ ảnh: background giao ảnh (như menu chuột phải) → side panel hỏi ChatGPT kèm ảnh → Đưa vào Gen ----
  const bgTarget = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.url.endsWith('/background.js'));
  const bg = await connect(bgTarget.webSocketDebuggerUrl);
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC';
  await P(`(()=>{const t=document.getElementById('gen-text');t.value='';t.dispatchEvent(new Event('input'));})()`);
  await bg.ev(`deliverImage('analyze', ${JSON.stringify(tinyPng)}, { url: 'https://example.com/' }).then(() => 1)`);
  await sleep(2500);
  const ipOpen = await P(`!!document.querySelector('dialog.image-prompt[open] .ip-image img')`);
  check('Prompt từ ảnh: side panel mở hộp thoại với ảnh nhận từ menu chuột phải', ipOpen, ipOpen);
  await P(`(()=>{const d=document.querySelector('dialog.image-prompt');d.querySelector('[data-set=lang][data-val=vi]').click();d.querySelector('[data-go]').click();})()`);
  let ipResult = '';
  for (let i = 0; i < 40 && !ipResult; i++) { await sleep(1500); ipResult = await P(`document.querySelector('dialog.image-prompt [data-insert]') ? document.querySelector('dialog.image-prompt [data-o=result]').value : ''`); }
  const ipSent = chatPage ? (await chatPage.ev('window.chatMock.sent')).slice(-1)[0] : null;
  check('Prompt từ ảnh: gửi ChatGPT yêu cầu tiếng Việt kèm 1 ảnh', /attached image/.test(ipSent?.text || '') && /Vietnamese/.test(ipSent.text) && ipSent.attachments === 1, ipSent);
  check('Prompt từ ảnh: hiện prompt AI trả về', /^Here is my answer about/.test(ipResult), ipResult.slice(0, 120));
  await P(`document.querySelector('dialog.image-prompt [data-insert-ref]').click()`);
  await sleep(600);
  const ipGen = await P(`(async()=>{const {store}=await import('./lib/store.js');return {text:document.getElementById('gen-text').value, refs:store.gen.refIds.length, hist:((await chrome.storage.local.get('aflImagePrompts')).aflImagePrompts||[]).length}})()`);
  check('Prompt từ ảnh: Đưa vào Gen kèm ảnh tham chiếu + lưu lịch sử', /^Here is my answer about/.test(ipGen.text) && ipGen.refs >= 1 && ipGen.hist === 1, ipGen);
  await P(`(async()=>{const {store}=await import('./lib/store.js');store.gen.refIds=[];store.save('gen',0);const t=document.getElementById('gen-text');t.value='';t.dispatchEvent(new Event('input'));return 1})()`);
  await bg.ev(`deliverImage('ref', ${JSON.stringify(tinyPng)}, { url: 'https://example.com/' }).then(() => 1)`);
  await sleep(1500);
  const refOnly = await P(`(async()=>{const {store}=await import('./lib/store.js');return store.gen.refIds.length})()`);
  check('Menu "Thêm làm ảnh tham chiếu": thêm ảnh vào Gen', refOnly === 1, refOnly);
  await P(`(async()=>{const {store}=await import('./lib/store.js');store.gen.refIds=[];store.save('gen',0);return 1})()`);

  // ---- Tab Ảnh → Album: tạo album, trùng tên, thêm ảnh từ menu chuột phải, dùng làm tham chiếu ----
  await P(`(()=>{document.querySelector('[data-tab=photos]').click();document.querySelector('#ph-subtabs [data-sub=albums]').click();return 1})()`);
  await sleep(400);
  const albumEmpty = await P(`!document.getElementById('ph-albums').hidden && document.getElementById('ph-flow').hidden && /Chưa có album/.test(document.getElementById('ph-albums').textContent)`);
  check('Album: tab con Album hiện, trống lúc đầu', albumEmpty, albumEmpty);
  const mkAlbum = (name) => P(`(async()=>{document.querySelector('#ph-albums [data-act=new]').click();await new Promise(r=>setTimeout(r,200));
    const d=document.querySelector('dialog.album-modal[open]');d.querySelector('[data-name]').value=${JSON.stringify(name)};d.querySelector('[data-ok]').click();
    await new Promise(r=>setTimeout(r,400));const still=document.querySelector('dialog.album-modal[open]');const err=still?.querySelector('[data-err]')?.textContent||'';still?.close();return err})()`);
  const mk1 = await mkAlbum('Nhân vật');
  await sleep(300);
  await P(`document.querySelector('#ph-albums [data-act=back]')?.click()`);
  await sleep(300);
  const mk2 = await mkAlbum('nhân vật');
  check('Album: tạo album, tên trùng bị chặn', mk1 === '' && /đã tồn tại/.test(mk2), { mk1, mk2 });
  await bg.ev(`deliverImage('album', ${JSON.stringify(tinyPng)}, { url: 'https://example.com/' }).then(() => 1)`);
  let pickRow = false;
  for (let i = 0; i < 10 && !pickRow; i++) { await sleep(400); pickRow = await P(`!!document.querySelector('dialog.album-modal[open] .album-row')`); }
  await P(`document.querySelector('dialog.album-modal[open] .album-row')?.click()`);
  await sleep(600);
  const albumState = await P(`(async()=>{const a=((await chrome.storage.local.get('aflAlbums')).aflAlbums||[]);return {n:a.length,items:a[0]?.items.length,name:a[0]?.name}})()`);
  check('Menu "Thêm vào album": chọn album, ảnh được lưu', pickRow && albumState.n === 1 && albumState.items === 1 && albumState.name === 'Nhân vật', { pickRow, albumState });
  await P(`(async()=>{document.querySelector('#ph-albums [data-act=back]')?.click();await new Promise(r=>setTimeout(r,300));document.querySelector('#ph-albums [data-open]').click();await new Promise(r=>setTimeout(r,300));document.querySelector('#ph-albums [data-act=ref]').click();return 1})()`);
  await sleep(500);
  const albumRefs = await P(`(async()=>{const {store}=await import('./lib/store.js');return {refs:store.gen.refIds.length,tab:document.querySelector('.tab.active')?.dataset.tab}})()`);
  check('Album: "Làm tham chiếu" đưa ảnh album vào Gen', albumRefs.refs === 1 && albumRefs.tab === 'gen', albumRefs);
  await P(`(async()=>{const {store}=await import('./lib/store.js');store.gen.refIds=[];store.save('gen',0);return 1})()`);

  // ---- Tab Ảnh → Tìm ảnh: chọn kênh mở trang tìm kiếm ở tab mới ----
  await P(`(()=>{document.querySelector('[data-tab=photos]').click();document.querySelector('#ph-subtabs [data-sub=search]').click();
    const q=document.querySelector('#ph-websearch [data-q]');q.value='red sneaker';document.querySelector('#ph-websearch [data-ch=unsplash]').click();return 1})()`);
  let searchTab = null;
  for (let i = 0; i < 10 && !searchTab; i++) { await sleep(500); searchTab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.url.includes('unsplash.com/s/photos/red-sneaker')); }
  check('Tìm ảnh: bấm kênh Unsplash mở trang tìm "red sneaker"', !!searchTab, searchTab?.url);
  if (searchTab) await fetch(`http://127.0.0.1:${port}/json/close/${searchTab.id}`).catch(() => {});
  await P(`(()=>{document.querySelector('#ph-subtabs [data-sub=flow]').click();document.querySelector('[data-tab=gen]').click();return 1})()`);

  // ---- Xác nhận chạy + Gửi tay: AutoFlow điền prompt, chỉ gửi khi người dùng bấm Tạo trên Flow ----
  const tasksBeforeManual = (await tasks()).length;
  await P(`(async()=>{const {store}=await import('./lib/store.js');store.settings.confirmRun=true;store.save('settings',0);
    document.querySelector('[data-provider=flow]').click();document.querySelector('[data-type=image]').click();
    const t=document.getElementById('gen-text');t.value='a manual submit check';t.dispatchEvent(new Event('input'));document.getElementById('btn-generate').click();return 1})()`);
  await sleep(1500);
  const crTxt = await P(`document.querySelector('dialog.confirm-run[open]')?.innerText || ''`);
  check('Xác nhận chạy: hiện tóm tắt (1 prompt, Google Flow, cách chạy / cách gửi)', /Xác nhận chạy/.test(crTxt) && /1 · Single/.test(crTxt) && /Google Flow/.test(crTxt) && /Gửi tay/.test(crTxt), crTxt.slice(0, 300));
  const subsBeforeManual = (await flowPage.ev('window.mock.submits')).length;
  await P(`(()=>{const d=document.querySelector('dialog.confirm-run');d.querySelector('[data-k=submit][data-v=manual]').click();d.querySelector('[data-c=noask]').checked=true;d.querySelector('[data-yes]').click();})()`);
  let filled = '';
  for (let i = 0; i < 30 && !/manual submit check/.test(filled); i++) { await sleep(1000); filled = await flowPage.ev('document.querySelector("[data-slate-editor]")?.textContent || ""'); }
  await sleep(2500);
  const manualState = { filled, subs: (await flowPage.ev('window.mock.submits')).length - subsBeforeManual, banner: await P(`document.getElementById('run-message').textContent`) };
  check('Gửi tay: điền prompt nhưng không tự bấm Tạo, side panel nhắc bấm Tạo', /manual submit check/.test(filled) && manualState.subs === 0 && /bấm Tạo/.test(manualState.banner), manualState);
  await flowPage.ev('document.getElementById("submit").click()');
  list = await waitTasks(tasksBeforeManual + 1);
  const manualTask = list.at(-1);
  const manualSubs = (await flowPage.ev('window.mock.submits')).slice(subsBeforeManual);
  check('Gửi tay: người dùng bấm Tạo → task chạy xong', manualSubs.length === 1 && manualSubs[0].text === 'a manual submit check' && manualTask?.status === 'done', { manualSubs, s: manualTask?.status, e: manualTask?.error });
  const crSaved = await P(`(async()=>{const {store}=await import('./lib/store.js');const r=store.settings.submitMode+'|'+store.settings.confirmRun;store.settings.submitMode='auto';store.save('settings',0);return r})()`);
  check('Xác nhận chạy: lưu cách gửi + "Không hỏi lại"', crSaved === 'manual|false', crSaved);
  list = await tasks();

  // ---- Task đã lưu + phong cách + ref Mention + dùng kết quả trước ----
  await P(`(()=>{document.querySelector('[data-tab=gen]').click();document.querySelector('[data-provider=flow]').click();
    document.querySelector('[data-type=image]').click();
    const t=document.getElementById('gen-text');t.value='a red bicycle @img1\\n\\na blue kite';t.dispatchEvent(new Event('input'));})()`);
  // 2 ảnh tham chiếu (ref Mention: prompt 1 chỉ dùng ảnh 1, prompt 2 không dùng ảnh)
  await P(`(async()=>{const mk=(c)=>{const cv=document.createElement('canvas');cv.width=cv.height=32;const x=cv.getContext('2d');x.fillStyle=c;x.fillRect(0,0,32,32);return cv.toDataURL('image/png');};
    const {store}=await import('./lib/store.js');
    const ids=[store.addRef({name:'a.png',mime:'image/png',dataUrl:mk('#f00')}),store.addRef({name:'b.png',mime:'image/png',dataUrl:mk('#00f')})];
    store.gen.refIds=ids;store.gen.refMode='mention';store.gen.styleId='watercolor';store.gen.chainPrev=true;store.gen.chainMode='last';store.gen.quantity=1;store.save('gen');store.save('refs');return 1})()`);
  const cfgOk = await P(`(async()=>{const {store}=await import('./lib/store.js');return store.gen.refIds.length+'|'+store.gen.refMode})()`);
  check('cấu hình Gen: 2 ảnh ref + Mention', cfgOk === '2|mention', cfgOk);
  // Lưu thành task qua nút + (hộp đặt tên)
  await P(`document.getElementById('btn-add').click()`);
  await sleep(400);
  await P(`(()=>{const d=document.querySelector('dialog[open]');d.querySelector('input').value='Task xe đạp';d.querySelector('[data-ok]').click();})()`);
  await sleep(400);
  await P(`document.querySelector('[data-tab=tasks]').click()`);
  const stCount = await P(`document.querySelectorAll('#st-list .st-card').length`);
  check('lưu cấu hình Gen thành task (tab Tasks)', stCount === 1, stCount);
  const beforeSt = (await flowPage.ev('window.mock.submits')).length;
  await P(`document.getElementById('st-runall').click()`);
  list = await waitTasks(list.length + 2, 150000);
  const stSubs = (await flowPage.ev('window.mock.submits')).slice(beforeSt);
  check('chạy task đã lưu: 2 prompt gửi tới Flow', stSubs.length === 2, stSubs.map((s) => s.text));
  check('phong cách được nối vào prompt', stSubs.every((s) => /watercolor and ink storybook/.test(s.text)), stSubs.map((s) => s.text));
  check('ref Mention: prompt 1 dùng 1 ảnh, @img1 bị bỏ khỏi prompt', stSubs[0]?.refs === 1 && !/@img1/.test(stSubs[0].text), stSubs[0]);
  check('dùng kết quả trước làm tham chiếu: prompt 2 nhận ảnh kết quả của prompt 1', stSubs[1]?.refs === 1, stSubs[1]);
  await sleep(1500);
  const stState = await P(`document.querySelector('#st-list .st-card').className`);
  check('task đã lưu hiện trạng thái xong', /ok/.test(stState), stState);
  await P(`(async()=>{const {store}=await import('./lib/store.js');Object.assign(store.gen,{refIds:[],refMode:'all',styleId:'',chainPrev:false});store.save('gen');})()`);

  // ---- Effects & Angles (trang riêng gửi task sang side panel) ----
  const fxTab = await newTab(`chrome-extension://${extId}/sidepanel/effects.html`);
  const fx = await connect(fxTab.webSocketDebuggerUrl);
  await sleep(2000);
  const beforeFx = (await flowPage.ev('window.mock.submits')).length;
  await fx.ev(`(async()=>{const cv=document.createElement('canvas');cv.width=cv.height=64;cv.getContext('2d').fillRect(0,0,64,64);
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));const f=new File([blob],'src.png',{type:'image/png'});
    const dt=new DataTransfer();dt.items.add(f);const inp=document.getElementById('file');inp.files=dt.files;inp.dispatchEvent(new Event('change'));
    await new Promise(r=>setTimeout(r,400));document.querySelector('[data-fx=rain]').click();document.getElementById('intensity').value=100;document.getElementById('intensity').dispatchEvent(new Event('input'));
    document.getElementById('go').click();return 1})()`);
  let fxDone = '';
  for (let i = 0; i < 40; i++) { await sleep(1500); fxDone = await fx.ev(`document.querySelector('.res-card')?.className || ''`); if (/done|error/.test(fxDone)) break; }
  const fxSubs = (await flowPage.ev('window.mock.submits')).slice(beforeFx);
  check('Effects: gửi prompt hiệu ứng + ảnh gốc làm tham chiếu', fxSubs.length === 1 && /torrential/.test(fxSubs[0].text) && fxSubs[0].refs === 1, fxSubs);
  check('Effects: hiện kết quả', /done/.test(fxDone) && (await fx.ev(`document.querySelectorAll('.res-card img').length`)) >= 1, fxDone);
  const angTab = await newTab(`chrome-extension://${extId}/sidepanel/angles.html`);
  const ang = await connect(angTab.webSocketDebuggerUrl);
  await sleep(2000);
  const beforeAng = (await flowPage.ev('window.mock.submits')).length;
  await ang.ev(`(async()=>{const cv=document.createElement('canvas');cv.width=cv.height=64;cv.getContext('2d').fillRect(0,0,64,64);
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));const dt=new DataTransfer();dt.items.add(new File([blob],'s.png',{type:'image/png'}));
    const inp=document.getElementById('file');inp.files=dt.files;inp.dispatchEvent(new Event('change'));await new Promise(r=>setTimeout(r,400));
    document.querySelector('[data-p="2"]').click();document.getElementById('add-angle').click();document.querySelector('[data-p="6"]').click();document.getElementById('add-angle').click();
    document.getElementById('go').click();return 1})()`);
  for (let i = 0; i < 50; i++) { await sleep(1500); const n = await ang.ev(`document.querySelectorAll('.res-card.done').length`); if (n >= 2) break; }
  const angSubs = (await flowPage.ev('window.mock.submits')).slice(beforeAng);
  check('Angles: 2 góc → 2 lượt với prompt góc máy + ảnh tham chiếu', angSubs.length === 2 && /left profile/.test(angSubs[0].text) && /top-down/.test(angSubs[1].text) && angSubs.every((s) => s.refs === 1), angSubs.map((s) => s.text.slice(0, 80)));

  // ---- Workflow (mô hình node/cạnh mới): Prompt → Flow ảnh → Flow video (ảnh = khung đầu) → Download ----
  const wfId = await P(`(async()=>{
    const N=(id,type,x,y,data)=>({id,type,x,y,data:Object.assign({name:id,slug:id,enabled:true},data)});
    const nodes=[
      N('p1','prompt',0,0,{text:'a golden retriever puppy, studio photo',multi:false,agent:false}),
      N('g1','generate',400,0,{genType:'image',model:'',ratio:'16:9',quantity:1,videoMode:'frames',duration:'',prompt:''}),
      N('g2','generate',800,0,{genType:'video',model:'Veo 3.1 - Quality',ratio:'16:9',quantity:1,videoMode:'frames',duration:'6s',prompt:'slow zoom, {input}'}),
      N('dl','download',1200,0,{folder:''})];
    const E=(a,ap,b,bp)=>({id:a+b+bp,from:{node:a,port:ap},to:{node:b,port:bp}});
    const edges=[E('p1','text','g1','text'),E('g1','media','g2','frame_1'),E('p1','text','g2','text'),E('g1','media','dl','media'),E('g2','media','dl','media')];
    const wf={id:'wftest',name:'Test WF',enabled:true,maxSpeed:false,nodes,edges,viewport:{x:0,y:0,zoom:1},results:{},updatedAt:Date.now()};
    await chrome.storage.local.set({aflWorkflows:[wf]});return wf.id})()`);
  await sleep(800);
  await P(`document.querySelector('[data-tab=workflow]').click(); document.querySelector('[data-sub=workflows]').click()`);
  const wfListed = await P(`document.querySelectorAll('#wf-list .wf-row').length`);
  check('workflow hiện trong danh sách Workflows', wfListed === 1, wfListed);
  const tplCount = await P(`(document.querySelector('[data-sub=templates]').click(), document.querySelectorAll('#wf-templates .tpl').length)`);
  check('tab Templates có workflow mẫu', tplCount >= 4, tplCount);
  await P(`document.querySelector('[data-sub=workflows]').click()`);
  const before = (await flowPage.ev('window.mock.submits')).length;
  await P(`document.querySelector('#wf-list [data-act=run]').click()`);
  let wfState = '';
  for (let i = 0; i < 80; i++) { await sleep(1500); wfState = await P(`document.getElementById('wf-run').innerText`); if (/đã kết thúc/.test(wfState)) break; }
  check('workflow chạy hết các node', /đã kết thúc/.test(wfState) && (wfState.match(/xong/g) || []).length >= 4, wfState);
  const wfSubs = (await flowPage.ev('window.mock.submits')).slice(before);
  check('Flow nhận ảnh rồi video; video dùng ảnh làm khung đầu', wfSubs.length === 2 && wfSubs[0].mode === 'IMAGE' && wfSubs[0].text === 'a golden retriever puppy, studio photo'
    && wfSubs[1].mode === 'VIDEO' && wfSubs[1].vmode === 'VIDEO_FRAMES' && wfSubs[1].refs === 1 && wfSubs[1].text === 'slow zoom, a golden retriever puppy, studio photo' && wfSubs[1].duration === '6s' && wfSubs[1].model === 'Veo 3.1 - Quality', wfSubs);
  await sleep(2500);
  const f2 = files();
  check('node Download lưu kết quả vào thư mục workflow', f2.filter((f) => f.startsWith('AutoFlow/Test WF/')).length === 2, f2.filter((f) => f.includes('Test WF')));
  const savedResults = await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const w=d.aflWorkflows.find(x=>x.id==='wftest');return {r:Object.keys(w.results||{}).length, runs:w.runs?.count}})()`);
  check('kết quả chạy được lưu cho trình soạn', savedResults.r === 4 && savedResults.runs === 1, savedResults);

  // ---- Trình soạn: dựng node, thêm node bằng menu, nối dây bằng kéo thả, chạy 1 node ----
  const edTab = await newTab(`chrome-extension://${extId}/sidepanel/workflow.html?id=${wfId}`);
  const ed = await connect(edTab.webSocketDebuggerUrl);
  await ed.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(2500);
  const edInfo = await ed.ev(`({nodes: document.querySelectorAll('.node').length, wires: document.querySelectorAll('#edges path.wire').length, name: document.getElementById('wf-title').value, done: document.querySelectorAll('.node .nb-media .viewer img').length})`);
  check('trình soạn dựng 4 node + 5 dây, hiện ảnh kết quả đã lưu', edInfo.nodes === 4 && edInfo.wires === 5 && edInfo.name === 'Test WF' && edInfo.done >= 1, edInfo);
  // Thêm node Prompt qua menu (gõ tìm + Enter)
  await ed.ev(`(()=>{document.querySelector('[data-act=add]').click();const i=document.querySelector('.add-pop input');i.value='prompt';i.dispatchEvent(new Event('input'));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await sleep(500);
  const added = await ed.ev(`document.querySelectorAll('.node').length`);
  check('thêm node bằng menu tìm kiếm + Enter', added === 5, added);
  // Nối cổng T của node mới vào cổng T của node ảnh bằng chuột thật
  const pts = await ed.ev(`(()=>{const nodes=[...document.querySelectorAll('.node')];const nn=nodes[nodes.length-1];const out=nn.querySelector('.port.out[data-type=text]').getBoundingClientRect();
    const target=document.querySelector('.node[data-node=g1] .port.in[data-port=text]').getBoundingClientRect();return {a:[out.x+out.width/2,out.y+out.height/2],b:[target.x+target.width/2,target.y+target.height/2]}})()`);
  const mouse = async (type, x, y) => ed.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  await mouse('mousePressed', ...pts.a);
  for (let k = 1; k <= 8; k++) await mouse('mouseMoved', pts.a[0] + (pts.b[0] - pts.a[0]) * k / 8, pts.a[1] + (pts.b[1] - pts.a[1]) * k / 8);
  await mouse('mouseReleased', ...pts.b);
  await sleep(400);
  const wires = await ed.ev(`document.querySelectorAll('#edges path.wire').length`);
  check('kéo thả nối dây giữa 2 cổng cùng kiểu', wires === 6, wires);
  // Nối sai kiểu (T → cổng khung hình) phải bị từ chối
  const pts2 = await ed.ev(`(()=>{const nodes=[...document.querySelectorAll('.node')];const nn=nodes[nodes.length-1];const out=nn.querySelector('.port.out[data-type=text]').getBoundingClientRect();
    const target=document.querySelector('.node[data-node=g2] .port.in[data-port=frame_2]').getBoundingClientRect();return {a:[out.x+out.width/2,out.y+out.height/2],b:[target.x+target.width/2,target.y+target.height/2]}})()`);
  await mouse('mousePressed', ...pts2.a);
  for (let k = 1; k <= 6; k++) await mouse('mouseMoved', pts2.a[0] + (pts2.b[0] - pts2.a[0]) * k / 6, pts2.a[1] + (pts2.b[1] - pts2.a[1]) * k / 6);
  await mouse('mouseReleased', ...pts2.b);
  await sleep(400);
  check('chặn nối khác kiểu (văn bản → khung hình)', (await ed.ev(`document.querySelectorAll('#edges path.wire').length`)) === 6);
  // Hoàn tác xoá dây vừa nối
  await ed.ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))`);
  await sleep(300);
  check('Ctrl+Z hoàn tác', (await ed.ev(`document.querySelectorAll('#edges path.wire').length`)) === 5);
  await sleep(1200);
  const savedNodes = await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');return d.aflWorkflows.find(x=>x.id==='wftest').nodes.length})()`);
  check('trình soạn tự lưu', savedNodes === 5, savedNodes);
  // Chạy riêng node "g1" từ thanh nổi: dùng kết quả cũ của node trước
  const before2 = (await flowPage.ev('window.mock.submits')).length;
  await ed.ev(`(()=>{const n=document.querySelector('.node[data-node=g1]');const r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:r.x+150,clientY:r.y+200}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));document.querySelector('.node-bar [data-bar=run]').click();})()`);
  let g1Done = false;
  for (let i = 0; i < 40 && !g1Done; i++) { await sleep(1200); g1Done = await ed.ev(`document.querySelector('.node[data-node=g1]').classList.contains('done')`); }
  const subs2 = (await flowPage.ev('window.mock.submits')).slice(before2);
  check('chạy riêng 1 node từ trình soạn (node xong có viền xanh)', g1Done && subs2.length === 1 && subs2[0].mode === 'IMAGE', { g1Done, subs2 });
  const shotEd = await ed.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(workDir, 'e2e-editor.png'), Buffer.from(shotEd.result.data, 'base64'));


  // ---- Cửa sổ Cài đặt: Tài khoản AI ----
  const stTab = await newTab(`chrome-extension://${extId}/sidepanel/settings.html?tab=accounts`);
  const stp = await connect(stTab.webSocketDebuggerUrl);
  await sleep(5000);
  const accTxt = await stp.ev(`[...document.querySelectorAll('#acc-list .acc')].map(a=>a.querySelector('b').textContent+':'+a.querySelector('.pill').textContent)`);
  check('Cài đặt → Tài khoản AI: Flow + ChatGPT Ready, Gemini/Grok chưa mở', accTxt.includes('Google Flow:✓ Ready') && accTxt.includes('ChatGPT:✓ Ready') && accTxt.includes('Gemini:Chưa mở'), accTxt);
  // Nút Chẩn đoán ngay trên dòng tài khoản: lưu file JSON của tab ChatGPT đang mở.
  await stp.ev(`document.querySelector('#acc-list .acc[data-p=chatgpt] [data-act=diag]').click()`);
  let diagFile;
  for (let i = 0; i < 20 && !diagFile; i++) { await sleep(500); diagFile = files().find((f) => /chan-doan-chatgpt-\d+\.json$/.test(f)); }
  const diag = diagFile ? JSON.parse(fs.readFileSync(path.join(dlDir, diagFile), 'utf8')) : null;
  check('Tài khoản AI → Chẩn đoán: lưu file JSON của trang ChatGPT', !!diag && diag.provider === 'chatgpt' && diag.found?.composer === true && 'matched' in diag, { diagFile, found: diag?.found });
  await stp.ev(`(()=>{document.querySelector('[data-tab=general]').click();const p=document.querySelector('[data-s=project]');p.value='CuteCats';p.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('save').click();})()`);
  await sleep(1000);
  const proj = await P(`(async()=>{const {store}=await import('./lib/store.js');return store.settings.project})()`);
  check('Lưu cài đặt từ cửa sổ Cài đặt → side panel nhận ngay', proj === 'CuteCats', proj);

  // ---- Cài đặt → Nền tảng AI: mặc định model / tỷ lệ cho Flow và ChatGPT ----
  await stp.ev(`document.querySelector('#general-sub [data-sub=platform]').click()`);
  await sleep(300);
  const freshDefaults = await P(`(async()=>{const m=await import('./lib/store.js');return m.DEFAULT_SETTINGS.flowImageModel+'|'+m.DEFAULT_SETTINGS.chatgptModel+'|'+m.DEFAULT_SETTINGS.defProvider})()`);
  check('Nền tảng AI: mặc định giống TobyFlow (Nano Banana 2.1, Instant, Google Flow)', freshDefaults === 'Nano Banana 2.1|instant|flow', freshDefaults);
  const platUi = await stp.ev(`({shown: !document.getElementById('sub-platform').hidden, img: [...document.querySelector('[data-s=flowImageModel]').options].map(o=>o.value), gpt: [...document.querySelector('[data-s=chatgptModel]').options].map(o=>o.textContent), r: document.querySelector('[data-s=chatgptRatio] option[value="9:16"]').textContent, conn: document.getElementById('flow-conn').textContent})`);
  check('Nền tảng AI: danh sách model Flow (đã đồng bộ) + model ChatGPT', platUi.shown && platUi.img.includes('Imagen 4') && platUi.gpt.join('|') === 'Giữ như trang|Instant|Medium|High|Pro' && platUi.r === '▯ Story (9:16)' && /Kết nối 1\/1/.test(platUi.conn), platUi);
  await stp.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 1400, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  fs.writeFileSync(path.join(workDir, 'e2e-settings-platform.png'), Buffer.from((await stp.send('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  const setS = (k, v) => `(()=>{const e=document.querySelector('[data-s=${k}]');e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`;
  await stp.ev(setS('flowImageModel', 'Imagen 4'));
  await stp.ev(setS('flowImageRatio', '1:1'));
  await stp.ev(setS('chatgptRatio', '1:1'));
  await stp.ev(setS('chatgptModel', 'pro'));
  await stp.ev(`document.getElementById('save').click()`);
  await sleep(1000);
  const genLabel = await P(`(()=>{document.querySelector('[data-provider=flow]').click();document.querySelector('#gen-type [data-type=image]').click();return document.getElementById('gen-model').options[0].textContent})()`);
  check('Gen hiện model mặc định khi để trống', genLabel === 'Model: mặc định (Imagen 4)', genLabel);
  const beforeDef = (await flowPage.ev('window.mock.submits')).length;
  await P(`(async()=>{const {store}=await import('./lib/store.js');Object.assign(store.gen,{model:'',ratio:'',characters:[],styleId:'',refIds:[],chainPrev:false,multi:false});return 1})()`);
  await P(setVal('gen-model', ''));
  await P(setVal('gen-ratio', ''));
  await P(setVal('gen-text', 'default model check'));
  await P(`document.getElementById('btn-generate').click()`);
  list = await waitTasks((await tasks()).length, 150000);
  for (let i = 0; i < 60 && (await flowPage.ev('window.mock.submits')).length === beforeDef; i++) await sleep(1000);
  list = await waitTasks((await tasks()).length, 150000);
  const defSub = (await flowPage.ev('window.mock.submits')).slice(beforeDef);
  check('task để trống model/tỷ lệ → Flow nhận mặc định Imagen 4 + 1:1', defSub[0]?.text === 'default model check' && defSub[0].model === 'Imagen 4' && defSub[0].ratio === 'SQUARE', defSub);
  await P(`document.querySelector('[data-provider=chatgpt]').click()`);
  await P(setVal('gen-text', 'Draw a blue car'));
  const nBefore = (await tasks()).length;
  await P(`document.getElementById('btn-generate').click()`);
  list = await waitTasks(nBefore + 1, 150000);
  const gptSent = chatPage ? (await chatPage.ev('window.chatMock.sent')).at(-1)?.text || '' : '';
  const gptLogs = await P(`document.getElementById('log-list').innerText`);
  check('ChatGPT: tỷ lệ mặc định ghi vào prompt, model không có trên trang → cảnh báo, vẫn tạo xong', /Draw a blue car\s*Aspect ratio: 1:1\./.test(gptSent) && /giữ model hiện tại/.test(gptLogs) && list.at(-1)?.status === 'done', { gptSent, status: list.at(-1)?.status });
  await stp.ev(setS('flowImageModel', '')); await stp.ev(setS('flowImageRatio', '')); await stp.ev(setS('chatgptRatio', '')); await stp.ev(setS('chatgptModel', ''));
  await stp.ev(`document.getElementById('save').click()`);
  await sleep(800);
  await P(`document.querySelector('[data-provider=flow]').click()`);

  // ---- Workflow storyboard: ChatGPT viết mốc → Text Extract [image_prompt_02] → Flow ----
  await P(`(async()=>{
    const N=(id,type,data)=>({id,type,x:0,y:0,data:Object.assign({name:id,slug:id,enabled:true},data)});
    const nodes=[N('chu_de','text',{text:'người tiền sử'}),N('so_luong','text',{text:'2'}),
      N('ai','prompt',{text:'Chủ đề: @chu_de\\nSố cảnh: @so_luong',multi:false,agent:true,agentProvider:'chatgpt',agentSplit:false,agentInstruction:'Viết storyboard có mốc [image_prompt_0i] và [video_prompt_0i]'}),
      N('ex2','extract',{mode:'marker',marker:'image_prompt_02'}),
      N('img','generate',{genType:'image',model:'',ratio:'16:9',quantity:1,videoMode:'frames',duration:'',prompt:''})];
    const E=(a,ap,b,bp)=>({id:a+b,from:{node:a,port:ap},to:{node:b,port:bp}});
    const d=await chrome.storage.local.get('aflWorkflows');const list=d.aflWorkflows||[];
    list.unshift({id:'wfstory',name:'Story WF',enabled:true,nodes,edges:[E('ai','text','ex2','text'),E('ex2','text','img','text')],results:{},updatedAt:Date.now()});
    await chrome.storage.local.set({aflWorkflows:list});return 1})()`);
  await sleep(800);
  const beforeStory = (await flowPage.ev('window.mock.submits')).length;
  await P(`(()=>{document.querySelector('[data-tab=workflow]').click();document.querySelector('[data-sub=workflows]').click();document.querySelector('#wf-list [data-id=wfstory] [data-act=run]').click();})()`);
  let storyState = '';
  for (let i = 0; i < 60; i++) { await sleep(1500); storyState = await P(`document.getElementById('wf-run').innerText`); if (/Story WF[\s\S]*đã kết thúc/.test(storyState)) break; }
  const storySubs = (await flowPage.ev('window.mock.submits')).slice(beforeStory);
  check('Storyboard: @mention + AI + Text Extract theo mốc → Flow nhận đúng cảnh 02', storySubs.length === 1 && storySubs[0].text === 'Caveman scene 02 still image', { storySubs, storyState });

  // ---- Quảng cáo sản phẩm: Assistant xuất danh sách → List → ảnh (giữ sản phẩm) → List ảnh → mỗi ảnh một video ----
  await P(`(async()=>{
    const N=(id,type,data)=>({id,type,x:0,y:0,data:Object.assign({name:id,slug:id,enabled:true},data)});
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const nodes=[N('product','image',{media:[{kind:'image',dataUrl:png,mime:'image/png',thumb:png}]}),
      N('ai','assistant',{provider:'chatgpt',text:'Write 3 distinct ad environments for this product',exportAs:'list'}),
      N('ideas','list',{items:[],kind:'any',keep:'replace'}),
      N('g1','generate',{genType:'image',model:'',ratio:'9:16',quantity:1,videoMode:'frames',duration:'',prompt:'',perImage:false}),
      N('shots','list',{items:[],kind:'image',keep:'replace'}),
      N('motion','text',{text:'Create a 360 video of this product'}),
      N('v1','generate',{genType:'video',model:'',ratio:'9:16',quantity:1,videoMode:'frames',duration:'',prompt:''}),
      N('clips','list',{items:[],kind:'video',keep:'replace'})];
    const E=(a,ap,b,bp)=>({id:a+b+bp,from:{node:a,port:ap},to:{node:b,port:bp}});
    const edges=[E('product','media','ai','image_ref'),E('ai','text','ideas','in'),E('ideas','items','g1','text'),E('product','media','g1','image_ref'),
      E('g1','media','shots','in'),E('shots','items','v1','frame_1'),E('motion','text','v1','text'),E('v1','media','clips','in')];
    const d=await chrome.storage.local.get('aflWorkflows');const list=d.aflWorkflows||[];
    list.unshift({id:'wfad',name:'Ad WF',enabled:true,nodes,edges,results:{},updatedAt:Date.now()});
    await chrome.storage.local.set({aflWorkflows:list});return 1})()`);
  await sleep(800);
  const beforeAd = (await flowPage.ev('window.mock.submits')).length;
  await P(`(()=>{document.querySelector('[data-tab=workflow]').click();document.querySelector('[data-sub=workflows]').click();document.querySelector('#wf-list [data-id=wfad] [data-act=run]').click();})()`);
  let adState = '';
  for (let i = 0; i < 120; i++) { await sleep(1500); adState = await P(`document.getElementById('wf-run').innerText`); if (/Ad WF[\s\S]*đã kết thúc/.test(adState)) break; }
  const adSubs = (await flowPage.ev('window.mock.submits')).slice(beforeAd);
  const adImgs = adSubs.filter((s) => s.mode === 'IMAGE'), adVids = adSubs.filter((s) => s.mode === 'VIDEO');
  check('Assistant xuất danh sách → mỗi mục một ảnh, giữ ảnh sản phẩm làm tham chiếu', adImgs.length === 3 && adImgs.every((s, i) => s.text === `A cinematic shot number ${i + 1} of the idea` && s.refs === 1), { adImgs, adState });
  check('List 3 ảnh → khung đầu: mỗi ảnh một video', adVids.length === 3 && adVids.every((s) => s.refs === 1 && s.text === 'Create a 360 video of this product'), adVids);
  const adSaved = await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const w=d.aflWorkflows.find(x=>x.id==='wfad');const by=(id)=>w.nodes.find(n=>n.id===id).data;return {ideas:by('ideas').items.map(i=>i.text),ideasKind:by('ideas').kind,shots:by('shots').items.length,clips:by('clips').items.map(i=>i.kind)}})()`);
  check('List lưu các mục vừa nhận vào workflow', adSaved.ideas.length === 3 && adSaved.ideasKind === 'text' && adSaved.shots === 3 && adSaved.clips.length === 3 && adSaved.clips.every((k) => k === 'video'), adSaved);
  // Sửa List (bỏ 1 mục, đổi 1 mục) rồi chạy riêng node ảnh: dùng đúng danh sách đã sửa, không hỏi lại AI.
  await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const w=d.aflWorkflows.find(x=>x.id==='wfad');const it=w.nodes.find(n=>n.id==='ideas').data;it.items=[{kind:'text',text:'Edited scene A'},it.items[2]];await chrome.storage.local.set({aflWorkflows:d.aflWorkflows});const {store}=await import('./lib/store.js');await store.load();return 1})()`);
  await sleep(600);
  const chatTasks = `(async()=>{const {store}=await import('./lib/store.js');return store.tasks.filter(t=>t.provider==='chatgpt').length})()`;
  const chatBefore = await P(chatTasks);
  const beforeOnly = (await flowPage.ev('window.mock.submits')).length;
  await ed.ev(`chrome.runtime.sendMessage({type:'afl:runWorkflow', id:'wfad', only:['g1']})`);
  for (let i = 0; i < 60; i++) { await sleep(1500); adState = await P(`document.getElementById('wf-run').innerText`); if (/Ad WF[\s\S]*đã kết thúc/.test(adState) && !/đang chạy/.test(adState)) break; }
  const onlySubs = (await flowPage.ev('window.mock.submits')).slice(beforeOnly);
  const chatAfter = await P(chatTasks);
  check('chạy riêng node ảnh: dùng List đã sửa tay, không gọi lại AI', onlySubs.length === 2 && onlySubs[0].text === 'Edited scene A' && onlySubs[1].text === 'A cinematic shot number 3 of the idea' && chatAfter === chatBefore, { onlySubs, chatBefore, chatAfter });
  // Trình soạn: List hiện từng mục sửa được, node ảnh có lật trang 01/03, dây mang nhiều mục nét đứt.
  const adEdTab = await newTab(`chrome-extension://${extId}/sidepanel/workflow.html?id=wfad`);
  const adEd = await connect(adEdTab.webSocketDebuggerUrl);
  await adEd.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(2500);
  const adEdInfo = await adEd.ev(`({rows: document.querySelectorAll('.node[data-node=ideas] .li textarea').length, first: document.querySelector('.node[data-node=ideas] .li textarea')?.value,
    pager: document.querySelector('.node[data-node=v1] .pager span')?.textContent || '', multi: document.querySelectorAll('#edges path.wire.multi').length,
    grid: document.querySelectorAll('.node[data-node=shots] .lm img').length})`);
  check('trình soạn: List sửa được từng mục, lật trang kết quả, dây nét đứt', adEdInfo.rows === 2 && adEdInfo.first === 'Edited scene A' && adEdInfo.pager === '01/03' && adEdInfo.multi >= 2 && adEdInfo.grid === 3, adEdInfo);
  const fullImg = await adEd.ev(`(()=>{const img=document.querySelector('.node[data-node=g1] .viewer img');const box=img?.closest('.nb-media');return {src:img?.src.slice(0,40),w:img?.naturalWidth,ratio:box?.style.aspectRatio,dims:document.querySelector('.node[data-node=g1] .dims')?.textContent}})()`);
  check('node ảnh hiện ảnh gốc đúng pixel, khung theo đúng tỉ lệ ảnh', fullImg.src?.startsWith('http://127.0.0.1') && fullImg.w === 400 && fullImg.ratio === '400 / 300' && fullImg.dims === '400 × 300', fullImg);
  const snap = async (page, name) => { const r = await page.send('Page.captureScreenshot', { format: 'png' }); if (r?.result?.data) fs.writeFileSync(path.join(workDir, name), Buffer.from(r.result.data, 'base64')); };
  await adEd.ev(`document.querySelector('#toolbar [data-act=arrange]').click()`);
  await sleep(800);
  await snap(adEd, 'editor-ad.png');
  // Workflow trống: thẻ bắt đầu nhanh.
  const emptyTab = await newTab(`chrome-extension://${extId}/sidepanel/workflow.html?name=Empty`);
  const emptyEd = await connect(emptyTab.webSocketDebuggerUrl);
  await emptyEd.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(2000);
  check('workflow trống hiện thẻ bắt đầu nhanh', (await emptyEd.ev(`document.querySelectorAll('.quick-start [data-qs]').length`)) === 6);
  await snap(emptyEd, 'editor-empty.png');
  await emptyEd.ev(`document.querySelector('[data-qs=assistant]').click()`);
  await sleep(500);
  check('bấm thẻ thêm node có tên tự đánh số', (await emptyEd.ev(`document.querySelector('.node .label span')?.textContent + '|' + !document.querySelector('.quick-start')`)) === 'Assistant #1|true');
  // Đổi tên node bằng nhấp đúp vào tiêu đề.
  await adEd.ev(`(()=>{const l=document.querySelector('.node[data-node=g1] > .label');l.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));const i=document.querySelector('.label-edit');i.value='Shoe Image';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await sleep(1200);
  const renamed = await adEd.ev(`document.querySelector('.node[data-node=g1] > .label span')?.textContent`);
  check('đổi tên node bằng nhấp đúp vào tiêu đề', renamed === 'Shoe Image', renamed);
  // "✎ Sửa ảnh": ảnh đang xem → node Ảnh riêng + Yêu cầu sửa + node Flow mới; chạy node mới không chạy lại node cũ.
  const editIds = await adEd.ev(`(async()=>{const before=new Set([...document.querySelectorAll('.node')].map(n=>n.dataset.node));
    document.querySelector('.node[data-node=g1] [data-act=edit-result]').click();await new Promise(r=>setTimeout(r,400));
    const added=[...document.querySelectorAll('.node')].map(n=>n.dataset.node).filter(id=>!before.has(id));
    const ta=added.map(id=>document.querySelector('.node[data-node="'+id+'"] textarea[data-k=text]')).find(Boolean);
    if(!ta) return {added, error:'không thấy ô Yêu cầu sửa'};
    ta.value='Change the sneaker to red';ta.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('btn-save').click();await new Promise(r=>setTimeout(r,800));
    const d=await chrome.storage.local.get('aflWorkflows');const w=d.aflWorkflows.find(x=>x.id==='wfad');
    const nodes=w.nodes.filter(n=>added.includes(n.id));return {added:nodes.map(n=>n.type),gen:nodes.find(n=>n.type==='generate')?.id,edges:w.edges.filter(e=>added.includes(e.to.node)).length,
      g1Out:w.edges.filter(e=>e.from.node==='g1'&&added.includes(e.to.node)).length}})()`);
  check('✎ Sửa ảnh tạo node Ảnh + Yêu cầu sửa + node Flow mới, không nối từ node cũ', editIds.added.sort().join() === 'generate,image,prompt' && editIds.edges === 2 && editIds.g1Out === 0, editIds);
  await P(`(async()=>{const {store}=await import('./lib/store.js');await store.load();return 1})()`);
  const beforeEdit = (await flowPage.ev('window.mock.submits')).length;
  await adEd.ev(`chrome.runtime.sendMessage({type:'afl:runWorkflow', id:'wfad', only:[${JSON.stringify(editIds.gen)}]})`);
  for (let i = 0; i < 40; i++) { await sleep(1500); adState = await P(`document.getElementById('wf-run').innerText`); if (/Ad WF[\s\S]*đã kết thúc/.test(adState) && !/đang chạy/.test(adState)) break; }
  const editSubs = (await flowPage.ev('window.mock.submits')).slice(beforeEdit);
  check('chạy node sửa: Flow nhận đúng 1 lượt (yêu cầu sửa + ảnh cần sửa), node cũ không chạy lại', editSubs.length === 1 && editSubs[0].text === 'Change the sneaker to red' && editSubs[0].refs === 1, { editSubs, adState });
  // Hàng đợi: đang chạy node ảnh (2 mục) thì bấm chạy node sửa → vào hàng chờ, hiện "Đang chờ", tự chạy sau.
  const beforeQ = (await flowPage.ev('window.mock.submits')).length;
  const q1 = await adEd.ev(`chrome.runtime.sendMessage({type:'afl:runWorkflow', id:'wfad', only:['g1']})`);
  await sleep(300);
  const q2 = await adEd.ev(`chrome.runtime.sendMessage({type:'afl:runWorkflow', id:'wfad', only:[${JSON.stringify(editIds.gen)}]})`);
  await sleep(600);
  const qPill = await adEd.ev(`document.querySelector('.node[data-node=${editIds.gen}] .queued-pill')?.textContent || ''`);
  // Đang chạy g1: node không liên quan mờ + đứng im, dây vào g1 sáng (đường chạy), dây khác mờ.
  const idleUi = await adEd.ev(`(()=>{const c=(id)=>document.querySelector('.node[data-node="'+id+'"]')?.classList.contains('run-idle');return {g1:c('g1'),v1:c('v1'),queued:c(${JSON.stringify(editIds.gen)}),idleWires:document.querySelectorAll('#edges path.wire.idle').length,routeWires:document.querySelectorAll('#edges path.wire.active:not(.idle)').length}})()`);
  check('đang chạy: node không liên quan mờ và đứng im, đường chạy sáng', idleUi.g1 === false && idleUi.v1 === true && idleUi.queued === false && idleUi.idleWires > 0 && idleUi.routeWires > 0, idleUi);
  for (let i = 0; i < 60; i++) { await sleep(1500); const subsNow = (await flowPage.ev('window.mock.submits')).length - beforeQ; adState = await P(`document.getElementById('wf-run').innerText`); if (subsNow >= 3 && /đã kết thúc/.test(adState)) break; }
  const qSubs = (await flowPage.ev('window.mock.submits')).slice(beforeQ);
  check('hàng đợi: node bấm chạy khi đang chạy được xếp hàng, hiện "Đang chờ", rồi tự chạy', q1?.ok && !q1.queued && q2?.ok && q2.queued === 1 && /Đang chờ/.test(qPill) && qSubs.length === 3 && qSubs[2].text === 'Change the sneaker to red', { q1, q2, qPill, qSubs: qSubs.map((s) => s.text) });
  // Bấm 1 lần vào node → bảng chi tiết; tab Kết quả có thông tin chạy + ảnh gốc.
  await sleep(1500);
  const sideInfo = await adEd.ev(`(async()=>{const card=document.querySelector('.node[data-node=g1] .chips');const r=card.getBoundingClientRect();
    const o={bubbles:true,clientX:r.left+r.width-6,clientY:r.top+r.height/2,button:0};card.dispatchEvent(new MouseEvent('mousedown',o));window.dispatchEvent(new MouseEvent('mouseup',o));
    await new Promise(x=>setTimeout(x,300));const opened=!document.getElementById('side').hidden;
    document.querySelector('#side [data-tab=result]').click();await new Promise(x=>setTimeout(x,1500));
    const s=document.getElementById('side');return {opened,kv:[...s.querySelectorAll('.kv span')].map(x=>x.textContent),prompts:s.querySelectorAll('.field .t').length,items:s.querySelectorAll('.res-item').length,dims:s.querySelector('.res-item .dims')?.textContent}})()`);
  check('bấm 1 lần vào node mở bảng chi tiết; tab Kết quả có AI/model/thời gian/prompt/ảnh gốc', sideInfo.opened && ['Trạng thái', 'Thời gian chạy', 'AI', 'Model', 'Tỉ lệ'].every((k) => sideInfo.kv.includes(k)) && sideInfo.prompts >= 1 && sideInfo.items >= 1 && sideInfo.dims === '400 × 300', sideInfo);
  // Thanh nổi theo loại node, prompt hiện trên node video, chú thích khi rê dây, nút Tải trong bảng chi tiết.
  const ui = await adEd.ev(`(async()=>{const bar=(id)=>{const el=document.querySelector('.node[data-node="'+id+'"] .card');el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return [...document.querySelectorAll('.node-bar [data-bar]')].map(b=>b.dataset.bar)};
    const g1=bar('g1'); const sideDl=!!document.querySelector('#side [data-side=download-all]'); const product=bar('product');
    const peek=document.querySelector('.node[data-node=v1] .prompt-peek')?.textContent;
    const hit=document.querySelector('#edges path.hit');const r=hit.getBoundingClientRect();
    hit.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
    const tip=document.querySelector('.edge-tip');
    return {g1,product,peek,sideDl,tip:tip.hidden?'':tip.textContent}})()`);
  check('thanh nổi có Reset/Tải/Copy prompt; node Ảnh không có Chạy; node video hiện prompt; rê dây hiện chú thích; bảng chi tiết có nút Tải',
    ['run', 'reset', 'download', 'copy-prompt'].every((k) => ui.g1.includes(k)) && !ui.product.includes('run') && ui.product.includes('run-next') && ui.product.includes('run-branch') && ui.peek === 'Create a 360 video of this product' && /→/.test(ui.tip) && ui.sideDl, ui);

  // ---- Sửa ngay trong node: Prompt 1 → ảnh; Prompt sửa nối cổng "edit"; bấm ▶ Prompt sửa → sửa chính ảnh đó ----
  const runWf = async (id, only) => {
    const before = (await flowPage.ev('window.mock.submits')).length;
    await P(`(async()=>{const {store}=await import('./lib/store.js');await store.load();return 1})()`);
    await adEd.ev(`chrome.runtime.sendMessage({type:'afl:runWorkflow', id:${JSON.stringify(id)}${only ? `, only:${JSON.stringify(only)}` : ''}})`);
    let st = '';
    for (let i = 0; i < 60; i++) { await sleep(1500); st = await P(`document.getElementById('wf-run').innerText`); if (/đã kết thúc/.test(st) && !/đang chạy/.test(st)) break; }
    return { subs: (await flowPage.ev('window.mock.submits')).slice(before), st };
  };
  await P(`(async()=>{const N=(id,type,data)=>({id,type,x:0,y:0,data:Object.assign({name:id,slug:id,enabled:true},data)});
    const nodes=[N('p1','prompt',{text:'a young man in an office',multi:false,agent:false}),N('img2','generate',{genType:'image',model:'',ratio:'9:16',quantity:1,videoMode:'frames',duration:'',prompt:''})];
    const d=await chrome.storage.local.get('aflWorkflows');const list=(d.aflWorkflows||[]).filter(w=>w.id!=='wfedit');
    list.unshift({id:'wfedit',name:'Edit WF',enabled:true,nodes,edges:[{id:'e1',from:{node:'p1',port:'text'},to:{node:'img2',port:'text'}}],results:{},updatedAt:Date.now()});
    await chrome.storage.local.set({aflWorkflows:list});return 1})()`);
  const e1 = await runWf('wfedit');
  await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const w=d.aflWorkflows.find(x=>x.id==='wfedit');
    w.nodes.push({id:'p3',type:'prompt',x:0,y:400,data:{name:'p3',slug:'p3',enabled:true,text:'turn the man into a woman',multi:false,agent:false}});
    w.edges.push({id:'e3',from:{node:'p3',port:'text'},to:{node:'img2',port:'edit'}});await chrome.storage.local.set({aflWorkflows:d.aflWorkflows});return 1})()`);
  const e2 = await runWf('wfedit', ['p3']);
  const e2Saved = await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const r=d.aflWorkflows.find(x=>x.id==='wfedit').results.img2;return {count:r.count,prev:r.preview.map(p=>p.prompt||'')}})()`);
  check('▶ trên Prompt sửa: Flow nhận đúng 1 lượt (nội dung sửa + ảnh hiện tại), Prompt 1 không chạy lại', e1.subs.length === 1 && e2.subs.length === 1 && e2.subs[0].text === 'turn the man into a woman' && e2.subs[0].refs === 1, { e1: e1.subs.map((x) => x.text), e2: e2.subs, st: e2.st });
  check('node ảnh hiện ảnh đã sửa trước, vẫn giữ ảnh cũ để lật lại', e2Saved.count === 1 && e2Saved.prev[0] === 'turn the man into a woman' && e2Saved.prev.length === 2 && e2Saved.prev[1] === 'a young man in an office', e2Saved);
  const e3 = await runWf('wfedit');
  check('▶ Chạy workflow: tạo lại ảnh gốc rồi áp prompt sửa', e3.subs.length === 2 && e3.subs[0].text === 'a young man in an office' && e3.subs[1].text === 'turn the man into a woman' && e3.subs[1].refs === 1, e3.subs.map((x) => `${x.text} (${x.refs} ref)`));
  // ---- 1 ảnh nối vào 3 node: chạy các node nối từ ảnh (nút ▶ 3) → cả 3 chạy, mỗi node nhận ảnh làm tham chiếu ----
  await P(`(async()=>{const N=(id,type,data)=>({id,type,x:0,y:0,data:Object.assign({name:id,slug:id,enabled:true},data)});
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const g=(id,p)=>N(id,'generate',{genType:'image',model:'',ratio:'1:1',quantity:1,videoMode:'frames',duration:'',prompt:p});
    const nodes=[N('src','image',{media:[{kind:'image',dataUrl:png,mime:'image/png',thumb:png}]}),g('ga','variant A'),g('gb','variant B'),g('gc','variant C')];
    const edges=['ga','gb','gc'].map(t=>({id:'e'+t,from:{node:'src',port:'media'},to:{node:t,port:'image_ref'}}));
    const d=await chrome.storage.local.get('aflWorkflows');const list=(d.aflWorkflows||[]).filter(w=>w.id!=='wffan');
    list.unshift({id:'wffan',name:'Fan WF',enabled:true,nodes,edges,results:{},updatedAt:Date.now()});await chrome.storage.local.set({aflWorkflows:list});return 1})()`);
  const fan = await runWf('wffan', ['ga', 'gb', 'gc']);
  check('1 ảnh nối vào 3 node: chạy các node nối từ ảnh → cả 3 chạy, mỗi node nhận ảnh làm tham chiếu', fan.subs.length === 3 && ['variant A', 'variant B', 'variant C'].every((t) => fan.subs.some((x) => x.text === t && x.refs === 1)), fan.subs.map((x) => `${x.text} (${x.refs} ref)`));
  // ---- Sửa video: ảnh → video (khung đầu); Prompt sửa nối cổng "edit"; ▶ Prompt sửa → tạo lại video, cùng khung đầu, prompt gốc + sửa ----
  await P(`(async()=>{const N=(id,type,data)=>({id,type,x:0,y:0,data:Object.assign({name:id,slug:id,enabled:true},data)});
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const nodes=[N('vsrc','image',{media:[{kind:'image',dataUrl:png,mime:'image/png',thumb:png}]}),N('vp','prompt',{text:'the man walks into the office',multi:false,agent:false}),
      N('vid','generate',{genType:'video',model:'',ratio:'16:9',quantity:1,videoMode:'frames',duration:'',prompt:''})];
    const edges=[{id:'v1',from:{node:'vsrc',port:'media'},to:{node:'vid',port:'frame_1'}},{id:'v2',from:{node:'vp',port:'text'},to:{node:'vid',port:'text'}}];
    const d=await chrome.storage.local.get('aflWorkflows');const list=(d.aflWorkflows||[]).filter(w=>w.id!=='wfvedit');
    list.unshift({id:'wfvedit',name:'Video Edit WF',enabled:true,nodes,edges,results:{},updatedAt:Date.now()});await chrome.storage.local.set({aflWorkflows:list});return 1})()`);
  const ve1 = await runWf('wfvedit');
  await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const w=d.aflWorkflows.find(x=>x.id==='wfvedit');
    w.nodes.push({id:'vfix',type:'prompt',x:0,y:400,data:{name:'vfix',slug:'vfix',enabled:true,text:'slower camera',multi:false,agent:false}});
    w.edges.push({id:'v3',from:{node:'vfix',port:'text'},to:{node:'vid',port:'edit'}});await chrome.storage.local.set({aflWorkflows:d.aflWorkflows});return 1})()`);
  const ve2 = await runWf('wfvedit', ['vfix']);
  const veSaved = await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const r=d.aflWorkflows.find(x=>x.id==='wfvedit').results.vid;return {prev:r.preview.map(p=>p.kind+':'+(p.prompt||''))}})()`);
  check('▶ Prompt sửa video: tạo lại video với cùng khung đầu, prompt gốc + nội dung sửa; node phía trước không chạy lại',
    ve1.subs.length === 1 && ve2.subs.length === 1 && ve2.subs[0].mode === 'VIDEO' && ve2.subs[0].refs === 1 && ve2.subs[0].text.startsWith('the man walks into the office') && ve2.subs[0].text.includes('Edit: slower camera')
      && veSaved.prev.length === 2 && veSaved.prev[0].startsWith('video:') && veSaved.prev[0].includes('slower camera'), { ve1: ve1.subs.map((x) => x.text), ve2: ve2.subs, veSaved });

  // ---- Model video mặc định cũ "Omni 1.1 Flash" (không có trên Flow): task vẫn tạo xong, giữ model của Flow ----
  const omniRun = async (syncedOptions) => {
    await P(`(async()=>{const {store}=await import('./lib/store.js');store.settings.flowVideoModel='Omni 1.1 Flash';${syncedOptions ? '' : 'window.__opt=store.options;store.options=null;'}
      const N=(id,type,data)=>({id,type,x:0,y:0,data:Object.assign({name:id,slug:id,enabled:true},data)});
      const nodes=[N('op','prompt',{text:'omni default check',multi:false,agent:false}),N('ov','generate',{genType:'video',model:'',ratio:'16:9',quantity:1,videoMode:'frames',duration:'',prompt:''})];
      const d=await chrome.storage.local.get('aflWorkflows');const list=(d.aflWorkflows||[]).filter(w=>w.id!=='wfomni');
      list.unshift({id:'wfomni',name:'Omni WF',enabled:true,nodes,edges:[{id:'e1',from:{node:'op',port:'text'},to:{node:'ov',port:'text'}}],results:{},updatedAt:Date.now()});
      await chrome.storage.local.set({aflWorkflows:list});store.workflows=list;return 1})()`);
    const before = (await flowPage.ev('window.mock.submits')).length;
    await P(`(()=>{document.querySelector('[data-tab=workflow]').click();document.querySelector('[data-sub=workflows]').click();document.querySelector('#wf-list [data-id=wfomni] [data-act=run]').click();})()`);
    let st = '';
    for (let i = 0; i < 60; i++) { await sleep(1500); st = await P(`document.getElementById('wf-run').innerText`); if (/Omni WF[\s\S]*đã kết thúc/.test(st)) break; }
    const subs = (await flowPage.ev('window.mock.submits')).slice(before);
    const task = await P(`(async()=>{const {store}=await import('./lib/store.js');const t=store.tasks.filter(x=>x.prompt==='omni default check').at(-1);${syncedOptions ? '' : 'store.options=window.__opt;'}return t&&{status:t.status,error:t.error||''}})()`);
    return { subs, task, st };
  };
  const omni1 = await omniRun(true);
  check('model mặc định "Omni 1.1 Flash" không có trong danh sách đã đồng bộ → bỏ qua, video vẫn tạo xong', omni1.task?.status === 'done' && omni1.subs.length === 1 && omni1.subs[0].model !== 'Omni 1.1 Flash' && omni1.subs[0].mode === 'VIDEO', omni1);
  const omni2 = await omniRun(false);
  check('chưa đồng bộ model: Flow không có model mặc định → giữ model hiện tại + cảnh báo, không lỗi task', omni2.task?.status === 'done' && omni2.subs.length === 1 && omni2.subs[0].mode === 'VIDEO', omni2);
  await P(`(async()=>{const {store}=await import('./lib/store.js');store.settings.flowVideoModel='';return 1})()`);

  // ---- Seedance (Dreamina giả lập): List 2 ảnh → mỗi ảnh một video, đúng model / tỉ lệ / thời lượng ----
  await P(`(async()=>{
    const N=(id,type,data)=>({id,type,x:0,y:0,data:Object.assign({name:id,slug:id,enabled:true},data)});
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const img={kind:'image',dataUrl:png,mime:'image/png',thumb:png};
    const nodes=[N('frames','list',{items:[img,img],kind:'image',keep:'replace'}),N('mv','text',{text:'Slow 360 orbit around the product'}),
      N('sd','seedance',{genType:'video',model:'Seedance 2.0 Fast',ratio:'9:16',duration:'10s',prompt:''})];
    const E=(a,ap,b,bp)=>({id:a+b+bp,from:{node:a,port:ap},to:{node:b,port:bp}});
    const d=await chrome.storage.local.get('aflWorkflows');const list=d.aflWorkflows||[];
    list.unshift({id:'wfsd',name:'Seedance WF',enabled:true,nodes,edges:[E('frames','items','sd','frame_1'),E('mv','text','sd','text')],results:{},updatedAt:Date.now()});
    await chrome.storage.local.set({aflWorkflows:list});const {store}=await import('./lib/store.js');await store.load();return 1})()`);
  await sleep(800);
  await P(`(()=>{document.querySelector('[data-tab=workflow]').click();document.querySelector('[data-sub=workflows]').click();document.querySelector('#wf-list [data-id=wfsd] [data-act=run]').click();})()`);
  let sdState = '';
  for (let i = 0; i < 60; i++) { await sleep(1500); sdState = await P(`document.getElementById('wf-run').innerText`); if (/Seedance WF[\s\S]*đã kết thúc/.test(sdState)) break; }
  const drTab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.url.includes('/dreamina'));
  const drPage = drTab ? await connect(drTab.webSocketDebuggerUrl) : null;
  const drSubs = drPage ? await drPage.ev('window.dreamina.submits') : [];
  check('Seedance: mỗi ảnh khung đầu một video, đúng model/tỉ lệ/thời lượng', drSubs.length === 2 && drSubs.every((s) => s.prompt === 'Slow 360 orbit around the product' && s.files === 1 && s.model === 'Seedance 2.0 Fast' && s.ratio === '9:16' && s.duration === '10s'), { drSubs, sdState });
  const sdRes = await P(`(async()=>{const {store}=await import('./lib/store.js');return store.tasks.filter(t=>t.provider==='seedance').map(t=>({s:t.status,r:(t.results||[]).map(r=>r.kind)}))})()`);
  check('Seedance: task xong, nhận video', sdRes.length === 2 && sdRes.every((t) => t.s === 'done' && t.r.length === 1 && t.r[0] === 'video'), sdRes);

  // ---- MCP: máy chủ autoflow-mcp.mjs thật qua stdio ↔ side panel ----
  await P(`(async()=>{const {store}=await import('./lib/store.js');Object.assign(store.settings,{mcpEnabled:true,mcpToken:'tok_test_123',mcpPort:17399,project:''});store.save('settings',0);return 1})()`);
  const mcpProc = spawn(process.execPath, [path.join(here, '..', 'mcp', 'autoflow-mcp.mjs')], { env: { ...process.env, AUTOFLOW_TOKEN: 'tok_test_123', AUTOFLOW_PORT: '17399' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let mcpBuf = ''; const mcpWait = new Map(); let mcpId = 0;
  mcpProc.stdout.on('data', (c) => { mcpBuf += c; let i; while ((i = mcpBuf.indexOf('\n')) >= 0) { const line = mcpBuf.slice(0, i); mcpBuf = mcpBuf.slice(i + 1); try { const m = JSON.parse(line); mcpWait.get(m.id)?.(m); } catch {} } });
  const rpc = (method, params) => new Promise((r) => { const id = ++mcpId; mcpWait.set(id, r); mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  check('MCP: initialize', init.result?.serverInfo?.name === 'autoflow', init.result);
  const toolsList = await rpc('tools/list', {});
  check('MCP: 6 công cụ', toolsList.result?.tools?.length === 6, toolsList.result?.tools?.map((t) => t.name));
  await sleep(4000);
  const beforeMcp = (await flowPage.ev('window.mock.submits')).length;
  const gen = await rpc('tools/call', { name: 'autoflow_generate', arguments: { prompts: ['a cat drawn by an AI agent'], ratio: '1:1', wait: true, timeout_sec: 180 } });
  let genRes;
  try { genRes = JSON.parse(gen.result?.content?.[0]?.text || '{}'); } catch { genRes = { error: gen.result?.content?.[0]?.text }; }
  check('MCP: autoflow_generate chờ xong + trả file trong AutoFlow_mcp', genRes.finished && genRes.results?.[0]?.status === 'done' && genRes.results[0].files.every((f) => f.startsWith('AutoFlow_mcp/')), genRes);
  const mcpSubs = (await flowPage.ev('window.mock.submits')).slice(beforeMcp);
  check('MCP: Flow nhận prompt từ AI Agent', mcpSubs.length === 1 && mcpSubs[0].text === 'a cat drawn by an AI agent' && mcpSubs[0].ratio === 'SQUARE', mcpSubs);
  const wfl = await rpc('tools/call', { name: 'autoflow_list_workflows', arguments: {} });
  check('MCP: autoflow_list_workflows', /Test WF/.test(wfl.result?.content?.[0]?.text || ''), wfl.result?.content?.[0]?.text?.slice(0, 200));
  const cw = await rpc('tools/call', { name: 'autoflow_create_workflow', arguments: { name: 'WF từ Claude', nodes: [{ key: 'p', type: 'prompt', data: { text: 'hello' } }, { key: 'g', type: 'generate' }], edges: [{ from: 'p.text', to: 'g.text' }] } });
  check('MCP: autoflow_create_workflow', /"nodes": 2/.test(cw.result?.content?.[0]?.text || '') && (await P(`(async()=>{const {store}=await import('./lib/store.js');return store.workflows.some(w=>w.name==='WF từ Claude')})()`)), cw.result?.content?.[0]?.text);
  mcpProc.kill();

  // ---- Telegram: /start liên kết chat, /gen tạo ảnh rồi gửi ảnh về chat ----
  await P(`(async()=>{const {store}=await import('./lib/store.js');Object.assign(store.settings,{mcpEnabled:false,tgEnabled:true,tgToken:'TESTTOKEN',tgApiBase:'http://127.0.0.1:8765',tgChatId:'',tgNotify:false});store.save('settings',0);return 1})()`);
  const tgPush = (text) => fetch('http://127.0.0.1:8765/__tg/push', { method: 'POST', body: JSON.stringify({ text, chatId: 777 }) });
  const tgSent = async () => (await fetch('http://127.0.0.1:8765/__tg/sent')).json();
  await sleep(2500);
  await tgPush('/start');
  let sentTg = [];
  for (let i = 0; i < 20; i++) { await sleep(800); sentTg = await tgSent(); if (sentTg.some((m) => /liên kết/.test(m.text || ''))) break; }
  check('Telegram: /start liên kết chat', sentTg.some((m) => m.method === 'sendMessage' && /liên kết/.test(m.text)) && (await P(`(async()=>{const {store}=await import('./lib/store.js');return store.settings.tgChatId})()`)) === '777', sentTg);
  const beforeTg = (await flowPage.ev('window.mock.submits')).length;
  await tgPush('/gen a dog from telegram');
  for (let i = 0; i < 50; i++) { await sleep(1200); sentTg = await tgSent(); if (sentTg.some((m) => m.method === 'sendPhoto')) break; }
  const tgSubs = (await flowPage.ev('window.mock.submits')).slice(beforeTg);
  check('Telegram: /gen → Flow tạo ảnh → gửi ảnh về chat', tgSubs[0]?.text === 'a dog from telegram' && sentTg.some((m) => m.method === 'sendPhoto' && m.bytes > 1000), { tgSubs, sentTg: sentTg.map((m) => m.method + (m.text ? ':' + m.text.slice(0, 40) : '')) });

  // Node Telegram trong workflow: Text → Telegram (tin nhắn), Image → Telegram (ảnh kèm chú thích)
  const tgWfId = await P(`(async()=>{const {createNode,newWorkflow,nid}=await import('./lib/workflow-nodes.js');const {store}=await import('./lib/store.js');
    const cv=document.createElement('canvas');cv.width=cv.height=64;cv.getContext('2d').fillRect(0,0,64,64);const png=cv.toDataURL('image/png');
    const wf=newWorkflow('TG WF');const t=createNode('text',0,0,{text:'hello from workflow'});const im=createNode('image',0,300,{media:[{kind:'image',dataUrl:png,mime:'image/png'}]});const tg=createNode('telegram',400,0,{caption:'ảnh từ workflow'});
    const e=(a,ap,b,bp)=>({id:nid(),from:{node:a.id,port:ap},to:{node:b.id,port:bp}});
    wf.nodes=[t,im,tg];wf.edges=[e(t,'text',tg,'media'),e(im,'media',tg,'media')];store.workflows.push(wf);await chrome.storage.local.set({aflWorkflows:store.workflows});return wf.id})()`);
  const sentBeforeNode = (await tgSent()).length;
  const tgRun = await bg.ev(`chrome.runtime.sendMessage({ type: 'afl:runWorkflow', id: ${JSON.stringify(tgWfId)} })`);
  let tgNodeSent = [];
  for (let i = 0; i < 20; i++) { await sleep(800); tgNodeSent = (await tgSent()).slice(sentBeforeNode); if (tgNodeSent.length >= 2) break; }
  check('Node Telegram: gửi văn bản + ảnh từ workflow về chat', tgRun?.ok && tgNodeSent.some((m) => m.method === 'sendMessage' && m.text === 'hello from workflow') && tgNodeSent.some((m) => m.method === 'sendPhoto' && m.bytes > 100), { tgRun, sent: tgNodeSent.map((m) => m.method + (m.text ? ':' + m.text : '')) });

  // ---- Tuỳ chọn node như TobyFlow: dựng workflow bằng mã rồi chạy, đợi kết quả lưu vào storage ----
  // build: thân hàm nhận (C, E, png) trả về { nodes, edges }; C(type, data) tạo node, E(a, ap, b, bp) tạo dây.
  async function runBuilt(name, build, timeout = 90000) {
    const id = await P(`(async()=>{const {createNode,newWorkflow,nid}=await import('./lib/workflow-nodes.js');const {store}=await import('./lib/store.js');
      const cv=document.createElement('canvas');cv.width=cv.height=64;const x=cv.getContext('2d');x.fillStyle='#3a6';x.fillRect(0,0,64,64);const png=cv.toDataURL('image/png');
      let k=0;const C=(t,d)=>createNode(t,(k++)*320,0,d);const E=(a,ap,b,bp)=>({id:nid(),from:{node:a.id,port:ap},to:{node:b.id,port:bp}});
      const wf=newWorkflow(${JSON.stringify(name)});Object.assign(wf,(${build})(C,E,png));store.workflows.push(wf);await chrome.storage.local.set({aflWorkflows:store.workflows});return wf.id})()`);
    await bg.ev(`chrome.runtime.sendMessage({ type: 'afl:runWorkflow', id: ${JSON.stringify(id)} })`);
    const t0 = Date.now();
    let res = null;
    while (Date.now() - t0 < timeout) {
      await sleep(1500);
      res = await P(`(async()=>{const {aflWorkflows=[]}=await chrome.storage.local.get('aflWorkflows');const w=aflWorkflows.find(x=>x.id===${JSON.stringify(id)});return w?.runs ? Object.fromEntries(w.nodes.map(n=>[n.data.name,{s:w.results?.[n.id]?.status,e:w.results?.[n.id]?.error,c:w.results?.[n.id]?.count}])) : null})()`);
      if (res) break;
    }
    return res;
  }

  // Multi-prompt: mỗi prompt một cổng ra; chỉ nối cổng Prompt 2 → Flow nhận đúng prompt thứ 2.
  let subsBefore = (await flowPage.ev('window.mock.submits')).length;
  const multiRes = await runBuilt('Multi port', `(C,E)=>{const p=C('prompt',{name:'P',multi:true,text:'a red cube\\n\\na blue sphere'});const g=C('generate',{name:'G'});return {nodes:[p,g],edges:[E(p,'p2',g,'text')]}}`);
  const multiSubs = (await flowPage.ev('window.mock.submits')).slice(subsBefore).map((x) => x.text);
  check('Multi-prompt: cổng "Prompt 2" chỉ chuyển prompt thứ 2', multiRes?.G?.s === 'done' && multiSubs.length === 1 && multiSubs[0] === 'a blue sphere', { multiRes, multiSubs });

  // Text Extract không tìm thấy mốc + "Bỏ qua nhánh sau": node phía sau bị bỏ qua, Flow không nhận gì.
  subsBefore = (await flowPage.ev('window.mock.submits')).length;
  const skipRes = await runBuilt('Skip branch', `(C,E)=>{const t=C('text',{name:'T',text:'không có mốc nào'});const x=C('extract',{name:'X',mode:'marker',marker:'image_prompt_01',onFail:'skip'});const g=C('generate',{name:'G'});return {nodes:[t,x,g],edges:[E(t,'text',x,'text'),E(x,'text',g,'text')]}}`);
  check('Text Extract "Bỏ qua nhánh sau": node sau bị bỏ qua', skipRes?.X?.s === 'skipped' && skipRes?.G?.s === 'skipped' && (await flowPage.ev('window.mock.submits')).length === subsBefore, skipRes);
  const concatRes = await runBuilt('Extract concat', `(C,E)=>{const t=C('text',{name:'T',text:'a1 b2 c3'});const x=C('extract',{name:'X',mode:'regex',pattern:'[a-z](\\\\d)',multiMatch:'concat'});return {nodes:[t,x],edges:[E(t,'text',x,'text')]}}`);
  check('Text Extract "Nối tất cả": 3 kết quả gộp thành 1 mục', concatRes?.X?.s === 'done' && concatRes.X.c === 1, concatRes);

  // Telegram "Gộp (1 tin nhắn)": 2 ảnh → sendMediaGroup.
  const tgBeforeGroup = (await tgSent()).length;
  const groupRes = await runBuilt('TG group', `(C,E,png)=>{const im=C('image',{name:'I',media:[{kind:'image',dataUrl:png,mime:'image/png'},{kind:'image',dataUrl:png,mime:'image/png'}]});const tg=C('telegram',{name:'TG',sendMode:'group',caption:'album'});return {nodes:[im,tg],edges:[E(im,'media',tg,'media')]}}`);
  const groupSent = (await tgSent()).slice(tgBeforeGroup);
  check('Telegram "Gộp": 2 ảnh gửi thành 1 album', groupRes?.TG?.s === 'done' && groupSent.length === 1 && groupSent[0].method === 'sendMediaGroup', { groupRes, groupSent: groupSent.map((m) => m.method) });

  // ChatGPT đổi giao diện (khung trả lời không có thuộc tính quen): Assistant vẫn đọc được câu trả lời.
  const strangeRes = await runBuilt('Strange UI', `(C,E)=>{const a=C('assistant',{name:'AS',provider:'chatgpt',text:'strangeui tell me a fact',exportAs:'text'});return {nodes:[a],edges:[]}}`, 150000);
  const strangeOut = await P(`(async()=>{const {aflWorkflows=[]}=await chrome.storage.local.get('aflWorkflows');const w=aflWorkflows.find(x=>x.name==='Strange UI');const n=w.nodes[0];return (w.results?.[n.id]?.preview||[]).map(p=>p.text).join('|')})()`);
  check('ChatGPT giao diện lạ: đọc câu trả lời bằng cách so chữ mới trong hội thoại', strangeRes?.AS?.s === 'done' && /Here is my answer about: strangeui tell me a fact/.test(strangeOut) && !/^strangeui tell me a fact$/m.test(strangeOut), { strangeRes, strangeOut: strangeOut.slice(0, 300) });

  // "Chạy tất cả" (tab Workflows): chỉ các workflow đang bật, chạy lần lượt.
  await P(`(async()=>{const {createNode,newWorkflow,nid}=await import('./lib/workflow-nodes.js');const {store}=await import('./lib/store.js');
    for(const w of store.workflows) w.enabled=false;
    const mk=(name,text,enabled)=>{const w=newWorkflow(name);w.enabled=enabled;const t=createNode('text',0,0,{text});const g=createNode('generate',320,0,{});w.nodes=[t,g];w.edges=[{id:nid(),from:{node:t.id,port:'text'},to:{node:g.id,port:'text'}}];return w;};
    store.workflows.push(mk('RA1','run all one',true),mk('RA2','run all two',true),mk('RA3','run all off',false));
    await chrome.storage.local.set({aflWorkflows:store.workflows});
    document.querySelector('[data-tab=workflow]').click();document.querySelector('#wf-subtabs [data-sub=workflows]').click();return 1})()`);
  await sleep(800);
  subsBefore = (await flowPage.ev('window.mock.submits')).length;
  const raVisible = await P(`!document.getElementById('wf-run-all').hidden`);
  await P(`document.getElementById('wf-run-all').click()`);
  let raSubs = [];
  for (let i = 0; i < 60 && raSubs.length < 2; i++) { await sleep(1500); raSubs = (await flowPage.ev('window.mock.submits')).slice(subsBefore).map((x) => x.text); }
  await sleep(3000);
  raSubs = (await flowPage.ev('window.mock.submits')).slice(subsBefore).map((x) => x.text);
  check('Workflows "Chạy tất cả": chạy lần lượt 2 workflow đang bật, bỏ workflow tắt', raVisible && raSubs.length === 2 && raSubs.includes('run all one') && raSubs.includes('run all two'), { raVisible, raSubs });

  // Node ChatGPT: tỷ lệ + "Luôn thêm Generate an image:" riêng của node.
  const gptRes = await runBuilt('GPT opts', `(C,E)=>{const g=C('chatgpt',{name:'GPT',prompt:'a green pear on a table',ratio:'1:1',prefix:'always'});return {nodes:[g],edges:[]}}`, 120000);
  // Chat mới tải lại trang chat giả lập (danh sách tin đã gửi bị đặt lại): đọc tin cuối.
  const nodeGptSent = chatPage ? (await chatPage.ev('window.chatMock.sent')).slice(-1).map((x) => x.text) : [];
  check('Node ChatGPT: tỷ lệ + tiền tố riêng của node', gptRes?.GPT?.s === 'done' && /^Generate an image: a green pear on a table/.test(nodeGptSent[0] || '') && /Aspect ratio: 1:1/.test(nodeGptSent[0] || ''), { gptRes, nodeGptSent });
  // ChatGPT sửa ảnh: trang hiện ảnh gốc làm nền trong lúc vẽ → không được nhận ảnh gốc làm kết quả.
  const gptPreview = (name) => P(`(async()=>{const {aflWorkflows=[]}=await chrome.storage.local.get('aflWorkflows');const w=aflWorkflows.find(x=>x.name===${JSON.stringify(name)});const g=w.nodes.find(n=>n.data.name==='GE');
    return {id:w.id,g:g.id,status:w.results?.[g.id]?.status,count:w.results?.[g.id]?.count,urls:(w.results?.[g.id]?.preview||[]).map(p=>p.url)}})()`);
  const geRes = await runBuilt('GPT edit', `(C,E,png)=>{const im=C('image',{name:'I',media:[{kind:'image',dataUrl:png,mime:'image/png'}]});const g=C('chatgpt',{name:'GE',prompt:'replace the title',prefix:'always'});return {nodes:[im,g],edges:[E(im,'media',g,'image_ref')]}}`, 120000);
  const ge1 = await gptPreview('GPT edit');
  check('ChatGPT sửa ảnh: nhận ảnh mới, không nhận ảnh gốc đang làm nền', geRes?.GE?.s === 'done' && ge1.urls.length === 1 && /chatedit/.test(ge1.urls[0]), { geRes, ge1 });
  // ▶ trên chính node đã có ảnh + Prompt sửa nối vào: chỉ sửa tiếp trên ảnh mới nhất, không tạo lại từ đầu.
  await P(`(async()=>{const {store}=await import('./lib/store.js');const {createNode,nid}=await import('./lib/workflow-nodes.js');const d=await chrome.storage.local.get('aflWorkflows');const w=d.aflWorkflows.find(x=>x.id===${JSON.stringify(ge1.id)});
    const pe=createNode('prompt',0,300,{name:'PE',text:'change the sky to blue'});w.nodes.push(pe);w.edges.push({id:nid(),from:{node:pe.id,port:'text'},to:{node:${JSON.stringify(ge1.g)},port:'edit'}});
    const i=store.workflows.findIndex(x=>x.id===w.id);if(i>=0)store.workflows[i]=w;await chrome.storage.local.set({aflWorkflows:d.aflWorkflows});return 1})()`);
  await bg.ev(`chrome.runtime.sendMessage({ type: 'afl:runWorkflow', id: ${JSON.stringify(ge1.id)}, only: [${JSON.stringify(ge1.g)}] })`);
  let ge2 = ge1;
  for (let i = 0; i < 60 && ge2.urls.length < 2; i++) { await sleep(1500); ge2 = await gptPreview('GPT edit'); }
  const geSent = chatPage ? (await chatPage.ev('window.chatMock.sent')).slice(-1)[0] : null;
  check('▶ node ChatGPT đã có ảnh + Prompt sửa: sửa tiếp trên ảnh mới nhất, không tạo lại', ge2.status === 'done' && ge2.count === 1 && ge2.urls.length === 2 && /chatedit/.test(ge2.urls[0]) && ge2.urls[1] === ge1.urls[0] && /change the sky to blue/.test(geSent?.text || '') && !/replace the title/.test(geSent?.text || '') && geSent?.attachments === 1, { ge2, geSent });
  await P(`(async()=>{const {store}=await import('./lib/store.js');store.settings.tgEnabled=false;store.save('settings',0);return 1})()`);

  await P(`document.querySelector('[data-tab=queue]').click()`);
  await sleep(500);
  const shot = await panel.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(workDir, 'e2e-panel.png'), Buffer.from(shot.result.data, 'base64'));
} catch (e) {
  fail++; console.log('ERROR', e.stack);
}
console.log(`\n${pass} pass, ${fail} fail`);
browser.kill(); server.kill();
process.exit(fail ? 1 : 0);

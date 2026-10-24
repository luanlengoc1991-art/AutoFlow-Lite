// Khôi phục: đóng/mở lại side panel, tải lại trang provider khi task đang tạo → không gửi trùng.
// node test-recovery.mjs <extDir> <workDir>
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

  
  await P(`(async()=>{const {store}=await import('./lib/store.js');Object.assign(store.settings,{delayMin:0,delayMax:0,dlImageRes:'original',confirmRun:false});await chrome.storage.local.set({aflSettings:store.settings});return 1})()`);
  await P('location.reload()').catch(() => {});
  await sleep(3000);
  // ---- Khôi phục: task đã gửi không bao giờ bị gửi lại tự động ----
  const genSlow = (text) => P(`(()=>{document.querySelector('[data-tab=gen]').click();document.querySelector('[data-provider=flow]').click();document.querySelector('#gen-type [data-type=image]').click();
    const t=document.getElementById('gen-text');t.value=${JSON.stringify(text)};t.dispatchEvent(new Event('input'));document.getElementById('btn-generate').click();return 1})()`);
  const taskBy = async (text) => (await tasks()).find((t) => t.prompt === text);
  const waitTask = async (text, ok, ms = 60000) => { const t0 = Date.now(); let t; while (Date.now() - t0 < ms) { t = await taskBy(text); if (t && ok(t)) break; await sleep(1000); } return t; };
  // 1) Tải lại side panel khi task đang tạo: nối lại theo token, nhận kết quả, Flow chỉ nhận 1 lượt.
  const prBefore = (await flowPage.ev('window.mock.submits')).length;
  await genSlow('SLOW panel reload recovery');
  const prSent = await waitTask('SLOW panel reload recovery', (t) => t.status === 'running' && t.submittedAt > 0, 30000);
  // Hàng đợi còn task chờ khác (như khi đang chạy cả lô): sau khi nối lại, hàng đợi tạm dừng nhưng task đã gửi vẫn phải xong.
  await P(`(async()=>{const {store}=await import('./lib/store.js');store.tasks.push({id:'waiting1',index:99,prompt:'waiting task',provider:'flow',genType:'image',quantity:1,status:'pending',attempts:0,refIds:[],createdAt:Date.now()});await chrome.storage.local.set({aflTasks:store.tasks});return 1})()`);
  await panel.send('Page.reload');
  await sleep(4000);
  const prDone = await waitTask('SLOW panel reload recovery', (t) => ['done', 'error', 'unknown', 'cancelled'].includes(t.status), 60000);
  const prSubs = (await flowPage.ev('window.mock.submits')).slice(prBefore).filter((s) => s.text === 'SLOW panel reload recovery').length;
  check('tải lại side panel khi đang tạo: nối lại task, nhận kết quả, không gửi lại', !!prSent && prDone?.status === 'done' && prDone.results?.length > 0 && /Nối lại/.test(prDone.note || '') && prSubs === 1,
    { sent: prSent?.status, st: prDone?.status, note: prDone?.note, err: prDone?.error, res: prDone?.results?.length, prSubs });
  const paused = await P(`document.getElementById('run-message')?.textContent || ''`);
  check('nối lại khi còn task chờ: hàng đợi tạm dừng, task chờ chưa bị gửi', /tạm dừng/.test(paused) && (await taskBy('waiting task'))?.status === 'pending', { paused, list: (await tasks()).map((t) => [t.index, t.status, t.prompt.slice(0, 20)]), btn: await P(`document.getElementById('run-start').textContent`) });
  await P(`document.getElementById('run-start').click()`);
  const resumed = await waitTask('waiting task', (t) => t.status === 'done', 40000);
  check('bấm Tiếp tục: hàng đợi chạy tiếp task đang chờ', resumed?.status === 'done', resumed?.status);
  const keptLog = await P(`[...document.querySelectorAll('#log-list > .old')].some(l=>l.textContent.includes('đã gửi')&&l.textContent.includes('SLOW panel reload recovery'))`);
  check('nhật ký phiên trước vẫn còn sau khi tải lại side panel', keptLog === true, keptLog);
  // 2) Tải lại trang Flow khi task đang tạo: mất theo dõi → "Chưa rõ", không tự gửi lại.
  await genSlow('SLOW flow reload unknown');
  const frSent = await waitTask('SLOW flow reload unknown', (t) => t.status === 'running' && t.submittedAt > 0, 30000);
  await flowPage.send('Page.reload');
  for (let i = 0; i < 40 && !(await flowPage.ev('!!document.querySelector("[data-slate-editor]")').catch(() => false)); i++) await sleep(500);
  const frDone = await waitTask('SLOW flow reload unknown', (t) => ['done', 'error', 'unknown', 'cancelled'].includes(t.status), 60000);
  await sleep(15000);
  const frSubs = (await flowPage.ev('window.mock.submits')).length;
  const frRow = await P(`(()=>{document.querySelector('[data-tab=queue]')?.click();const li=[...document.querySelectorAll('#task-list li.task')].find(l=>/SLOW flow reload unknown/.test(l.textContent));return li?{st:li.querySelector('.st').textContent,retry:!!li.querySelector('[data-act=retry]')}:null})()`);
  check('tải lại trang Flow khi đang tạo: task "Chưa rõ", không tự gửi lại, vẫn bấm Chạy lại được', !!frSent && frDone?.status === 'unknown' && frSubs === 0 && frRow?.st === 'Chưa rõ' && frRow.retry,
    { sent: frSent?.status, st: frDone?.status, err: frDone?.error, frSubs, frRow });
  // Sao lưu không chứa token; khôi phục giữ token đang có, bỏ khoá lạ.
  await P(`(async()=>{const {store}=await import('./lib/store.js');Object.assign(store.settings,{tgToken:'111111:SECRETSECRETSECRETSECRETSECRET12',mcpToken:'MCPSECRET',folder:'BeforeRestore'});await chrome.storage.local.set({aflSettings:store.settings});return 1})()`);
  const setTab = await newTab(`chrome-extension://${extId}/sidepanel/settings.html`);
  const setPage = await connect(setTab.webSocketDebuggerUrl);
  await sleep(2500);
  await setPage.ev(`document.getElementById('backup').click()`);
  let bkFile = '';
  for (let i = 0; i < 20 && !bkFile; i++) { await sleep(500); bkFile = files().find((f) => /autoflow-backup-.*.json$/.test(f)) || ''; }
  const bk = bkFile ? JSON.parse(fs.readFileSync(path.join(dlDir, bkFile), 'utf8')) : null;
  const bkText = bk ? JSON.stringify(bk) : '';
  check('sao lưu không chứa token Telegram / MCP', !!bk && !!bk.data.aflSettings && !/SECRETSECRET|MCPSECRET/.test(bkText), { bkFile, keys: bk && Object.keys(bk.data.aflSettings || {}).filter((k) => /token/i.test(k)) });
  if (bk) {
    bk.data.aflSettings = { ...bk.data.aflSettings, folder: 'RestoredFolder', tgToken: 'EVIL' };
    bk.data.evilKey = { x: 1 };
    const rf = path.join(workDir, 'restore-test.json');
    fs.writeFileSync(rf, JSON.stringify(bk));
    await setPage.ev('window.confirm = () => true; 1');
    const doc = await setPage.send('DOM.getDocument', {});
    const q = await setPage.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#restore' });
    await setPage.send('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [rf] });
    await sleep(3000);
    const after = await setPage.ev(`(async()=>{const d=await chrome.storage.local.get(null);return {folder:d.aflSettings?.folder,tg:d.aflSettings?.tgToken,mcp:d.aflSettings?.mcpToken,evil:'evilKey' in d}})()`);
    check('khôi phục: dữ liệu được khôi phục, giữ token trên máy, bỏ khoá lạ', after.folder === 'RestoredFolder' && after.tg === '111111:SECRETSECRETSECRETSECRETSECRET12' && after.mcp === 'MCPSECRET' && after.evil === false, after);
  }
  console.log('LOG', JSON.stringify(await P(`[...document.querySelectorAll('#log-list > *')].slice(0,30).map(l=>l.textContent)`).catch((e) => e.message)));
} catch (e) {
  fail++; console.log('ERROR', e.stack);
}
console.log(`\n${pass} pass, ${fail} fail`);
browser.kill(); server.kill();
process.exit(fail ? 1 : 0);


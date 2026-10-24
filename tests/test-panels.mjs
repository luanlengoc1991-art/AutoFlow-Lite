// Nhiều side panel (nhiều cửa sổ): chỉ một panel điều khiển, chuyển quyền không mất/trùng task.
// node test-panels.mjs <extDir> <workDir>
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
  const taskBy = async (text) => (await tasks()).find((t) => t.prompt === text);
  const waitTask = async (text, ok, ms = 60000) => { const t0 = Date.now(); let t; while (Date.now() - t0 < ms) { t = await taskBy(text); if (t && ok(t)) break; await sleep(1000); } return t; };
  const overlay = (page) => page.ev(`!!document.getElementById('follower') && !document.getElementById('follower').hidden`);
  const submitsOf = async (text) => (await flowPage.ev('window.mock.submits')).filter((s) => s.text === text).length;
  const bgTarget = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.url.endsWith('/background.js'));
  const bg = await connect(bgTarget.webSocketDebuggerUrl);

  // 1) Mở panel thứ hai: panel đầu vẫn điều khiển, panel sau hiện lớp phủ.
  const panel2Tab = await newTab(`chrome-extension://${extId}/sidepanel/index.html`);
  const panel2 = await connect(panel2Tab.webSocketDebuggerUrl);
  await sleep(3000);
  const o1 = { p1: await overlay(panel), p2: await overlay(panel2) };
  check('2 side panel: panel đầu điều khiển, panel sau hiện "đang điều khiển ở cửa sổ khác"', o1.p1 === false && o1.p2 === true, o1);

  // 2) Lệnh chạy workflow tới mọi panel: chỉ panel điều khiển chạy → Flow nhận đúng 1 lượt.
  await P(`(async()=>{const d=await chrome.storage.local.get('aflWorkflows');const list=(d.aflWorkflows||[]).filter(w=>w.id!=='wf2p');
    list.unshift({id:'wf2p',name:'Two panels',enabled:true,nodes:[{id:'g',type:'generate',x:0,y:0,data:{name:'g',slug:'g',enabled:true,genType:'image',model:'',ratio:'1:1',quantity:1,videoMode:'frames',duration:'',prompt:'two panels one run'}}],edges:[],results:{},updatedAt:Date.now()});
    await chrome.storage.local.set({aflWorkflows:list});return 1})()`);
  await sleep(1000);
  await bg.ev(`chrome.runtime.sendMessage({ type: 'afl:runWorkflow', id: 'wf2p' })`);
  await sleep(20000);
  const runs = await submitsOf('two panels one run');
  check('2 side panel: lệnh chạy workflow chỉ được chạy 1 lần', runs === 1, runs);

  // 3) Nhận quyền ở panel 2 khi panel 1 đang có task tạo dở: panel 1 nhường, panel 2 nối lại, không gửi trùng.
  await P(`(()=>{document.querySelector('[data-tab=gen]').click();document.querySelector('[data-provider=flow]').click();document.querySelector('#gen-type [data-type=image]').click();
    const t=document.getElementById('gen-text');t.value='SLOW takeover task';t.dispatchEvent(new Event('input'));document.getElementById('btn-generate').click();return 1})()`);
  const sent = await waitTask('SLOW takeover task', (t) => t.status === 'running' && t.submittedAt > 0, 30000);
  await panel2.ev(`window.confirm = () => true; document.getElementById('follower-take').click(); 1`);
  await sleep(8000);
  const o2 = { p1: await overlay(panel), p2: await overlay(panel2).catch(() => null) };
  const taken = await waitTask('SLOW takeover task', (t) => ['done', 'error', 'unknown', 'cancelled'].includes(t.status), 60000);
  const tkSubs = await submitsOf('SLOW takeover task');
  check('nhận quyền ở panel 2: panel 1 nhường, task đang tạo được nối lại và xong, Flow chỉ nhận 1 lượt',
    !!sent && o2.p1 === true && o2.p2 === false && taken?.status === 'done' && tkSubs === 1, { sent: sent?.status, o2, st: taken?.status, err: taken?.error, note: taken?.note, tkSubs });

  // 4) Đóng panel đang điều khiển (panel 2): panel 1 tự nhận quyền sau khi giấy phép cũ.
  await fetch(`http://127.0.0.1:${port}/json/close/${panel2Tab.id}`);
  let free = true;
  for (let i = 0; i < 30 && free; i++) { await sleep(1000); free = await overlay(panel).catch(() => true); }
  check('đóng panel điều khiển: panel còn lại tự nhận quyền', free === false, free);
} catch (e) {
  fail++; console.log('ERROR', e.stack);
}
console.log(`\n${pass} pass, ${fail} fail`);
browser.kill(); server.kill();
process.exit(fail ? 1 : 0);


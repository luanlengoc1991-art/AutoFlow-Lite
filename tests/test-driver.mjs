// Kiểm thử AFLDriver trên trang Flow giả lập qua Chrome DevTools Protocol.
// node test-driver.mjs <extDir> <shotDir>
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';

const [extDir, shotDir] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const server = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs'), '8765'], { stdio: 'ignore' });
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpmock-'));
const port = 9400 + Math.floor(Math.random() * 400);
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [`--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--headless=new', '--window-size=1200,900', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let targets = [];
for (let i = 0; i < 40; i++) { await sleep(400); try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {} }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++seq; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
};
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8765/project/0b6f4c1e-1111-4222-8333-944455556666' });
for (let i = 0; i < 40 && !(await ev('!!document.querySelector("[data-slate-editor]")').catch(() => false)); i++) await sleep(500);

await ev(fs.readFileSync(path.join(extDir, 'page-bridge.js'), 'utf8').replace("'labs.google'", "'127.0.0.1'"));
await ev(fs.readFileSync(path.join(extDir, 'content/flow-driver.js'), 'utf8'));

let pass = 0, fail = 0;
const check = (name, cond, detail) => { (cond ? pass++ : fail++); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''}`); };
const D = 'window.AFLDriver';

async function runJob(task, maxMs = 20000) {
  const sub = await ev(`(async()=>{const t=${JSON.stringify(task)};await ${D}.closePanels();const s=await ${D}.applySettings(t);await ${D}.clearRefs();if(t.refs?.length){const r=await ${D}.attachRefs(t.refs,t.genType==='video'?t.videoMode:null);if(!r.ok)return {ok:false,error:r.error};}const p=await ${D}.setPrompt(t.prompt);if(!p.ok)return {ok:false,error:p.error};const token=await ${D}.startJob(t);const x=await ${D}.submit();return {ok:x.ok,token,warnings:s.warnings,error:x.error}})()`);
  if (!sub.ok) return { sub };
  const t0 = Date.now(); let r;
  while (Date.now() - t0 < maxMs) { await sleep(700); r = await ev(`${D}.pollJob(${JSON.stringify(sub.token)})`); if (r.status !== 'running') break; }
  let fin = null;
  if (r.status === 'done') fin = await ev(`${D}.finalizeJob(${JSON.stringify(sub.token)}, ${JSON.stringify(r.results)})`);
  return { sub, r, fin };
}

try {
  check('tìm thấy editor/submit/settings', await ev(`!!${D}.findEditor() && !!${D}.findSubmit() && !!${D}.findSettingsButton()`));
  const cur = await ev(`${D}.readComposerSettings()`);
  check('đọc cài đặt hiện tại từ nút settings', cur?.ratio === '16:9' && cur?.quantity === 2 && /Veo 3\.1 - Fast/.test(cur?.model), cur);

  const opts = await ev(`${D}.scrapeOptions()`);
  check('scrape model ảnh', opts.image.models.join('|') === '🍌 Nano Banana Pro|Nano Banana 2|Imagen 4', opts.image.models);
  check('scrape model video', opts.video.models.join('|') === 'Veo 3.1 - Fast|Veo 3.1 - Quality', opts.video.models);
  check('scrape tỉ lệ + thời lượng + kiểu video', opts.image.ratios.length === 5 && opts.video.durations.join() === '4s,6s,8s' && opts.video.modes.join() === 'frames,ingredients', { r: opts.image.ratios, d: opts.video.durations, m: opts.video.modes });
  check('popover đã đóng sau scrape', await ev(`!document.querySelector('[data-radix-popper-content-wrapper]')`));

  const p = await ev(`${D}.setPrompt('một chú mèo\\nphi hành gia')`);
  const st = await ev('window.mockText()');
  check('nhập prompt vào state Slate (qua bridge)', p.ok && st === 'một chú mèo\nphi hành gia', { p, st });

  // Ảnh: Nano Banana Pro, 9:16, x3
  const j1 = await runJob({ prompt: 'a red fox in snow', genType: 'image', model: 'Nano Banana Pro', ratio: '9:16', quantity: 3 });
  const s1 = await ev('window.mock.submits.at(-1)');
  check('áp cài đặt ảnh (mode/model/ratio/qty)', s1 && s1.mode === 'IMAGE' && /Nano Banana Pro/.test(s1.model) && s1.ratio === 'PORTRAIT' && s1.qty === 3 && s1.text === 'a red fox in snow', s1);
  check('job ảnh xong với 3 kết quả /asb/', j1.r?.status === 'done' && j1.r.results.length === 3 && j1.r.results.every((x) => x.url.includes('/asb/') && x.kind === 'image'), j1.r);
  check('finalize tạo thumbnail', j1.fin?.length === 3 && j1.fin.every((x) => x.thumb.startsWith('data:image/jpeg')), j1.fin?.map((x) => x.thumb.slice(0, 30)));

  // Video Frames + 2 ảnh tham chiếu (fallback qua nút add_2), Veo Quality, 6s
  const ref = await ev(`(()=>{const c=document.createElement('canvas');c.width=c.height=64;c.getContext('2d').fillRect(0,0,64,64);return c.toDataURL('image/png')})()`);
  const j2 = await runJob({ prompt: 'drone shot over mountains', genType: 'video', videoMode: 'ingredients', model: 'Veo 3.1 - Quality', ratio: '9:16', quantity: 1, duration: '6s', refs: [{ name: 'a.png', dataUrl: ref }, { name: 'b.png', dataUrl: ref }] });
  const s2 = await ev('window.mock.submits.at(-1)');
  check('áp cài đặt video (ingredients/Quality/9:16/6s)', s2 && s2.mode === 'VIDEO' && s2.vmode === 'VIDEO_REFERENCES' && s2.model === 'Veo 3.1 - Quality' && s2.ratio === 'PORTRAIT' && s2.duration === '6s' && s2.qty === 1, s2);
  check('upload 2 ảnh tham chiếu (bẫy input.click)', s2?.refs === 2, { refs: s2?.refs, sub: j2.sub });
  check('video: lấy URL <video> bằng hover', j2.fin?.[0]?.kind === 'video' && /\/video$/.test(j2.fin[0].url), j2.fin);
  check('video: thumbnail từ poster', j2.fin?.[0]?.thumb?.startsWith('data:image/jpeg'), j2.fin?.[0]?.thumb?.slice(0, 30));
  check('không có hộp thoại file mở / bẫy đã gỡ', await ev(`HTMLInputElement.prototype.click.toString().includes('native')`));

  // "Veo 3.1 - Fast" không được khớp nhầm khi yêu cầu Quality và ngược lại
  check('so khớp model chặt chẽ', await ev(`(async()=>{await ${D}.closePanels();return true})()`));

  // Lỗi chính sách
  const j3 = await runJob({ prompt: 'FAIL please', genType: 'image', quantity: 1 });
  check('phát hiện lỗi chính sách trên tile', j3.r?.status === 'failed' && j3.r.category === 'policy', j3.r);

  // Hết credit qua toast
  const j4 = await runJob({ prompt: 'QUOTA test', genType: 'image', quantity: 1 });
  check('phát hiện hết credit (toast)', j4.r?.status === 'failed' && j4.r.category === 'quota', { r: j4.r, sub: j4.sub, toasts: await ev(`${D}.toastTexts()`), last: await ev('window.mock.submits.at(-1)') });

  // Lỗi chỉ có trong phản hồi API (page-bridge bắt mã PUBLIC_ERROR_*), không chờ hết 2 phút
  const j5 = await runJob({ prompt: 'NET_USER_QUOTA_REACHED test', genType: 'image', quantity: 1 }, 8000);
  check('phát hiện hết credit qua phản hồi API', j5.r?.status === 'failed' && j5.r.category === 'quota' && /PUBLIC_ERROR_USER_QUOTA_REACHED/.test(j5.r.error), j5.r);
  const j6 = await runJob({ prompt: 'NET_UNUSUAL_ACTIVITY test', genType: 'image', quantity: 1 }, 8000);
  check('hoạt động bất thường qua API → cần xác minh (captcha)', j6.r?.status === 'failed' && j6.r.category === 'captcha', j6.r);

  // Nhân vật / giọng nói
  const comps = await ev(`${D}.scrapeComponents()`);
  check('đồng bộ nhân vật (cuộn hết danh sách) + giọng', comps.characters.length === 17 && comps.characters[0] === 'Mèo Cam' && comps.voices.join('|') === 'Giọng Nam Trầm|Giọng Nữ Trẻ', comps);
  const pm = await ev(`${D}.parseMentions('@char:[Mèo Cam] nhảy múa @voice:[Giọng Nữ Trẻ] trên @char:Robot')`);
  check('tách @mention khỏi prompt', pm.clean === 'nhảy múa trên' && pm.mentions.length === 3 && pm.mentions[0].name === 'Mèo Cam' && pm.mentions[2].name === 'Robot', pm);
  const sc = await ev(`(async()=>{const a=await ${D}.selectComponent('char','Mèo Cam');const b=await ${D}.selectComponent('voice','Giọng Nữ Trẻ');const c=await ${D}.selectComponent('char','Nhân vật 14');return {a,b,c,chars:window.mock.chars,voices:window.mock.voices}})()`);
  check('chọn nhân vật/giọng qua menu + (kể cả mục phải cuộn mới thấy)', sc.a.ok && sc.b.ok && sc.c.ok && sc.chars.join('|') === 'Mèo Cam|Nhân vật 14' && sc.voices[0] === 'Giọng Nữ Trẻ', sc);
  const missing = await ev(`${D}.selectComponent('char','Không Có')`);
  check('nhân vật không tồn tại → báo lỗi', !missing.ok && /Không tìm thấy/.test(missing.error), missing);

  // Tải qua menu chuột phải (upscale)
  const imgUrl = j1.r.results[0].url;
  const dm = await ev(`${D}.downloadViaMenu(${JSON.stringify(imgUrl)}, '2k')`);
  await sleep(300);
  const dls = await ev('window.mock.downloads');
  check('tải qua menu: chọn đúng "Upscaled (2K)"', dm.ok && dls.at(-1)?.res === 'Upscaled (2K)', { dm, dls });
  const dm2 = await ev(`${D}.downloadViaMenu(${JSON.stringify(imgUrl)}, 'original')`);
  await sleep(300);
  check('tải qua menu: bản gốc', dm2.ok && (await ev('window.mock.downloads.at(-1).res')) === 'Original size (1K)', dm2);
  const dm3 = await ev(`${D}.downloadViaMenu(${JSON.stringify(imgUrl)}, '8k')`);
  check('độ phân giải không có → báo lỗi kèm danh sách', !dm3.ok && dm3.available?.length === 3, dm3);

  // Xoá ảnh tham chiếu + nhân vật
  await ev(`${D}.clearRefs()`);
  check('xoá ảnh tham chiếu + nhân vật/giọng', (await ev('window.mock.refs')) === 0 && (await ev('window.mock.chars.length + window.mock.voices.length')) === 0, await ev('({refs: window.mock.refs, chars: window.mock.chars})'));

  // Model không tồn tại → lỗi có danh sách
  const bad = await ev(`(async()=>{try{await ${D}.applySettings({genType:'image',model:'Midjourney',modelStrict:true});return 'no-error'}catch(e){return e.message}})()`);
  check('model task chọn không có → báo lỗi kèm danh sách', /MODEL_NOT_FOUND.*Nano Banana 2/.test(bad), bad);
  const soft = await ev(`(async()=>{try{return (await ${D}.applySettings({genType:'image',model:'Midjourney'})).warnings}catch(e){return e.message}})()`);
  check('model mặc định không có → chỉ cảnh báo', Array.isArray(soft) && soft.some((w) => /Midjourney/.test(w)), soft);

  const diag = await ev(`${D}.diagnose()`);
  check('chẩn đoán xuất được cấu trúc', diag.found.editor && diag.found.submit && diag.composer.length > 3, diag.found);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, 'mock-final.png'), Buffer.from(shot.result.data, 'base64'));
} catch (e) {
  fail++; console.log('ERROR', e.message);
}
console.log(`\n${pass} pass, ${fail} fail`);
ws.close(); browser.kill(); server.kill();
process.exit(fail ? 1 : 0);

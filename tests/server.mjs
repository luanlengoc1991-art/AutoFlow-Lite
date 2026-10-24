// Mock server: trang Flow giả lập + /asb/* trả ảnh PNG 400x300 sinh động.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (~c) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = (x + seed) & 255; raw[i + 1] = (y * 2 + seed * 11) & 255; raw[i + 2] = (seed * 7) & 255; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const port = +process.argv[2] || 8765;

// Telegram Bot API giả lập: /bot<token>/<method>; test đẩy tin nhắn qua /__tg/push, đọc tin đã gửi qua /__tg/sent.
const tg = { updates: [], sent: [], nextId: 1 };
function readBody(req) {
  return new Promise((resolve) => { const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => resolve(Buffer.concat(chunks))); });
}
async function telegram(req, res) {
  const url = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (url.pathname === '/__tg/push') { const b = JSON.parse((await readBody(req)).toString() || '{}'); tg.updates.push({ update_id: tg.nextId++, message: { message_id: tg.nextId, chat: { id: b.chatId || 777 }, text: b.text } }); json({ ok: true }); return; }
  if (url.pathname === '/__tg/sent') { json(tg.sent); return; }
  const m = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  if (!m) return false;
  if (m[1] !== 'TESTTOKEN') { json({ ok: false, description: 'Unauthorized' }); return; }
  const method = m[2];
  if (method === 'getMe') { json({ ok: true, result: { id: 1, username: 'autoflow_test_bot' } }); return; }
  if (method === 'getUpdates') {
    const offset = +(url.searchParams.get('offset') || 0);
    const pick = () => tg.updates.filter((u) => u.update_id >= offset);
    const t0 = Date.now();
    while (!pick().length && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 200));
    json({ ok: true, result: pick() });
    return;
  }
  const body = await readBody(req);
  const ct = req.headers['content-type'] || '';
  if (ct.includes('application/json')) tg.sent.push({ method, ...JSON.parse(body.toString() || '{}') });
  else tg.sent.push({ method, bytes: body.length, multipart: true });
  json({ ok: true, result: { message_id: tg.nextId++ } });
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST' }); res.end(); return; }
  if (req.url.startsWith('/bot') || req.url.startsWith('/__tg/')) { if ((await telegram(req, res)) !== false) return; }
  if (req.url.startsWith('/__api/generate')) {
    const code = new URL(req.url, 'http://x').searchParams.get('code');
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 429, message: 'Request failed', status: code } }));
    return;
  }
  if (req.url.startsWith('/asb/')) {
    if (req.url.endsWith('/video')) { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(Buffer.alloc(2048)); return; }
    res.writeHead(200, { 'content-type': 'image/png' });
    // Mỗi URL một ảnh khác hẳn (theo mã băm, không theo độ dài): AutoFlow so nội dung ảnh để bỏ ảnh đính kèm.
    res.end(png(400, 300, [...req.url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 251));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const page = req.url.startsWith('/chat') ? 'mock-chat.html' : req.url.startsWith('/dreamina') ? 'mock-dreamina.html' : 'mock-flow.html';
  res.end(fs.readFileSync(path.join(dir, page)));
}).listen(port, () => console.log('mock on', port));

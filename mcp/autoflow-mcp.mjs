#!/usr/bin/env node
// Máy chủ MCP của AutoFlow (stdio, không cần thư viện ngoài).
// AI Agent (Claude / Cursor / Codex…) gọi công cụ → lệnh được chuyển cho side panel AutoFlow qua
// cổng localhost (long-poll, có token). Side panel thực thi bằng tài khoản đang đăng nhập trên trình duyệt.
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const TOKEN = process.env.AUTOFLOW_TOKEN || '';
const PORT = +(process.env.AUTOFLOW_PORT || 17321);
const VERSION = '0.4.0';
const log = (...a) => process.stderr.write(`[autoflow-mcp] ${a.join(' ')}\n`);

if (!TOKEN) log('CẢNH BÁO: chưa đặt AUTOFLOW_TOKEN (lấy trong AutoFlow → Cài đặt → AI Agent / Bot).');

// ---------- Hàng lệnh chờ side panel lấy ----------
const queue = [];          // lệnh chưa giao
const waiting = new Map(); // id -> { resolve, timer }
let poller = null;         // response đang long-poll
let lastPoll = 0;

function deliver() {
  if (!poller || !queue.length) return;
  const cmd = queue.shift();
  const res = poller;
  poller = null;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(cmd));
}

function callExtension(tool, args, timeoutMs) {
  return new Promise((resolve) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      waiting.delete(id);
      const i = queue.findIndex((c) => c.id === id);
      if (i >= 0) queue.splice(i, 1);
      resolve({ ok: false, error: Date.now() - lastPoll > 40000
        ? 'Không kết nối được AutoFlow: hãy mở side panel AutoFlow và bật "Cầu nối MCP" trong Cài đặt → AI Agent / Bot (token và cổng phải khớp).'
        : 'Hết thời gian chờ AutoFlow trả kết quả.' });
    }, timeoutMs);
    waiting.set(id, { resolve, timer });
    queue.push({ id, tool, args });
    deliver();
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const auth = url.searchParams.get('token') || req.headers['x-autoflow-token'];
  res.setHeader('access-control-allow-origin', '*');
  if (req.method === 'OPTIONS') { res.setHeader('access-control-allow-headers', 'content-type, x-autoflow-token'); res.end(); return; }
  if (url.pathname === '/health') { res.end(JSON.stringify({ ok: true, version: VERSION, connected: Date.now() - lastPoll < 40000 })); return; }
  if (!TOKEN || auth !== TOKEN) { res.writeHead(401); res.end('bad token'); return; }
  if (url.pathname === '/poll' && req.method === 'GET') {
    lastPoll = Date.now();
    if (poller) { poller.writeHead(204); poller.end(); }
    poller = res;
    const t = setTimeout(() => { if (poller === res) { poller = null; res.writeHead(204); res.end(); } }, 25000);
    res.on('close', () => { clearTimeout(t); if (poller === res) poller = null; });
    deliver();
    return;
  }
  if (url.pathname === '/result' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on('end', () => {
      try {
        const msg = JSON.parse(body);
        const w = waiting.get(msg.id);
        if (w) { clearTimeout(w.timer); waiting.delete(msg.id); w.resolve(msg); }
        res.end('{"ok":true}');
      } catch (_) { res.writeHead(400); res.end('bad json'); }
    });
    return;
  }
  res.writeHead(404); res.end();
});
server.on('error', (e) => log(`Không mở được cổng ${PORT}: ${e.message}`));
server.listen(PORT, '127.0.0.1', () => log(`đang chờ AutoFlow tại http://127.0.0.1:${PORT}`));

// ---------- Định nghĩa công cụ ----------
const TOOLS = [
  {
    name: 'autoflow_status',
    description: 'Trạng thái AutoFlow: hàng đợi (đang chạy/chờ/xong/lỗi), tài khoản AI đang mở, số workflow.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    timeout: 30000
  },
  {
    name: 'autoflow_generate',
    description: 'Tạo ảnh/video hàng loạt bằng tài khoản của người dùng (Google Flow mặc định, hoặc ChatGPT/Gemini/Grok). Mỗi prompt tạo 1 lượt. Mặc định chờ xong và trả về file đã tải.',
    inputSchema: {
      type: 'object',
      properties: {
        prompts: { type: 'array', items: { type: 'string' }, minItems: 1, description: 'Danh sách prompt' },
        provider: { type: 'string', enum: ['flow', 'chatgpt', 'gemini', 'grok'], default: 'flow' },
        type: { type: 'string', enum: ['image', 'video'], default: 'image' },
        model: { type: 'string', description: 'Tên model trên Flow (vd. "Nano Banana Pro", "Veo 3.1 - Fast"); bỏ trống = giữ như Flow' },
        ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
        quantity: { type: 'integer', minimum: 1, maximum: 4, default: 1 },
        video_mode: { type: 'string', enum: ['text', 'frames', 'ingredients'], default: 'text' },
        duration: { type: 'string', description: 'vd. "8s"' },
        wait: { type: 'boolean', default: true, description: 'Chờ tạo xong rồi trả kết quả' },
        timeout_sec: { type: 'integer', minimum: 30, maximum: 3600, default: 1200 }
      },
      required: ['prompts'],
      additionalProperties: false
    },
    timeout: (a) => ((a.wait === false ? 60 : (a.timeout_sec || 1200)) + 60) * 1000
  },
  {
    name: 'autoflow_list_workflows',
    description: 'Liệt kê workflow đã lưu trong AutoFlow (id, tên, số node).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    timeout: 30000
  },
  {
    name: 'autoflow_run_workflow',
    description: 'Chạy một workflow theo id hoặc tên. Mặc định chờ chạy xong và trả về kết quả từng node.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, name: { type: 'string' }, wait: { type: 'boolean', default: true }, timeout_sec: { type: 'integer', minimum: 30, maximum: 7200, default: 3600 } },
      additionalProperties: false
    },
    timeout: (a) => ((a.wait === false ? 60 : (a.timeout_sec || 3600)) + 60) * 1000
  },
  {
    name: 'autoflow_create_workflow',
    description: 'Dựng workflow mới. Node type: prompt, text, extract, assistant, list, image, generate, seedance, chatgpt, gemini, grok, download, telegram, delay. Cạnh dạng "khoá_node.cổng". Cổng: prompt/text/extract/assistant ra "text" (assistant vào "text","image_ref"; data.provider chatgpt|claude|gemini|grok, data.exportAs list|text); list vào "in", ra "items" (node sau chạy mỗi mục một lượt); generate vào "text","image_ref","frame_1","frame_2","video_ref", ra "media","frame"; seedance vào "text","frame_1","frame_2", ra "media"; download vào "media"; telegram vào "media" (gửi về chat Telegram đã liên kết, data.caption), ra "pass".',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        nodes: {
          type: 'array',
          items: { type: 'object', properties: { key: { type: 'string' }, type: { type: 'string' }, data: { type: 'object' } }, required: ['key', 'type'] }
        },
        edges: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } },
        run: { type: 'boolean', default: false }
      },
      required: ['name', 'nodes'],
      additionalProperties: false
    },
    timeout: 60000
  },
  {
    name: 'autoflow_recent_results',
    description: 'Các kết quả tạo gần đây (prompt, loại, tên file đã tải).',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }, additionalProperties: false },
    timeout: 30000
  }
];

// ---------- JSON-RPC qua stdio (mỗi dòng một thông điệp) ----------
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'autoflow', version: VERSION } } });
  } else if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
  } else if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  } else if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) { send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Không có công cụ ${params?.name}` } }); return; }
    const args = params.arguments || {};
    const r = await callExtension(tool.name, args, typeof tool.timeout === 'function' ? tool.timeout(args) : tool.timeout);
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.ok ? JSON.stringify(r.result, null, 2) : `Lỗi: ${r.error}` }], isError: !r.ok } });
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Không hỗ trợ ${method}` } });
  }
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { handle(JSON.parse(line)).catch((e) => log(e.message)); } catch (e) { log(`JSON lỗi: ${e.message}`); }
  }
});
process.stdin.on('end', () => process.exit(0));

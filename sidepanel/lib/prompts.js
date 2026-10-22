// Tách prompt, biến {a|b}, đọc CSV/TXT, đặt tên file.

export function splitPrompts(text, multi, split) {
  const raw = String(text || '').replace(/\r/g, '');
  if (!multi) return raw.trim() ? [raw.trim()] : [];
  const parts = split === 'blank' ? raw.split(/\n\s*\n/) : raw.split('\n');
  return parts.map((p) => p.trim()).filter(Boolean);
}

const SPIN_RE = /\{([^{}]*\|[^{}]*)\}/g;
const MAX_COMBOS = 200;

// "{a|b} con {mèo|chó}": random → mỗi lượt chọn ngẫu nhiên; all → mọi tổ hợp (tối đa 200).
export function expandSpin(prompt, mode) {
  if (!SPIN_RE.test(prompt)) return [prompt];
  SPIN_RE.lastIndex = 0;
  if (mode !== 'all') return [prompt.replace(SPIN_RE, (_, g) => { const o = g.split('|'); return o[Math.floor(Math.random() * o.length)].trim(); })];
  let results = [''];
  let last = 0;
  for (const m of prompt.matchAll(SPIN_RE)) {
    const lit = prompt.slice(last, m.index);
    const opts = m[1].split('|').map((s) => s.trim());
    const next = [];
    for (const r of results) for (const o of opts) { if (next.length < MAX_COMBOS) next.push(r + lit + o); }
    results = next;
    last = m.index + m[0].length;
  }
  return results.map((r) => r + prompt.slice(last));
}

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

const COLS = {
  prompt: ['prompt', 'text', 'nội dung', 'noi dung'],
  genType: ['type', 'gentype', 'loại', 'loai', 'media'],
  model: ['model'],
  ratio: ['ratio', 'aspect', 'aspect_ratio', 'tỉ lệ', 'ti le'],
  quantity: ['quantity', 'count', 'n', 'số lượng', 'so luong', 'outputs'],
  videoMode: ['mode', 'videomode', 'video_mode', 'chế độ'],
  duration: ['duration', 'thời lượng', 'thoi luong'],
  resolution: ['resolution', 'độ phân giải'],
  repeat: ['repeat', 'lặp', 'lap']
};

// CSV có dòng tiêu đề → task có cài đặt riêng; không có tiêu đề → cột đầu là prompt.
export function csvToTasks(text) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {};
  for (const [key, names] of Object.entries(COLS)) idx[key] = header.findIndex((h) => names.includes(h));
  const hasHeader = idx.prompt >= 0;
  const body = hasHeader ? rows.slice(1) : rows;
  return body.map((r) => {
    if (!hasHeader) return { prompt: r[0].trim() };
    const get = (k) => (idx[k] >= 0 ? String(r[idx[k]] ?? '').trim() : '');
    const t = { prompt: get('prompt') };
    const type = get('genType').toLowerCase();
    if (type) t.genType = type.startsWith('v') ? 'video' : 'image';
    if (get('model')) t.model = get('model');
    if (get('ratio')) t.ratio = get('ratio');
    if (get('quantity')) t.quantity = Math.min(4, Math.max(1, parseInt(get('quantity'), 10) || 1));
    const mode = get('videoMode').toLowerCase();
    if (mode) t.videoMode = mode.startsWith('f') ? 'frames' : mode.startsWith('i') ? 'ingredients' : 'text';
    if (get('duration')) t.duration = `${parseInt(get('duration'), 10)}s`;
    if (get('resolution')) t.resolution = get('resolution').toLowerCase();
    if (get('repeat')) t.repeat = Math.max(1, parseInt(get('repeat'), 10) || 1);
    return t;
  }).filter((t) => t.prompt);
}

export function slug(text, max = 40) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max).toLowerCase() || 'prompt';
}

const pad = (n, w = 2) => String(n).padStart(w, '0');

export function buildFilename(pattern, ctx) {
  const d = new Date(ctx.time || Date.now());
  const vars = {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`,
    index: pad(ctx.index, 3),
    prompt: slug(ctx.prompt),
    n: ctx.n,
    type: ctx.genType || 'image',
    model: slug(ctx.model || 'flow', 24),
    project: ctx.project ? slug(ctx.project, 30) : ''
  };
  // Hỗ trợ cả {date} và [Date] (kiểu của bản gốc); biến rỗng thì bỏ luôn dấu "_" thừa.
  const out = String(pattern || '{index}_{prompt}_{n}')
    .replace(/\{(\w+)\}|\[(\w+)\]/g, (m, a, b) => { const k = (a || b).toLowerCase(); return k in vars ? vars[k] : m; });
  return out.replace(/_{2,}/g, '_').replace(/(^|\/)_+|_+($|\/)/g, '$1$2') || 'autoflow';
}

export function extFor(kind, url, mime) {
  const m = String(mime || '').split(';')[0];
  if (m.includes('/')) {
    const e = m.split('/')[1];
    return e === 'jpeg' ? 'jpg' : e === 'quicktime' ? 'mov' : e;
  }
  const fromUrl = /\.(mp4|webm|mov|png|jpe?g|webp|gif)(?:$|[?#=])/i.exec(url || '');
  if (fromUrl) return fromUrl[1].toLowerCase().replace('jpeg', 'jpg');
  return kind === 'video' ? 'mp4' : 'png';
}

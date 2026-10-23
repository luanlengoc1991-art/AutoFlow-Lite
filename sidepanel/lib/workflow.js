// Bộ chạy workflow: chạy node theo thứ tự đồ thị (cạnh + tham chiếu @slug), mỗi bước tạo task trong hàng đợi chung.
import { store, uid } from './store.js';
import { FINAL } from './runner.js';
import { PROVIDERS } from './providers.js';
import * as flow from './flow.js';
import { NODE_DEFS, portsOf } from './workflow-nodes.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MENTION_RE = /@([a-z0-9_]+)/gi;

export function splitLines(text) {
  let raw = String(text || '');
  // AI đôi khi viết "1. ... 2. ..." trên cùng một dòng.
  if (!raw.includes('\n') && (raw.match(/(^|\s)\d+[.)]\s/g) || []).length >= 2) raw = raw.replace(/\s+(?=\d+[.)]\s)/g, '\n');
  return raw.split('\n')
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•]|prompt\s*\d*\s*:)\s*/i, '').replace(/^["“]|["”]$/g, '').trim())
    .filter((l) => l.length > 3);
}

// Các trường văn bản có thể chứa @slug.
const TEXT_FIELDS = ['text', 'prompt', 'agentInstruction'];

function mentionDeps(node, bySlug) {
  const deps = new Set();
  for (const f of TEXT_FIELDS) {
    for (const m of String(node.data[f] || '').matchAll(MENTION_RE)) {
      const src = bySlug.get(m[1].toLowerCase());
      if (src && src.id !== node.id) deps.add(src.id);
    }
  }
  return deps;
}

export function analyze(wf) {
  const nodes = wf.nodes.filter((n) => n.type !== 'note');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const bySlug = new Map(nodes.filter((n) => n.data.slug).map((n) => [n.data.slug.toLowerCase(), n]));
  const deps = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const e of wf.edges) if (byId.has(e.from.node) && byId.has(e.to.node)) deps.get(e.to.node).add(e.from.node);
  for (const n of nodes) for (const d of mentionDeps(n, bySlug)) deps.get(n.id).add(d);
  const order = [], state = new Map();
  const visit = (id) => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) throw new Error('Workflow có vòng lặp, hãy bỏ bớt kết nối');
    state.set(id, 1);
    deps.get(id).forEach(visit);
    state.set(id, 2);
    order.push(byId.get(id));
  };
  nodes.forEach((n) => visit(n.id));
  return { order, deps, byId, bySlug };
}

// stop(id): node nguồn đủ dữ liệu (vd. List đã có mục), không cần chạy lại các node phía trước nó.
function ancestorsOf(ids, deps, stop = () => false) {
  const out = new Set();
  const walk = (id) => { if (out.has(id)) return; out.add(id); if (!ids.includes(id) && stop(id)) return; (deps.get(id) || []).forEach(walk); };
  ids.forEach(walk);
  return out;
}

// Node nằm trong khung ghi chú.
export function nodesInNote(wf, note) {
  const { x, y } = note, w = note.data.w, h = note.data.h;
  return wf.nodes.filter((n) => n.type !== 'note' && n.x >= x && n.y >= y && n.x < x + w && n.y < y + h).map((n) => n.id);
}

const preview = (items, max = 24) => items.slice(0, max).map((it) => (it.kind === 'text'
  ? { kind: 'text', text: it.text.slice(0, 2000) }
  : { kind: it.kind, thumb: it.thumb || '', url: it.url || '', provider: it.provider || '' }));

// Mục của node List được lưu lại vào node (để sửa tay rồi chạy tiếp các node phía sau).
const MAX_LIST = 200;
const listItem = (it) => (it.kind === 'text'
  ? { kind: 'text', text: String(it.text || '') }
  : { kind: it.kind === 'frame' ? 'image' : it.kind, url: it.url || '', thumb: it.thumb || '', provider: it.provider || '', ...(it.dataUrl && !it.url ? { dataUrl: it.dataUrl, mime: it.mime } : {}) });
const listKind = (items) => {
  const kinds = new Set(items.map((i) => i.kind));
  return kinds.size === 1 ? [...kinds][0] : kinds.size ? 'any' : '';
};

// Ghép prompt với ảnh: cùng số lượng thì ghép 1-1, khác thì mỗi prompt × mỗi ảnh.
function combine(a, b) {
  if (a.length > 1 && a.length === b.length) return a.map((x, i) => [x, b[i]]);
  return a.flatMap((x) => b.map((y) => [x, y]));
}

export class WorkflowRunner {
  constructor({ runner, log, onUpdate }) {
    this.runner = runner;
    this.log = log;
    this.onUpdate = onUpdate;
    this.state = null; // { workflowId, name, running, nodes: { id: { status, count, error, title, preview } } }
    this.cache = new Map(); // workflowId -> { nodeId: outputs } từ lần chạy trước (để chạy riêng 1 node)
  }

  enqueue(fields) {
    const index = store.tasks.reduce((m, t) => Math.max(m, t.index || 0), 0) + 1;
    const task = { id: uid(), index, status: 'pending', attempts: 0, createdAt: Date.now(), autoDownload: true, refIds: [], ...fields };
    store.tasks.push(task);
    store.save('tasks');
    return task;
  }

  // onProgress(doneCount) được gọi mỗi khi một task kết thúc.
  waitTasks(tasks, onProgress) {
    return new Promise((resolve) => {
      const pending = new Set(tasks.filter((t) => !FINAL.has(t.status)).map((t) => t.id));
      if (!pending.size) { resolve(tasks); return; }
      const off = this.runner.onSettled((t) => {
        if (!pending.delete(t.id)) return;
        onProgress?.(tasks.length - pending.size);
        this.onUpdate();
        if (!pending.size) { off(); resolve(tasks); }
      });
      if (!this.runner.running) this.runner.start();
    });
  }

  // Hỏi AI (ChatGPT/Claude/Gemini/Grok) và trả về câu trả lời văn bản.
  async ask(provider, prompt, extra = {}) {
    const task = this.enqueue({ provider, chatMode: 'text', prompt, autoDownload: false, newChat: true, ...extra });
    this.onUpdate();
    await this.waitTasks([task]);
    if (task.status !== 'done') throw new Error(task.error || `${PROVIDERS[provider].name} không trả lời`);
    return task.text || '';
  }

  // Media item → id ảnh tham chiếu (data URL lưu trong store.refs).
  async toRef(item) {
    if (item.refId && store.refs[item.refId]) return item.refId;
    let dataUrl = item.dataUrl, mime = item.mime;
    if (!dataUrl) ({ dataUrl, mime } = await this.runner.mediaToDataUrl({ provider: item.provider || 'flow' }, item));
    item.refId = store.addRef({ name: item.kind === 'video' ? 'video.mp4' : 'image.png', mime, dataUrl });
    return item.refId;
  }

  async lastFrame(item) {
    const tab = await flow.findTab('flow');
    if (!tab) throw new Error('Cần mở tab Flow để lấy khung cuối video');
    const r = await flow.send(tab.id, { type: 'afl:lastFrame', url: item.url });
    if (!r?.ok) throw new Error(r?.error || 'Không lấy được khung cuối');
    return { kind: 'frame', dataUrl: r.dataUrl, mime: 'image/jpeg', thumb: r.thumb || r.dataUrl, provider: 'flow' };
  }

  resolveMentions(text, ctx) {
    return String(text || '').replace(MENTION_RE, (m, slug) => {
      const src = ctx.bySlug.get(slug.toLowerCase());
      if (!src) return m;
      const items = Object.values(ctx.outputs.get(src.id) || {}).flat().filter((i) => i.kind === 'text');
      return items.length ? items.map((i) => i.text).join('\n') : m;
    }).trim();
  }

  // inputs: { portName: items[] }. Trả về { outPortName: items[] }.
  async execNode(node, inputs, ctx) {
    const d = node.data;
    const texts = (inputs.text || []).filter((i) => i.kind === 'text').map((i) => i.text);
    switch (node.type) {
      case 'text':
        return { text: d.text.trim() ? [{ kind: 'text', text: this.resolveMentions(d.text, ctx) }] : [] };

      case 'prompt': {
        const own = this.resolveMentions(d.text, ctx);
        let parts = texts.length ? texts.map((t) => (own ? (own.includes('{input}') ? own.replaceAll('{input}', t) : `${own}\n${t}`) : t)) : own ? [own] : [];
        if (d.multi) parts = parts.flatMap((p) => p.split('\n').map((l) => l.trim()).filter(Boolean));
        if (!d.agent) return { text: parts.map((text) => ({ kind: 'text', text })) };
        const refIds = [];
        for (const it of inputs.image_ref || []) refIds.push(await this.toRef(it));
        const out = [];
        for (const p of parts.length ? parts : ['']) {
          if (ctx.cancelled) break;
          const request = [this.resolveMentions(d.agentInstruction, ctx), p].filter(Boolean).join('\n\n');
          const answer = await this.ask(d.agentProvider || 'chatgpt', request, { refIds, workflowRun: ctx.runId });
          const lines = d.agentSplit ? splitLines(answer) : [answer.trim()];
          out.push(...lines.map((text) => ({ kind: 'text', text })));
        }
        return { text: out };
      }

      case 'extract': {
        const src = texts.join('\n');
        let out = [];
        if (d.mode === 'marker') {
          // Đoạn sau mốc [tên_mốc] cho tới mốc [..] kế tiếp (hoặc hết văn bản).
          const name = String(d.marker || '').replace(/^\[|\]$/g, '').trim();
          const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const m = new RegExp(`\\[${esc(name)}\\]\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*\\[[^\\]\\n]{1,60}\\]|$)`, 'i').exec(src);
          out = m && m[1].trim() ? [m[1].trim()] : [];
          if (!out.length) throw new Error(`Không tìm thấy mốc [${name}] trong văn bản đầu vào`);
        } else if (d.mode === 'lines') out = splitLines(src);
        else if (d.mode === 'line') out = [src.split('\n').map((l) => l.trim()).filter(Boolean)[(parseInt(d.index, 10) || 1) - 1]].filter(Boolean);
        else if (d.mode === 'regex') {
          const re = new RegExp(d.pattern || '.+', 'g');
          out = [...src.matchAll(re)].map((m) => (m[1] ?? m[0]).trim()).filter(Boolean);
        } else if (d.mode === 'between') {
          const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`${esc(d.start || '')}([\\s\\S]*?)${d.end ? esc(d.end) : '$'}`, 'g');
          out = [...src.matchAll(re)].map((m) => m[1].trim()).filter(Boolean);
        } else if (d.mode === 'json') {
          const json = JSON.parse(src.slice(src.indexOf('{') >= 0 && (src.indexOf('[') < 0 || src.indexOf('{') < src.indexOf('[')) ? src.indexOf('{') : src.indexOf('['), Math.max(src.lastIndexOf('}'), src.lastIndexOf(']')) + 1));
          let v = json;
          for (const key of String(d.path || '').split('.').filter(Boolean)) v = v?.[/^\d+$/.test(key) ? +key : key];
          out = (Array.isArray(v) ? v : [v]).filter((x) => x != null).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
        }
        return { text: out.map((text) => ({ kind: 'text', text })) };
      }

      case 'image': {
        const media = (d.media || []).map((m) => ({ kind: m.kind || 'image', dataUrl: m.dataUrl, mime: m.mime, thumb: m.thumb || m.dataUrl, url: m.url || '', provider: m.provider || '' }));
        return { media };
      }

      case 'assistant': {
        const provider = d.provider || 'chatgpt';
        const refIds = [];
        for (const it of inputs.image_ref || []) refIds.push(await this.toRef(it));
        const request = [this.resolveMentions(d.text, ctx), ...texts].filter(Boolean).join('\n\n');
        if (!request) throw new Error('Chưa có yêu cầu cho Assistant');
        const wantList = d.exportAs === 'list';
        const ask = wantList ? `${request}\n\nReturn only the items, one per line, without numbering or extra text.` : request;
        const answer = await this.ask(provider, ask, { refIds, workflowRun: ctx.runId });
        const lines = wantList ? splitLines(answer) : [answer.trim()];
        return { text: lines.filter(Boolean).map((text) => ({ kind: 'text', text })) };
      }

      case 'list': {
        const incoming = Object.values(inputs).flat().map(listItem);
        const own = (d.items || []).map(listItem);
        // Không có dữ liệu mới thì giữ danh sách đang có (kể cả mục đã sửa tay).
        const items = (!incoming.length ? own : d.keep === 'append' ? [...own, ...incoming] : incoming).slice(0, MAX_LIST);
        if (ctx.nodeState) Object.assign(ctx.nodeState, { listItems: items, listKind: listKind(items) });
        return { items };
      }

      case 'generate':
      case 'seedance':
      case 'chatgpt':
      case 'gemini':
      case 'grok': {
        const own = this.resolveMentions(d.prompt, ctx);
        let prompts = texts.length ? texts.map((t) => (own ? (own.includes('{input}') ? own.replaceAll('{input}', t) : `${own} ${t}`) : t)) : own ? [own] : [];
        const isSeedance = node.type === 'seedance';
        const isVideo = isSeedance || (node.type === 'generate' && d.genType === 'video');
        const usesFrames = isSeedance || (isVideo && d.videoMode === 'frames');
        // Seedance tạo được video chỉ từ ảnh khung đầu.
        if (!prompts.length && isSeedance && inputs.frame_1?.length) prompts = [''];
        if (!prompts.length) throw new Error('Chưa có prompt (nối node Prompt hoặc nhập prompt trong node)');
        // Mỗi lượt: một prompt + bộ ảnh tham chiếu của lượt đó.
        let jobs;
        if (usesFrames) {
          const end = inputs.frame_2?.[0] ? await this.toRef(inputs.frame_2[0]) : null;
          const starts = [];
          for (const it of inputs.frame_1 || []) starts.push(await this.toRef(it));
          jobs = combine(prompts, starts.length ? starts : [null]).map(([prompt, start]) => ({ prompt, refIds: [start, end].filter(Boolean) }));
        } else {
          const refs = [];
          for (const it of inputs.image_ref || []) refs.push(await this.toRef(it));
          // Ingredients: video chuyển động mẫu cũng được tải lên làm thành phần.
          const extra = isVideo && inputs.video_ref?.[0] ? [await this.toRef(inputs.video_ref[0])] : [];
          jobs = d.perImage && refs.length > 1
            ? combine(prompts, refs).map(([prompt, ref]) => ({ prompt, refIds: [ref, ...extra] }))
            : prompts.map((prompt) => ({ prompt, refIds: [...refs, ...extra] }));
        }
        const tasks = jobs.map(({ prompt, refIds }) => {
          const common = { workflowRun: ctx.runId, autoDownload: false, refIds, prompt };
          if (isSeedance) return this.enqueue({ ...common, provider: 'seedance', genType: 'video', model: d.model || '', ratio: d.ratio || '', duration: d.duration || '' });
          if (node.type === 'generate') {
            return this.enqueue({
              ...common, provider: 'flow', genType: isVideo ? 'video' : 'image',
              videoMode: isVideo ? (refIds.length ? d.videoMode : 'text') : 'text',
              model: d.model || '', ratio: d.ratio || '', quantity: Math.min(4, Math.max(1, +d.quantity || 1)),
              duration: isVideo ? d.duration || '' : '', resolution: ''
            });
          }
          return this.enqueue({ ...common, provider: node.type, chatMode: 'image', newChat: d.newChat !== false });
        });
        const st = ctx.nodeState;
        if (st) Object.assign(st, { total: tasks.length, done: 0 });
        this.onUpdate();
        await this.waitTasks(tasks, (done) => { if (st) st.done = done; });
        const media = [];
        for (const t of tasks) {
          if (t.status !== 'done') { ctx.errors.push(`#${t.index}: ${t.error || t.status}`); continue; }
          for (const r of t.results || []) media.push({ kind: r.kind, url: r.url, thumb: r.thumb, provider: t.provider || 'flow', prompt: t.prompt });
        }
        if (!media.length && tasks.length) throw new Error(tasks.map((t) => t.error).filter(Boolean)[0] || 'Không có kết quả');
        const out = { media };
        if (isVideo && ctx.wanted.has(`${node.id}:frame`)) {
          out.frame = [];
          for (const m of media) {
            try { out.frame.push(await this.lastFrame(m)); } catch (e) { ctx.errors.push(e.message); }
          }
        }
        return out;
      }

      case 'download': {
        const items = (inputs.media || []).filter((i) => i.kind !== 'text');
        let n = 0;
        const folder = d.folder?.trim() ? `${store.settings.folder || 'AutoFlow'}/${d.folder.trim()}` : ctx.folder;
        for (const it of items) {
          n++;
          const tab = it.provider ? await flow.findTab(it.provider) : null;
          const fake = { index: n, prompt: it.prompt || ctx.name, provider: it.provider || 'flow', genType: it.kind, createdAt: Date.now(), folder };
          if (it.dataUrl) {
            await chrome.runtime.sendMessage({ type: 'afl:download', url: it.dataUrl, filename: `${this.runner.baseName(fake, n)}.${it.kind === 'video' ? 'mp4' : 'png'}` });
          } else if (tab) {
            await this.runner.download(tab.id, fake, it, n);
          }
        }
        return {};
      }

      case 'delay': {
        const until = Date.now() + Math.max(0, +d.seconds || 0) * 1000;
        while (Date.now() < until && !ctx.cancelled) await sleep(250);
        return { out: Object.values(inputs).flat() };
      }

      default:
        throw new Error(`Node không hỗ trợ: ${node.type}`);
    }
  }

  // opts.only: id node cần chạy (kèm node phía trước chưa có kết quả lưu sẵn).
  async run(workflow, opts = {}) {
    if (this.state?.running) throw new Error('Đang chạy một workflow khác');
    const { order, deps, bySlug, byId } = analyze(workflow);
    if (!order.length) throw new Error('Workflow trống, hãy thêm node');
    const cached = this.cache.get(workflow.id) || {};
    let runSet = null;
    if (opts.only?.length) {
      runSet = new Set(opts.only);
      // Node phía trước: dùng kết quả lần trước nếu có, nếu không thì chạy lại.
      const filledList = (id) => byId.get(id)?.type === 'list' && byId.get(id).data.items?.length > 0;
      for (const id of ancestorsOf(opts.only, deps, filledList)) if (!runSet.has(id) && !cached[id]) runSet.add(id);
    }
    const wanted = new Set(workflow.edges.map((e) => `${e.from.node}:${e.from.port}`));
    const ctx = {
      runId: uid(), cancelled: false, errors: [], bySlug, outputs: new Map(), wanted, name: workflow.name,
      folder: `${store.settings.folder || 'AutoFlow'}/${workflow.name.replace(/[\\/:*?"<>|]+/g, '_')}`
    };
    this.ctx = ctx;
    const todo = order.filter((n) => !runSet || runSet.has(n.id));
    this.state = {
      workflowId: workflow.id, name: workflow.name, running: true, startedAt: Date.now(),
      nodes: Object.fromEntries(todo.map((n) => [n.id, { status: 'pending', count: 0, title: n.data.name || NODE_DEFS[n.type].title }]))
    };
    const prevConcurrency = store.settings.concurrency;
    if (workflow.maxSpeed) store.settings.concurrency = Math.max(prevConcurrency, 3);
    this.log(`Chạy workflow "${workflow.name}" (${todo.length} node${workflow.maxSpeed ? ', Max Speed' : ''})`);
    this.onUpdate();
    try {
      for (const node of order) {
        if (ctx.cancelled || this.runner.stopRequested) { ctx.cancelled = true; break; }
        if (runSet && !runSet.has(node.id)) {
          // List giữ đúng các mục đang hiển thị (có thể đã sửa tay), không dùng bản cache cũ.
          ctx.outputs.set(node.id, node.type === 'list' && node.data.items?.length ? { items: node.data.items.map(listItem) } : cached[node.id] || {});
          continue;
        }
        const st = this.state.nodes[node.id];
        const inputs = {};
        let hasUpstream = false, upstreamItems = 0;
        for (const e of workflow.edges.filter((x) => x.to.node === node.id)) {
          hasUpstream = true;
          const items = ctx.outputs.get(e.from.node)?.[e.from.port] || [];
          upstreamItems += items.length;
          (inputs[e.to.port] ||= []).push(...items);
        }
        if (!node.data.enabled) { Object.assign(st, { status: 'skipped', error: 'Node đang tắt' }); ctx.outputs.set(node.id, {}); this.onUpdate(); continue; }
        const needsInput = NODE_DEFS[node.type].ins.length && !['prompt', 'generate', 'seedance', 'chatgpt', 'gemini', 'grok', 'assistant', 'list'].includes(node.type);
        if (hasUpstream && !upstreamItems && needsInput) { Object.assign(st, { status: 'skipped' }); ctx.outputs.set(node.id, {}); this.onUpdate(); continue; }
        st.status = 'running';
        st.startedAt = Date.now();
        ctx.nodeState = st;
        this.onUpdate();
        try {
          const out = await this.execNode(node, inputs, ctx);
          ctx.outputs.set(node.id, out);
          const items = Object.values(out).flat();
          Object.assign(st, { status: 'done', count: items.length, preview: preview(items, node.type === 'list' ? MAX_LIST : 24), finishedAt: Date.now() });
        } catch (e) {
          ctx.outputs.set(node.id, {});
          Object.assign(st, { status: 'error', error: e.message });
          this.log(`Workflow: node "${st.title}" lỗi: ${e.message}`, 'error');
        }
        this.onUpdate();
      }
    } finally {
      store.settings.concurrency = prevConcurrency;
      this.cache.set(workflow.id, { ...cached, ...Object.fromEntries(ctx.outputs) });
      this.state.running = false;
      this.state.finishedAt = Date.now();
      this.state.errors = ctx.errors;
      this.log(ctx.cancelled ? `Workflow "${workflow.name}" đã dừng` : `Workflow "${workflow.name}" xong${ctx.errors.length ? `, ${ctx.errors.length} lỗi` : ''}`, ctx.cancelled ? 'warn' : 'ok');
      this.onUpdate();
    }
    return ctx.outputs;
  }

  cancel() {
    if (!this.ctx) return;
    this.ctx.cancelled = true;
    this.runner.stop();
  }
}

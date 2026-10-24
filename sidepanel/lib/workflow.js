// Bộ chạy workflow: chạy node theo thứ tự đồ thị (cạnh + tham chiếu @slug), mỗi bước tạo task trong hàng đợi chung.
import { store, uid } from './store.js';
import { FINAL } from './runner.js';
import { PROVIDERS } from './providers.js';
import * as flow from './flow.js';
import { NODE_DEFS, portsOf, splitMultiPrompt } from './workflow-nodes.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Text Extract không tìm thấy + "Bỏ qua nhánh sau": node này và mọi node phía sau được đánh dấu bỏ qua.
class SkipBranch extends Error {}
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
  : { kind: it.kind, thumb: it.thumb || '', url: it.url || '', provider: it.provider || '', ...(it.prompt ? { prompt: String(it.prompt).slice(0, 1000) } : {}) }));

// Mục của node List được lưu lại vào node (để sửa tay rồi chạy tiếp các node phía sau).
const MAX_LIST = 200;
const listItem = (it) => (it.kind === 'text'
  ? { kind: 'text', text: String(it.text || '') }
  : { kind: it.kind === 'frame' ? 'image' : it.kind, url: it.url || '', thumb: it.thumb || '', provider: it.provider || '', ...(it.dataUrl && !it.url ? { dataUrl: it.dataUrl, mime: it.mime } : {}) });
const listKind = (items) => {
  const kinds = new Set(items.map((i) => i.kind));
  return kinds.size === 1 ? [...kinds][0] : kinds.size ? 'any' : '';
};

const GEN_TYPES = new Set(['generate', 'seedance', 'chatgpt', 'gemini', 'grok']);
// Dấu nội dung yêu cầu của node AI (để biết câu trả lời đã lưu còn đúng không).
const aiSig = (n) => JSON.stringify([n.data.text, n.data.agentInstruction, n.data.agentProvider, n.data.provider, n.data.exportAs, n.data.agentSplit, n.data.multi]);

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

  // % tiến độ của các node đang tạo (trung bình % các lượt của node). Trả về true nếu có thay đổi.
  refreshProgress() {
    let changed = false;
    for (const st of Object.values(this.state?.nodes || {})) {
      if (st.status !== 'running' || !st.taskIds?.length) continue;
      const ts = st.taskIds.map((id) => store.tasks.find((t) => t.id === id)).filter(Boolean);
      const p = ts.length ? Math.round(ts.reduce((a, t) => a + (FINAL.has(t.status) ? 100 : +t.progress || 0), 0) / ts.length) : 0;
      if (p !== st.progress) { st.progress = p; changed = true; }
    }
    return changed;
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
      const all = Object.values(ctx.outputs.get(src.id) || {}).flat();
      const items = all.filter((i) => i.kind === 'text');
      if (items.length) return items.map((i) => i.text).join('\n');
      // @slug của node ảnh/video: dùng để chọn ảnh tham chiếu (Mention Mode), không gửi vào prompt.
      return all.length ? '' : m;
    }).replace(/[ \t]{2,}/g, ' ').trim();
  }

  // Id các node được @mention trong văn bản.
  mentionedIds(text, ctx) {
    const ids = new Set();
    for (const m of String(text || '').matchAll(MENTION_RE)) { const src = ctx.bySlug.get(m[1].toLowerCase()); if (src) ids.add(src.id); }
    return ids;
  }

  // Mention Mode: prompt / ảnh tham chiếu từ node phía trước.
  // all: dùng tất cả · mention: chỉ node được @mention · auto: có @mention thì như mention, không thì all.
  // Prompt từ node đã @mention được chèn ngay vào chỗ @slug nên không ghép thêm lần nữa.
  pickTexts(items, ownRaw, mode, ctx) {
    const ids = this.mentionedIds(ownRaw, ctx);
    if (mode === 'all') return items;
    if (mode === 'mention') return [];
    return items.filter((i) => !ids.has(i._src));
  }
  pickRefs(items, ownRaw, mode, ctx) {
    const ids = this.mentionedIds(ownRaw, ctx);
    if (mode === 'all') return items;
    const hit = items.filter((i) => ids.has(i._src));
    return mode === 'mention' || hit.length ? hit : items;
  }

  // Khung cuối video của Gemini/Grok: tách ngay trong side panel (không cần tab Flow).
  async localLastFrame(item) {
    const { dataUrl } = item.dataUrl ? item : await this.runner.mediaToDataUrl({ provider: item.provider || 'flow' }, item);
    const v = document.createElement('video');
    v.muted = true;
    v.src = dataUrl;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Không đọc được video')); });
    v.currentTime = Math.max(0, (v.duration || 0) - 0.05);
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 3000); });
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 1; c.height = v.videoHeight || 1;
    c.getContext('2d').drawImage(v, 0, 0);
    const url = c.toDataURL('image/jpeg', 0.92);
    return { kind: 'frame', dataUrl: url, mime: 'image/jpeg', thumb: url, provider: item.provider || '' };
  }

  // Một lượt tạo trên provider của node (Flow / Seedance / trang chat).
  genTask(node, d, ctx, { prompt, refIds }, isVideo, single = false) {
    const common = {
      workflowRun: ctx.runId, autoDownload: !!d.autoDownload, folder: ctx.folder, refIds, prompt,
      ...(+d.timeoutSec > 0 ? { timeoutMs: +d.timeoutSec * 1000 } : {})
    };
    if (node.type === 'seedance') return this.enqueue({ ...common, provider: 'seedance', genType: 'video', model: d.model || '', ratio: d.ratio || '', duration: d.duration || '' });
    if (node.type === 'generate') {
      return this.enqueue({
        ...common, provider: 'flow', genType: isVideo ? 'video' : 'image',
        videoMode: isVideo ? (refIds.length ? d.videoMode : 'text') : 'text',
        model: d.model || '', ratio: d.ratio || '', quantity: single ? 1 : Math.min(4, Math.max(1, +d.quantity || 1)),
        duration: isVideo ? d.duration || '' : '', resolution: ''
      });
    }
    const chatOverrides = {
      mode: d.mode || 'image', ratio: d.ratio || '', model: d.model || '', quality: d.quality || '', prefix: d.prefix || 'auto',
      ...(d.mode === 'video' ? { duration: d.duration || '', resolution: d.resolution || '' } : {}),
      ...(d.deleteAfter === 'yes' ? { deleteAfter: true } : d.deleteAfter === 'no' ? { deleteAfter: false } : {})
    };
    return this.enqueue({ ...common, provider: node.type, chatMode: 'image', newChat: d.newChat !== false, chatOverrides });
  }

  // Tạo ảnh/video gốc từ prompt + ảnh tham chiếu nối vào node.
  async generateMedia(node, inputs, ctx, texts, isVideo, opts = {}) {
    const d = node.data;
    const own = this.resolveMentions(d.prompt, ctx);
    texts = this.pickTexts((inputs.text || []).filter((i) => i.kind === 'text'), d.prompt, d.promptMode || 'auto', ctx).map((i) => i.text);
    let prompts = opts.rawPrompt ? [opts.rawPrompt]
      : texts.length ? texts.map((t) => (own ? (own.includes('{input}') ? own.replaceAll('{input}', t) : `${own} ${t}`) : t)) : own ? [own] : [];
    const isSeedance = node.type === 'seedance';
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
      for (const it of this.pickRefs(inputs.image_ref || [], d.prompt, d.refMode || 'auto', ctx)) refs.push(await this.toRef(it));
      // Ảnh tham chiếu chọn sẵn trong node (tối đa 4).
      for (const r of (d.refs || []).slice(0, 4)) refs.push(store.addRef({ name: r.name || 'ref.png', mime: r.mime || 'image/png', dataUrl: r.dataUrl }));
      // Ingredients: video chuyển động mẫu cũng được tải lên làm thành phần.
      const extra = isVideo && inputs.video_ref?.[0] ? [await this.toRef(inputs.video_ref[0])] : [];
      jobs = d.perImage && refs.length > 1
        ? combine(prompts, refs).map(([prompt, ref]) => ({ prompt, refIds: [ref, ...extra] }))
        : prompts.map((prompt) => ({ prompt, refIds: [...refs, ...extra] }));
    }
    if (opts.single) jobs = jobs.slice(0, 1);
    const tasks = jobs.map((job) => this.genTask(node, d, ctx, job, isVideo, !!opts.single));
    const st = ctx.nodeState;
    if (st) {
      Object.assign(st, { total: tasks.length, done: 0, taskIds: tasks.map((t) => t.id), progress: 0 });
      // Thông tin lượt chạy cho tab "Kết quả" của trình soạn.
      st.info = {
        provider: tasks[0]?.provider || node.type, genType: isVideo ? 'video' : 'image', model: d.model || d.quality || '', ratio: d.ratio || '', duration: isVideo ? d.duration || '' : '',
        videoMode: node.type === 'generate' && isVideo ? d.videoMode : '', prompts: jobs.slice(0, 20).map((j) => j.prompt.slice(0, 4000)), refs: jobs[0]?.refIds.length || 0
      };
    }
    this.onUpdate();
    await this.waitTasks(tasks, (done) => { if (st) st.done = done; });
    const media = [];
    for (const t of tasks) {
      if (t.status !== 'done') { ctx.errors.push(`#${t.index}: ${t.error || t.status}`); continue; }
      for (const r of t.results || []) media.push({ kind: r.kind, url: r.url, thumb: r.thumb, provider: t.provider || 'flow', prompt: t.prompt });
    }
    if (!media.length && tasks.length) throw new Error(tasks.map((t) => t.error).filter(Boolean)[0] || 'Không có kết quả');
    return media;
  }

  // inputs: { portName: items[] }. Trả về { outPortName: items[] }.
  async execNode(node, inputs, ctx) {
    const d = node.data;
    const texts = (inputs.text || []).filter((i) => i.kind === 'text').map((i) => i.text);
    switch (node.type) {
      case 'text':
        return { text: d.text.trim() ? [{ kind: 'text', text: this.resolveMentions(d.text, ctx) }] : [] };

      case 'prompt': {
        const ownTexts = d.multi ? splitMultiPrompt(d.text).map((p) => this.resolveMentions(p, ctx)) : [this.resolveMentions(d.text, ctx)].filter(Boolean);
        const up = this.pickTexts((inputs.text || []).filter((i) => i.kind === 'text'), d.text, d.promptMode || 'auto', ctx).map((i) => i.text);
        const withUp = (own) => (up.length ? up.map((t) => (own ? (own.includes('{input}') ? own.replaceAll('{input}', t) : `${own}\n${t}`) : t)) : own ? [own] : []);
        // Multi-prompt: mỗi prompt ra cổng riêng p1, p2…; cổng "text" mang tất cả.
        const groups = (ownTexts.length ? ownTexts : ['']).map(withUp);
        let refIds = null;
        const run = async (parts) => {
          if (!d.agent) return parts;
          if (!refIds) {
            refIds = [];
            for (const it of this.pickRefs(inputs.image_ref || [], d.text, d.refMode || 'auto', ctx)) refIds.push(await this.toRef(it));
            for (const r of (d.refs || []).slice(0, 4)) refIds.push(store.addRef({ name: r.name || 'ref.png', mime: r.mime || 'image/png', dataUrl: r.dataUrl }));
          }
          const out = [];
          for (const p of parts.length ? parts : ['']) {
            if (ctx.cancelled) break;
            const request = [this.resolveMentions(d.agentInstruction, ctx), p].filter(Boolean).join('\n\n');
            try {
              const answer = await this.ask(d.agentProvider || 'chatgpt', request, {
                refIds, workflowRun: ctx.runId, timeoutMs: Math.max(10, +d.agentTimeout || 60) * 1000,
                chatOverrides: { deleteAfter: !!d.agentDelete }
              });
              out.push(...(d.agentSplit ? splitLines(answer) : [answer.trim()]));
            } catch (e) {
              // Dự phòng: AI không trả lời (hết giờ / lỗi) thì dùng nguyên văn bản.
              if (d.agentFallback === false || !p) throw e;
              ctx.errors.push(`AI Agent: ${e.message}, dùng văn bản gốc`);
              out.push(p);
            }
          }
          return out;
        };
        const result = { text: [] };
        for (let i = 0; i < groups.length; i++) {
          const items = (await run(groups[i])).filter((t) => t !== '').map((text) => ({ kind: 'text', text }));
          result.text.push(...items);
          if (d.multi) result[`p${i + 1}`] = items;
        }
        return result;
      }

      case 'extract': {
        const src = texts.join('\n');
        const flags = d.strict ? 'g' : 'gi';
        let out = [];
        if (d.mode === 'marker') {
          // Đoạn sau mốc [tên_mốc] cho tới mốc [..] kế tiếp (hoặc hết văn bản).
          const name = String(d.marker || '').replace(/^\[|\]$/g, '').trim();
          const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`\\[${esc(name)}\\]\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*\\[[^\\]\\n]{1,60}\\]|$)`, flags);
          out = [...src.matchAll(re)].map((m) => m[1].trim()).filter(Boolean);
        } else if (d.mode === 'lines') out = splitLines(src);
        else if (d.mode === 'line') out = [src.split('\n').map((l) => l.trim()).filter(Boolean)[(parseInt(d.index, 10) || 1) - 1]].filter(Boolean);
        else if (d.mode === 'regex') {
          const re = new RegExp(d.pattern || '.+', flags);
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
        // Khớp nhiều: tất cả (mỗi mục một lượt) / đầu / cuối / nối thành một.
        if (out.length > 1 && d.multiMatch === 'first') out = out.slice(0, 1);
        else if (out.length > 1 && d.multiMatch === 'last') out = out.slice(-1);
        else if (out.length > 1 && d.multiMatch === 'concat') out = [out.join('\n')];
        if (!out.length) {
          const what = d.mode === 'marker' ? `mốc [${String(d.marker || '').replace(/^\[|\]$/g, '')}]` : 'nội dung cần tách';
          if (d.onFail === 'empty') return { text: [{ kind: 'text', text: '' }] };
          if (d.onFail === 'skip') throw new SkipBranch(`Không tìm thấy ${what}, bỏ qua nhánh sau`);
          if (d.onFail === 'fail') { ctx.cancelled = true; throw new Error(`Không tìm thấy ${what}, dừng workflow`); }
          throw new Error(`Không tìm thấy ${what} trong văn bản đầu vào`);
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
        if (ctx.nodeState) ctx.nodeState.info = { provider, prompts: [request.slice(0, 4000)], refs: refIds.length };
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
        const isSeedance = node.type === 'seedance';
        const isVideo = isSeedance || (node.type === 'generate' && d.genType === 'video') || ((node.type === 'gemini' || node.type === 'grok') && d.mode === 'video');
        const st = ctx.nodeState;
        // Prompt sửa kết quả (cổng "edit"): áp lần lượt lên ảnh/video mới nhất của chính node này.
        const edits = (inputs.edit || []).filter((i) => i.kind === 'text').map((i) => i.text.trim()).filter(Boolean);
        // Chỉ sửa (bấm ▶ trên Prompt sửa): dùng ảnh/video đang có của node, không tạo lại bản gốc.
        const base = ctx.editOnly?.has(node.id) ? ctx.saved(node.id, true)?.media || [] : [];
        let media, history = [];
        if (base.length && edits.length) {
          media = [base[0]];
          history = base;
          if (st) st.info = { ...(ctx.savedInfo(node.id) || {}), editOnly: true };
        } else {
          media = await this.generateMedia(node, inputs, ctx, texts, isVideo);
        }
        if (edits.length) {
          const versions = [];
          let cur = media[0];
          if (st) Object.assign(st, { total: edits.length, done: 0 });
          for (const edit of edits) {
            if (ctx.cancelled) break;
            if (isVideo) {
              // Video: tạo lại với đúng thiết lập + đầu vào của node (khung đầu/cuối, ảnh tham chiếu),
              // prompt gốc + yêu cầu sửa; Ingredients thì kèm video hiện tại làm video tham chiếu.
              const vInputs = { ...inputs };
              if (node.type === 'generate' && d.videoMode === 'ingredients') vInputs.video_ref = [cur];
              const prompt = `${cur.prompt || texts.join('\n') || this.resolveMentions(d.prompt, ctx)}\n\nEdit: ${edit}`.trim();
              try {
                const got = await this.generateMedia(node, vInputs, ctx, [], true, { rawPrompt: prompt, single: true });
                cur = got[0];
                versions.unshift(cur);
              } catch (e) { ctx.errors.push(`Sửa "${edit.slice(0, 40)}": ${e.message}`); break; }
              continue;
            }
            const task = this.genTask(node, d, ctx, { prompt: edit, refIds: [await this.toRef(cur)] }, false, true);
            this.onUpdate();
            await this.waitTasks([task]);
            if (st) st.done = (st.done || 0) + 1;
            const r = task.status === 'done' && task.results?.find((x) => x.kind === 'image');
            if (!r) { ctx.errors.push(`Sửa "${edit.slice(0, 40)}": ${task.error || 'không có kết quả'}`); break; }
            cur = { kind: 'image', url: r.url, thumb: r.thumb, provider: task.provider || 'flow', prompt: edit };
            versions.unshift(cur);
          }
          if (!versions.length) throw new Error(ctx.errors.at(-1) || 'Sửa không thành công');
          if (st) {
            // Ảnh mới nhất hiện trước; các phiên bản cũ vẫn lật lại xem được.
            st.previewItems = [...versions, ...(history.length ? history : media)];
            st.info = { ...(st.info || {}), edits: edits.slice(0, versions.length) };
          }
          return { media: [cur] };
        }
        const out = { media };
        if (isVideo && ctx.wanted.has(`${node.id}:frame`)) {
          out.frame = [];
          for (const m of media) {
            try { out.frame.push(await (m.provider === 'flow' || !m.provider ? this.lastFrame(m) : this.localLastFrame(m))); } catch (e) { ctx.errors.push(e.message); }
          }
        }
        return out;
      }

      case 'download': {
        const items = (inputs.media || []).filter((i) => i.kind !== 'text');
        // Gom tất cả ảnh/video đang có trên trang Flow (project đang mở).
        if (d.collectFlow) {
          const tab = await flow.findTab('flow');
          const r = tab ? await flow.send(tab.id, { type: 'afl:listMedia', opts: { scroll: true } }).catch(() => null) : null;
          if (!r?.ok) throw new Error('Gom ảnh trên Flow: cần mở một project Flow');
          const have = new Set(items.map((i) => i.url));
          for (const m of r.items) if (!have.has(m.url)) items.push({ kind: m.kind, url: m.url, thumb: m.thumb, provider: 'flow', prompt: m.prompt });
        }
        const now = new Date();
        const pad = (x) => String(x).padStart(2, '0');
        const vars = { workflow: ctx.name, node: node.data.name || 'download', date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` };
        const sub = String(d.folder || '').trim().replace(/\{(workflow|date|time)\}/gi, (_, k) => vars[k.toLowerCase()].replace(/[\\/:*?"<>|]+/g, '_'));
        const folder = sub ? `${store.settings.folder || 'AutoFlow'}/${sub}` : ctx.folder;
        const dlRes = { image: d.imageRes || '', video: d.videoRes || '' };
        let n = 0, ok = 0;
        for (const it of items) {
          if (ctx.cancelled) break;
          n++;
          const tab = it.provider ? await flow.findTab(it.provider) : null;
          const fake = {
            index: n, prompt: it.prompt || ctx.name, provider: it.provider || 'flow', genType: it.kind, createdAt: Date.now(), folder,
            filePattern: d.filePattern?.trim() || '', nameVars: { node: vars.node, workflow: vars.workflow }, dlRes
          };
          if (it.dataUrl) {
            const r = await chrome.runtime.sendMessage({ type: 'afl:download', url: it.dataUrl, filename: `${this.runner.baseName(fake, n)}.${it.kind === 'video' ? 'mp4' : 'png'}` });
            if (r?.ok) ok++;
          } else if (tab) {
            if ((await this.runner.download(tab.id, fake, it, n)).downloaded) ok++;
          }
          if (ctx.nodeState) Object.assign(ctx.nodeState, { total: items.length, done: n });
        }
        this.log(`${node.data.name || 'Download'}: đã tải ${ok}/${items.length} file`, ok === items.length ? 'ok' : 'warn');
        return {};
      }

      case 'telegram': {
        const items = inputs.media || [];
        if (!this.telegram) throw new Error('Bot Telegram chưa sẵn sàng');
        const st = store.settings;
        const chatId = String(d.chatId || '').trim() || st.tgChatId;
        if (!st.tgToken || !chatId) throw new Error('Chưa cấu hình Telegram (Cài đặt → AI Agent / Bot: token + /start để liên kết chat)');
        const caption = (it) => (d.caption?.trim() ? d.caption.trim().replace(/\{prompt\}/g, it.prompt || '') : it.prompt || ctx.name);
        const media = [];
        for (const it of items) {
          if (ctx.cancelled) break;
          if (it.kind === 'text') { await this.telegram.send(it.text || '', chatId); continue; }
          const dataUrl = it.dataUrl || (await this.runner.mediaToDataUrl({ provider: it.provider || 'flow' }, it)).dataUrl;
          media.push({ dataUrl, kind: it.kind === 'video' ? 'video' : 'image', caption: caption(it) });
        }
        // Gộp 1 tin nhắn (album, tối đa 10 file/tin) hoặc gửi từng file.
        if (d.sendMode === 'group' && media.length > 1) {
          for (let i = 0; i < media.length; i += 10) await this.telegram.sendMediaGroup(media.slice(i, i + 10), chatId);
        } else {
          for (const m of media) await this.telegram.sendMedia(m.dataUrl, m.kind, m.caption, chatId);
        }
        this.log(`${node.title || 'Telegram'}: đã gửi ${items.length} mục`, 'ok');
        return { pass: items };
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
    // Kết quả đã lưu trong workflow (còn sau khi đóng side panel): node tạo ảnh/video chỉ nối ra cổng
    // "media" dùng lại được, để chạy riêng node phía sau không tạo lại ảnh của node phía trước.
    // history: lấy cả các bản cũ (để lật xem); mặc định chỉ thành phẩm của lần chạy cuối (bản sửa mới nhất).
    const saved = (id, history = false) => {
      const n = byId.get(id), r = workflow.results?.[id];
      if (!n || r?.status !== 'done') return null;
      // Câu trả lời AI đã có (AI Agent / Assistant): dùng lại, không gọi AI lần nữa (bỏ qua nếu bị cắt ngắn khi lưu).
      if (n.type === 'assistant' || (n.type === 'prompt' && n.data.agent)) {
        const texts = (r.preview || []).filter((p) => p.kind === 'text');
        if (r.sig !== aiSig(n)) return null; // đã sửa yêu cầu sau lần chạy trước: hỏi AI lại
        return texts.length && texts.every((p) => p.text.length < 2000) ? { text: texts.map((p) => ({ kind: 'text', text: p.text })) } : null;
      }
      if (!GEN_TYPES.has(n.type)) return null;
      if (workflow.edges.some((e) => e.from.node === id && e.from.port !== 'media')) return null;
      const all = (r.preview || []).filter((p) => p.kind !== 'text' && p.url);
      const media = history || !(r.count > 0) ? all : all.slice(0, r.count);
      return media.length ? { media: media.map((p) => ({ ...p })) } : null;
    };
    let runSet = null;
    const editOnly = new Set();
    if (opts.only?.length) {
      runSet = new Set(opts.only);
      for (const e of workflow.edges) if (opts.only.includes(e.from.node) && e.to.port === 'edit' && !opts.only.includes(e.to.node) && saved(e.to.node)) editOnly.add(e.to.node);
      // Bấm ▶ trên chính node đã có ảnh/video và có Prompt sửa nối vào: sửa tiếp trên bản mới nhất,
      // không tạo lại từ đầu (muốn tạo lại thì Reset node trước).
      for (const e of workflow.edges) if (opts.only.includes(e.to.node) && e.to.port === 'edit' && GEN_TYPES.has(byId.get(e.to.node)?.type) && saved(e.to.node)) editOnly.add(e.to.node);
      // Node phía trước: dùng kết quả lần trước nếu có, nếu không thì chạy lại.
      const filledList = (id) => byId.get(id)?.type === 'list' && byId.get(id).data.items?.length > 0;
      for (const id of ancestorsOf(opts.only, deps, filledList)) if (!runSet.has(id) && !cached[id] && !saved(id)) runSet.add(id);
      // Node được sửa không chạy lại các node phía trước nó (dùng ảnh đang có).
      editOnly.forEach((id) => runSet.add(id));
    }
    const wanted = new Set(workflow.edges.map((e) => `${e.from.node}:${e.from.port}`));
    const ctx = {
      runId: uid(), cancelled: false, errors: [], bySlug, outputs: new Map(), wanted, name: workflow.name, skipped: new Set(),
      editOnly, saved, savedInfo: (id) => workflow.results?.[id]?.info || null,
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
          let out = node.type === 'list' && node.data.items?.length ? { items: node.data.items.map(listItem) } : cached[node.id] || saved(node.id);
          // Node không tốn lượt (Text, Prompt thường, Ảnh tải lên, Text Extract): đọc lại ngay thay vì để trống.
          if (!out && node.data.enabled !== false && (['text', 'image', 'extract'].includes(node.type) || (node.type === 'prompt' && !node.data.agent))) {
            const inputs = {};
            for (const e of workflow.edges.filter((x) => x.to.node === node.id)) (inputs[e.to.port] ||= []).push(...(ctx.outputs.get(e.from.node)?.[e.from.port] || []).map((i) => ({ ...i, _src: e.from.node })));
            ctx.nodeState = null;
            out = await this.execNode(node, inputs, ctx).catch(() => ({}));
          }
          ctx.outputs.set(node.id, out || {});
          continue;
        }
        const st = this.state.nodes[node.id];
        const inputs = {};
        let hasUpstream = false, upstreamItems = 0, skippedUp = false;
        for (const e of workflow.edges.filter((x) => x.to.node === node.id && (!editOnly.has(node.id) || x.to.port !== 'edit' || opts.only.includes(node.id) || opts.only.includes(x.from.node)))) {
          hasUpstream = true;
          const items = ctx.outputs.get(e.from.node)?.[e.from.port] || [];
          upstreamItems += items.length;
          if (ctx.skipped.has(e.from.node)) skippedUp = true;
          (inputs[e.to.port] ||= []).push(...items.map((i) => ({ ...i, _src: e.from.node })));
        }
        if (!node.data.enabled) { Object.assign(st, { status: 'skipped', error: 'Node đang tắt' }); ctx.outputs.set(node.id, {}); this.onUpdate(); continue; }
        if (skippedUp) { Object.assign(st, { status: 'skipped', error: 'Nhánh phía trước bị bỏ qua' }); ctx.skipped.add(node.id); ctx.outputs.set(node.id, {}); this.onUpdate(); continue; }
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
          Object.assign(st, { status: 'done', count: items.length, preview: preview(st.previewItems || items, node.type === 'list' ? MAX_LIST : 24), finishedAt: Date.now() });
          delete st.previewItems;
          if (node.type === 'assistant' || (node.type === 'prompt' && node.data.agent)) st.sig = aiSig(node);
        } catch (e) {
          ctx.outputs.set(node.id, {});
          if (e instanceof SkipBranch) {
            Object.assign(st, { status: 'skipped', error: e.message });
            ctx.skipped.add(node.id);
            this.log(`Workflow: node "${st.title}": ${e.message}`, 'warn');
            this.onUpdate();
            continue;
          }
          // Sửa không thành công: giữ nguyên ảnh/video đang có của node để sửa lại tiếp.
          const prev = editOnly.has(node.id) && workflow.results?.[node.id];
          if (prev?.status === 'done') {
            Object.assign(st, { status: 'done', count: prev.count, preview: prev.preview, info: prev.info, finishedAt: Date.now() });
            ctx.outputs.set(node.id, saved(node.id) || {});
            this.log(`Workflow: node "${st.title}" sửa không thành công (${e.message}), giữ kết quả cũ`, 'warn');
            this.onUpdate();
            continue;
          }
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

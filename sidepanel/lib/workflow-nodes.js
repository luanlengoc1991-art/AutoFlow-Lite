// Định nghĩa node workflow (dùng chung cho trình soạn và bộ chạy).
// Cổng có kiểu: text / image / video / frame / any. Một số cổng chỉ hiện theo cấu hình node (when).

export const PORT_TYPES = {
  text: { color: '#a78bfa', label: 'Văn bản', glyph: 'T' },
  image: { color: '#3b82f6', label: 'Ảnh', glyph: 'img' },
  video: { color: '#a855f7', label: 'Video', glyph: 'vid' },
  frame: { color: '#14b8a6', label: 'Khung hình', glyph: 'F' },
  any: { color: '#a1a1aa', label: 'Bất kỳ', glyph: '*' }
};

const COMPAT = {
  text: ['text'],
  image: ['image', 'frame'],
  video: ['video'],
  frame: ['frame', 'image']
};
export function canConnect(outType, inType) {
  if (outType === 'any' || inType === 'any') return true;
  return (COMPAT[outType] || []).includes(inType);
}

const isVideo = (d) => d.genType === 'video';
// Prompt sửa kết quả: bấm ▶ trên Prompt nối vào đây thì node sửa chính ảnh/video đang có (không chạy lại node phía trước).
// Ảnh: ảnh hiện tại làm tham chiếu + nội dung sửa. Video: tạo lại với đúng thiết lập/đầu vào, prompt gốc + nội dung sửa.
const EDIT_PORT = { name: 'edit', type: 'text', multi: true, label: 'Prompt sửa kết quả' };
export const PROVIDER_LABEL = { flow: 'Google Flow', chatgpt: 'ChatGPT', gemini: 'Gemini', grok: 'Grok', claude: 'Claude', seedance: 'Seedance' };
// AI viết văn bản cho node Assistant / AI Agent.
export const TEXT_AI = ['chatgpt', 'claude', 'gemini', 'grok'];
// Kiểu cổng ra của List theo loại mục đang chứa.
const listType = (d) => ({ text: 'text', image: 'image', video: 'video' })[d.kind] || 'any';
// Multi-prompt: tách theo dòng trống nếu có, không thì mỗi dòng một prompt.
export function splitMultiPrompt(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  return (/\n\s*\n/.test(raw) ? raw.split(/\n\s*\n/) : raw.split('\n')).map((x) => x.trim()).filter(Boolean);
}
// Cổng ra của Prompt: "Tất cả" + mỗi prompt một cổng (p1, p2…) khi bật Multi-prompt.
const promptOuts = (d) => [
  { name: 'text', type: 'text', label: d.multi ? 'Tất cả prompt' : 'Văn bản' },
  ...(d.multi ? splitMultiPrompt(d.text).slice(0, 20).map((p, i) => ({ name: `p${i + 1}`, type: 'text', label: `Prompt ${i + 1}: ${p.slice(0, 24)}` })) : [])
];
// Tuỳ chọn chung của node tạo ảnh/video: Mention Mode, tự tải, thời gian chờ.
const GEN_COMMON = { promptMode: 'auto', refMode: 'auto', autoDownload: false, timeoutSec: 0 };
const isChatVideo = (d) => d.mode === 'video';

export const NODE_DEFS = {
  prompt: {
    title: 'Prompt', icon: 'prompt', group: 'Văn bản',
    desc: 'Prompt văn bản. Bật AI Agent để ChatGPT/Claude/Gemini/Grok viết lại, mở rộng, dịch, phân tích ảnh.',
    ins: [
      { name: 'text', type: 'text', multi: true, label: 'Prompt đầu vào' },
      { name: 'image_ref', type: 'image', multi: true, label: 'Ảnh cho AI phân tích', when: (d) => d.agent }
    ],
    outs: promptOuts,
    data: { text: '', multi: false, agent: false, agentProvider: 'chatgpt', agentInstruction: 'Viết lại thành một prompt tạo ảnh chi tiết bằng tiếng Anh. Chỉ trả về prompt.', agentSplit: false, agentTimeout: 60, agentFallback: true, agentDelete: false, refs: [], promptMode: 'auto', refMode: 'auto' }
  },
  text: {
    title: 'Text', icon: 'text', group: 'Văn bản',
    desc: 'Văn bản tĩnh, dùng làm nguồn cho @mention trong node khác.',
    ins: [],
    outs: [{ name: 'text', type: 'text', label: 'Văn bản' }],
    data: { text: '' }
  },
  extract: {
    title: 'Text Extract', icon: 'extract', group: 'Văn bản',
    desc: 'Tách văn bản: theo mốc [image_prompt_01], theo dòng, regex, giữa 2 mốc, JSON.',
    ins: [{ name: 'text', type: 'text', multi: false, label: 'Văn bản đầu vào' }],
    outs: [{ name: 'text', type: 'text', label: 'Văn bản đã tách' }],
    data: { mode: 'marker', marker: 'image_prompt_01', pattern: '', start: '', end: '', path: '', index: '', strict: false, multiMatch: 'all', onFail: 'error' }
  },
  assistant: {
    title: 'Assistant', icon: 'assistant', group: 'Văn bản',
    desc: 'Hỏi ChatGPT / Claude / Gemini / Grok (kèm ảnh). Xuất câu trả lời thành văn bản hoặc danh sách.',
    ins: [
      { name: 'text', type: 'text', multi: true, label: 'Văn bản bổ sung' },
      { name: 'image_ref', type: 'image', multi: true, label: 'Ảnh cho AI xem' }
    ],
    outs: [{ name: 'text', type: 'text', label: 'Câu trả lời' }],
    data: { provider: 'chatgpt', text: '', exportAs: 'list' }
  },
  list: {
    title: 'List', icon: 'list', group: 'Văn bản',
    desc: 'Danh sách văn bản hoặc media, sửa từng mục. Node phía sau chạy mỗi mục một lượt.',
    ins: [{ name: 'in', type: 'any', multi: true, label: 'Thêm vào danh sách' }],
    outs: [{ name: 'items', type: listType, label: 'Các mục' }],
    data: { items: [], kind: 'any', keep: 'replace' }
  },
  image: {
    title: 'Image/Video', icon: 'image', group: 'Media',
    desc: 'Tải lên / dán / chọn từ thư viện ảnh hoặc video tham chiếu.',
    ins: [],
    outs: [{ name: 'media', type: (d) => (d.media?.[0]?.kind === 'video' ? 'video' : 'image'), label: 'Media' }],
    data: { media: [] }
  },
  generate: {
    title: 'Flow - Image/Video Generate', icon: 'generate', group: 'Tạo', provider: 'flow',
    desc: 'Tạo ảnh/video bằng Google Flow.',
    ins: [
      { name: 'image_ref', type: 'image', multi: true, label: 'Ảnh tham chiếu', when: (d) => !isVideo(d) || d.videoMode === 'ingredients' },
      { name: 'text', type: 'text', multi: true, label: 'Prompt' },
      { name: 'frame_1', type: 'frame', multi: false, label: 'Khung đầu', when: (d) => isVideo(d) && d.videoMode === 'frames' },
      { name: 'frame_2', type: 'frame', multi: false, label: 'Khung cuối', when: (d) => isVideo(d) && d.videoMode === 'frames' },
      { name: 'video_ref', type: 'video', multi: false, label: 'Video tham chiếu (chuyển động)', when: (d) => isVideo(d) && d.videoMode === 'ingredients' },
      EDIT_PORT
    ],
    outs: [
      { name: 'media', type: (d) => (isVideo(d) ? 'video' : 'image'), label: 'Kết quả' },
      { name: 'frame', type: 'frame', label: 'Khung cuối video', when: isVideo }
    ],
    data: { genType: 'image', model: '', ratio: '', quantity: 1, videoMode: 'frames', duration: '', prompt: '', perImage: false, ...GEN_COMMON }
  },
  seedance: {
    title: 'Seedance - Video', icon: 'video', group: 'Tạo', provider: 'seedance',
    desc: 'Tạo video Seedance trên Dreamina (credit tài khoản của bạn). Mỗi ảnh khung đầu ra một video.',
    ins: [
      { name: 'frame_1', type: 'frame', multi: true, label: 'Khung đầu (mỗi ảnh một video)' },
      { name: 'frame_2', type: 'frame', multi: false, label: 'Khung cuối' },
      { name: 'text', type: 'text', multi: true, label: 'Prompt' },
      EDIT_PORT
    ],
    outs: [{ name: 'media', type: 'video', label: 'Video' }],
    data: { genType: 'video', model: '', ratio: '', duration: '', prompt: '', ...GEN_COMMON }
  },
  chatgpt: {
    title: 'ChatGPT', icon: 'chat', group: 'Tạo', provider: 'chatgpt', desc: 'Tạo ảnh bằng ChatGPT.',
    ins: [{ name: 'image_ref', type: 'image', multi: true, label: 'Ảnh tham chiếu' }, { name: 'text', type: 'text', multi: true, label: 'Prompt' }, EDIT_PORT],
    outs: [{ name: 'media', type: 'image', label: 'Ảnh' }],
    data: { prompt: '', newChat: true, mode: 'image', ratio: '', model: '', refs: [], prefix: 'auto', deleteAfter: '', ...GEN_COMMON }
  },
  gemini: {
    title: 'Gemini', icon: 'chat', group: 'Tạo', provider: 'gemini', desc: 'Tạo ảnh / video bằng Gemini.',
    ins: [{ name: 'image_ref', type: 'image', multi: true, label: 'Ảnh tham chiếu' }, { name: 'text', type: 'text', multi: true, label: 'Prompt' }, EDIT_PORT],
    outs: [
      { name: 'media', type: (d) => (isChatVideo(d) ? 'video' : 'image'), label: 'Kết quả' },
      { name: 'frame', type: 'frame', label: 'Khung cuối video', when: isChatVideo }
    ],
    data: { prompt: '', newChat: true, mode: 'image', ratio: '', model: '', refs: [], deleteAfter: '', ...GEN_COMMON }
  },
  grok: {
    title: 'Grok', icon: 'chat', group: 'Tạo', provider: 'grok', desc: 'Tạo ảnh / video bằng Grok.',
    ins: [{ name: 'image_ref', type: 'image', multi: true, label: 'Ảnh tham chiếu' }, { name: 'text', type: 'text', multi: true, label: 'Prompt' }, EDIT_PORT],
    outs: [
      { name: 'media', type: (d) => (isChatVideo(d) ? 'video' : 'image'), label: 'Kết quả' },
      { name: 'frame', type: 'frame', label: 'Khung cuối video', when: isChatVideo }
    ],
    data: { prompt: '', newChat: true, mode: 'image', ratio: '', quality: '', duration: '6s', resolution: '720p', refs: [], ...GEN_COMMON }
  },
  download: {
    title: 'Download', icon: 'download', group: 'Tiện ích', desc: 'Tự tải kết quả về máy.',
    ins: [{ name: 'media', type: 'any', multi: true, label: 'File cần tải' }],
    outs: [],
    data: { folder: '', filePattern: '', imageRes: '', videoRes: '', collectFlow: false }
  },
  telegram: {
    title: 'Telegram', icon: 'send', group: 'Tiện ích', desc: 'Gửi ảnh / video / văn bản về chat Telegram đã liên kết.',
    ins: [{ name: 'media', type: 'any', multi: true, label: 'Gửi về Telegram' }],
    outs: [{ name: 'pass', type: 'any', label: 'Chuyển tiếp' }],
    data: { caption: '', chatId: '', sendMode: 'single' }
  },
  delay: {
    title: 'Wait', icon: 'delay', group: 'Tiện ích', desc: 'Chờ X giây rồi chuyển tiếp.',
    ins: [{ name: 'in', type: 'any', multi: true, label: 'Đầu vào' }],
    outs: [{ name: 'out', type: 'any', label: 'Đầu ra' }],
    data: { seconds: 5 }
  },
  note: {
    title: 'Ghi chú', icon: 'note', group: 'Tiện ích', desc: 'Khung ghi chú / nhóm node (chạy riêng cả nhóm).',
    ins: [], outs: [],
    data: { text: '', color: '#c6f432', w: 460, h: 320, fontSize: 14 }
  }
};

export const portsOf = (node, dir) => {
  const def = NODE_DEFS[node.type];
  const list = dir === 'in' ? def.ins : typeof def.outs === 'function' ? def.outs(node.data) : def.outs;
  return list.filter((p) => !p.when || p.when(node.data));
};
export const portType = (node, port) => (typeof port.type === 'function' ? port.type(node.data) : port.type);

export function slugify(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 32) || 'node';
}

let seq = 0;
export const nid = () => `n${Date.now().toString(36)}${(++seq).toString(36)}`;

export function createNode(type, x, y, data = {}) {
  const def = NODE_DEFS[type];
  return { id: nid(), type, x, y, data: { name: def.title, slug: '', enabled: true, ...structuredClone(def.data), ...data } };
}

export function newWorkflow(name) {
  const d = new Date();
  const label = name || `Workflow mới - ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  return { id: `wf${Date.now().toString(36)}`, name: label, enabled: true, maxSpeed: false, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, results: {}, updatedAt: Date.now() };
}

// Workflow cũ (bản Drawflow) không chuyển đổi được: trả về workflow trống cùng tên.
export function normalizeWorkflow(wf) {
  if (Array.isArray(wf?.nodes)) return { results: {}, viewport: { x: 0, y: 0, zoom: 1 }, ...wf };
  const fresh = newWorkflow(wf?.name);
  return { ...fresh, id: wf?.id || fresh.id };
}

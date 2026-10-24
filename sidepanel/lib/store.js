// Lưu trữ (chrome.storage.local): cài đặt, form Gen, hàng đợi, lịch sử, thư viện prompt, ảnh tham chiếu.

// Mặc định của Cài đặt → Nền tảng AI.
export const PLATFORM_DEFAULTS = {
  defProvider: 'flow',
  flowType: 'image',
  flowImageRatio: '9:16',
  flowVideoRatio: '9:16',
  flowImageModel: 'Nano Banana 2.1',
  flowVideoModel: '',
  flowDuration: '',
  chatgptRatio: '9:16',
  chatgptModel: 'instant',
  chatgptAutoClose: false,
  chatgptDeleteAfter: true,
  geminiModel: 'flash',
  geminiRatio: '',
  geminiAutoClose: false,
  geminiDeleteAfter: true,
  grokMode: 'image',
  grokRatio: '9:16',
  grokQuality: 'fast',
  grokAutoClose: false,
  claudeModel: '',
  claudeAutoClose: false,
  claudeDeleteAfter: false,
  seedanceModel: 'Seedance 2.0 Fast',
  seedanceRatio: '9:16',
  seedanceDuration: '5s',
  seedanceAutoClose: false
};
const PLATFORM_DEFAULTS_V = 3;

export const DEFAULT_SETTINGS = {
  concurrency: 1,
  delayMin: 3,
  delayMax: 8,
  timeoutMin: 10,
  retries: 2,
  stopOnError: false,
  // Hộp xác nhận trước khi chạy: gửi tự động / gửi tay, tải lại trang Flow trước khi chạy.
  confirmRun: true,
  submitMode: 'auto',
  reloadBeforeRun: false,
  notify: true,
  folder: 'AutoFlow',
  pattern: '[Date]/[Index]_[Prompt]_[N]',
  keepRefs: false,
  selectors: '',
  dlImageRes: 'original',
  dlVideoRes: 'original',
  chatNewChat: true,
  autoDownload: true,
  project: '',
  sound: true,
  // Nền tảng AI (rỗng = giữ như trang / lựa chọn gần nhất)
  ...PLATFORM_DEFAULTS,
  // Cầu nối MCP (AI Agent) và bot Telegram
  mcpEnabled: false,
  mcpPort: 17321,
  mcpToken: '',
  extDir: '',
  mcpAutoDownload: true,
  mcpFolder: 'AutoFlow_mcp',
  tgEnabled: false,
  tgToken: '',
  tgChatId: '',
  tgNotify: true,
  tgApiBase: 'https://api.telegram.org'
};

export const DEFAULT_GEN = {
  provider: 'flow',
  chatMode: 'image',
  text: '',
  multi: true,
  split: 'blank',
  styleId: '',
  characters: [],
  chainPrev: false,
  chainMode: 'last',
  genType: 'image',
  model: '',
  ratio: '',
  quantity: 1,
  videoMode: 'text',
  duration: '',
  resolution: '',
  repeat: 1,
  spin: 'random',
  refIds: [],
  refMode: 'all',
  autoDownload: true
};

const KEYS = { settings: 'aflSettings', gen: 'aflGen', tasks: 'aflTasks', history: 'aflHistory', library: 'aflLibrary', options: 'aflFlowOptions', refs: 'aflRefs', workflows: 'aflWorkflows', components: 'aflComponents', savedTasks: 'aflSavedTasks', styles: 'aflStyles' };
const HISTORY_LIMIT = 500;

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

class Store {
  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
    this.gen = { ...DEFAULT_GEN };
    this.tasks = [];
    this.history = [];
    this.library = [];
    this.options = null;
    this.refs = {};
    this.workflows = [];
    this.components = { characters: [], voices: [] };
    this.savedTasks = [];
    this.styles = [];
    this.timers = {};
  }

  async load() {
    const data = await chrome.storage.local.get(Object.values(KEYS));
    this.settings = { ...DEFAULT_SETTINGS, ...(data[KEYS.settings] || {}) };
    // Bản 0.5.0 lưu ô trống cho Nền tảng AI: điền mặc định một lần.
    if (this.settings.platformDefaultsV !== PLATFORM_DEFAULTS_V) {
      for (const [k, v] of Object.entries(PLATFORM_DEFAULTS)) if (this.settings[k] === '' || this.settings[k] === undefined) this.settings[k] = v;
      // "Omni 1.1 Flash" (mặc định cũ) không có trên Google Flow: về "Giữ như Flow".
      if (this.settings.flowVideoModel === 'Omni 1.1 Flash') this.settings.flowVideoModel = '';
      this.settings.platformDefaultsV = PLATFORM_DEFAULTS_V;
      await chrome.storage.local.set({ [KEYS.settings]: this.settings });
    }
    this.gen = { ...DEFAULT_GEN, ...(data[KEYS.gen] || {}) };
    this.tasks = data[KEYS.tasks] || [];
    this.history = data[KEYS.history] || [];
    this.library = data[KEYS.library] || [];
    this.options = data[KEYS.options] || null;
    this.refs = data[KEYS.refs] || {};
    this.workflows = data[KEYS.workflows] || [];
    this.components = data[KEYS.components] || { characters: [], voices: [] };
    this.savedTasks = data[KEYS.savedTasks] || [];
    this.styles = data[KEYS.styles] || [];
  }

  // Ghi trễ để gom nhiều thay đổi liên tiếp.
  save(name, delay = 250) {
    clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => chrome.storage.local.set({ [KEYS[name]]: this[name] }), delay);
  }

  // Ghi ngay (bỏ qua hẹn giờ gom thay đổi).
  flush(name) {
    clearTimeout(this.timers[name]);
    return chrome.storage.local.set({ [KEYS[name]]: this[name] });
  }

  selectors() {
    const raw = (this.settings.selectors || '').trim();
    if (!raw) return {};
    try { return JSON.parse(raw); } catch (_) { return {}; }
  }

  addRef(ref) {
    const id = uid();
    this.refs[id] = ref;
    this.save('refs');
    return id;
  }
  getRefs(ids) { return (ids || []).map((id) => this.refs[id]).filter(Boolean); }

  // Xoá ảnh tham chiếu không còn được form Gen hay task nào dùng.
  gcRefs() {
    const used = new Set([...(this.gen.refIds || []), ...this.tasks.flatMap((t) => t.refIds || []), ...this.savedTasks.flatMap((t) => t.config?.refIds || [])]);
    let changed = false;
    for (const id of Object.keys(this.refs)) if (!used.has(id)) { delete this.refs[id]; changed = true; }
    if (changed) this.save('refs');
  }

  addHistory(entry) {
    this.history.unshift(entry);
    if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
    this.save('history');
  }
}

export const store = new Store();

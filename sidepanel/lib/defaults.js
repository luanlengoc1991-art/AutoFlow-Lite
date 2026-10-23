// Mặc định theo nền tảng (Cài đặt → Nền tảng AI). Áp dụng khi runner gửi task, nên mọi nguồn
// (Gen, workflow, MCP, Telegram, công cụ) dùng chung một quy tắc: trường để trống mới lấy mặc định.

export const FLOW_IMAGE_MODELS = ['Nano Banana 2.1', 'Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'];
// Gợi ý khi chưa "Đồng bộ từ Flow"; danh sách thật lấy từ tài khoản sau khi đồng bộ.
export const FLOW_VIDEO_MODELS = ['Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Veo 3.1 - Lite', 'Veo 3.1 - Lite [Lower Priority]'];
export const FLOW_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16'];
export const FLOW_DURATIONS = ['4s', '6s', '8s'];

// value: lưu trong cài đặt; label: hiển thị; match: chữ trên menu chọn model của trang.
export const CHAT_MODELS = {
  chatgpt: [
    { value: 'instant', label: 'Instant', match: /instant|nhanh/i },
    { value: 'medium', label: 'Medium', match: /medium|standard|thinking(?!.*(high|extended|pro))/i },
    { value: 'high', label: 'High', match: /high|extended|heavy/i },
    { value: 'pro', label: 'Pro', match: /\bpro\b/i }
  ],
  gemini: [
    { value: 'flash', label: 'Flash (nhanh)', match: /flash|fast|nhanh/i },
    { value: 'thinking', label: 'Thinking', match: /thinking|tư duy|suy luận/i },
    { value: 'pro', label: 'Pro', match: /\bpro\b/i }
  ],
  grok: [
    { value: 'fast', label: 'Nhanh', match: /fast|speed|nhanh/i },
    { value: 'quality', label: 'Chất lượng cao', match: /quality|chất lượng/i }
  ],
  claude: [
    { value: 'sonnet', label: 'Sonnet', match: /sonnet/i },
    { value: 'opus', label: 'Opus', match: /opus/i },
    { value: 'haiku', label: 'Haiku', match: /haiku/i }
  ]
};

// Seedance trên Dreamina: tên model đúng như chữ trên menu của trang.
export const SEEDANCE_MODELS = ['Seedance 2.0', 'Seedance 2.0 Fast', 'Seedance 1.5 Pro', 'Seedance 1.0 Pro', 'Seedance 1.0 Lite'];
export const SEEDANCE_RATIOS = ['9:16', '16:9', '1:1', '3:4', '4:3', '21:9'];
export const SEEDANCE_DURATIONS = ['4s', '5s', '6s', '8s', '10s', '12s', '15s'];

// Task Seedance: trường để trống lấy mặc định trong Cài đặt → Nền tảng AI.
export function genOptions(task, s) {
  return {
    prompt: task.prompt,
    genType: task.genType || 'video',
    model: task.model || s.seedanceModel || '',
    ratio: task.ratio || s.seedanceRatio || '',
    duration: task.duration || s.seedanceDuration || ''
  };
}

export const CHAT_RATIOS = {
  chatgpt: [['1:1', 'Vuông (1:1)'], ['9:16', 'Story (9:16)'], ['2:3', 'Dọc (2:3)'], ['3:2', 'Ngang (3:2)'], ['16:9', 'Rộng (16:9)']],
  gemini: [['16:9', 'Ngang (16:9)'], ['9:16', 'Dọc (9:16)'], ['1:1', 'Vuông (1:1)']],
  grok: [['9:16', '9:16 (Dọc)'], ['16:9', '16:9 (Ngang)'], ['1:1', '1:1 (Vuông)'], ['2:3', '2:3 (Dọc)'], ['3:2', '3:2 (Ngang)']]
};

// So tên model bỏ emoji/ký hiệu (vd. "🍌 Nano Banana Pro" của Flow ≈ "Nano Banana Pro").
const modelKey = (v) => String(v || '').replace(/[^\p{L}\p{N}.:\s-]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Điền các trường Flow còn trống từ mặc định (không ghi đè lựa chọn của task).
// options: danh sách đã "Đồng bộ từ Flow"; model mặc định không có trong tài khoản thì bỏ qua (giữ model của Flow).
// modelStrict: model do task chọn (không có trên Flow thì báo lỗi); model mặc định chỉ cảnh báo.
export function applyFlowDefaults(task, s, options) {
  const video = task.genType === 'video';
  const out = { ...task, modelStrict: !!task.model };
  if (!out.model) {
    const def = (video ? s.flowVideoModel : s.flowImageModel) || '';
    const synced = options?.[video ? 'video' : 'image']?.models || [];
    out.model = def && (!synced.length || synced.some((m) => modelKey(m) === modelKey(def))) ? def : '';
  }
  if (!out.ratio) out.ratio = (video ? s.flowVideoRatio : s.flowImageRatio) || '';
  if (video && !out.duration) out.duration = s.flowDuration || '';
  return out;
}

// Tuỳ chọn gửi sang trang chat: model cần chọn, tỉ lệ (ghi vào prompt khi tạo ảnh/video), chế độ Grok.
// task.chatOverrides: tuỳ chọn riêng của node workflow (model, ratio, mode, quality, duration, resolution, prefix).
export function chatOptions(provider, task, s) {
  const o = task.chatOverrides || {};
  const media = (task.chatMode || 'image') !== 'text';
  const modelValue = provider === 'grok' ? o.quality || s.grokQuality : o.model || s[`${provider}Model`];
  const model = CHAT_MODELS[provider]?.find((m) => m.value === modelValue);
  const ratio = media ? o.ratio || s[`${provider}Ratio`] || '' : '';
  const mode = o.mode || (provider === 'grok' ? s.grokMode : provider === 'gemini' ? s.geminiMode : 'image');
  const video = media && (provider === 'grok' || provider === 'gemini') && mode === 'video';
  let prompt = task.prompt;
  // ChatGPT "Cách tạo ảnh": always = luôn thêm câu yêu cầu tạo ảnh ở đầu prompt.
  if (media && !video && o.prefix === 'always' && !/^(create|generate|draw|make)\b/i.test(prompt)) prompt = `Generate an image: ${prompt}`;
  if (ratio) prompt = `${prompt.replace(/\s+$/, '')}\n\nAspect ratio: ${ratio}.`;
  if (video) prompt = `${prompt.replace(/\s+$/, '')}\n\nGenerate a video${o.duration ? `, ${o.duration} long` : ''}${o.resolution ? `, ${o.resolution}` : ''}.`;
  return {
    prompt,
    model: model ? { label: model.label, match: model.match.source, flags: model.match.flags } : null,
    wantVideo: video
  };
}

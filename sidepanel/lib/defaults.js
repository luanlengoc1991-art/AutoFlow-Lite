// Mặc định theo nền tảng (Cài đặt → Nền tảng AI). Áp dụng khi runner gửi task, nên mọi nguồn
// (Gen, workflow, MCP, Telegram, công cụ) dùng chung một quy tắc: trường để trống mới lấy mặc định.

export const FLOW_IMAGE_MODELS = ['Nano Banana 2.1', 'Nano Banana Pro', 'Nano Banana 2', 'Imagen 4'];
export const FLOW_VIDEO_MODELS = ['Omni 1.1 Flash', 'Veo 3.1 - Lite', 'Veo 3.1 - Fast', 'Veo 3.1 - Quality', 'Veo 3.1 - Lite [Lower Priority]'];
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

// Điền các trường Flow còn trống từ mặc định (không ghi đè lựa chọn của task).
export function applyFlowDefaults(task, s) {
  const video = task.genType === 'video';
  const out = { ...task };
  if (!out.model) out.model = (video ? s.flowVideoModel : s.flowImageModel) || '';
  if (!out.ratio) out.ratio = (video ? s.flowVideoRatio : s.flowImageRatio) || '';
  if (video && !out.duration) out.duration = s.flowDuration || '';
  return out;
}

// Tuỳ chọn gửi sang trang chat: model cần chọn, tỉ lệ (ghi vào prompt khi tạo ảnh/video), chế độ Grok.
export function chatOptions(provider, task, s) {
  const media = (task.chatMode || 'image') !== 'text';
  const model = CHAT_MODELS[provider]?.find((m) => m.value === (provider === 'grok' ? s.grokQuality : s[`${provider}Model`]));
  const ratio = media ? s[`${provider}Ratio`] || '' : '';
  const video = media && provider === 'grok' && s.grokMode === 'video';
  let prompt = task.prompt;
  if (ratio) prompt = `${prompt.replace(/\s+$/, '')}\n\nAspect ratio: ${ratio}.`;
  if (video) prompt = `${prompt.replace(/\s+$/, '')}\n\nGenerate a video.`;
  return {
    prompt,
    model: model ? { label: model.label, match: model.match.source, flags: model.match.flags } : null,
    wantVideo: video
  };
}

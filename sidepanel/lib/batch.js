// Dựng danh sách task hàng đợi từ một cấu hình Gen (dùng cho tab Gen và task đã lưu).
import { uid } from './store.js';
import { PROVIDERS } from './providers.js';
import { splitPrompts, expandSpin } from './prompts.js';

// Phong cách dựng sẵn: phần mô tả được nối vào cuối mỗi prompt.
export const BUILTIN_STYLES = [
  { id: 'pixar3d', cat: '3D & Animation', name: 'Hoạt hình 3D kiểu Pixar', prompt: '3D animated feature film style, soft global illumination, expressive characters, rich colors', color: '#f59e0b' },
  { id: 'clay3d', cat: '3D & Animation', name: 'Đất sét 3D (Claymation)', prompt: 'claymation style, handmade clay textures, fingerprints on surfaces, stop-motion look', color: '#ef4444' },
  { id: 'anime', cat: '3D & Animation', name: 'Anime', prompt: 'anime style, clean line art, cel shading, vibrant colors, detailed background', color: '#ec4899' },
  { id: 'stickman', cat: '3D & Animation', name: 'Người que (Stickman)', prompt: 'simple stickman drawing style, black lines on white background, minimal, humorous', color: '#a1a1aa' },
  { id: 'cinematic', cat: 'Điện ảnh', name: 'Điện ảnh (Cinematic)', prompt: 'cinematic film still, anamorphic lens, shallow depth of field, dramatic lighting, film grain', color: '#3b82f6' },
  { id: 'noir', cat: 'Điện ảnh', name: 'Film noir đen trắng', prompt: 'film noir, high contrast black and white, hard shadows, moody atmosphere', color: '#52525b' },
  { id: 'documentary', cat: 'Điện ảnh', name: 'Phóng sự / tài liệu', prompt: 'documentary photography, natural light, candid moment, realistic details', color: '#14b8a6' },
  { id: 'watercolor', cat: 'Minh hoạ', name: 'Màu nước truyện tranh', prompt: 'soft watercolor and ink storybook illustration, loose washes, warm earth tones', color: '#84cc16' },
  { id: 'ink', cat: 'Minh hoạ', name: 'Phác thảo mực', prompt: 'ink pen sketch, cross-hatching, hand-drawn, on textured paper', color: '#78716c' },
  { id: 'flatvector', cat: 'Minh hoạ', name: 'Vector phẳng', prompt: 'flat vector illustration, bold shapes, limited color palette, clean modern design', color: '#8b5cf6' },
  { id: 'product', cat: 'Nhiếp ảnh', name: 'Ảnh sản phẩm studio', prompt: 'professional studio product photography, softbox lighting, clean background, high detail', color: '#e5e7eb' },
  { id: 'portrait', cat: 'Nhiếp ảnh', name: 'Chân dung xoá phông', prompt: 'portrait photography, 85mm lens, creamy bokeh, natural skin tones', color: '#fda4af' }
];

export function allStyles(custom) { return [...(custom || []).map((s) => ({ ...s, cat: 'Của tôi' })), ...BUILTIN_STYLES]; }

export function buildPrompts(cfg) {
  const base = splitPrompts(cfg.text, cfg.multi, cfg.split);
  const out = [];
  for (const p of base) {
    for (let r = 0; r < Math.max(1, cfg.repeat || 1); r++) {
      for (const v of expandSpin(p, cfg.spin)) out.push(v);
      if (cfg.spin === 'all') break; // "tất cả tổ hợp" đã sinh đủ biến thể
    }
  }
  return out;
}

const IMG_MENTION = /@img(\d+)\b/gi;

// rows: tuỳ chọn, [{ prompt, ...ghi đè }] (vd. từ CSV). Không có thì lấy prompt từ cfg.
export function buildQueueTasks(cfg, { startIndex, styles = [], rows } = {}) {
  const provider = cfg.provider || 'flow';
  const isChat = PROVIDERS[provider].kind === 'chat';
  const refs = cfg.refIds || [];
  const style = cfg.styleId ? allStyles(styles).find((s) => s.id === cfg.styleId) : null;
  const list = rows || buildPrompts(cfg).map((prompt) => ({ prompt }));
  const batchId = uid();
  const now = Date.now();
  let index = startIndex;
  return list.map((row, i) => {
    let prompt = row.prompt;
    // Chọn ảnh tham chiếu theo chế độ: tất cả / theo @img số / lần lượt.
    let refIds = [];
    if (refs.length) {
      if (cfg.refMode === 'each') refIds = [refs[i % refs.length]];
      else if (cfg.refMode === 'mention') {
        const picked = [...prompt.matchAll(IMG_MENTION)].map((m) => refs[+m[1] - 1]).filter(Boolean);
        refIds = [...new Set(picked)];
        prompt = prompt.replace(IMG_MENTION, ' ').replace(/[ \t]{2,}/g, ' ').trim();
      } else refIds = [...refs];
    }
    if (style) prompt = `${prompt.replace(/[.\s]+$/, '')}, ${style.prompt}`;
    const chain = cfg.chainPrev ? { chainPrev: cfg.chainMode || 'last', batchId } : { batchId };
    if (isChat) {
      return {
        id: uid(), index: index++, prompt, provider, chatMode: cfg.chatMode || 'image', newChat: cfg.newChat,
        refIds, autoDownload: cfg.autoDownload, status: 'pending', attempts: 0, createdAt: now, savedTaskId: cfg.savedTaskId, ...chain
      };
    }
    const genType = row.genType || cfg.genType;
    const videoMode = row.videoMode || cfg.videoMode;
    if (genType === 'video' && videoMode === 'text') refIds = [];
    if (genType === 'video' && videoMode === 'frames') refIds = refIds.slice(0, 2);
    const chars = (cfg.characters || []).map((n) => `@char:[${n}]`).join(' ');
    return {
      provider: 'flow', id: uid(), index: index++, prompt: chars ? `${chars} ${prompt}` : prompt, genType, videoMode,
      model: row.model ?? cfg.model, ratio: row.ratio ?? cfg.ratio, quantity: row.quantity || cfg.quantity,
      duration: genType === 'video' ? (row.duration ?? cfg.duration) : '', resolution: genType === 'video' ? (row.resolution ?? cfg.resolution) : '',
      refIds, autoDownload: cfg.autoDownload, status: 'pending', attempts: 0, createdAt: now, savedTaskId: cfg.savedTaskId, ...chain
    };
  });
}

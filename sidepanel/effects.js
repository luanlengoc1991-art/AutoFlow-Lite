// Effects: chọn ảnh + hiệu ứng (prompt mẫu có thang cường độ) → Flow tạo ảnh với ảnh gốc làm tham chiếu.
import { $, esc, toast, init, imageModels, sourcePicker, submitToPanel, watchTasks, resultCards } from './tools-common.js';

// base có {intensity}; levels ánh xạ cường độ (%) → từ mô tả gần nhất.
const EFFECTS = [
  { id: 'teal-orange', cat: 'Chỉnh màu', name: 'Điện ảnh cam - xanh', color: 'linear-gradient(135deg,#0ea5e9,#f97316)', base: 'Regrade this exact image with a cinematic teal and orange color grade, {intensity} contrast, subtle film grain. Keep the same subject, composition and details.', levels: { 25: 'gentle', 50: 'balanced', 75: 'strong', 100: 'bold dramatic' } },
  { id: 'retro70', cat: 'Chỉnh màu', name: 'Phim cổ điển 70s', color: 'linear-gradient(135deg,#d97706,#fde68a)', base: 'Give this exact image a 1970s analog film look with {intensity} faded colors, warm yellow cast and light leaks. Keep the same subject and composition.', levels: { 25: 'slightly', 50: 'noticeably', 75: 'clearly', 100: 'heavily' } },
  { id: 'noir', cat: 'Chỉnh màu', name: 'Đen trắng noir', color: 'linear-gradient(135deg,#111,#d4d4d4)', base: 'Turn this exact image into black and white film noir with {intensity} contrast and deep shadows. Keep the same subject and composition.', levels: { 25: 'soft', 50: 'medium', 75: 'high', 100: 'extreme' } },
  { id: 'pastel', cat: 'Chỉnh màu', name: 'Pastel nhẹ nhàng', color: 'linear-gradient(135deg,#f9a8d4,#a5f3fc)', base: 'Recolor this exact image with {intensity} soft pastel tones, airy and dreamy mood. Keep the same subject and composition.', levels: { 25: 'a hint of', 50: 'gentle', 75: 'clear', 100: 'fully' } },
  { id: 'golden', cat: 'Ánh sáng', name: 'Giờ vàng', color: 'linear-gradient(135deg,#f59e0b,#fef3c7)', base: 'Relight this exact scene with golden hour sunlight, {intensity} warm glow and soft lens flare. Keep the same subject and composition.', levels: { 25: 'a subtle', 50: 'a moderate', 75: 'a rich', 100: 'an intense' } },
  { id: 'neon', cat: 'Ánh sáng', name: 'Neon đêm', color: 'linear-gradient(135deg,#db2777,#22d3ee)', base: 'Relight this exact scene at night with {intensity} pink and cyan neon rim lighting, cyberpunk mood. Keep the same subject and composition.', levels: { 25: 'subtle', 50: 'moderate', 75: 'vivid', 100: 'intense' } },
  { id: 'moon', cat: 'Ánh sáng', name: 'Ánh trăng', color: 'linear-gradient(135deg,#1e3a8a,#c7d2fe)', base: 'Relight this exact scene as a moonlit night with {intensity} cool blue light and soft shadows. Keep the same subject and composition.', levels: { 25: 'faint', 50: 'soft', 75: 'clear', 100: 'strong' } },
  { id: 'rain', cat: 'Thời tiết', name: 'Mưa', color: 'linear-gradient(135deg,#334155,#94a3b8)', base: 'Add {intensity} rain to this exact scene, visible raindrops and wet reflective surfaces. Keep the same subject and composition.', levels: { 25: 'light drizzle', 50: 'steady', 75: 'heavy', 100: 'torrential' } },
  { id: 'fog', cat: 'Thời tiết', name: 'Sương mù', color: 'linear-gradient(135deg,#9ca3af,#f3f4f6)', base: 'Add {intensity} fog to this exact scene, misty and mysterious atmosphere. Keep the same subject and composition.', levels: { 25: 'a thin haze of', 50: 'moderate', 75: 'thick', 100: 'dense' } },
  { id: 'snow', cat: 'Thời tiết', name: 'Tuyết rơi', color: 'linear-gradient(135deg,#bfdbfe,#ffffff)', base: 'Add {intensity} falling snow and a wintry look to this exact scene. Keep the same subject and composition.', levels: { 25: 'a few flakes of', 50: 'gentle', 75: 'heavy', 100: 'a blizzard of' } },
  { id: 'watercolor', cat: 'Nghệ thuật', name: 'Màu nước', color: 'linear-gradient(135deg,#84cc16,#fde68a)', base: 'Repaint this exact image as a watercolor painting with {intensity} soft brush strokes and fluid washes. Keep the same subject and composition.', levels: { 25: 'subtle', 50: 'visible', 75: 'expressive', 100: 'loose and heavy' } },
  { id: 'oil', cat: 'Nghệ thuật', name: 'Sơn dầu', color: 'linear-gradient(135deg,#92400e,#fbbf24)', base: 'Repaint this exact image as a classical oil painting with {intensity} visible brush strokes and rich texture. Keep the same subject and composition.', levels: { 25: 'fine', 50: 'visible', 75: 'thick', 100: 'impasto' } },
  { id: 'sketch', cat: 'Nghệ thuật', name: 'Phác thảo chì', color: 'linear-gradient(135deg,#525252,#e5e5e5)', base: 'Redraw this exact image as a pencil sketch with {intensity} shading and hand-drawn lines. Keep the same subject and composition.', levels: { 25: 'light', 50: 'medium', 75: 'detailed', 100: 'dense cross-hatched' } },
  { id: 'popart', cat: 'Nghệ thuật', name: 'Pop art', color: 'linear-gradient(135deg,#ef4444,#facc15)', base: 'Turn this exact image into pop art with {intensity} bold colors, halftone dots and thick outlines. Keep the same subject and composition.', levels: { 25: 'subtle', 50: 'clear', 75: 'bold', 100: 'extreme' } },
  { id: 'toy3d', cat: 'Phong cách', name: 'Đồ chơi 3D', color: 'linear-gradient(135deg,#a855f7,#f0abfc)', base: 'Transform the subject of this image into a {intensity} cute 3D toy figure, glossy plastic, studio lighting. Keep the recognizable features.', levels: { 25: 'slightly stylized', 50: 'stylized', 75: 'chibi', 100: 'super deformed chibi' } },
  { id: 'cyberpunk', cat: 'Phong cách', name: 'Cyberpunk', color: 'linear-gradient(135deg,#7c3aed,#06b6d4)', base: 'Restyle this exact image as cyberpunk with {intensity} futuristic tech details and neon city atmosphere. Keep the same subject.', levels: { 25: 'subtle', 50: 'moderate', 75: 'strong', 100: 'extreme' } },
  { id: 'polaroid', cat: 'Phong cách', name: 'Polaroid hoài cổ', color: 'linear-gradient(135deg,#fef3c7,#a8a29e)', base: 'Make this exact image look like a vintage polaroid photo with {intensity} faded colors, soft vignette and white frame.', levels: { 25: 'slightly', 50: 'moderately', 75: 'clearly', 100: 'strongly' } }
];
const RATIOS = [['', 'Giữ như Flow'], ['1:1', '1:1'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:3', '4:3'], ['3:4', '3:4']];

await init();
let cat = 'Tất cả', effect = EFFECTS[0], ratio = '', promptEdited = false;
const ids = JSON.parse(sessionStorage.getItem('fxIds') || '[]');
const source = sourcePicker($('zone'), $('file'), () => {});

function word(levels, v) {
  const keys = Object.keys(levels).map(Number).sort((a, b) => a - b);
  return levels[keys.reduce((best, k) => (Math.abs(k - v) < Math.abs(best - v) ? k : best), keys[0])];
}
function buildPrompt() { return effect.base.replace('{intensity}', word(effect.levels, +$('intensity').value)); }
function renderPrompt() { if (!promptEdited) $('prompt').value = buildPrompt(); }

function renderEffects() {
  const cats = ['Tất cả', ...new Set(EFFECTS.map((e) => e.cat))];
  $('cats').innerHTML = cats.map((c) => `<button class="${c === cat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('');
  $('fx-grid').innerHTML = EFFECTS.filter((e) => cat === 'Tất cả' || e.cat === cat)
    .map((e) => `<button class="fx ${e.id === effect.id ? 'active' : ''}" data-fx="${e.id}"><div class="sw" style="background:${e.color}"></div><b>${esc(e.name)}</b></button>`).join('');
}
$('cats').addEventListener('click', (e) => { const c = e.target.closest('[data-cat]')?.dataset.cat; if (c) { cat = c; renderEffects(); } });
$('fx-grid').addEventListener('click', (e) => {
  const id = e.target.closest('[data-fx]')?.dataset.fx;
  if (!id) return;
  effect = EFFECTS.find((x) => x.id === id);
  promptEdited = false;
  renderEffects();
  renderPrompt();
});
$('intensity').addEventListener('input', () => { $('intensity-val').textContent = `${$('intensity').value}%`; renderPrompt(); });
$('prompt').addEventListener('input', () => { promptEdited = true; });
$('reset-prompt').addEventListener('click', (e) => { e.preventDefault(); promptEdited = false; renderPrompt(); });
$('model').innerHTML = `<option value="">Giữ như Flow</option>${imageModels().map((m) => `<option>${esc(m)}</option>`).join('')}`;
$('ratios').innerHTML = RATIOS.map(([v, l]) => `<button data-r="${v}" class="${v === ratio ? 'active' : ''}">${l}</button>`).join('');
$('ratios').addEventListener('click', (e) => {
  const b = e.target.closest('[data-r]');
  if (!b) return;
  ratio = b.dataset.r;
  $('ratios').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
});

const refresh = watchTasks(() => ids, (tasks) => {
  $('empty').hidden = tasks.length > 0;
  $('results').innerHTML = resultCards([...tasks].reverse(), (t) => t.label || t.prompt);
  const running = tasks.filter((t) => t.status === 'pending' || t.status === 'running').length;
  $('queue-info').textContent = running ? `${running} lượt đang chạy` : '';
});

$('go').addEventListener('click', async () => {
  const src = source.get();
  if (!src) { toast('Chọn ảnh gốc trước'); return; }
  const prompt = $('prompt').value.trim();
  if (!prompt) { toast('Prompt trống'); return; }
  $('go').disabled = true;
  const r = await submitToPanel({
    source: 'effects', image: src,
    tasks: [{ prompt, label: `${effect.name} · ${$('intensity').value}%`, genType: 'image', model: $('model').value, ratio, quantity: +$('qty').value }]
  });
  $('go').disabled = false;
  if (!r?.ok) { toast(r?.error || 'Không gửi được'); return; }
  ids.push(...r.ids);
  sessionStorage.setItem('fxIds', JSON.stringify(ids));
  refresh();
  toast('Đã gửi sang hàng đợi');
});
$('clear').addEventListener('click', () => { ids.length = 0; sessionStorage.setItem('fxIds', '[]'); refresh(); });

renderEffects();
renderPrompt();

// Angles: ảnh chủ thể + góc máy (xoay / độ cao / khoảng cách) → prompt tái hiện chủ thể ở góc mới, gửi Flow.
import { $, esc, toast, init, imageModels, sourcePicker, submitToPanel, watchTasks, resultCards } from './tools-common.js';

const ROTATION = {
  '-180': ['phía sau', 'from directly behind the subject, showing their back'],
  '-135': ['sau - trái', 'from behind and to the left, three-quarter rear view'],
  '-90': ['bên trái', 'from the left side, full left profile'],
  '-45': ['3/4 trái', 'from slightly left of front, three-quarter view from the left'],
  0: ['chính diện', 'from directly in front, the subject facing the camera'],
  45: ['3/4 phải', 'from slightly right of front, three-quarter view from the right'],
  90: ['bên phải', 'from the right side, full right profile'],
  135: ['sau - phải', 'from behind and to the right, three-quarter rear view'],
  180: ['phía sau', 'from directly behind the subject, showing their back']
};
const TILT = {
  '-60': ['sát mặt đất', 'camera very low near the ground looking up'],
  '-30': ['góc thấp', 'low camera angle looking up'],
  0: ['ngang tầm mắt', 'camera at eye level'],
  30: ['góc cao', 'high camera angle looking down'],
  60: ['rất cao', 'camera high above looking steeply down'],
  90: ['từ trên xuống', 'top-down overhead view']
};
const ZOOM = {
  '-2': ['toàn cảnh', 'extreme wide shot showing the whole environment'],
  '-1': ['toàn thân', 'wide shot with the full body visible'],
  0: ['trung cảnh', 'medium shot from the waist up'],
  1: ['cận cảnh', 'close-up on face and shoulders'],
  2: ['đặc tả', 'extreme close-up with fine detail']
};
const PRESETS = [
  ['Chính diện', 0, 0, 0], ['3/4 trái', -45, 0, 0], ['Trái', -90, 0, 0], ['Phía sau', 180, 0, -1],
  ['3/4 phải', 45, 0, 0], ['Phải', 90, 0, 0], ['Từ trên xuống', 0, 90, -1], ['Góc thấp', 0, -30, -1], ['Cận mặt', 0, 0, 1]
];

await init();
const ids = JSON.parse(sessionStorage.getItem('angIds') || '[]');
const queue = [];
const source = sourcePicker($('zone'), $('file'), () => {});

const nearest = (map, v) => {
  const keys = Object.keys(map).map(Number);
  return map[keys.reduce((b, k) => (Math.abs(k - v) < Math.abs(b - v) ? k : b), keys[0])];
};
const state = () => ({ rot: +$('rot').value, tilt: +$('tilt').value, zoom: +$('zoom').value });
const label = (s) => `${nearest(ROTATION, s.rot)[0]} · ${nearest(TILT, s.tilt)[0]} · ${nearest(ZOOM, s.zoom)[0]}`;
const buildPrompt = (s) => `Recreate this exact subject photographed ${nearest(ROTATION, s.rot)[1]}, ${nearest(TILT, s.tilt)[1]}, ${nearest(ZOOM, s.zoom)[1]}. `
  + 'Keep the identical appearance, face, clothing, colors and every detail. Same lighting and background style.';

function render() {
  const s = state();
  $('rot-val').textContent = `${s.rot}° · ${nearest(ROTATION, s.rot)[0]}`;
  $('tilt-val').textContent = nearest(TILT, s.tilt)[0];
  $('zoom-val').textContent = nearest(ZOOM, s.zoom)[0];
  $('prompt').value = buildPrompt(s);
  // Vị trí camera trên vòng: 0° = phía dưới (mặt trước), xoay theo chiều kim đồng hồ.
  const r = 100, a = (s.rot * Math.PI) / 180;
  $('cam').style.left = `${120 + r * Math.sin(-a)}px`;
  $('cam').style.top = `${120 + r * Math.cos(a)}px`;
  $('list-count').textContent = queue.length ? `${queue.length} góc` : '';
  $('angle-list').innerHTML = queue.map((q, i) => `<div class="it">${esc(label(q))}<button data-rm="${i}" title="Bỏ">✕</button></div>`).join('');
}
for (const id of ['rot', 'tilt', 'zoom']) $(id).addEventListener('input', render);
$('presets').innerHTML = PRESETS.map(([n], i) => `<button data-p="${i}">${esc(n)}</button>`).join('');
$('presets').addEventListener('click', (e) => {
  const p = PRESETS[+e.target.closest('[data-p]')?.dataset.p];
  if (!p) return;
  [$('rot').value, $('tilt').value, $('zoom').value] = [p[1], p[2], p[3]];
  render();
});
// Kéo camera quanh vòng tròn.
let dragging = false;
$('cam').addEventListener('pointerdown', (e) => { dragging = true; $('cam').setPointerCapture(e.pointerId); });
$('cam').addEventListener('pointerup', () => { dragging = false; });
$('cam').addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const box = $('orbit').getBoundingClientRect();
  const dx = e.clientX - (box.left + box.width / 2), dy = e.clientY - (box.top + box.height / 2);
  let deg = Math.round((Math.atan2(-dx, dy) * 180) / Math.PI / 15) * 15;
  if (deg > 180) deg -= 360;
  $('rot').value = deg;
  render();
});
$('add-angle').addEventListener('click', () => { queue.push(state()); render(); });
$('angle-list').addEventListener('click', (e) => { const i = e.target.closest('[data-rm]')?.dataset.rm; if (i !== undefined) { queue.splice(+i, 1); render(); } });
$('model').innerHTML = `<option value="">Giữ như Flow</option>${imageModels().map((m) => `<option>${esc(m)}</option>`).join('')}`;

const refresh = watchTasks(() => ids, (tasks) => {
  $('empty').hidden = tasks.length > 0;
  $('results').innerHTML = resultCards([...tasks].reverse(), (t) => t.label || t.prompt);
  const running = tasks.filter((t) => t.status === 'pending' || t.status === 'running').length;
  $('queue-info').textContent = running ? `${running} lượt đang chạy` : '';
});

$('go').addEventListener('click', async () => {
  const src = source.get();
  if (!src) { toast('Chọn ảnh chủ thể trước'); return; }
  const angles = queue.length ? [...queue] : [state()];
  $('go').disabled = true;
  const r = await submitToPanel({
    source: 'angles', image: src,
    tasks: angles.map((s) => ({ prompt: buildPrompt(s), label: `Góc: ${label(s)}`, genType: 'image', model: $('model').value, ratio: $('ratio').value, quantity: 1 }))
  });
  $('go').disabled = false;
  if (!r?.ok) { toast(r?.error || 'Không gửi được'); return; }
  ids.push(...r.ids);
  sessionStorage.setItem('angIds', JSON.stringify(ids));
  queue.length = 0;
  render();
  refresh();
  toast(`Đã gửi ${angles.length} góc sang hàng đợi`);
});
$('clear').addEventListener('click', () => { ids.length = 0; sessionStorage.setItem('angIds', '[]'); refresh(); });

render();

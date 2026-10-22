// Workflow mẫu có sẵn (tab Workflow → Templates → "Dùng mẫu" để sao chép về danh sách của bạn).
import { newWorkflow, createNode, nid } from './workflow-nodes.js';

const edge = (a, ap, b, bp) => ({ id: nid(), from: { node: a.id, port: ap }, to: { node: b.id, port: bp } });

function build(name, fn) {
  const wf = newWorkflow(name);
  const { nodes, edges } = fn();
  wf.nodes = nodes;
  wf.edges = edges;
  nodes.forEach((n, i) => { if (n.type !== 'note') n.data.slug = `${n.type}_${i + 1}`; });
  return wf;
}

// Theo video 3: chủ đề + số cảnh + phong cách → ChatGPT viết storyboard có mốc → tách từng mốc → ảnh → video.
function storyboardTemplate(scenes = 3) {
  return build('Storyboard tự động (ChatGPT → ảnh → video)', () => {
    const topic = createNode('text', 40, 40, { name: 'Chủ đề content', text: 'Người tiền sử săn voi ma mút' });
    const count = createNode('text', 40, 330, { name: 'Số lượng cảnh', text: String(scenes) });
    const style = createNode('text', 40, 620, { name: 'Global Style', text: 'Stylized prehistoric clay 3D animation, warm cinematic light, consistent characters' });
    const ai = createNode('prompt', 420, 200, {
      name: 'ChatGPT - Auto Prompt', agent: true, agentProvider: 'chatgpt', agentSplit: false,
      text: 'Chủ đề: @chu_de\nSố cảnh: @so_luong\nPhong cách: @global_style',
      agentInstruction: 'Hãy viết storyboard tạo video cho câu chuyện theo yêu cầu dưới đây. Với mỗi cảnh i (đánh số 01, 02, ...), viết đúng 2 mục bằng tiếng Anh:\n[image_prompt_0i] mô tả ảnh tĩnh của cảnh, có phong cách chung\n[video_prompt_0i] mô tả chuyển động/camera của cảnh dài khoảng 8 giây\nChỉ trả về các mục theo đúng định dạng trên.'
    });
    const nodes = [topic, count, style, ai];
    const edges = [];
    for (let i = 1; i <= scenes; i++) {
      const k = String(i).padStart(2, '0');
      const y = (i - 1) * 760;
      const exImg = createNode('extract', 820, y, { name: `image_prompt_${k}`, mode: 'marker', marker: `image_prompt_${k}` });
      const exVid = createNode('extract', 820, y + 320, { name: `video_prompt_${k}`, mode: 'marker', marker: `video_prompt_${k}` });
      const img = createNode('generate', 1200, y, { name: `Ảnh cảnh ${k}`, ratio: '16:9' });
      const vid = createNode('generate', 1600, y, { name: `Video cảnh ${k}`, genType: 'video', videoMode: 'frames', ratio: '16:9' });
      nodes.push(exImg, exVid, img, vid);
      edges.push(edge(ai, 'text', exImg, 'text'), edge(ai, 'text', exVid, 'text'), edge(exImg, 'text', img, 'text'), edge(img, 'media', vid, 'frame_1'), edge(exVid, 'text', vid, 'text'));
    }
    const dl = createNode('download', 2000, 120, { name: 'Tải về' });
    nodes.push(dl);
    return { nodes, edges };
  });
}

export const TEMPLATES = [
  {
    id: 'tpl-storyboard', name: 'Storyboard tự động (ChatGPT → ảnh → video)', category: 'Storytelling', color: '#22c55e',
    desc: 'Nhập chủ đề, số cảnh, phong cách. ChatGPT viết storyboard có mốc [image_prompt_01]/[video_prompt_01], Text Extract tách từng cảnh, Flow tạo ảnh rồi tạo video từ ảnh.',
    make: () => storyboardTemplate(3),
    fix: (wf) => {
      const by = (name) => wf.nodes.find((n) => n.data.name === name);
      by('Chủ đề content').data.slug = 'chu_de';
      by('Số lượng cảnh').data.slug = 'so_luong';
      by('Global Style').data.slug = 'global_style';
      const dl = wf.nodes.find((n) => n.type === 'download');
      wf.nodes.filter((n) => n.type === 'generate' && n.data.genType === 'video').forEach((v) => wf.edges.push(edge(v, 'media', dl, 'media')));
      return wf;
    }
  },
  {
    id: 'tpl-motion', name: 'Thay đồ + cầm sản phẩm + chép chuyển động', category: 'Video Generation', color: '#ec4899',
    desc: 'Ảnh người mẫu + trang phục → ảnh mặc đồ; thêm ảnh sản phẩm → ảnh cầm sản phẩm; video chuyển động mẫu → video Ingredients chép chuyển động.',
    make: () => build('Thay đồ + sản phẩm + chuyển động', () => {
      const model = createNode('image', 40, 40, { name: 'Người mẫu' });
      const outfit = createNode('image', 40, 600, { name: 'Trang phục' });
      const p1 = createNode('prompt', 420, 40, { name: 'Prompt mặc đồ', text: 'The model from the first image wearing the exact outfit from the second image, full body, studio photo' });
      const g1 = createNode('generate', 820, 40, { name: 'Ảnh mặc đồ', ratio: '9:16' });
      const product = createNode('image', 820, 820, { name: 'Sản phẩm' });
      const p2 = createNode('prompt', 1220, 600, { name: 'Prompt cầm sản phẩm', text: 'The same person holding the product naturally, keep face, outfit and product details exact' });
      const g2 = createNode('generate', 1220, 40, { name: 'Ảnh cầm sản phẩm', ratio: '9:16' });
      const motion = createNode('image', 1620, 820, { name: 'Video chuyển động mẫu' });
      const p3 = createNode('prompt', 2020, 600, { name: 'Prompt video', text: 'The person performs the same motion as the reference video, smooth camera, realistic' });
      const g3 = createNode('generate', 2020, 40, { name: 'Video chép chuyển động', genType: 'video', videoMode: 'ingredients', ratio: '9:16' });
      return {
        nodes: [model, outfit, p1, g1, product, p2, g2, motion, p3, g3],
        edges: [edge(model, 'media', g1, 'image_ref'), edge(outfit, 'media', g1, 'image_ref'), edge(p1, 'text', g1, 'text'),
          edge(g1, 'media', g2, 'image_ref'), edge(product, 'media', g2, 'image_ref'), edge(p2, 'text', g2, 'text'),
          edge(g2, 'media', g3, 'image_ref'), edge(motion, 'media', g3, 'video_ref'), edge(p3, 'text', g3, 'text')]
      };
    })
  },
  {
    id: 'tpl-image-to-video', name: 'Ảnh → Video', category: 'Video Generation', color: '#3b82f6',
    desc: 'Tạo ảnh từ prompt, rồi dùng chính ảnh đó làm khung đầu để tạo video (giống video hướng dẫn).',
    make: () => build('Ảnh → Video', () => {
      const p1 = createNode('prompt', 60, 120, { name: 'Prompt ảnh', text: 'A cozy coffee shop at sunrise, warm light, cinematic, 9:16' });
      const g1 = createNode('generate', 440, 40, { name: 'Tạo ảnh', ratio: '9:16' });
      const p2 = createNode('prompt', 440, 760, { name: 'Prompt video', text: 'Slow cinematic push-in, steam rising from the cup, soft morning light' });
      const g2 = createNode('generate', 860, 40, { name: 'Tạo video', genType: 'video', videoMode: 'frames', ratio: '9:16', duration: '4s' });
      const dl = createNode('download', 1280, 120, { name: 'Tải về' });
      return { nodes: [p1, g1, p2, g2, dl], edges: [edge(p1, 'text', g1, 'text'), edge(g1, 'media', g2, 'frame_1'), edge(p2, 'text', g2, 'text'), edge(g2, 'media', dl, 'media')] };
    })
  },
  {
    id: 'tpl-ai-prompt-image', name: 'AI viết prompt → Ảnh hàng loạt', category: 'Image Generation', color: '#c6f432',
    desc: 'ChatGPT viết nhiều prompt từ một ý tưởng (mỗi dòng 1 prompt), Flow tạo ảnh cho từng prompt rồi tự tải.',
    make: () => build('AI viết prompt → Ảnh', () => {
      const p = createNode('prompt', 60, 120, {
        name: 'Ý tưởng', text: 'Ảnh quảng cáo trà sữa phong cách 3D dễ thương', agent: true, agentProvider: 'chatgpt', agentSplit: true,
        agentInstruction: 'Viết 4 prompt tạo ảnh 3D chuyên nghiệp bằng tiếng Anh về chủ đề sau. Mỗi prompt một dòng, không đánh số.'
      });
      const g = createNode('generate', 460, 40, { name: 'Tạo ảnh', ratio: '1:1' });
      const dl = createNode('download', 880, 120, { name: 'Tải về' });
      return { nodes: [p, g, dl], edges: [edge(p, 'text', g, 'text'), edge(g, 'media', dl, 'media')] };
    })
  },
  {
    id: 'tpl-ref-product', name: 'Ảnh sản phẩm + tham chiếu', category: 'Image Generation', color: '#f5a524',
    desc: 'Tải ảnh sản phẩm lên, Flow tạo nhiều bối cảnh quảng cáo giữ đúng sản phẩm.',
    make: () => build('Ảnh sản phẩm + tham chiếu', () => {
      const img = createNode('image', 60, 40, { name: 'Ảnh sản phẩm' });
      const p = createNode('prompt', 60, 640, { name: 'Bối cảnh', multi: true, text: 'Product on a marble kitchen counter, morning light\nProduct on a beach at sunset, summer vibe\nProduct floating among fruits, studio lighting' });
      const g = createNode('generate', 480, 40, { name: 'Tạo ảnh', ratio: '1:1', quantity: 2 });
      const dl = createNode('download', 900, 120, { name: 'Tải về' });
      return { nodes: [img, p, g, dl], edges: [edge(img, 'media', g, 'image_ref'), edge(p, 'text', g, 'text'), edge(g, 'media', dl, 'media')] };
    })
  },
  {
    id: 'tpl-video-chain', name: 'Chuỗi video nối khung cuối', category: 'Video Generation', color: '#a855f7',
    desc: 'Video 2 bắt đầu từ khung cuối của video 1 để tạo cảnh liền mạch.',
    make: () => build('Chuỗi video nối khung cuối', () => {
      const p1 = createNode('prompt', 60, 80, { name: 'Cảnh 1', text: 'A paper boat sails down a rainy street, close-up, cinematic' });
      const g1 = createNode('generate', 440, 40, { name: 'Video 1', genType: 'video', videoMode: 'text', ratio: '16:9' });
      const p2 = createNode('prompt', 440, 520, { name: 'Cảnh 2', text: 'The boat reaches a big puddle reflecting neon lights, camera rises' });
      const g2 = createNode('generate', 860, 40, { name: 'Video 2', genType: 'video', videoMode: 'frames', ratio: '16:9' });
      const dl = createNode('download', 1280, 120, { name: 'Tải về' });
      return { nodes: [p1, g1, p2, g2, dl], edges: [edge(p1, 'text', g1, 'text'), edge(g1, 'frame', g2, 'frame_1'), edge(p2, 'text', g2, 'text'), edge(g1, 'media', dl, 'media'), edge(g2, 'media', dl, 'media')] };
    })
  },
  {
    id: 'tpl-story', name: 'Kịch bản truyện → nhiều cảnh', category: 'Storytelling', color: '#14b8a6',
    desc: 'AI viết kịch bản 5 cảnh, mỗi cảnh thành 1 ảnh minh hoạ cùng phong cách (dùng @mention phong cách).',
    make: () => build('Kịch bản truyện → nhiều cảnh', () => {
      const style = createNode('text', 60, 40, { name: 'Phong cách', text: 'soft watercolor and ink storybook illustration, warm earth tones' });
      const idea = createNode('prompt', 60, 300, {
        name: 'Kịch bản', text: 'Chú mèo nhỏ đi tìm mẹ trong thành phố', agent: true, agentProvider: 'chatgpt', agentSplit: true,
        agentInstruction: 'Viết kịch bản 5 cảnh bằng tiếng Anh cho câu chuyện sau, mỗi cảnh một dòng mô tả hình ảnh, không đánh số.'
      });
      const g = createNode('generate', 480, 40, { name: 'Minh hoạ', ratio: '16:9', prompt: '{input}, @generate_style' });
      return { nodes: [style, idea, g], edges: [edge(idea, 'text', g, 'text')] };
    }),
    fix: (wf) => { const s = wf.nodes.find((n) => n.data.name === 'Phong cách'); const g = wf.nodes.find((n) => n.type === 'generate'); s.data.slug = 'phong_cach'; g.data.prompt = '{input}, @phong_cach'; return wf; }
  }
];

export function instantiateTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  let wf = t.make();
  if (t.fix) wf = t.fix(wf);
  wf.fromTemplate = id;
  return wf;
}

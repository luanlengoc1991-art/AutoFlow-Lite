// Danh sách provider và cách tìm/mở tab của từng provider.

export const PROVIDERS = {
  flow: {
    name: 'Google Flow', kind: 'flow',
    urls: ['https://flow.google.com/*', 'https://labs.google/fx/*'],
    home: 'https://flow.google.com/',
    scripts: ['content/flow-driver.js', 'content/tracker.js', 'content/main.js']
  },
  chatgpt: {
    name: 'ChatGPT', kind: 'chat',
    urls: ['https://chatgpt.com/*'],
    home: 'https://chatgpt.com/',
    newChat: 'https://chatgpt.com/',
    scripts: ['content/chat-driver.js', 'content/tracker.js', 'content/chat-main.js']
  },
  gemini: {
    name: 'Gemini', kind: 'chat',
    urls: ['https://gemini.google.com/*'],
    home: 'https://gemini.google.com/app',
    newChat: 'https://gemini.google.com/app',
    scripts: ['content/chat-driver.js', 'content/tracker.js', 'content/chat-main.js']
  },
  grok: {
    name: 'Grok', kind: 'chat',
    urls: ['https://grok.com/*'],
    home: 'https://grok.com/',
    newChat: 'https://grok.com/',
    scripts: ['content/chat-driver.js', 'content/tracker.js', 'content/chat-main.js']
  },
  // Claude chỉ trả lời văn bản (viết prompt, phân tích ảnh), không tạo ảnh.
  claude: {
    name: 'Claude', kind: 'chat', textOnly: true,
    urls: ['https://claude.ai/*'],
    home: 'https://claude.ai/new',
    newChat: 'https://claude.ai/new',
    scripts: ['content/chat-driver.js', 'content/tracker.js', 'content/chat-main.js']
  },
  // Seedance chạy trên Dreamina (CapCut) bằng credit của tài khoản đăng nhập.
  seedance: {
    name: 'Seedance', kind: 'gen',
    urls: ['https://dreamina.capcut.com/*'],
    home: 'https://dreamina.capcut.com/ai-tool/generate?type=video',
    scripts: ['content/gen-driver.js', 'content/tracker.js', 'content/chat-main.js']
  }
};

export const CHAT_PROVIDERS = Object.keys(PROVIDERS).filter((k) => PROVIDERS[k].kind === 'chat');

// Bảng tiến độ nổi trên trang Flow (Shadow DOM để không đụng CSS của Flow).
(function () {
  if (window.AFLTracker) return;

  let host = null, shadow = null, collapsed = false;

  const CSS = `
    :host { all: initial; }
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; width: 280px;
      font: 12px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #ececec;
      background: #1c1c1e; border: 1px solid #333; border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.45); overflow: hidden; }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; user-select: none; }
    .logo { width: 18px; height: 18px; border-radius: 50%; background: #c6f432; display: grid; place-items: center; color: #111; font-weight: 800; font-size: 11px; }
    .title { font-weight: 650; flex: 1; }
    .count { color: #c6f432; font-weight: 650; }
    .body { padding: 0 12px 12px; }
    .bar { height: 4px; background: #333; border-radius: 2px; overflow: hidden; margin: 2px 0 8px; }
    .fill { height: 100%; background: linear-gradient(90deg, #c6f432, #e7fb9a); width: 0; transition: width .4s; }
    .cur { color: #bdbdbd; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 17px; }
    .msg { margin-top: 6px; color: #ffb547; }
    .msg.err { color: #ff6b6b; }
    .row { display: flex; gap: 6px; margin-top: 10px; }
    button { flex: 1; font: inherit; color: #ececec; background: #2a2a2d; border: 1px solid #3a3a3d; border-radius: 8px; padding: 6px 8px; cursor: pointer; }
    button:hover { background: #333336; }
    button.stop { color: #ff6b6b; }
    .collapsed .body { display: none; }
  `;

  function ensure() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-afl-root', '');
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${CSS}</style>
      <div class="box">
        <div class="head"><div class="logo">✦</div><div class="title">AutoFlow</div><div class="count"></div></div>
        <div class="body">
          <div class="bar"><div class="fill"></div></div>
          <div class="cur"></div>
          <div class="msg"></div>
          <div class="row"><button class="pause">Tạm dừng</button><button class="stop">Dừng</button></div>
        </div>
      </div>`;
    shadow.querySelector('.head').addEventListener('click', () => {
      collapsed = !collapsed;
      shadow.querySelector('.box').classList.toggle('collapsed', collapsed);
    });
    shadow.querySelector('.pause').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'afl:control', action: 'togglePause' }).catch(() => {}));
    shadow.querySelector('.stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'afl:control', action: 'stop' }).catch(() => {}));
    document.documentElement.appendChild(host);
  }

  // s: { visible, done, total, current, progress, paused, message, level }
  function update(s) {
    if (!s?.visible) { host?.remove(); host = null; return; }
    ensure();
    const $ = (sel) => shadow.querySelector(sel);
    $('.count').textContent = `${s.done}/${s.total}`;
    $('.fill').style.width = s.total ? `${Math.round(((s.done + (s.progress || 0) / 100) / s.total) * 100)}%` : '0';
    $('.cur').textContent = s.current ? `${s.progress != null ? s.progress + '% · ' : ''}${s.current}` : (s.paused ? 'Đang tạm dừng' : 'Đang chờ…');
    $('.msg').textContent = s.message || '';
    $('.msg').className = `msg ${s.level === 'error' ? 'err' : ''}`;
    $('.pause').textContent = s.paused ? 'Tiếp tục' : 'Tạm dừng';
  }

  window.AFLTracker = { update };
})();

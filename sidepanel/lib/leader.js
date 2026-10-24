// Chỉ một side panel điều khiển AutoFlow (mỗi cửa sổ Chrome có side panel riêng). Panel điều khiển giữ
// "giấy phép" trong chrome.storage.session và cập nhật nhịp đều; panel khác chỉ hiện thông báo, không nhận lệnh,
// không ghi hàng đợi (tránh chạy trùng workflow và ghi đè dữ liệu của nhau).
import { uid } from './store.js';

const KEY = 'aflLeader';
const HANDOVER = 'aflHandover';
const BEAT_MS = 4000;
const STALE_MS = 12000;

// Giữ nguyên id khi tải lại trang (nhận quyền rồi tải lại vẫn là panel điều khiển).
function panelId() {
  try { return sessionStorage.aflPanelId || (sessionStorage.aflPanelId = uid()); } catch (_) { return uid(); }
}

export class Leader {
  constructor({ status = () => ({}) } = {}) {
    this.id = panelId();
    this.status = status; // thông tin kèm nhịp, vd. { busy: true } để panel kia cảnh báo khi nhận quyền
    this.is = false;
    this.onLost = null;
    this.onFree = null;
  }

  async read() { return (await chrome.storage.session.get(KEY))[KEY] || null; }
  write(extra = {}) { return chrome.storage.session.set({ [KEY]: { id: this.id, at: Date.now(), ...this.status(), ...extra } }); }

  // Nhận quyền nếu chưa ai giữ, giấy phép đã cũ (panel kia đã đóng) hoặc chính panel này đang giữ.
  async claim() {
    const cur = await this.read();
    if (cur && cur.id !== this.id && Date.now() - cur.at < STALE_MS) return false;
    await this.write();
    this.is = true;
    return true;
  }

  // Bắt đầu nhịp (nếu đang giữ quyền) và theo dõi: mất quyền → onLost; panel giữ quyền đã đóng (giấy phép cũ) → onFree.
  // Không trả quyền khi pagehide: tải lại trang cũng gây pagehide, panel khác sẽ chen vào giữa chừng.
  watch() {
    this.timer = setInterval(async () => {
      if (this.is) { await this.write(); return; }
      const cur = await this.read();
      if (!cur || Date.now() - cur.at >= STALE_MS) this.onFree?.();
    }, BEAT_MS);
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'session' || !c[KEY] || !this.is) return;
      const next = c[KEY].newValue;
      if (next && next.id !== this.id) { this.is = false; this.onLost?.(next); }
    });
  }

  // Panel này nhận quyền từ panel đang điều khiển (người dùng bấm "Dùng ở cửa sổ này"). Chờ panel kia
  // dừng bộ chạy và ghi xong hàng đợi (handover) rồi mới trả về, để tải lại thì đọc đúng dữ liệu mới nhất.
  async takeOver(ms = 35000) {
    const prev = await this.read();
    await chrome.storage.session.remove(HANDOVER);
    await this.write();
    this.is = true;
    if (!prev || prev.id === this.id || Date.now() - prev.at >= STALE_MS) return;
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const h = (await chrome.storage.session.get(HANDOVER))[HANDOVER];
      if (h?.to === this.id) return;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Panel vừa mất quyền báo đã dừng và ghi xong dữ liệu.
  handedOver(to) { return chrome.storage.session.set({ [HANDOVER]: { from: this.id, to, at: Date.now() } }); }
}

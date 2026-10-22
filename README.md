# AutoFlow Lite

Extension Chrome (MV3) tự động hoá **Google Flow**, **ChatGPT**, **Gemini** và **Grok**:
- tạo ảnh/video hàng loạt, task lưu sẵn để chạy lại;
- workflow kéo thả nhiều bước;
- Effects, Angles;
- hàng đợi có thử lại, tự tải kết quả (kể cả bản upscale).

Viết lại độc lập theo hành vi của TobyFlow (đối chiếu với 2 video hướng dẫn chính thức); không dùng mã nguồn, server hay license của họ.

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**, chọn **Load unpacked** và trỏ tới thư mục này.
2. Mở https://flow.google.com, vào một project, bấm icon AutoFlow để mở side panel.
3. Bấm **Đồng bộ từ Flow** để lấy model, tuỳ chọn, nhân vật, giọng nói thật trong tài khoản của bạn.
4. Muốn dùng ChatGPT / Gemini / Grok: đăng nhập các trang đó trong cùng trình duyệt.
5. Lần đầu tải bản upscale, Chrome có thể hỏi *"Trang này muốn tải nhiều file"*: chọn **Cho phép**.

## Các tab

| Tab | Chức năng |
|---|---|
| **Gen** | Multi-Prompt (mặc định tách bằng dòng trống), "N prompt → M output(s)", Trợ lý prompt (AI viết prompt), import .txt/.csv, biến `{a\|b}`. Chọn Flow / ChatGPT / Gemini / Grok; ảnh/video, model, tỉ lệ, số lượng, Frames/Ingredients, thời lượng. **Nhân vật** (từ Flow), **Phong cách** (12 phong cách dựng sẵn + tự tạo, nối vào mọi prompt), `@char:` / `@voice:`. **Ảnh tham chiếu**: Tất cả / Mention (`@img1`, `@img2`…) / Thứ tự. **Dùng kết quả trước làm tham chiếu** (chỉ ảnh ngay trước / tất cả). Tự tải: thư mục + độ phân giải (Gốc/2K/4K; video Gốc/1080p/4K). **Parallel**. Nút **+** lưu cấu hình thành task; **Generate** chạy ngay |
| **Workflow** | Tab con **Templates** (5 mẫu, "Dùng mẫu") / **Workflows** (chạy, sửa, bật/tắt, ⋮: nhân bản, đổi tên, lưu làm mẫu, xuất) / **Mẫu của tôi**. **Tạo** mở hộp đặt tên, editor mở trong cửa sổ riêng |
| **Prompts** | Thư viện prompt |
| **Tasks** | Task đã lưu, nhóm theo ngày: tên, provider, ảnh/video, prompt đầu, trạng thái lần chạy, bật/tắt, ⋮ (chạy, mở trong Gen, cập nhật từ Gen, nhân bản, đổi tên, xoá). **Chạy tất cả** (task đang bật hoặc đã tích chọn), Parallel |
| Công cụ | **Angles** (vòng chọn góc máy kéo được, độ cao camera, khoảng cách, góc có sẵn, tạo nhiều góc cùng lúc) và **Effects** (17 hiệu ứng: chỉnh màu, ánh sáng, thời tiết, nghệ thuật, phong cách, kèm thanh cường độ), mỗi công cụ mở trong cửa sổ riêng |
| Hàng đợi | Mọi lượt tạo: tiến độ, thumbnail, thử lại |
| Lịch sử / Nhật ký / Cài đặt | Kết quả đã tạo, log, cấu hình chạy, tải xuống, selector tuỳ chỉnh, chẩn đoán |

## Tài khoản AI (dùng hạn mức gói của bạn)

AutoFlow không dùng API key hay server trung gian: nó điều khiển trực tiếp trang Google Flow, ChatGPT, Gemini, Grok bằng **phiên đăng nhập trên trình duyệt của bạn**, nên mọi lượt tạo tính vào hạn mức gói tài khoản đó (Free / Plus / Pro / Ultra…).
- Bánh răng → **Cài đặt → Tài khoản AI**: trạng thái từng tài khoản (✓ Ready / Cần đăng nhập / Chưa mở / Chưa vào project), nút **Kết nối** (mở trang để đăng nhập) và **Kiểm tra**.
- Gen: nút **📷 Chụp màn hình** thêm ảnh chụp tab đang mở làm ảnh tham chiếu.
- Trợ lý prompt kiểm tra Ready trước khi gửi và hỏi xác nhận.

## AI Agent (MCP) và Telegram

- **MCP**: `mcp/autoflow-mcp.mjs` (Node 18+, không cần cài thư viện) là máy chủ MCP qua stdio.
  - Vào Cài đặt → AI Agent / Bot → AI / MCP: bật cầu nối, nhập thư mục extension.
  - Copy cấu hình cho Claude Desktop / Cursor, hoặc lệnh `claude mcp add` cho Claude Code.
  - Công cụ: `autoflow_status`, `autoflow_generate`, `autoflow_list_workflows`, `autoflow_run_workflow`, `autoflow_create_workflow`, `autoflow_recent_results`.
  - Side panel phải đang mở.
- **Telegram**:
  - Tạo bot với @BotFather, dán token, bật bot, gửi `/start` để liên kết chat.
  - Lệnh `/gen <prompt>`, `/video <prompt>`, `/status`, `/stop`, `/help`.
  - Ảnh/video kết quả được gửi về chat.

## Trình soạn workflow

- Canvas tối lưới chấm: lăn chuột để zoom, giữ Space hoặc dùng công cụ bàn tay để kéo canvas, kéo khung để chọn nhiều node.
- Thanh công cụ trái: thêm node (N), chọn, bàn tay, ghi chú/nhóm, media từ thư viện, chạy, hoàn tác/làm lại, refresh, tìm node, sắp xếp lại, cài đặt.
- Menu chuột phải giống bản gốc; menu thêm node có ô tìm kiếm và phím ↑↓ Enter Esc.
- **Node:**
  - Prompt (Plain / AI Agent ChatGPT-Gemini-Grok, Multi-prompt)
  - Text (nguồn cho `@slug`)
  - Text Extract
  - Image/Video (tải lên, kéo thả, dán, từ thư viện)
  - Flow - Image/Video Generate (cổng ảnh tham chiếu, prompt, Khung đầu/cuối; cổng ra kết quả và khung cuối video)
  - ChatGPT, Gemini, Grok
  - Download, Wait
  - Ghi chú (khung nhóm, chạy cả nhóm)
- **Cổng có kiểu** (văn bản tím, ảnh xanh dương, video tím đậm, khung hình xanh ngọc). Nối sai kiểu hoặc tạo vòng lặp sẽ bị chặn. Thả dây ra chỗ trống để mở menu node phù hợp.
- Thanh nổi trên node: chạy node, cấu hình, tạo nhánh, nhân bản, xoá.
- Panel phải: Cấu hình / Kết quả, Tên Node / @Slug, Close / Reset / Lưu Node.
- **Khi chạy:** node đang chạy có viền gradient chuyển động và thanh "đã xong/tổng"; node xong có viền xanh; dây đang truyền dữ liệu có hạt chạy; panel **Log & tiến độ**.
- Header: Reset, Lưu, Lưu bản sao, Chia sẻ (xuất .json), Max Speed. Bộ chạy nằm ở side panel.

## Kiểm thử

`tests/`:
- trang Flow giả lập (React + Slate thật, popover Radix, menu nhân vật/giọng, tile, lỗi, toast, menu Download upscale);
- trang chat giả lập theo cấu trúc ChatGPT;
- hai bộ test chạy bằng Edge headless:

```
node tests/test-driver.mjs <thư-mục-extension> <thư-mục-ảnh>
node tests/test-e2e.mjs <thư-mục-extension> <thư-mục-làm-việc>
```

## Giới hạn

- Trang giả lập dựng theo cấu trúc suy ra từ hành vi của TobyFlow và video hướng dẫn. **Chưa chạy trên Flow/ChatGPT/Gemini/Grok thật.** Có lỗi thì vào **Cài đặt → Chẩn đoán** và gửi file JSON để hiệu chỉnh.
- Không có: Max Speed qua API (Toby Bridge), xoá watermark, template/thiết bị đồng bộ qua server.
- Side panel phải mở trong lúc chạy.
- Hãy tuân thủ điều khoản sử dụng và hạn mức của Google, OpenAI, xAI.

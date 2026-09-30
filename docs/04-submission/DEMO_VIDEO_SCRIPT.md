# Kịch bản video demo — 2 đến 3 phút

## Quy tắc ghi hình

- Dùng desktop build đã nghiệm thu và dữ liệu E2E năm tài khoản hiện có.
- Không để lộ JWT, OAuth token, webhook secret, encryption key, private key, seed phrase hoặc chat riêng không dành cho hồ sơ.
- Gọi project mẫu là source prototype có walkthrough tĩnh.
- Phân biệt trạng thái CI, claim của project, platform credential, tư vấn AI và quyết định của con người.

## Danh sách cảnh và lời dẫn

### 0:00–0:15 — Vấn đề và sự kiện

Hiển thị sự kiện đã publish và navigation theo vai trò.

> Đội thi hackathon làm sản phẩm dưới deadline ngắn, trong khi công việc, code, bằng chứng và thông tin nộp bài nằm ở nhiều công cụ. Azync HackHub nối quy trình đó cho đội thi, ban tổ chức và giám khảo.

### 0:15–0:40 — Team và GitHub

Mở workspace của đội hai thành viên, repository panel, revision mới nhất và trạng thái CI.

> Đội có thể mời thành viên và bắt đầu xây dựng từ một workspace. Azync tạo repository GitHub riêng tư, thêm collaborator được cấp quyền, cài CI và nhận cập nhật webhook có chữ ký.

### 0:40–1:05 — Planning

Hiển thị area, dependency, critical path, progress, alert và activity.

> Planning được thiết kế cho một sprint hackathon ngắn. Dependency chặn trạng thái không hợp lệ; progress, critical path và alert theo luật giúp đội thấy phần nào còn đe dọa deadline.

### 1:05–1:30 — Draft, final receipt và Solana

Hiển thị draft validation, final receipt, Submission Ledger và Explorer proof. Dùng receipt đã confirmed; không tạo final khác.

> Đội kiểm tra đúng draft revision rồi gửi một final snapshot bất biến. Azync cấp compressed NFT trên Solana devnet cho địa chỉ nhận và hiển thị transaction cùng asset để xác minh độc lập.

### 1:30–2:05 — Judge brief và inquiry

Mở completed analysis, evidence link, uncertainty, rubric context và một đoạn Judge Inquiry ngắn.

> Trước khi AI diễn giải, Azync thu thập GitHub evidence gắn commit, Solana proof đã final và demo check có giới hạn. Brief liên kết nhận định với evidence và ghi rõ phần chưa chắc chắn. Mỗi giám khảo có chat riêng được mã hóa, còn đánh giá chính thức vẫn do con người quyết định.

### 2:05–2:30 — Organizer closeout

Hiển thị organizer submissions, CSV/export và winner action. Nếu organizer đã đưa ra quyết định thật, hiển thị `AHWIN` proof đã confirmed. Nếu chưa, chỉ hiển thị action và không click.

> Sau deadline, organizer xem final submission và ghi một quyết định winner bất biến do con người đưa ra. Winner credential riêng có thể được xác minh trên Solana mà không cho AI quyền chọn kết quả.

### 2:30–2:45 — Kết

> Azync HackHub nối giai đoạn làm sản phẩm, hồ sơ nộp bài và evidence review trong một luồng có thể audit.

## Kiểm tra cuối

- Video mở được trong cửa sổ ẩn danh.
- Âm thanh rõ; có phụ đề nếu cổng nộp yêu cầu.
- Mọi link hiển thị đúng quyền cho reviewer.
- Không claim project mẫu đã deploy hoặc platform cNFT chứng minh đội thi tích hợp Solana.

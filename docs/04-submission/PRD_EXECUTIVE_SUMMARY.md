# Yêu cầu sản phẩm — Bản tóm tắt PRD

## Mục tiêu sản phẩm

Azync HackHub là workspace hackathon ưu tiên desktop, kết nối vận hành sự kiện, quá trình làm việc của đội, bằng chứng kỹ thuật, bài nộp cuối và đánh giá do con người quyết định.

## Vai trò

- **Người tham gia:** quản lý hồ sơ, đội, repository, task, draft, final submission, ví nhận và proof.
- **Ban tổ chức:** tạo và publish sự kiện, track, luật, rubric, đăng ký, phân công judge, submission, export, đóng deadline và chứng nhận winner.
- **Giám khảo:** đọc submission được phân công cùng evidence, dùng AI inquiry riêng và tự đưa ra đánh giá.
- **Khách:** tìm sự kiện đã publish và chỉ xem dữ liệu công khai.

## Yêu cầu MVP

### Sự kiện và quyền truy cập

- Danh tính GitHub OAuth và phân quyền phía server.
- Tách phạm vi hiển thị giữa sự kiện draft và published.
- Luật cùng tiêu chí rubric có phiên bản.
- Kích hoạt track, đăng ký đội và quyền theo phân công giám khảo.

### Quá trình làm việc của đội

- Tạo đội, lời mời dùng một lần, vai trò thành viên và bảo vệ roster.
- Tạo repository GitHub riêng tư với collaborator, workflow CI và webhook có chữ ký.
- Area, task, dependency, critical path, template, activity feed, dự báo tiến độ và cảnh báo theo luật.
- Cập nhật realtime và kiểm tra lại quyền sau khi kết nối lại.

### Bài nộp

- Lưu draft theo revision và validator tất định trước khi submit.
- Final receipt bất biến sau khi kiểm tra deadline hợp lệ.
- Các trường repository, demo, video, slide, URL blockchain evidence, track và ví nhận.
- Double-submit idempotent và giữ nguyên final snapshot.

### Solana

- Backend tài trợ compressed NFT cho final submission (`AHSUB`).
- Lưu recipient, metadata hash, asset ID, transaction signature, tree, leaf và cluster.
- Reconcile và retry mà không mint trùng.
- Winner credential riêng (`AHWIN`), chỉ organizer được cấp sau deadline.

### AI và chấm bài

- Phân tích bất đồng bộ, không rollback submission đã xác nhận.
- GitHub evidence gắn commit, Solana evidence đã final và demo probing an toàn có giới hạn.
- Structured output chặt chẽ, business validation theo evidence và tối đa một lần repair.
- Project context có phiên bản, xử lý revision cũ và provenance link.
- Judge chat mã hóa, riêng theo judge, event và submission.
- AI không được ghi điểm chính thức hoặc chọn winner.
- UI tĩnh dùng tiếng Anh; hội thoại AI trả lời theo ngôn ngữ câu hỏi.

### Vận hành

- Organizer filter, pagination, CSV export và chặn formula injection.
- Health check, migration, recovery sau restart, load gate, backup/restore, secret scan và test phá hủy trong stack cô lập.

## Các gate chất lượng đã đạt

- Production build backend và các regression suite ghi trong báo cáo E2E cuối đã pass.
- Production build, typecheck, Chromium smoke trên desktop và accessibility audit của trang submit đã pass.
- Đã chạy đường GitHub, Solana devnet, Redis, PostgreSQL và AI provider với bằng chứng live và fixture được ghi nhãn riêng.

## Giới hạn đã biết

- Solflare chưa được cài trong browser test; Phantom đã chạy live.
- Một final submission chạy live; các case AI bổ sung và second judge dùng fixture cô lập.
- Project mẫu là source với walkthrough tĩnh, không phải ứng dụng đã deploy.
- Responsive/mobile nằm ngoài phạm vi E2E đã thống nhất.
- Reviewer note cuối và thao tác chọn winner live cần con người thực hiện.

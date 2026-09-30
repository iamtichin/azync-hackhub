# Azync HackHub — Tổng quan sản phẩm

> **Trạng thái:** MVP đã triển khai và kiểm thử E2E trên desktop với năm tài khoản
> **Cập nhật:** 30/09/2026
> **Mục tiêu:** UniHackFest 2026

## Sản phẩm

Azync HackHub là không gian vận hành hackathon dành cho đội thi, ban tổ chức và giám khảo. Sản phẩm nối việc lập kế hoạch, tạo repository GitHub riêng tư, tín hiệu CI, bài nộp cuối bất biến, chứng nhận Solana, AI đọc bằng chứng và bước tổng kết của ban tổ chức trong một luồng thống nhất.

## Vấn đề

Đội thi làm sản phẩm trong vài giờ nhưng công việc lại nằm rải rác giữa chat, bảng task, repository và biểu mẫu nộp bài. Ban tổ chức khó nhìn thấy tiến độ thực tế. Giám khảo có ít thời gian để phân biệt claim của đội với bằng chứng từ mã nguồn, CI, demo và dữ liệu blockchain.

## Giải pháp

### Đội thi

- Tạo đội và mời thành viên bằng liên kết có kiểm soát quyền.
- Tạo repository GitHub riêng tư, collaborator, workflow CI và webhook có chữ ký.
- Lập kế hoạch theo khu vực, dependency, ưu tiên, critical path và dự báo deadline.
- Lưu và kiểm tra bản nháp tại đúng revision.
- Tạo một final receipt bất biến và nhận chứng nhận cNFT trên Solana devnet.

### Giám khảo

- Đọc brief có phiên bản, xây dựng từ GitHub evidence gắn với commit, kiểm tra demo có giới hạn, luật, rubric và Solana proof đã xác nhận.
- Xem provenance, điểm chưa chắc chắn, concern và câu hỏi gợi ý.
- Trao đổi trong phiên chat mã hóa, riêng theo từng giám khảo và submission.
- Giữ toàn quyền đối với đánh giá chính thức.

### Ban tổ chức

- Cấu hình cuộc thi, track, luật, rubric, đăng ký và phân công giám khảo.
- Tìm kiếm, lọc, xem và xuất danh sách bài nộp cuối.
- Thực thi deadline và giữ final receipt sau khi cuộc thi đóng.
- Ghi một quyết định winner bất biến do con người đưa ra và cấp cNFT riêng cho winner.

## Điểm khác biệt

Azync bao phủ cả giai đoạn đội đang xây dựng sản phẩm, không chỉ lúc đăng ký và nộp bài. Hoạt động GitHub, planning, final receipt, evidence analysis và Solana proof dùng chung một mô hình phân quyền. CI là tín hiệu kỹ thuật, không phải điểm thi. AI giải thích bằng chứng và phần chưa chắc chắn; giám khảo cùng ban tổ chức vẫn đưa ra mọi quyết định chính thức.

## Mô hình tin cậy

- Nội dung do đội thi cung cấp được xem là dữ liệu không tin cậy.
- Backend thu thập bằng chứng trước khi AI diễn giải.
- Nhận định tích cực của AI phải trỏ đến bằng chứng được hệ thống chấp nhận.
- Submission vẫn thành công khi AI hoặc Solana provider tạm thời lỗi.
- Final receipt và quyết định winner là bất biến.
- Chat riêng của giám khảo được mã hóa và kiểm tra lại quyền trước khi truy cập.

## Hiện trạng triển khai

| Lớp | Công nghệ hiện tại |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, React Hook Form, Zod, Socket.IO client, Solana wallet adapters |
| Backend | NestJS 11, Prisma 5, PostgreSQL, Redis, BullMQ, Socket.IO |
| Tích hợp | GitHub OAuth/API/webhooks, Solana devnet và Metaplex Bubblegum, AI gateway độc lập provider |
| Kiểm chứng | Unit, integration, E2E cô lập, Chromium smoke trên desktop và checkpoint GitHub/Solana/AI live |

## Bằng chứng hiện có

- Đã chạy các vai trò organizer, judge, đội hai thành viên và người tham gia solo trên các browser desktop riêng.
- Đã kiểm tra repository mới, quyền collaborator, webhook có chữ ký, trạng thái Actions, planning, draft validation, final receipt và submission cNFT.
- Các gate về phân quyền, prompt injection, context cũ, submission trùng, retry, restart, migration, backup/restore và tải pilot đã đạt kết quả ghi trong báo cáo.
- Một submission live đã hoàn tất AI analysis; các case lỗi và cô lập bổ sung dùng fixture có nhãn rõ ràng.

## Giới hạn hiện tại

- Chưa kiểm thử Solflare extension live; Phantom đã chạy live.
- Chỉ một final submission chạy live. Một ứng viên live thứ hai và một giám khảo live thứ hai sẽ tăng độ tin cậy.
- Project mẫu gồm source và walkthrough tĩnh, chưa deploy.
- Mobile nằm ngoài phạm vi đã thống nhất.
- Reviewer note cuối, video demo, bộ ảnh và thao tác chọn winner live vẫn cần con người thực hiện.

## Mốc xác thực tiếp theo

Chạy một sự kiện nhỏ thật và đo tỷ lệ đội hoạt động, thời gian thiết lập, thời gian review của giám khảo, khối lượng hỗ trợ của ban tổ chức và ý định tổ chức lại. Giá cùng quy mô thị trường vẫn là giả thuyết cho đến khi pilot tạo được dữ liệu sơ cấp.

## Liên kết

- [Nội dung biểu mẫu Corelia](../04-submission/CORELIA_PROJECT_SUBMISSION_VI.md)
- [Câu chuyện dự án](../04-submission/CAU_CHUYEN_DU_AN_VI.md)
- [Phụ lục kỹ thuật](../02-technical/TECHNICAL_APPENDIX.md)
- [Xác minh sản phẩm](../VERIFICATION.md)

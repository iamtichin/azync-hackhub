# Xác minh sản phẩm — Azync HackHub

> **Baseline:** MVP desktop ngày 30/09/2026<br>
> **Môi trường:** frontend local, backend Docker, PostgreSQL, Redis, GitHub thật, Solana devnet và AI gateway<br>
> **Phạm vi:** kết quả kỹ thuật phục vụ demo và pilot có kiểm soát

## Kết luận

Azync HackHub đã hoàn tất luồng MVP chính với dữ liệu mới: organizer tạo và công khai cuộc thi; người tham gia lập đội và đăng ký; hệ thống tạo repository GitHub riêng tư cùng CI; đội lập kế hoạch, kiểm tra draft và gửi final submission; backend lưu receipt bất biến, cấp cNFT trên Solana devnet và tạo evidence brief cho giám khảo; organizer xem, lọc, xuất dữ liệu và đóng sự kiện.

Kết quả hiện tại đủ cho demo nội bộ và một pilot có kiểm soát. Đây chưa phải chứng nhận sẵn sàng production.

## Phạm vi đã chạy live

- Năm tài khoản GitHub OAuth trên năm browser desktop: organizer, judge, đội hai thành viên và người tham gia solo.
- Event, publication, rules, rubric, registration, judge assignment và deadline.
- Hai repository GitHub riêng tư mới, collaborator, GitHub Actions và webhook có chữ ký.
- Planning, dependency, activity, tiến độ, critical path, cảnh báo và realtime reconnect.
- Draft theo revision, validation stale sau khi sửa và final receipt chống gửi trùng.
- Một final submission cùng cNFT `AHSUB` đã xác nhận trên Solana devnet.
- Một lần AI analysis qua provider, evidence brief và Judge Inquiry riêng.
- Organizer search, filter, detail, CSV export, event close và giao diện winner award.
- Restart backend, webhook redelivery và đăng nhập lại sau khi thu hồi phiên.

## Phạm vi đã kiểm tra trong môi trường cô lập

- Quyền giữa team, organizer, judge và khách khi đoán ID hoặc dùng session sai.
- Lời mời hết hạn, đăng ký trùng, event chưa công khai và dữ liệu event không hợp lệ.
- Lỗi provisioning, mint, AI, retry và reconciliation.
- Prompt injection, evidence ID giả, URL nội bộ, redirect không an toàn và giới hạn deadline.
- Cách ly chat giữa hai giám khảo và lưu trữ chat mã hóa.
- Pagination, CSV formula injection, retention boundary và concurrency.
- Tải thử nhiều workspace, final request đồng thời và webhook burst.
- Migration từ database rỗng, restart, backup và restore.

Fixture cô lập chỉ xác minh hành vi của hệ thống; nó không được trình bày như bằng chứng từ nhà cung cấp bên ngoài.

## Kết quả kiểm thử chính

| Nhóm | Kết quả |
| --- | --- |
| Backend unit regression | 54 suite, 308 test đạt |
| Backend security regression | 9 suite, 81 test đạt |
| Submission concurrency | 22/22 test đạt |
| AI URL, prompt và validator | 5 suite, 19 test đạt |
| E2E tải cô lập | 8 suite, 18 test đạt |
| E2E lặp lại cô lập | 7 suite, 17 test đạt |
| Frontend Chromium smoke | 54 test đạt, 1 test webhook bỏ qua đúng điều kiện |
| Winner organizer smoke | 12/12 test đạt |
| Frontend typecheck và production build | đạt |
| Accessibility trang submit | Lighthouse 100, không có audit thất bại |

## Ranh giới của bằng chứng

- Một final submission đã chạy live; các trường hợp AI bổ sung dùng fixture cô lập.
- Project mẫu gồm source code và walkthrough tĩnh, chưa được deploy thành ứng dụng chạy thật.
- cNFT xác nhận record do Azync phát hành; nó không chứng minh project của đội tự chạy on-chain.
- Demo truy cập được không chứng minh toàn bộ chức năng đúng.
- File test hoặc workflow không chứng minh CI đã pass; trạng thái workflow đã thực thi là evidence riêng.
- AI chỉ tư vấn, không ghi điểm chính thức hoặc chọn người thắng.

## Việc còn lại

- Hoàn tất nhận xét cuối của giám khảo trên submission live.
- Organizer tự xác nhận người thắng thật và kiểm tra cNFT `AHWIN`.
- Kiểm thử Solflare ở mức extension; Phantom đã chạy live.
- Quay video, chụp bộ ảnh và hoàn thiện pitch deck.
- Chạy thêm ít nhất một final submission live và một judge live để tăng độ tin cậy khi so sánh nhiều đội.
- Bổ sung monitoring, KMS, chính sách pháp lý và security review trước production.

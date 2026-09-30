# Ghi chú rủi ro và tuân thủ — Azync HackHub

> **Phạm vi:** MVP và demo UniHackFest
> **Cập nhật:** 30/09/2026
> **Mức sẵn sàng:** phù hợp demo có kiểm soát; public production cần hoàn tất các control còn mở

## 1. Dữ liệu được xử lý

Azync lưu danh tính GitHub, hồ sơ, membership, link project, planning activity, final submission snapshot, địa chỉ Solana public cùng proof, AI evidence và judge conversation. Hệ thống không cần seed phrase hoặc private key của ví người tham gia.

## 2. Control đã triển khai

### Danh tính và phân quyền

- GitHub OAuth identity và JWT session.
- Kiểm tra revoked session cho HTTP cùng realtime.
- Object-level authorization cho team, organizer, judge, event và submission.
- Kiểm tra assignment trước khi giải mã judge chat.
- Regression cho cross-team, cross-event và guessed ID.

### GitHub

- OAuth token được mã hóa khi lưu.
- Quyền private repository đồng bộ theo vai trò team và judge.
- Raw-body webhook có chữ ký, dùng HMAC comparison constant-time.
- Delivery idempotency, replay conflict detection, repository scope và event ordering.

### AI

- Nội dung participant được cô lập thành input không tin cậy.
- Evidence tất định được thu thập trước khi model diễn giải.
- Structured output chặt chẽ và business validation theo evidence.
- Repair có giới hạn một lần; output sai sẽ fail closed.
- AI không ghi điểm chính thức hoặc winner decision.
- Lịch sử chat mã hóa và cô lập theo judge.

### An toàn URL và nội dung

- SSRF policy từ chối loopback, private, reserved, unsafe redirect và target không hợp lệ.
- Demo probe giới hạn DNS, redirect, thời gian và response size.
- Markdown renderer bỏ raw HTML và không tự tải remote image.
- CSV export vô hiệu spreadsheet formula prefix.

### Submission và Solana

- Kiểm tra deadline phía server.
- Final receipt bất biến và duplicate request idempotent.
- Backend trả phí cNFT; client chỉ cung cấp public recipient address.
- Reconcile trước retry để tránh asset trùng.
- Winner decision lưu trước winner mint và bất biến sau đó.

### Vận hành

- Destructive E2E chạy trong stack cô lập có cleanup thuộc sở hữu run.
- Migration từ database rỗng.
- Test restart, load, backup/restore và encrypted-chat recovery.
- Scan secret trong runtime log và artifact.

## 3. Giới hạn của bằng chứng

- Platform submission cNFT chứng minh receipt của Azync; không chứng minh app của đội đã chạy hoặc dùng Solana.
- Demo URL truy cập được không chứng minh chức năng đúng.
- Test file hoặc workflow file không chứng minh CI pass; executed workflow state là evidence riêng.
- AI output luôn là advisory dù có evidence link.
- Devnet proof phù hợp demo, không phải production mainnet credential.

## 4. Rủi ro còn lại

| Rủi ro | Trạng thái hiện tại | Việc cần làm trước production |
| --- | --- | --- |
| Quản lý authority và encryption key | Environment-managed cho MVP | Chuyển sang KMS/HSM, rotate key, ghi quy trình recovery và access |
| Privacy và legal basis | Đã giảm dữ liệu ở mức kỹ thuật | Công bố privacy policy, terms, retention, consent và quy trình delete/export |
| Monitoring và incident response | Dùng health/log trong E2E | Thêm alert production, incident owner, status communication và runbook |
| Provider ngoài bị gián đoạn | Đã có queue, retry và degradation | Chốt SLO, dashboard provider, budget alert và fallback policy |
| Tương thích Solflare | Chỉ test adapter tự động | Chạy extension-level connect/reject/disconnect/account-switch |
| Bảo vệ tài khoản judge | OAuth và assignment control | Thêm lựa chọn xác thực mạnh hơn cho event giá trị cao |
| Abuse và plagiarism | Có rate limit và human review | Thêm moderation workflow và similarity review tùy chọn |
| Vòng đời dữ liệu | Đã test final retention | Duyệt retention, deletion, legal hold và backup expiry chính thức |
| Accessibility và browser | Chromium desktop cùng submit audit | Audit tất cả route chính và browser matrix đã thống nhất |

## 5. Checklist trước production

- [ ] Legal review cho privacy policy, terms, consent, processor role và nghĩa vụ Việt Nam/EU.
- [ ] Authority cùng encryption key trên KMS, có rotation và least-privilege access.
- [ ] Chính sách backup database production và restore drill theo lịch.
- [ ] Monitoring API, queue age, AI failure rate, GitHub delivery, Solana reconciliation và cost.
- [ ] Quy trình incident response cùng deadline extension.
- [ ] Dependency, container và external penetration/security review.
- [ ] Quy trình export, correction, deletion và retention dữ liệu người dùng.
- [ ] Acceptance test Solflare và browser được hỗ trợ.
- [ ] Accessibility review cho tất cả route chính.
- [ ] Chính sách quyền repository/demo dành cho judge.

## 6. Checklist artifact nộp bài

- [ ] Xóa token, secret, private key, seed phrase, JWT và private chat khỏi ảnh/video.
- [ ] Chỉ hiển thị public wallet address và public devnet transaction dành cho review.
- [ ] Ghi nhãn rõ fixture và live evidence.
- [ ] Không claim quá mức về deployment, CI, Solana hoặc độ chắc chắn của AI.
- [ ] Xác nhận mọi external link có quyền đúng cho người xem dự kiến.

## 7. Kết luận

Các control đã triển khai cùng evidence E2E hỗ trợ một demo hackathon có kiểm soát. Chúng không phải chứng nhận compliance production. Trước khi public hoặc thu phí, cần hoàn tất checklist production và có legal cùng security review phù hợp.

# Phụ lục kỹ thuật — Azync HackHub

> **Phiên bản:** baseline MVP E2E
> **Cập nhật:** 30/09/2026
> **Bằng chứng:** [tóm tắt xác minh sản phẩm](../VERIFICATION.md)

## 1. Kiến trúc

```text
Browser / Next.js 16
  ├─ phiên GitHub OAuth
  ├─ Solana wallet adapters
  └─ Socket.IO client
          │ HTTPS / WebSocket
          ▼
NestJS 11 modular monolith
  ├─ auth, users, teams, hackathons, planning
  ├─ GitHub provisioning và webhook có chữ ký
  ├─ submission draft, final receipt và validation
  ├─ Solana submission và winner credential
  ├─ organizer operations và judge workspace
  └─ AI evidence, queue, versioned context và chat
          │
          ├─ PostgreSQL + Prisma — nguồn trạng thái bền vững
          ├─ Redis + BullMQ — vận chuyển job bất đồng bộ
          ├─ GitHub API / Actions / webhooks
          ├─ Solana devnet / Metaplex Bubblegum
          └─ AI gateway độc lập provider
```

Backend là modular monolith. PostgreSQL giữ trạng thái bền vững; Redis không bao giờ là nơi duy nhất giữ submission hoặc AI result.

## 2. Stack

| Lớp | Phiên bản hoặc cách triển khai |
| --- | --- |
| Frontend | Next.js 16.3, React 19.2, TypeScript 5.9 |
| Form và render | React Hook Form, Zod, React Markdown, remark-gfm |
| Realtime | Socket.IO 4.8 client/server |
| Backend | NestJS 11, TypeScript 5.7 |
| Dữ liệu | PostgreSQL, Prisma 5.22, Redis, BullMQ 5 |
| GitHub | OAuth, Octokit, Actions, raw-body HMAC webhooks |
| Solana | web3.js 1.98, Metaplex Bubblegum 5.1, Umi 0.9 |
| Test | Jest 30, Supertest, Playwright 1.63, Docker E2E harness cô lập |

## 3. Domain model bền vững

Prisma schema production có các record chính:

- user và revoked session;
- team, membership, invite dùng một lần và team activity;
- hackathon, track, registration, judge, rules có phiên bản và rubric data;
- area, task và task dependency;
- GitHub repository, workflow run và webhook delivery bền vững;
- submission draft, final submission bất biến và Solana transaction;
- winner award bất biến với mint state riêng;
- AI job, analysis, evidence, context session, snapshot, artifact version và evidence link;
- judge chat session, message và message-to-evidence link được mã hóa.

Final receipt cùng winner decision dùng uniqueness constraint và transaction check để chặn thay thế hoặc tạo trùng.

## 4. Phân quyền

Backend service và WebSocket join thực thi quyền; frontend navigation không được dùng làm ranh giới bảo mật.

- Guest chỉ thấy projection của event đã publish.
- Team member truy cập roster, planning, repository, draft và final receipt của đội mình.
- Biết ID của team khác không tạo quyền truy cập.
- Organizer chỉ quản lý event mình sở hữu và chỉ export submission của event đó.
- Judge cần assignment hiện hành trước khi đọc evidence hoặc giải mã chat.
- Socket.IO kiểm tra session cùng quyền object trước khi vào room bảo vệ.
- Logout và revoked session chặn cả HTTP lẫn realtime.

## 5. Tích hợp GitHub

Start Building tạo một private repository với retry idempotent. Service cài workflow, thêm team collaborator, cấp quyền đọc cho judge được phân công và cấu hình webhook có chữ ký.

Kiểm soát webhook gồm:

- xác minh HMAC trên raw body và so sánh constant-time;
- kiểm tra repository scope;
- idempotency theo delivery ID và phát hiện replay conflict;
- lưu delivery bền vững;
- sắp thứ tự workflow run cùng attempt để event cũ không ghi đè state mới;
- realtime invalidation cho planning và leaderboard projection.

CI tách khỏi chấm điểm chính thức. Workflow file hoặc test file không chứng minh một lần chạy thành công.

## 6. Planning và realtime

Planning hỗ trợ area, template, task, assignee, effort, priority, dependency và status. Service validation từ chối tham chiếu khác team, effort sai, cycle và hoàn tất trước dependency. Forecast cùng alert là tất định.

Realtime client vào lại room có quyền sau reconnect và refetch durable state khi nhận invalidation. Redis hoặc Socket.IO chỉ tối ưu delivery; PostgreSQL vẫn là nguồn đúng.

## 7. Vòng đời submission

```text
Lưu draft
  → revision timestamp đổi
  → kiểm tra đúng revision đã lưu
  → deterministic checks + advisory tùy chọn
  → chỉnh sửa làm validation cũ stale
  → final request kiểm tra event, team, track, deadline, URL và recipient
  → lưu receipt bất biến cùng canonical snapshot đúng một lần
  → Solana mint và AI job tiếp tục bất đồng bộ
```

Final request lặp hoặc đồng thời trả về receipt hiện có. Payload sau không thể thay project, link, recipient hoặc canonical hash.

## 8. Solana credential

Frontend đọc public recipient address từ Phantom hoặc Solflare. Backend authority trả phí và gửi giao dịch; hệ thống không thu seed hoặc private key của người tham gia.

### Submission credential

- symbol: `AHSUB`;
- tạo từ final snapshot bất biến;
- lưu recipient, canonical metadata hash, signature, asset ID, tree, leaf, network và metadata URI;
- hỗ trợ reconcile và retry không mint trùng.

### Winner credential

- symbol: `AHWIN`;
- chỉ có sau deadline;
- chỉ organizer được thao tác và chỉ chọn final submission thuộc event đó;
- winner decision được lưu trước mint;
- mỗi event có một winner record và không thay bằng submission khác.

Public verification so sánh dữ liệu đã lưu với credential metadata dự kiến và chain state.

## 9. AI evidence và analysis

AI analysis là đường advisory bất đồng bộ:

1. tạo database job bền vững với input fingerprint;
2. enqueue BullMQ payload chỉ chứa ID;
3. thu thập GitHub, Solana và demo evidence an toàn;
4. tạo hoặc tái sử dụng context snapshot có phiên bản;
5. gửi tiêu chí tin cậy và nội dung đội thi đã cô lập đến provider;
6. parse structured output chặt chẽ;
7. kiểm tra evidence coverage, ID, status và giới hạn điểm;
8. repair có giới hạn một lần nếu cần;
9. lưu analysis cùng provenance trong transaction.

Lỗi tạm thời dùng retry có giới hạn. Failed job vẫn hiển thị và có thể refresh. Repository hoặc tiêu chí đổi sẽ tạo fingerprint cùng snapshot mới. API đọc lại marker hiện tại của submission khi job hoàn tất để tránh race `completed/false`.

## 10. Judge chat

Judge Inquiry được scope theo judge, hackathon và submission. Session title cùng message nằm trong authenticated encrypted envelope. Quyền được kiểm tra trước giải mã, kể cả sau khi assignment bị thu hồi. Response được kiểm tra với evidence hiện có và render Markdown an toàn; raw HTML bị bỏ qua.

Prompt yêu cầu AI trả lời theo ngôn ngữ câu hỏi. Fallback cục bộ cũng hỗ trợ câu hỏi tiếng Việt có dấu và các mẫu không dấu phổ biến. AI không thể ghi điểm chính thức, thay winner decision hoặc so sánh submission ngoài context được cung cấp.

## 11. Kiểm soát bảo mật

- Global DTO validation từ chối trường lạ khi contract yêu cầu.
- Safe URL policy chặn private, loopback, reserved và redirect không an toàn.
- Demo collector giới hạn DNS, redirect, thời gian và kích thước response.
- Prompt boundary escape delimiter do participant kiểm soát.
- CSV export vô hiệu prefix có thể kích hoạt spreadsheet formula.
- Named throttler tách traffic provisioning, submission, webhook và AI.
- Runtime log cùng submission artifact được scan secret.
- GitHub OAuth token và judge chat được mã hóa khi lưu.
- Recovery và load test có khả năng phá hủy chỉ chạy trên stack cô lập với run ID riêng.

## 12. Vận hành và recovery

- Health endpoint bao phủ dependency API và Solana readiness.
- Production migration chạy được từ database rỗng.
- Restart test giữ receipt, proof và AI state.
- Backup/restore xác nhận encrypted chat vẫn giải mã được với cùng controlled test key.
- E2E harness sở hữu Postgres, Redis, network, migration, fixture và cleanup của nó.
- Latency provider ngoài được báo riêng khỏi latency backend local.

## 13. Gate chất lượng đã xác minh

Run cuối gồm backend unit và security regression, isolated E2E, production build, frontend typecheck, Chromium smoke desktop, Lighthouse accessibility cho submission, GitHub webhook redelivery live, Solana devnet proof, AI completion, load measurement, restart, migration và backup/restore.

Xem [tóm tắt xác minh sản phẩm](../VERIFICATION.md) để biết phạm vi live, phạm vi fixture, kết quả kiểm thử và giới hạn.

## 14. Giới hạn đã biết

- Solflare extension vẫn bị chặn; Phantom đã chạy live.
- Một final submission và một assigned judge chạy live; case cô lập bổ sung dùng fixture.
- Sample app chưa deploy.
- Mobile nằm ngoài phạm vi.
- Chưa đo p95 provider ngoài thành production SLO.
- Legal policy, production KMS, production monitoring và third-party security review là việc trước production.

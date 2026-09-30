# Azync HackHub — Nội dung pitch deck

> **Định dạng:** 10 slide chính
> **Cập nhật:** 30/09/2026
> **Quy tắc:** chỉ dùng ảnh và claim từ E2E build đã nghiệm thu

## Slide 1 — Azync HackHub

**Xây dựng, chứng minh và review dự án hackathon trong một workspace.**

Azync nối giai đoạn đội làm sản phẩm với submission record bất biến và quy trình review dựa trên evidence.

Ghi chú thuyết trình: giới thiệu đây là MVP đã chạy qua vai trò organizer, judge, team và người tham gia solo.

## Slide 2 — Giai đoạn build bị phân mảnh

- Đội thi quản lý task, code, CI, deadline và link nộp trên nhiều công cụ.
- Ban tổ chức thấy đăng ký cùng form cuối nhưng khó theo dõi quá trình thực hiện.
- Giám khảo có ít thời gian để kiểm tra repository, demo và blockchain claim một cách nhất quán.
- Sát deadline, evidence thiếu và ownership không rõ làm tăng rủi ro.

Hình gợi ý: chat + task board + GitHub + form nộp bài hội tụ vào một timeline.

## Slide 3 — Một luồng cho ba vai trò

### Đội thi

Repository riêng tư, collaborator, CI, planning, draft validation và final receipt.

### Ban tổ chức

Cấu hình sự kiện, đăng ký, phân công judge, quản lý submission và winner closeout.

### Giám khảo

Evidence brief có phiên bản, provenance, uncertainty và inquiry riêng.

Hình gợi ý: Team → Final receipt → Judge, với Organizer quản lý ranh giới sự kiện.

## Slide 4 — Thực thi trong giai đoạn build

- Start Building tạo repository GitHub riêng tư và workflow CI.
- Webhook có chữ ký giữ revision cùng workflow state luôn mới.
- Area, dependency, critical path, forecast và alert cho biết phần nào chặn deadline.
- CI là tín hiệu kỹ thuật, không bao giờ là điểm chính thức.

Ảnh gợi ý: team workspace có planning và repository status.

## Slide 5 — Submission bất biến và Solana proof

- Draft validation gắn với đúng revision.
- Final submission tạo một receipt bất biến.
- Azync mint `AHSUB` compressed NFT đến recipient trên Solana devnet.
- Signature, asset, recipient, metadata và Explorer link có thể kiểm tra.
- Provider chậm không xóa receipt đã được chấp nhận.

Ảnh gợi ý: Submission Ledger và devnet Explorer.

## Slide 6 — Evidence trước AI

```text
Final receipt
  → GitHub + Solana + demo evidence an toàn
  → project context có phiên bản
  → structured AI analysis
  → backend validation
  → brief có evidence link
```

- Nội dung của đội thi là dữ liệu không tin cậy.
- Nhận định tích cực phải có evidence được chấp nhận.
- Test file, CI đã thực thi, demo truy cập được và platform credential là các fact riêng.
- Evidence thiếu luôn được ghi là uncertainty.

## Slide 7 — Chấm bài do con người kiểm soát

- Mỗi judge được phân công có conversation mã hóa, riêng theo submission.
- Câu trả lời dùng evidence snapshot hiện tại và gắn provenance khi có.
- AI gợi ý nhận định và câu hỏi.
- AI không ghi điểm chính thức hoặc chọn winner.
- Sau deadline, organizer ghi một winner do con người chọn và có thể cấp `AHWIN` cNFT.

Ảnh gợi ý: judge brief và organizer winner action.

## Slide 8 — Phạm vi đã kiểm thử

- Năm vai trò đã đăng nhập trên các browser desktop.
- Repository riêng tư mới, quyền collaborator, Actions và webhook có chữ ký.
- Planning integrity, realtime reconnect, authorization, final receipt bất biến và Solana devnet proof.
- AI hoàn tất cùng các case unavailable, stale, malicious và cross-judge trong fixture cô lập.
- Restart, migration, backup/restore, secret scan và pilot load gate.

Ghi nhãn rõ: một final submission chạy live; các case AI bổ sung dùng fixture.

## Slide 9 — Thị trường đầu tiên và giả thuyết kinh doanh

- Bắt đầu với hackathon sinh viên và cộng đồng tại Việt Nam.
- Dùng pilot có kiểm soát để đo activation, mức hữu ích cho judge, tải vận hành và ý định tổ chức lại.
- Giữ độ cản truy cập thấp cho người tham gia.
- Sau pilot, thu phí organizer cho giới hạn, hỗ trợ, báo cáo, branding và cam kết vận hành.

Không trình bày quy mô thị trường, conversion hoặc doanh thu chưa được xác thực như kết quả đã đạt.

## Slide 10 — Mốc tiếp theo

1. Hoàn tất human judge review và winner certificate live.
2. Đóng gói evidence đã nghiệm thu vào video demo, bộ ảnh và final deck.
3. Chạy pilot thật với 5–20 đội và ít nhất hai giám khảo.
4. Đo usage cùng thời gian review.
5. Chuyển sự kiện đầu tiên thành case study có thể lặp lại.

Câu kết:

> Azync HackHub giúp đội thi nhìn rõ giai đoạn build, ban tổ chức có một sự kiện audit được và giám khảo có evidence để tự kiểm tra.

## Phụ lục A — Stack kỹ thuật

- Frontend Next.js 16 và React 19.
- Backend NestJS 11 modular monolith.
- PostgreSQL và Prisma lưu trạng thái bền vững.
- Redis và BullMQ xử lý job bất đồng bộ.
- GitHub OAuth/API/Actions/webhooks.
- Solana devnet và Metaplex Bubblegum.
- AI analysis độc lập provider với validation chặt chẽ.

## Phụ lục B — Giới hạn bằng chứng

- Project mẫu chưa deploy.
- Demo truy cập được không chứng minh ứng dụng đúng.
- Platform cNFT không chứng minh project của đội tích hợp Solana.
- Solflare extension chưa được kiểm thử live.
- AI chỉ đưa ra tư vấn.

## Phụ lục C — Luồng demo

Dùng [kịch bản video demo](../04-submission/DEMO_VIDEO_SCRIPT.md). Trình tự ghi hình: event/team → GitHub/CI → planning → final/cNFT → judge brief → organizer closeout.

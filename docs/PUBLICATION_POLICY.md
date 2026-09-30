# Phạm vi tài liệu public

Tài liệu trong repository public phải giúp người đọc hiểu sản phẩm, kiến trúc, cách xác minh, giới hạn và hồ sơ hackathon hiện tại. Nhật ký phiên làm việc, kế hoạch triển khai cũ, dữ liệu kiểm thử nội bộ và artifact tạm thời không thuộc gói public.

## Danh sách tài liệu được xuất bản

- `docs/README.md`
- `docs/PUBLICATION_POLICY.md`
- `docs/VERIFICATION.md`
- `docs/01-product/PRODUCT_ONE_PAGER.md`
- `docs/02-technical/TECHNICAL_APPENDIX.md`
- `docs/02-technical/RISK_COMPLIANCE_NOTE.md`
- `docs/03-business/PITCH_DECK.md`
- `docs/03-business/GTM_PLAN.md`
- `docs/04-submission/CORELIA_PROJECT_SUBMISSION_VI.md`
- `docs/04-submission/CAU_CHUYEN_DU_AN_VI.md`
- `docs/04-submission/MARKET_OPPORTUNITY_ONE_PAGER.md`
- `docs/04-submission/PRD_EXECUTIVE_SUMMARY.md`
- `docs/04-submission/SOLANA_TECHNICAL_PROOF.md`
- `docs/04-submission/AI_FEATURE_OVERVIEW.md`
- `docs/04-submission/DEMO_VIDEO_SCRIPT.md`

## Nội dung không đưa vào repository public

- `docs/superpowers/`: kế hoạch, handoff và báo cáo theo từng phiên.
- `docs/05-features/`: đặc tả discovery cũ đã được thay bằng baseline hiện tại.
- `docs/06-research/`: prompt nghiên cứu, log cập nhật và dữ liệu nghiên cứu thô.
- `docs/assets/mockups/`: mockup HTML cũ không đại diện cho giao diện đã nghiệm thu.
- `docs/ui-error/`: ảnh lỗi và dữ liệu debug.
- `docs/04-submission/exports/`: PDF review nội bộ có thể tái tạo từ nguồn Markdown.
- Judge notes, private chat, ID môi trường local, token, secret và dữ liệu tài khoản thử nghiệm.
- Các bản tự đánh giá hoặc checklist cũ đã bị thay thế bởi tài liệu submission hiện tại.

Các nguồn nội bộ vẫn được giữ ở máy phát triển. Khi tạo repository public mới, chỉ sao chép các file trong danh sách cho phép ở trên.

## Kiểm tra trước khi push

1. Kiểm tra link Markdown trong danh sách public.
2. Chạy secret scan trên toàn bộ snapshot sắp commit.
3. Xác nhận không có `.env`, database dump, log, ảnh debug hoặc file tạm.
4. Xác nhận README không trỏ tới tài liệu bị loại.
5. Chạy build và bộ test được công bố trong `VERIFICATION.md` trên đúng commit chuẩn bị push.
6. Dùng lịch sử Git mới cho repository public để tài liệu nội bộ không còn trong commit cũ.

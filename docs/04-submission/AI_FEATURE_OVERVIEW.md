# Tổng quan tính năng AI

## Vai trò của AI

Azync dùng AI để hỗ trợ giám khảo đọc bằng chứng. AI không tạo bằng chứng, không ghi điểm chính thức và không chọn winner.

## Luồng xử lý

```text
Final submission
  → job bất đồng bộ bền vững
  → bộ thu thập GitHub, Solana và demo evidence
  → context snapshot có phiên bản cùng change manifest
  → structured analysis độc lập provider
  → kiểm tra schema và business rule
  → judge brief có liên kết evidence
  → Judge Inquiry riêng theo submission
```

## Ranh giới bằng chứng

- Thông tin repository được gắn với một revision cụ thể.
- Trạng thái thực thi CI tách biệt với sự tồn tại của test file hoặc workflow file.
- Demo probe an toàn chỉ xác minh khả năng truy cập có giới hạn, không chứng minh ứng dụng đúng.
- Solana credential do nền tảng cấp được tách khỏi claim blockchain của đội thi.
- Nội dung của đội thi là input không tin cậy và không thể tự tạo verified evidence ID.
- Nhận định tích cực phải dùng evidence được backend validation chấp nhận.

## Bộ nhớ có phiên bản

Evidence không đổi có thể được dùng lại. Repository, finality, luật hoặc rubric thay đổi sẽ làm đổi input fingerprint và tạo context snapshot mới. Artifact được thêm, đổi hoặc xóa vẫn có thể audit. Brief hoàn tất chỉ được trả về khi job và marker hiện tại của submission khớp nhau.

## Judge Inquiry

Mỗi phiên chat chỉ thuộc một giám khảo được phân công, một hackathon và một submission. Tiêu đề cùng message được mã hóa khi lưu và chỉ giải mã sau khi kiểm tra assignment cùng ownership hiện tại. Câu trả lời được render thành GitHub Flavored Markdown an toàn, gắn provenance khi có và nêu rõ uncertainty khi thiếu evidence.

Giao diện và gợi ý mặc định dùng tiếng Anh. Judge Inquiry cùng Azync Bot trả lời theo ngôn ngữ của câu hỏi hiện tại; câu hỏi tiếng Việt nhận câu trả lời tiếng Việt. Fallback evidence cục bộ giữ cùng quy tắc khi provider không sẵn sàng.

## Xử lý lỗi

- Submission thành công không phụ thuộc AI availability.
- Lỗi queue hoặc provider tạm thời dùng retry có giới hạn và trạng thái hiển thị rõ.
- Analysis lỗi có thể refresh mà không thay đổi final receipt.
- Provider output không hợp lệ được repair có giới hạn một lần rồi fail tất định.
- Repository thay đổi làm context bị stale và cần snapshot hiện hành trước khi dùng advisory.

## Phạm vi E2E

- Một final submission live đã hoàn tất analysis qua OmniRoute.
- Fixture cô lập bao phủ README/demo unavailable, có test file nhưng CI chưa chạy, prompt injection, fake citation, revision thay đổi, failed-job recovery và second-judge isolation.
- Manual judge review cuối vẫn mở để con người ghi AI đã hỗ trợ tốt đến đâu.

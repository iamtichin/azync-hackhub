# Câu chuyện dự án — Azync HackHub

## Vấn đề

Trong một cuộc thi hackathon, thời gian làm sản phẩm thường chỉ tính bằng giờ. Đội thi phải vừa chia việc, viết code, kiểm tra bản chạy thử, vừa nhớ hạn nộp và gom đủ các đường dẫn cần thiết. Thông tin nằm rải rác giữa nhóm chat, bảng công việc, GitHub và biểu mẫu nộp bài. Khi sát hạn, cả đội khó biết phần nào đã hoàn thành, phần nào còn chặn đường ra bản demo. Ban tổ chức cũng khó theo dõi tiến độ thực tế; giám khảo nhận nhiều bài nhưng phải tự mở từng repo, demo và tài liệu để tìm bằng chứng cho các nhận định của mình.

## Người dùng

Azync HackHub phục vụ ba nhóm trong cùng một cuộc thi: đội thi cần phối hợp và nộp dự án đúng hạn; ban tổ chức cần quản lý cuộc thi, track, luật và bài nộp; giám khảo cần xem dự án cùng các nguồn thông tin có thể kiểm tra. Trọng tâm trước mắt là hackathon dành cho sinh viên và cộng đồng lập trình.

## Giải pháp

Azync HackHub nối công việc của đội thi với hồ sơ nộp bài. Thành viên lập đội, mời nhau vào không gian chung và chia việc theo từng mảng trên bảng tiến độ. Khi đội chọn **Start Building**, hệ thống tạo một repository GitHub riêng tư, thêm thành viên và cấu hình workflow kiểm thử. Kết quả GitHub Actions được hiển thị riêng bên cạnh tiến độ công việc, giúp đội thấy code mới nhất đang ở trạng thái nào mà không nhầm kết quả CI với điểm thi.

Trước hạn nộp, đội lưu bản nháp, kiểm tra các mục còn thiếu và gửi repo, demo cùng tài liệu dự án. Bài nộp cuối được ghi thành một bản cố định có mã nhận diện. Azync cấp một chứng nhận dạng compressed NFT trên Solana devnet để người xem có thể kiểm tra bằng chứng của bài nộp; đội chỉ cung cấp địa chỉ ví nhận chứng nhận, còn hệ thống thực hiện giao dịch mint.

Ở phía giám khảo, Azync gom thông tin từ bài nộp, repository, demo và bằng chứng Solana thành một hồ sơ. AI giúp tóm tắt dự án, chỉ ra điều có nguồn xác nhận, điều chưa chắc chắn và gợi ý câu hỏi cần hỏi đội thi. Giám khảo có thể trao đổi thêm trong phiên chat riêng, rồi tự đưa ra đánh giá cuối cùng. AI không tự quyết định điểm hoặc chọn đội thắng.

## Điểm khác biệt

Azync HackHub quan tâm cả quãng thời gian **đội đang làm sản phẩm**, thay vì chỉ ghi danh và nhận bài vào cuối cuộc thi. Bảng công việc, repo GitHub, tín hiệu CI và hồ sơ nộp bài cùng nằm trong một luồng; ban tổ chức và giám khảo nhìn thấy những phần phù hợp với quyền của mình. Bằng chứng Solana giúp xác minh chứng nhận bài nộp, còn AI hỗ trợ đọc hồ sơ theo nguồn dữ liệu đã thu thập và ghi rõ chỗ chưa đủ bằng chứng. Quyết định đánh giá vẫn thuộc về con người.

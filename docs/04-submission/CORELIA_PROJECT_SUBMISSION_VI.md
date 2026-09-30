# Nội dung hồ sơ dự án Corelia — Azync HackHub

> **Ngôn ngữ bản chính:** Tiếng Việt<br>
> **Mục đích:** Nội dung sẵn để điền vào biểu mẫu tạo dự án của UniHackFest 2026.<br>
> **Phạm vi:** Chỉ gồm các trường văn bản. Logo, ảnh sản phẩm, demo, slide, mã nguồn, video và các trường yêu cầu gắn đường dẫn được để ngoài tài liệu này. Tracks, chuyên môn kỹ thuật và công nghệ cũng không nằm trong phạm vi tài liệu.

## Tên dự án

Azync HackHub

## Slug

azync-hackhub

## Mô tả

Azync HackHub là không gian vận hành hackathon dành cho đội thi, ban tổ chức và giám khảo. Sản phẩm kết nối việc lập đội, lập kế hoạch, repository GitHub, tín hiệu CI, bài nộp cuối, chứng nhận Solana và quy trình review dựa trên bằng chứng trong một luồng thống nhất. AI giúp giám khảo đọc hồ sơ, nhận biết phần đã được xác minh và đặt câu hỏi phù hợp; quyền chấm điểm và chọn đội thắng luôn thuộc về con người.

## Mô tả chi tiết

### Vấn đề

Trong một cuộc thi hackathon, đội thi thường chỉ có vài giờ hoặc vài ngày để biến ý tưởng thành sản phẩm. Công việc lại nằm rải rác giữa nhóm chat, bảng task, repository, kết quả kiểm thử và biểu mẫu nộp bài. Khi sát hạn, thành viên khó biết phần nào đang chặn bản demo, bản code nào là mới nhất và hồ sơ đã thiếu những gì.

Sự phân mảnh này cũng ảnh hưởng đến ban tổ chức và giám khảo. Ban tổ chức thường nhìn thấy dữ liệu đăng ký và bài nộp cuối nhưng thiếu một bức tranh có cấu trúc về quá trình thực hiện. Giám khảo phải tự mở nhiều nguồn trong thời gian ngắn và khó phân biệt nội dung do đội tự mô tả với bằng chứng từ mã nguồn, CI, demo hoặc blockchain.

### Người dùng

Azync HackHub phục vụ ba nhóm trong cùng một cuộc thi:

- **Đội thi** cần phối hợp công việc, theo dõi deadline, quản lý code và nộp dự án đúng hạn.
- **Ban tổ chức** cần cấu hình sự kiện, quản lý đăng ký, theo dõi bài nộp, phân công giám khảo và khép lại cuộc thi bằng một quyết định có thể kiểm tra.
- **Giám khảo** cần đọc nhanh hồ sơ, biết nhận định nào có bằng chứng, nhận định nào còn thiếu dữ liệu và tự đưa ra đánh giá cuối cùng.

Nhóm người dùng đầu tiên là các hackathon sinh viên và cộng đồng lập trình tại Việt Nam và Đông Nam Á, nơi đội thi thường dùng GitHub, thời gian build ngắn và nguồn lực vận hành còn hạn chế.

### Giải pháp

Azync HackHub nối giai đoạn đội đang xây dựng sản phẩm với hồ sơ nộp bài và quá trình review. Thành viên tạo đội, mời nhau vào workspace và chia công việc theo khu vực, task, mức ưu tiên cùng dependency. Hệ thống tính critical path, dự báo tiến độ và cảnh báo những phần có nguy cơ chặn deadline.

Khi đội chọn **Start Building**, hệ thống tạo một repository GitHub riêng tư, thêm collaborator, cấu hình workflow CI và webhook có chữ ký. Trạng thái GitHub Actions được hiển thị cạnh tiến độ công việc để đội thấy tình trạng kỹ thuật của revision hiện tại. CI được giữ như một tín hiệu kỹ thuật riêng, không được chuyển thành điểm thi.

Trước deadline, đội có thể lưu nhiều revision của bản nháp và chạy kiểm tra tất định để biết trường nào còn thiếu hoặc không hợp lệ. Khi gửi bản cuối, Azync tạo một final receipt bất biến. Backend sau đó cấp chứng nhận compressed NFT `AHSUB` trên Solana devnet tới địa chỉ ví mà đội đã chọn. Receipt vẫn được giữ nguyên nếu nhà cung cấp AI hoặc blockchain tạm thời lỗi; các tác vụ bên ngoài có thể được đối soát và thử lại mà không tạo bản ghi trùng.

Ở phía giám khảo, Azync thu thập bằng chứng từ đúng commit của repository, kết quả CI đã thực thi, khả năng truy cập của demo và chứng nhận Solana đã xác nhận. AI tạo một brief có phiên bản, tách claim của đội khỏi dữ kiện mà hệ thống kiểm tra được, ghi rõ phần chưa chắc chắn và gợi ý câu hỏi tiếp theo. Mỗi giám khảo có phiên inquiry riêng, được mã hóa và giới hạn theo đúng cuộc thi cùng bài nộp. AI chỉ hỗ trợ đọc và hỏi; nó không ghi điểm chính thức hoặc chọn người thắng.

Sau deadline, ban tổ chức có thể tìm kiếm, lọc, xem chi tiết và xuất danh sách bài nộp. Quyết định người thắng chỉ do organizer thực hiện và được lưu bất biến trước khi hệ thống cấp chứng nhận winner `AHWIN` riêng. Chứng nhận Solana xác nhận record do Azync phát hành; nó không được dùng để khẳng định rằng code của đội tự chạy on-chain hoặc rằng sản phẩm đã được triển khai production.

### Điểm khác biệt

Azync HackHub bao phủ cả quãng thời gian đội đang làm sản phẩm, thay vì chỉ nhận đăng ký và bài nộp cuối. Planning, repository, CI, draft validation, final receipt, evidence analysis và bước tổng kết của organizer dùng chung một mô hình quyền và một luồng dữ liệu.

Sản phẩm đặt bằng chứng trước AI. Nội dung do đội cung cấp được xem là dữ liệu chưa xác minh; nhận định tích cực của AI phải gắn với evidence mà backend chấp nhận, còn chỗ thiếu dữ liệu được trình bày như uncertainty. Cách tiếp cận này giúp giám khảo đọc nhanh hơn mà vẫn giữ quyền phán đoán ở con người.

Azync cũng tách rõ ba loại thông tin thường bị trộn lẫn: tiến độ task của đội, trạng thái kỹ thuật từ CI và kết quả đánh giá chính thức. Submission receipt cùng winner credential là hai chứng nhận riêng, giúp người xem kiểm tra Azync đã ghi nhận điều gì ở từng thời điểm mà không phóng đại ý nghĩa của blockchain.

## Tiến độ trong hackathon

### Đã thực hiện

Trong giai đoạn hackathon, chúng tôi đã xây dựng MVP desktop cho toàn bộ ba vai trò chính và kiểm tra luồng bằng năm tài khoản tách biệt: một organizer, một judge, hai thành viên chung một đội và một người tham gia solo.

Phần vận hành cuộc thi đã có luồng tạo và công khai sự kiện, quản lý luật cùng rubric, đăng ký đội, phân công giám khảo, tìm kiếm và lọc bài nộp, xuất CSV an toàn, khóa thao tác sau deadline và giữ quyền đọc các final submission cũ. Organizer có giao diện chọn một người thắng sau khi cuộc thi kết thúc; quyết định được thiết kế bất biến và có chứng nhận winner riêng.

Phần dành cho đội thi đã có tạo đội, lời mời dùng một lần, vai trò thành viên và đăng ký cuộc thi. Luồng **Start Building** tạo repository GitHub riêng tư, thêm collaborator, cấu hình GitHub Actions và webhook có chữ ký. Workspace hỗ trợ area, task, assignee, dependency, template, critical path, dự báo, cảnh báo, activity feed và cập nhật realtime sau khi mất kết nối rồi kết nối lại.

Luồng submission đã có bản nháp theo revision, kiểm tra dữ liệu trước khi nộp, final receipt bất biến và cơ chế chống gửi trùng. Một final submission đã chạy live với dữ liệu mới, nhận cNFT `AHSUB` trên Solana devnet và được kiểm tra qua asset, transaction, recipient, metadata cùng API xác minh. Phantom đã được dùng trong luồng live; Solflare mới được bao phủ ở mức adapter và giao diện tự động.

Phần AI đã hoàn tất một lần phân tích live qua provider. Evidence brief phân biệt claim của người tham gia, source code, CI đã thực thi, demo và platform credential; các câu trả lời chat có provenance khi có evidence và hiển thị rõ uncertainty khi thiếu dữ liệu. Các trường hợp provider lỗi, context cũ, prompt injection, evidence giả và cách ly giữa giám khảo được kiểm tra thêm trong môi trường fixture cô lập. Giao diện AI analysis và chat đã hỗ trợ Markdown an toàn, tự cuộn tới tin mới nhất và trả lời theo ngôn ngữ câu hỏi.

Chúng tôi cũng đã hoàn tất production build, kiểm tra kiểu dữ liệu, bộ test backend, luồng E2E cô lập, Chromium smoke trên desktop, kiểm tra accessibility của trang submit, migration, restart, backup/restore, secret scan và tải thử ở quy mô pilot. Bộ tài liệu nguồn tiếng Việt và các bản PDF phục vụ review nội bộ đã được chuẩn hóa.

### Điều đã học được

- Dữ liệu từ repository chỉ hữu ích khi gắn với đúng commit và phân biệt rõ file test với một lần CI thực sự đã chạy.
- AI chỉ hỗ trợ tốt khi backend thu thập evidence trước, ép output theo cấu trúc và không cho nội dung của người tham gia tự trở thành bằng chứng.
- Final submission phải tồn tại độc lập với trạng thái của AI, GitHub hoặc Solana để lỗi nhà cung cấp sát deadline không làm mất bài đã được chấp nhận.
- Planning, CI và điểm thi cần được hiển thị như ba khái niệm riêng để tránh tạo cảm giác hệ thống tự động chấm đội dựa trên số task hoặc trạng thái build.
- Các quyết định có hậu quả như chọn người thắng cần thuộc về con người, được giới hạn quyền rõ ràng và chỉ ghi một lần.
- Kịch bản nhiều tài khoản thực tế phát hiện được các vấn đề về quyền, trạng thái realtime, deep link và layout mà kiểm thử một vai trò khó bộc lộ.

### Việc tiếp theo

MVP đã đủ để trình diễn luồng chính, nhưng vẫn còn một số bước cần con người hoặc dịch vụ ngoài. Giám khảo cần hoàn tất nhận xét cuối trên submission live. Organizer cần tự xác nhận người thắng thật rồi kiểm tra chứng nhận `AHWIN`. Chúng tôi cũng cần chạy đầy đủ Solflare ở mức extension, hoàn thiện video, ảnh và deck cuối, đồng thời thử thêm một final submission live để đánh giá việc so sánh nhiều đội trên dữ liệu thật.

Sau hồ sơ hackathon, bước xác thực sản phẩm là chạy một pilot có kiểm soát với 5–20 đội và ít nhất hai giám khảo. Pilot sẽ đo thời gian thiết lập sự kiện, tỷ lệ đội kích hoạt workspace, mức sử dụng planning và repository, thời gian review, số sự cố cần hỗ trợ và ý định tổ chức lại. Các giả thuyết về giá, quy mô thị trường và doanh thu chỉ được chốt sau khi có dữ liệu từ pilot.

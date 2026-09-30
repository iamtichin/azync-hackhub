# Azync HackHub Frontend

Next.js App Router frontend cho toàn bộ vòng đời hackathon: organizer vận hành cuộc thi, participant quản lý team và submission, judge review bằng evidence-grounded AI.

## Current scope

- Competition index lấy dữ liệu trực tiếp từ backend.
- Judge Workspace gồm submission rail, versioned evidence brief và judge inquiry.
- Judge chat được scope theo `judge + submission`; lịch sử do backend mã hóa.
- Ghost suggestion lấy từ context cuộc thi/submission; nhấn `Tab` để điền gợi ý.
- AI analysis refresh dùng policy incremental của backend.
- Submission form dùng React Hook Form + Zod.
- Phantom và Solflare trên Solana devnet.
- Success proof hiển thị transaction signature, NFT asset và Explorer URL.
- Dashboard theo tài khoản và trạng thái Solana.
- Organizer console quản lý cuộc thi, rules, rubric, judges, registrations và leaderboard.
- Team workspace quản lý roster, quyền admin/member, wallet, GitHub repository/collaborator/webhook.
- Planning Canvas hỗ trợ area, task, dependency DAG, Kanban và critical path.
- Planning Canvas có template Web3/AI/full-stack, assignee, filters, progress theo area, projected finish và rule-based risk alerts.
- Socket.IO cập nhật team workspace, submissions và leaderboard theo room real-time.
- Public competition detail hiển thị rules, rubric, teams, submissions và leaderboard.

## Design direction

Giao diện theo hướng **Hackathon Operations Workbench**:

- Data-first, không card-first.
- Fira Sans cho nội dung; Fira Code/Cascadia Code cho revision, version và signature.
- Surface phẳng, border rõ, không glassmorphism hoặc gradient trang trí.
- Màu chỉ mang nghĩa: action, verified, warning và failure.
- AI xuất hiện như công cụ phân tích có provenance, không phải mascot.

## Requirements

- Node.js 20.9 trở lên.
- Backend chạy tại `http://localhost:3001` theo mặc định.
- Tài khoản GitHub đã được gán judge nếu muốn dùng Judge Chat.
- Phantom hoặc Solflare nếu muốn nộp submission.

## Setup

```bash
cd frontend
copy .env.example .env.local
npm install
npm run dev
```

Mở `http://localhost:3000`.

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SOLANA_NETWORK=devnet
```

Không đặt JWT, GitHub token hoặc private key trong biến `NEXT_PUBLIC_*`.

## Local authentication

Chọn **Đăng nhập → Tiếp tục với GitHub**. Backend hoàn tất OAuth rồi chuyển về `/auth/callback#access_token=...`; frontend nhận token, xóa fragment khỏi address bar, giữ phiên trong `sessionStorage` của tab và chuyển đến `/dashboard`.

Nếu backend chưa có `FRONTEND_URL`, callback vẫn trả JSON để tương thích môi trường cũ. Có thể dán `access_token` thủ công trong popover đăng nhập để debug local.

## Routes

| Route                    | Purpose                                    |
| ------------------------ | ------------------------------------------ |
| `/`                      | Danh sách cuộc thi đang hoạt động          |
| `/hackathons/[id]`       | Public competition detail                  |
| `/auth/callback`         | Hoàn tất GitHub OAuth                      |
| `/dashboard`             | Tổng quan tài khoản                        |
| `/teams`                 | Danh sách và tạo team                      |
| `/teams/[id]`            | Roster, Planning Canvas, GitHub và webhook |
| `/teams/new`             | Điều hướng vào flow tạo team               |
| `/organizer`             | Console vận hành cuộc thi                  |
| `/submissions`           | Submission ledger và retry operations      |
| `/judge`                 | Evidence brief và Judge AI Chat            |
| `/submit`                | Submission form + Solana wallet            |
| `/submit/success?id=...` | Submission proof                           |

## Backend contracts used

- `GET /hackathons`
- `GET /hackathons/:id/submissions`
- `GET /auth/me`
- `GET /users/me/teams`
- `POST /submissions`
- `GET /submissions/:id`
- `GET /submissions/:id/ai-analysis`
- `POST /submissions/:id/ai-analysis/refresh`
- `GET|POST /submissions/:id/ai-chat/...`

## Verification

```bash
npm run typecheck
npm run build
npm run start
```

Các luồng OAuth đa tài khoản, phân quyền organizer/team/judge và webhook cần được kiểm thử E2E cùng backend đang chạy và GitHub accounts thật.

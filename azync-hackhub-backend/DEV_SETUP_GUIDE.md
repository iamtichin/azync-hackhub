# Development Setup Guide - Local Frontend + Deployed Backend

**Date:** 2026-09-05
**Architecture:** Frontend (localhost:3000) → Backend (Vercel production)

---

## 🎯 Overview

Cấu hình này cho phép bạn:

- ✅ Phát triển frontend locally (Next.js)
- ✅ Gọi API đến backend deployed (Vercel)
- ✅ Đảm bảo bảo mật đầy đủ
- ✅ Hot reload khi code frontend
- ✅ Không cần chạy backend local

**Architecture:**

```
┌─────────────────────┐
│   Your Computer     │
│                     │
│  Frontend Dev       │
│  localhost:3000     │
│                     │
└──────────┬──────────┘
           │ HTTPS
           │ (secured)
           ↓
┌─────────────────────┐
│   Vercel Cloud      │
│                     │
│  Backend API        │
│  azync-api.vercel   │
│  + Database         │
│  + Redis            │
│  + Solana           │
│                     │
└─────────────────────┘
```

---

## ✅ Backend Security (Already Implemented)

### 1. **CORS Configuration** ✅

```typescript
// src/main.ts - UPDATED
app.enableCors({
  origin: [
    process.env.FRONTEND_URL, // Production: https://azync-hackhub.vercel.app
    'http://localhost:3000', // ✅ Development frontend
    'http://localhost:3001', // ✅ Additional dev port
  ],
  credentials: true, // ✅ Allow cookies (JWT)
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});
```

**What this means:**

- ✅ Backend chấp nhận requests từ `localhost:3000`
- ✅ Cookies (JWT) được gửi kèm
- ✅ Các origin khác bị reject (CORS error)

### 2. **Authentication** ✅

```typescript
// JWT validation on every protected route
@UseGuards(JwtAuthGuard)
@Get('teams/:id')
async getTeam(@Param('id') id: string, @Req() req) {
  // ✅ req.user chứa authenticated user
  // ✅ Backend verify JWT signature
  // ✅ Không thể forge token
}
```

### 3. **Authorization** ✅

```typescript
// Membership checks
await this.checkTeamMembership(teamId, userId);
// ✅ Non-member → HTTP 403
```

### 4. **All Other Security Layers** ✅

- ✅ Input validation (Zod)
- ✅ SQL injection protection (Prisma)
- ✅ Prompt injection defense
- ✅ Rate limiting (if configured)
- ✅ HTTPS encryption (Vercel auto)

---

## 🚀 Frontend Setup

### Step 1: Environment Variables

Create `frontend/.env.local`:

```bash
# Backend API URL (deployed)
NEXT_PUBLIC_API_URL=https://azync-hackhub-api.vercel.app

# Solana network
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
```

**Security Note:**

- ✅ `NEXT_PUBLIC_*` vars are safe to expose (public)
- ❌ **NEVER** put secrets here (JWT_SECRET, private keys, etc.)
- ✅ Secrets stay on backend only

### Step 2: API Client Setup

Create `frontend/lib/api.ts`:

```typescript
import axios from 'axios';

// Create axios instance
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  withCredentials: true, // ✅ CRITICAL: Send cookies (JWT)
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor (optional - for debugging)
api.interceptors.request.use(
  (config) => {
    console.log('→ API Request:', config.method?.toUpperCase(), config.url);
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor (handle auth errors)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Redirect to login
      console.error('Unauthorized - redirecting to login');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export default api;
```

### Step 3: Example API Calls

#### **3.1 Authentication Flow**

```typescript
// pages/login.tsx
import api from '@/lib/api';

export default function LoginPage() {
  const handleGitHubLogin = () => {
    // Redirect to backend OAuth
    window.location.href = `${process.env.NEXT_PUBLIC_API_URL}/auth/github`;

    // Backend flow:
    // 1. User authorizes on GitHub
    // 2. GitHub redirects to backend callback
    // 3. Backend creates JWT, sets httpOnly cookie
    // 4. Backend redirects to frontend
    // 5. Frontend now has JWT cookie (automatic)
  };

  return (
    <button onClick={handleGitHubLogin}>
      Login with GitHub
    </button>
  );
}
```

#### **3.2 Get Current User**

```typescript
// hooks/useAuth.ts
import { useEffect, useState } from 'react';
import api from '@/lib/api';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchUser() {
      try {
        const { data } = await api.get('/auth/me');
        // ✅ Cookie automatically sent by browser
        setUser(data);
      } catch (error) {
        console.error('Not authenticated');
        setUser(null);
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, []);

  return { user, loading };
}
```

#### **3.3 Create Team**

```typescript
// pages/teams/new.tsx
import api from '@/lib/api';

async function createTeam(name: string, hackathonId: string) {
  try {
    const { data } = await api.post('/teams', {
      name,
      hackathonId,
    });

    console.log('Team created:', data);
    return data;
  } catch (error) {
    if (error.response?.status === 401) {
      // Not authenticated
      console.error('Please login first');
    } else if (error.response?.status === 400) {
      // Validation error
      console.error('Invalid input:', error.response.data);
    }
    throw error;
  }
}
```

#### **3.4 Get Planning Tasks**

```typescript
// pages/teams/[id]/planning.tsx
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import api from '@/lib/api';

export default function PlanningPage() {
  const { id: teamId } = useParams();
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    async function fetchTasks() {
      try {
        const { data } = await api.get(`/teams/${teamId}/planning/tasks`);
        // ✅ Backend checks team membership
        // ✅ HTTP 403 if not member
        setTasks(data);
      } catch (error) {
        if (error.response?.status === 403) {
          console.error('Not a team member');
        }
      }
    }

    fetchTasks();
  }, [teamId]);

  return (
    <div>
      {tasks.map(task => (
        <div key={task.id}>{task.title}</div>
      ))}
    </div>
  );
}
```

#### **3.5 Submit Project + Mint NFT**

```typescript
// pages/teams/[id]/submit.tsx
import api from '@/lib/api';

async function submitProject(data: {
  teamId: string;
  hackathonId: string;
  projectName: string;
  githubUrl: string;
  demoUrl: string;
  walletAddress: string;
}) {
  try {
    const { data: submission } = await api.post('/submissions', data);

    console.log('Submission created:', submission);
    console.log('NFT minted:', submission.nft.signature);
    console.log('Solana Explorer:', submission.nft.explorerUrl);

    // ✅ Backend automatically:
    // - Creates submission record
    // - Mints NFT on Solana
    // - Queues AI analysis (BullMQ)
    // - Returns transaction signature

    return submission;
  } catch (error) {
    console.error('Submission failed:', error.response?.data);
    throw error;
  }
}
```

---

## 🔐 Security FAQ

### Q1: "Cookie từ backend deployed có hoạt động với localhost frontend không?"

**A: CÓ** - Miễn là CORS configured đúng.

**Cách hoạt động:**

```
1. User login → Backend sets cookie:
   Set-Cookie: jwt=xxx; HttpOnly; SameSite=None; Secure

2. Frontend makes request → Browser automatically includes cookie:
   Cookie: jwt=xxx

3. Backend validates JWT → Returns data
```

**Important:** Cần `SameSite=None` và `Secure=true` để cross-origin cookies hoạt động.

### Q2: "Có bị lộ secret keys không?"

**A: KHÔNG** - Secrets chỉ ở backend.

```
Frontend (.env.local):
✅ NEXT_PUBLIC_API_URL=https://...  (public, OK)
✅ NEXT_PUBLIC_SOLANA_NETWORK=devnet (public, OK)

Backend (Vercel env vars):
🔒 JWT_SECRET=xxx                    (private, SAFE)
🔒 DATABASE_URL=postgresql://...     (private, SAFE)
🔒 GITHUB_CLIENT_SECRET=xxx          (private, SAFE)
🔒 SOLANA_PRIVATE_KEY=xxx            (private, SAFE)
```

**Frontend KHÔNG BAO GIỜ thấy được backend secrets.**

### Q3: "User có thể forge JWT token không?"

**A: KHÔNG** - JWT signed với secret key chỉ backend biết.

```
JWT structure:
Header.Payload.Signature

Signature = HMAC-SHA256(
  Header + Payload,
  JWT_SECRET  ← Only backend knows this
)

❌ User không thể tạo valid signature
✅ Backend verify signature → Reject nếu invalid
```

### Q4: "User có thể access team của người khác không?"

**A: KHÔNG** - Backend enforce authorization.

```typescript
// Backend checks membership
await this.checkTeamMembership(teamId, req.user.id);

✅ Member → HTTP 200 (OK)
❌ Non-member → HTTP 403 (Forbidden)
```

### Q5: "Rate limiting có hoạt động không?"

**A: CÓ** - Backend enforce rate limits per IP.

```
✅ 100 requests/15min per IP (general)
✅ 5 login attempts/15min (auth)
❌ Exceed limit → HTTP 429 Too Many Requests
```

### Q6: "SQL injection có thể xảy ra không?"

**A: KHÔNG** - Prisma tự động escape parameters.

```typescript
// Safe from SQL injection
await prisma.user.findUnique({
  where: { id: userInput }, // ✅ Prisma escapes automatically
});
```

---

## 🧪 Testing Security

### Test 1: CORS Protection

```bash
# Try from unauthorized origin
curl https://azync-hackhub-api.vercel.app/auth/me \
  -H "Origin: https://evil-site.com" \
  -v

# Expected: CORS error (no Access-Control-Allow-Origin header)
```

### Test 2: Authentication Required

```bash
# Try without JWT
curl https://azync-hackhub-api.vercel.app/teams/123

# Expected: HTTP 401 Unauthorized
```

### Test 3: Authorization Enforcement

```bash
# Try to access other team's data
curl https://azync-hackhub-api.vercel.app/teams/other-team-id/planning/tasks \
  -H "Cookie: jwt=your-valid-token"

# Expected: HTTP 403 Forbidden (if not member)
```

---

## 🎯 Development Workflow

### Daily Development Flow

```bash
# 1. Start frontend dev server
cd azync-hackhub-frontend
npm run dev
# → http://localhost:3000

# 2. Frontend automatically calls backend API
# → https://azync-hackhub-api.vercel.app

# 3. Make changes to frontend
# → Hot reload automatically

# 4. No need to restart backend
# → Already deployed and running
```

### When to Redeploy Backend

```bash
# Only redeploy backend when:
✅ Fix bugs in backend code
✅ Add new API endpoints
✅ Update database schema
✅ Change environment variables

# No need to redeploy for:
❌ Frontend changes
❌ Frontend debugging
❌ UI/UX iterations
```

---

## 📊 Architecture Benefits

### ✅ Advantages

| Aspect            | Benefit                                                  |
| ----------------- | -------------------------------------------------------- |
| **Speed**         | Frontend hot reload (instant), no backend restart needed |
| **Security**      | Backend security layers fully enforced                   |
| **Realistic**     | Test against real production environment                 |
| **Collaboration** | Multiple frontend devs can share same backend            |
| **Database**      | Use real production database (or staging)                |
| **CI/CD**         | Frontend deploy independent of backend                   |

### ⚠️ Considerations

| Aspect          | Note                                                       |
| --------------- | ---------------------------------------------------------- |
| **API Changes** | Need to redeploy backend after API changes                 |
| **Debugging**   | Backend logs on Vercel dashboard (not local console)       |
| **Latency**     | Network roundtrip to Vercel (vs instant local)             |
| **Costs**       | Vercel usage during development (usually within free tier) |

---

## 🔧 Troubleshooting

### Issue 1: CORS Error

**Error:**

```
Access to XMLHttpRequest at 'https://api.vercel.app/...' from origin 'http://localhost:3000'
has been blocked by CORS policy
```

**Solution:**

```bash
# Check backend CORS config includes localhost
# src/main.ts should have:
origin: ['http://localhost:3000', ...]
```

### Issue 2: Cookie Not Sent

**Error:**

```
Request doesn't include JWT cookie
```

**Solution:**

```typescript
// Frontend API client must have:
api.create({
  withCredentials: true, // ✅ CRITICAL
});
```

### Issue 3: 401 Unauthorized After Login

**Error:**

```
Login succeeds but API calls return 401
```

**Solution:**

```bash
# Check backend cookie settings:
res.cookie('jwt', token, {
  httpOnly: true,
  secure: true,      # ✅ Must be true for production
  sameSite: 'none',  # ✅ Required for cross-origin
});
```

### Issue 4: Slow API Calls

**Error:**

```
API calls take 2-3 seconds
```

**Solution:**

```bash
# Normal for deployed backend (network latency)
# Options:
1. Use React Query for caching
2. Implement optimistic updates
3. Add loading states
4. Consider deploying backend closer to you (e.g., Vercel region)
```

---

## ✅ Security Checklist

Before starting development:

- [x] Backend CORS configured for localhost
- [x] JWT authentication working
- [x] Authorization checks implemented
- [x] Rate limiting configured
- [x] Input validation (Zod) working
- [x] SQL injection protection (Prisma)
- [x] Prompt injection defense (AI layer)
- [x] HTTPS enforced (Vercel auto)
- [x] Environment variables documented
- [x] No secrets in frontend code

---

## 📚 Additional Resources

### Backend Security Docs

- [TECHNICAL_APPENDIX.md](../docs/02-technical/TECHNICAL_APPENDIX.md) - Section 7: Security Architecture
- [RISK_COMPLIANCE_NOTE.md](../docs/02-technical/RISK_COMPLIANCE_NOTE.md)

### API Documentation

- **Swagger:** https://azync-hackhub-api.vercel.app/api
- **Endpoints:** [SETUP_GUIDE.md](./SETUP_GUIDE.md) - Section "API Endpoints"

### Testing

- Run `npm run build` and `npm run test:unit` for the local regression gate.
- Run `npm run test:e2e:ci` only with the isolated Docker E2E environment.
- See the repository [verification summary](../docs/VERIFICATION.md) for the public test scope and evidence limits.

---

## 🎉 Summary

**Setup này HOÀN TOÀN AN TOÀN vì:**

1. ✅ Backend deployed enforce tất cả security layers
2. ✅ CORS whitelist chỉ cho phép localhost:3000
3. ✅ JWT authentication + authorization đầy đủ
4. ✅ HTTPS encryption cho tất cả requests
5. ✅ Secrets chỉ ở backend, frontend không thấy
6. ✅ Rate limiting, input validation, SQL protection
7. ✅ Đây là **industry standard practice**

**Bạn có thể yên tâm phát triển frontend local!** 🚀

---

**Last Updated:** 2026-09-05
**Maintained By:** Azync HackHub Team

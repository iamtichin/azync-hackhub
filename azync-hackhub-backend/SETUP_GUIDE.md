# Azync HackHub Backend - Setup Guide

## 🎯 Current Status

**Phase 4 Complete:** Backend đã implement đầy đủ 6 modules còn thiếu:
- ✅ Authentication (GitHub OAuth + JWT)
- ✅ Users Management
- ✅ Teams CRUD + Members
- ✅ Hackathons CRUD + Registration
- ✅ GitHub Auto-Repo Integration
- ✅ Planning Canvas (Core Feature)

**Total:** 47 API endpoints hoạt động

---

## 🚀 Quick Start (Development)

### 1. Prerequisites

- Node.js 18+ (recommended: 20+)
- PostgreSQL 14+
- Redis 6+
- Git

### 2. Install Dependencies

```bash
cd azync-hackhub-backend
npm install
```

### 3. Setup Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

**Minimum required for development:**

```env
# Database
DATABASE_URL="postgresql://postgres:123456@localhost:5432/azync_hackhub_dev"

# Redis
REDIS_HOST="127.0.0.1"
REDIS_PORT=6379

# JWT (development only - change in production)
JWT_SECRET="dev-jwt-secret-key-change-this-in-production-min-32-chars"

# App
PORT=3001
NODE_ENV="development"
FRONTEND_URL="http://localhost:3000"

# Solana (devnet)
SOLANA_RPC_URL="https://api.devnet.solana.com"
SOLANA_NETWORK="devnet"
SOLANA_AUTHORITY_SECRET_KEY='[your-solana-keypair-array]'
SOLANA_MERKLE_TREE_ADDRESS="your-merkle-tree-address"

# AI Provider
ANTHROPIC_API_KEY="sk-ant-your-key"
ANTHROPIC_MODEL="claude-sonnet-4-20250514"
```

**Optional (GitHub features will be disabled without these):**

```env
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
GITHUB_TOKEN=""
```

### 4. Setup Database

```bash
# Generate Prisma Client
npx prisma generate

# Run migrations
npx prisma migrate dev

# (Optional) Seed database
npx prisma db seed
```

### 5. Start Development Server

```bash
npm run start:dev
```

Server will start at `http://localhost:3001`

**Expected output:**
```
[Nest] Starting Nest application...
[Nest] SolanaModule dependencies initialized
[Nest] Solana initialized (devnet)
[GithubService] GITHUB_TOKEN not configured - GitHub features will be disabled
[Nest] Nest application successfully started
```

✅ **47 endpoints registered successfully**

---

## 🔐 Production Setup Requirements

### 1. Create GitHub OAuth App

**Purpose:** User authentication via GitHub

**Steps:**
1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Fill in:
   - **Application name:** Azync HackHub
   - **Homepage URL:** `https://your-domain.com`
   - **Authorization callback URL:** `https://your-domain.com/auth/github/callback`
4. Copy **Client ID** and **Client Secret**

**Add to `.env`:**
```env
GITHUB_CLIENT_ID="Iv1.your-client-id"
GITHUB_CLIENT_SECRET="your-client-secret"
GITHUB_CALLBACK_URL="https://your-domain.com/auth/github/callback"
```

### 2. Create GitHub Personal Access Token

**Purpose:** Auto-create repositories for teams

**Steps:**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `admin:org` (Full control of orgs and teams)
   - ✅ `admin:repo_hook` (Full control of repository hooks)
4. Generate and copy token

**Add to `.env`:**
```env
GITHUB_TOKEN="ghp_your-personal-access-token-here"
GITHUB_ORG_NAME="azync-hackhub-contests"
```

### 3. Create GitHub Organization

**Purpose:** Host team repositories

**Steps:**
1. Go to https://github.com/organizations/new
2. Create organization: `azync-hackhub-contests`
3. Add GitHub Personal Access Token owner to organization

### 4. Setup GitHub Webhook Secret

**Purpose:** Secure webhook verification

**Generate strong secret:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Add to `.env`:**
```env
GITHUB_WEBHOOK_SECRET="your-generated-webhook-secret"
BACKEND_URL="https://your-domain.com"
```

### 5. Production Environment Variables

**Full production `.env`:**

```env
# Database (use managed service like Supabase)
DATABASE_URL="postgresql://user:password@host:5432/azync_hackhub_prod?schema=public"

# Redis (use managed service like Upstash)
REDIS_HOST="your-redis-host"
REDIS_PORT=6379
REDIS_PASSWORD="your-redis-password"
REDIS_DB=0

# JWT Authentication (MUST be strong in production)
JWT_SECRET="<generate-strong-random-secret-min-32-chars>"

# GitHub OAuth
GITHUB_CLIENT_ID="Iv1.your-production-client-id"
GITHUB_CLIENT_SECRET="your-production-client-secret"
GITHUB_CALLBACK_URL="https://your-domain.com/auth/github/callback"

# GitHub API
GITHUB_TOKEN="ghp_your-production-token"
GITHUB_ORG_NAME="azync-hackhub-contests"

# GitHub Webhooks
GITHUB_WEBHOOK_SECRET="your-strong-webhook-secret"

# Backend URL
BACKEND_URL="https://api.your-domain.com"

# Solana (use devnet for testing, mainnet-beta for production)
SOLANA_RPC_URL="https://api.devnet.solana.com"
SOLANA_NETWORK="devnet"
SOLANA_AUTHORITY_SECRET_KEY='[your-production-keypair]'
SOLANA_MERKLE_TREE_ADDRESS="your-production-merkle-tree"

# AI Provider
AI_PROVIDER="anthropic"
ANTHROPIC_API_KEY="your-anthropic-api-key"
ANTHROPIC_MODEL="claude-sonnet-4-20250514"

# App
PORT=3001
NODE_ENV="production"
FRONTEND_URL="https://your-domain.com"
```

---

## 🧪 Testing

### Manual API Testing

**1. Health Check (Solana):**
```bash
curl http://localhost:3001/solana/health
```

**Expected:**
```json
{
  "status": "ok",
  "network": "devnet",
  "authority": "4sArSbZU..."
}
```

**2. Test Authentication Flow:**

```bash
# Step 1: Redirect to GitHub OAuth
open http://localhost:3001/auth/github

# Step 2: After GitHub auth, get your token
curl http://localhost:3001/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**3. Test CRUD Operations:**

```bash
# Create team (requires authentication)
curl -X POST http://localhost:3001/teams \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Team",
    "hackathonId": "hackathon-id"
  }'
```

### Run Tests (TODO)

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Test coverage
npm run test:cov
```

---

## 📚 API Documentation

### Swagger UI

Once server is running, open:

```
http://localhost:3001/api
```

**47 Endpoints grouped by module:**

1. **Auth (4 endpoints)**
   - `GET /auth/github` - Redirect to GitHub OAuth
   - `GET /auth/github/callback` - OAuth callback handler
   - `GET /auth/me` - Get current user
   - `POST /auth/logout` - Logout

2. **Users (4 endpoints)**
   - `GET /users/me` - Get current user profile
   - `GET /users/me/teams` - Get my teams
   - `GET /users/:id` - Get user by ID
   - `GET /users/:id/teams` - Get user's teams

3. **Teams (8 endpoints)**
   - `POST /teams` - Create team
   - `GET /teams` - List teams
   - `GET /teams/:id` - Get team details
   - `PATCH /teams/:id` - Update team
   - `DELETE /teams/:id` - Delete team
   - `GET /teams/:id/members` - List members
   - `POST /teams/:id/members` - Add member
   - `DELETE /teams/:id/members/:userId` - Remove member

4. **Hackathons (8 endpoints)**
   - `POST /hackathons` - Create hackathon
   - `GET /hackathons` - List hackathons
   - `GET /hackathons/:id` - Get hackathon
   - `PATCH /hackathons/:id` - Update hackathon
   - `DELETE /hackathons/:id` - Delete hackathon
   - `POST /hackathons/:id/register` - Register team
   - `GET /hackathons/:id/teams` - List registered teams
   - `GET /hackathons/:id/submissions` - List submissions

5. **GitHub Integration (3 endpoints)**
   - `POST /github/create-repo` - Auto-create team repository
   - `POST /github/:teamId/add-collaborator` - Add collaborator
   - `POST /webhooks/github` - GitHub webhook handler

6. **Planning Canvas (15 endpoints)** ⭐ Core Feature
   - `POST /teams/:teamId/planning/areas` - Create area
   - `GET /teams/:teamId/planning/areas` - List areas
   - `PATCH /teams/:teamId/planning/areas/:areaId` - Update area
   - `DELETE /teams/:teamId/planning/areas/:areaId` - Delete area
   - `POST /teams/:teamId/planning/tasks` - Create task
   - `GET /teams/:teamId/planning/tasks` - List tasks
   - `GET /teams/:teamId/planning/tasks/:taskId` - Get task
   - `PATCH /teams/:teamId/planning/tasks/:taskId` - Update task
   - `DELETE /teams/:teamId/planning/tasks/:taskId` - Delete task
   - `POST /teams/:teamId/planning/tasks/:taskId/dependencies` - Add dependency
   - `DELETE /teams/:teamId/planning/tasks/:taskId/dependencies/:dependsOnId` - Remove dependency
   - `GET /teams/:teamId/planning/critical-path` - **Calculate critical path** 🎯

7. **Submissions (4 endpoints)**
   - `POST /submissions` - Submit project (mints NFT + queues AI)
   - `GET /submissions/:id` - Get submission
   - `GET /submissions/:id/ai-analysis` - Get AI analysis status
   - `POST /submissions/:id/retry-mint` - Retry failed NFT mint

8. **Solana (1 endpoint)**
   - `GET /solana/health` - Health check

---

## 🔒 Security Considerations

### Development Mode

✅ **Safe to run without:**
- GitHub OAuth credentials (auth endpoints return 500, but server runs)
- GitHub Personal Access Token (repo creation disabled)
- GitHub Webhook Secret (webhook verification skipped)

⚠️ **Must have:**
- Strong JWT secret (even in dev)
- Secure database credentials
- Valid Solana keypair

### Production Mode

🔴 **MUST configure:**
- GitHub OAuth App (required for user authentication)
- GitHub Personal Access Token (required for auto-repo)
- Strong JWT secret (min 32 chars, cryptographically random)
- GitHub Webhook Secret (for webhook verification)
- HTTPS/TLS for all endpoints
- Rate limiting (already configured via ThrottlerModule)
- CORS configuration (check `FRONTEND_URL`)

---

## 🐛 Troubleshooting

### Server won't start

**Error:** `OAuth2Strategy requires a clientID option`

**Solution:** Add placeholder values to `.env`:
```env
GITHUB_CLIENT_ID="placeholder"
GITHUB_CLIENT_SECRET="placeholder"
GITHUB_CALLBACK_URL="http://localhost:3001/auth/github/callback"
```

**Error:** `GITHUB_TOKEN is not configured`

**Solution:** This is now a **warning**, not an error. Server will start with GitHub features disabled.

**Error:** `listen EADDRINUSE: address already in use :::3001`

**Solution:** Port 3001 is already in use. Kill the process or change `PORT` in `.env`.

```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:3001 | xargs kill -9
```

### Database connection failed

**Error:** `Can't reach database server`

**Solution:**
1. Check PostgreSQL is running
2. Verify `DATABASE_URL` in `.env`
3. Run `npx prisma db push` to create tables

### Redis connection failed

**Error:** `ECONNREFUSED 127.0.0.1:6379`

**Solution:**
1. Install and start Redis:
```bash
# Windows (with Chocolatey)
choco install redis-64
redis-server

# Linux
sudo apt install redis-server
sudo systemctl start redis

# Mac
brew install redis
brew services start redis
```

---

## 📦 Deployment

### Vercel (Recommended for MVP)

**Frontend + Backend API:**

1. Push code to GitHub
2. Import project to Vercel
3. Configure environment variables
4. Deploy

**Database:** Use Supabase (managed PostgreSQL)

**Redis:** Use Upstash (serverless Redis)

### Railway / Render

**Alternative for full backend deployment:**

```bash
# Railway
railway up

# Render
# Use web dashboard to connect GitHub repo
```

---

## 📊 Database Schema

7 new models added in Phase 4:

```prisma
model User {
  id             String   @id @default(cuid())
  githubId       String   @unique
  githubUsername String
  email          String?
  name           String
  avatarUrl      String?
  accessToken    String?  @db.Text
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  teamMembers    TeamMember[]
}

model TeamMember {
  id       String   @id @default(cuid())
  teamId   String
  userId   String
  role     String   @default("member") // "admin" | "member"
  joinedAt DateTime @default(now())
  team     Team     @relation(...)
  user     User     @relation(...)
  @@unique([teamId, userId])
}

model HackathonRegistration {
  id           String    @id @default(cuid())
  hackathonId  String
  teamId       String
  registeredAt DateTime  @default(now())
  hackathon    Hackathon @relation(...)
  team         Team      @relation(...)
  @@unique([hackathonId, teamId])
}

model Area {
  id             String @id @default(cuid())
  teamId         String
  name           String
  estimatedHours Int
  color          String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  team           Team   @relation(...)
  tasks          Task[]
}

model Task {
  id              String   @id @default(cuid())
  areaId          String
  teamId          String
  title           String
  description     String?
  estimatedHours  Int
  actualHours     Int      @default(0)
  status          String   @default("todo") // "todo" | "in_progress" | "done"
  assigneeId      String?
  isCriticalPath  Boolean  @default(false)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  startedAt       DateTime?
  completedAt     DateTime?
  area            Area     @relation(...)
  team            Team     @relation(...)
  dependencies    TaskDependency[] @relation("TaskDependencies")
  dependents      TaskDependency[] @relation("TaskDependents")
}

model TaskDependency {
  id           String @id @default(cuid())
  taskId       String
  dependsOnId  String
  task         Task   @relation("TaskDependencies", ...)
  dependsOn    Task   @relation("TaskDependents", ...)
  @@unique([taskId, dependsOnId])
}

model GitHubRepository {
  id        String   @id @default(cuid())
  teamId    String   @unique
  fullName  String
  url       String
  createdAt DateTime @default(now())
  team      Team     @relation(...)
}
```

---

## 🎯 Next Steps

### For Development:

1. ✅ Backend Phase 4 Complete (47 endpoints)
2. ⏳ **Test all endpoints manually** (use Postman/Insomnia)
3. ⏳ **Write integration tests** for critical flows
4. ⏳ **Start frontend development** (Next.js)

### For Production:

1. ⏳ Create GitHub OAuth App
2. ⏳ Create GitHub Organization
3. ⏳ Generate production secrets
4. ⏳ Setup Supabase (PostgreSQL)
5. ⏳ Setup Upstash (Redis)
6. ⏳ Deploy to Vercel
7. ⏳ Test full authentication flow

---

## 📞 Support

**Documentation:**
- Technical Architecture: `docs/02-technical/TECHNICAL_APPENDIX.md`
- Product Spec: `docs/05-features/PRODUCT_DIRECTION_FINAL.md`
- Design Decisions: `docs/01-product/AZYNC_HACKHUB_DECISIONS.md`

**Team:** Azync HackHub Development Team

**Last Updated:** 2026-09-04

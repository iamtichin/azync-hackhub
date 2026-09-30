# Azync HackHub - Backend

> **Status:** Phase 4 Complete ✅<br>
> **Part 1:** Core Backend (NestJS + Prisma + Submissions API)<br>
> **Part 2:** Solana Integration (Compressed NFT minting)<br>
> **Part 3:** AI Orchestrator (Evidence-grounded analysis with BullMQ)<br>
> **Part 4:** Auth + Core Business Logic (GitHub OAuth, Teams, Hackathons, Planning Canvas) ✅

## Tech Stack

- **Backend Framework:** NestJS 11
- **Database:** PostgreSQL 14+ with Prisma 5 ORM
- **Language:** TypeScript 5
- **Authentication:** JWT + GitHub OAuth (passport-github2)
- **Validation:** class-validator + Zod schemas
- **API Documentation:** Swagger/OpenAPI
- **Blockchain:** Solana Web3.js + Metaplex Bubblegum v5 (Compressed NFTs)
- **Transaction Builder:** Umi Framework
- **Queue:** BullMQ + Redis 7+
- **AI Provider:** OmniRoute (Anthropic primary + OpenAI fallback)
- **Security:** Prompt injection defense, evidence-grounded validation

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Redis 7+
- npm

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and update:

```env
DATABASE_URL="postgresql://postgres:123456@localhost:5432/azync_hackhub_dev"
PORT=3001
NODE_ENV="development"
FRONTEND_URL="http://localhost:3000"

# Redis / BullMQ
REDIS_HOST="127.0.0.1"
REDIS_PORT=6379
REDIS_PASSWORD=""
REDIS_DB=0
AI_QUEUE_CONCURRENCY=2
AI_JOB_ATTEMPTS=3

# OmniRoute over Tailscale Funnel
OMNIROUTE_BASE_URL="https://tichin-lap.tail615d69.ts.net"
OMNIROUTE_API_KEY=""
OMNIROUTE_PRIMARY_PROTOCOL="anthropic"
OMNIROUTE_PRIMARY_MODEL="azync-analysis-v1"
OMNIROUTE_FALLBACK_PROTOCOL="openai"
OMNIROUTE_FALLBACK_MODEL=""

# Optional authenticated GitHub evidence collection
GITHUB_TOKEN=""

# Solana Configuration
SOLANA_RPC_URL="https://api.devnet.solana.com"
SOLANA_NETWORK="devnet"
SOLANA_AUTHORITY_SECRET_KEY="[ARRAY_FROM_SCRIPT]"
SOLANA_MERKLE_TREE_ADDRESS="TREE_ADDRESS_FROM_SCRIPT"
```

**Important:** Run the Merkle tree creation script (Step 3a) to generate Solana credentials.

### 3. Setup database

Create PostgreSQL database:

```bash
psql -U postgres -c "CREATE DATABASE azync_hackhub_dev;"
```

Run migrations:

```bash
npx prisma migrate dev
```

Seed test data:

```bash
npx prisma db seed
```

### 3a. Setup Solana Merkle Tree (Required for NFT Minting)

**First time setup:**

1. Run the Merkle tree creation script:

```bash
npm run create-merkle-tree
```

2. If it's your first run, the script will generate a keypair and show:

```
✅ Payer address: <YOUR_WALLET_ADDRESS>
🔑 Generated new keypair: ./keypair.json
⚠️  Fund this wallet with devnet SOL: https://faucet.solana.com
```

3. Go to https://faucet.solana.com and airdrop 2 SOL to your wallet address.

4. Run the script again to create the Merkle tree:

```bash
npm run create-merkle-tree
```

5. Copy the output values to your `.env` file:

```env
SOLANA_MERKLE_TREE_ADDRESS="<TREE_ADDRESS_FROM_OUTPUT>"
SOLANA_AUTHORITY_SECRET_KEY='[<SECRET_KEY_ARRAY_FROM_OUTPUT>]'
```

6. The script output also includes:
   - Tree Address (used for minting)
   - Transaction signature
   - Solana Explorer link (verify on devnet)

**Note:** The `keypair.json` file is gitignored. Keep it safe for devnet testing.

### 3b. Setup Redis

The AI queue requires Redis. Start the existing development container:

```bash
docker start azync-redis
npm run test:redis
```

To create it for the first time:

```bash
docker run -d --name azync-redis --restart unless-stopped -p 127.0.0.1:6379:6379 redis:7-alpine
```

Expected smoke-test result: Redis returns `PONG` and queue `ai-analysis` is ready.

### 4. Start server

Development mode:

```bash
npm run start:dev
```

Server runs at: http://localhost:3001<br>
Swagger docs: http://localhost:3001/api

## API Endpoints

### Authentication

#### GET /auth/github

Initiate GitHub OAuth flow (redirects to GitHub).

#### GET /auth/github/callback

GitHub OAuth callback endpoint.

**Response (200):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-id-123",
    "githubUsername": "johndoe",
    "email": "john@example.com",
    "name": "John Doe",
    "avatarUrl": "https://avatars.githubusercontent.com/..."
  }
}
```

#### GET /auth/me

Get current user profile (requires JWT).

**Headers:** `Authorization: Bearer {token}`

**Response (200):**

```json
{
  "id": "user-id-123",
  "githubUsername": "johndoe",
  "email": "john@example.com",
  "name": "John Doe",
  "avatarUrl": "https://avatars.githubusercontent.com/..."
}
```

### Users

#### GET /users/me

Get current user profile (same as /auth/me).

#### GET /users/me/teams

Get current user's teams.

#### GET /users/:id

Get user by ID.

### Teams

#### POST /teams

Create a new team (requires authentication).

**Request:**

```json
{
  "name": "Team Alpha",
  "hackathonId": "hackathon-id-123",
  "walletAddress": "SolanaWalletAddress..." // optional
}
```

#### GET /teams

Get all teams (optional query: ?hackathonId=xxx).

#### GET /teams/:id

Get team by ID with members, submissions, tasks, and repository info.

#### PATCH /teams/:id

Update team (admin only).

#### DELETE /teams/:id

Delete team (admin only).

#### GET /teams/:id/members

Get team members.

#### POST /teams/:id/members

Add member to team (admin only).

**Request:**

```json
{
  "userId": "user-id-123",
  "role": "member" // "admin" | "member"
}
```

#### DELETE /teams/:id/members/:userId

Remove member from team (admin or self).

### Hackathons

#### POST /hackathons

Create a new hackathon (organizer).

**Request:**

```json
{
  "name": "UniHackFest 2026",
  "startDate": "2026-09-15T00:00:00Z",
  "endDate": "2026-09-17T23:59:59Z",
  "rules": [],
  "rubric": []
}
```

#### GET /hackathons

Get all hackathons (optional query: ?includeEnded=true).

#### GET /hackathons/:id

Get hackathon by ID with registrations and submissions.

#### PATCH /hackathons/:id

Update hackathon (organizer).

#### DELETE /hackathons/:id

Delete hackathon (organizer).

#### POST /hackathons/:id/register

Register team for hackathon.

**Request:**

```json
{
  "teamId": "team-id-123"
}
```

#### GET /hackathons/:id/teams

Get registered teams for hackathon.

#### GET /hackathons/:id/submissions

Get all submissions for hackathon.

### GitHub Integration

#### POST /github/create-repo

Create GitHub repository for team (auto-adds members as collaborators).

**Request:**

```json
{
  "teamId": "team-id-123",
  "description": "My Hackathon Project",
  "topics": ["javascript", "react", "nextjs"]
}
```

**Response:**

```json
{
  "repository": {
    "id": "repo-id-123",
    "teamId": "team-id-123",
    "fullName": "azync-hackhub-contests/team-abc-project",
    "url": "https://github.com/azync-hackhub-contests/team-abc-project"
  },
  "githubData": {
    "url": "https://github.com/azync-hackhub-contests/team-abc-project",
    "cloneUrl": "https://github.com/azync-hackhub-contests/team-abc-project.git",
    "sshUrl": "git@github.com:azync-hackhub-contests/team-abc-project.git"
  }
}
```

#### POST /github/:teamId/add-collaborator

Add collaborator to team repository (admin only).

**Request:**

```json
{
  "username": "github-username",
  "permission": "push" // "pull" | "push" | "admin"
}
```

#### POST /webhooks/github

GitHub webhook receiver (internal use).

Webhook security and delivery behavior:

- GitHub signs the exact raw request bytes with `X-Hub-Signature-256`; Nest is started with `rawBody: true` so JSON parsing cannot alter signature verification.
- Missing secret, event, delivery ID, raw body, or signature fails closed. Digests are compared with `crypto.timingSafeEqual`.
- `X-GitHub-Delivery` is persisted uniquely in `GitHubWebhookDelivery`. An identical redelivery returns the stored status; reuse with different payload bytes is rejected.
- `push` updates repository activity and marks submission context `STALE` only when the pushed commit differs from its analyzed revision. The next analysis refresh resolves the new HEAD and uses incremental artifact memory.
- `pull_request` and `workflow_run` update durable repository activity/CI fields instead of only logging the event.
- Automatic webhook setup accepts only a public HTTPS `BACKEND_URL`. `localhost` remains valid for direct local API work but cannot be registered as a GitHub callback.

For local GitHub delivery testing, expose a dedicated public route with a webhook proxy or Tailscale Funnel, then set `BACKEND_URL` to that public base URL. Keep the payload URL as `${BACKEND_URL}/webhooks/github` and use the same random `GITHUB_WEBHOOK_SECRET` in GitHub and the backend.

The public [risk and compliance note](../docs/02-technical/RISK_COMPLIANCE_NOTE.md) summarizes webhook signature, replay, scope, and ordering controls.

### Planning Canvas

#### POST /teams/:teamId/planning/areas

Create area for team.

**Request:**

```json
{
  "name": "Backend",
  "color": "#3B82F6",
  "estimatedHours": 20,
  "displayOrder": 0
}
```

#### GET /teams/:teamId/planning/areas

Get all areas for team.

#### PATCH /teams/:teamId/planning/areas/:areaId

Update area.

#### DELETE /teams/:teamId/planning/areas/:areaId

Delete area.

#### POST /teams/:teamId/planning/tasks

Create task for team.

**Request:**

```json
{
  "title": "Setup database schema",
  "description": "Create Prisma schema with all models",
  "areaId": "area-id-123",
  "estimatedHours": 3,
  "priority": "high",
  "assigneeId": "user-id-123"
}
```

#### GET /teams/:teamId/planning/tasks

Get all tasks for team (optional filters: ?status=in_progress&areaId=xxx).

#### GET /teams/:teamId/planning/tasks/:taskId

Get task by ID with dependencies.

#### PATCH /teams/:teamId/planning/tasks/:taskId

Update task (status changes trigger timestamp updates).

**Request:**

```json
{
  "status": "in_progress", // "backlog" | "todo" | "in_progress" | "blocked" | "done"
  "actualHours": 2.5
}
```

#### DELETE /teams/:teamId/planning/tasks/:taskId

Delete task.

#### POST /teams/:teamId/planning/tasks/:taskId/dependencies

Add task dependency.

**Request:**

```json
{
  "dependsOnId": "task-id-456"
}
```

#### DELETE /teams/:teamId/planning/tasks/:taskId/dependencies/:dependsOnId

Remove task dependency.

#### GET /teams/:teamId/planning/critical-path

Calculate critical path for team (longest path through task dependencies).

**Response:**

```json
{
  "taskIds": ["task-1", "task-3", "task-7", "task-9"]
}
```

### Submissions

#### POST /submissions

Create a new submission **and mint NFT credential on Solana devnet**.

**Request:**

```json
{
  "teamId": "team-demo-123",
  "hackathonId": "hack-demo-456",
  "projectName": "My Project",
  "description": "Project description (min 10 chars)",
  "githubUrl": "https://github.com/user/repo",
  "demoUrl": "https://demo.vercel.app",
  "videoUrl": "https://youtube.com/...",
  "walletAddress": "4sArSbZUgHtaCuVNWZBZj5E8rKE6GiJJoLUdR75LHs95"
}
```

**Response (201 - Success):**

```json
{
  "id": "clxx123...",
  "status": "confirmed",
  "transactionSignature": "5hBdbmWf9yNjKVbgqREhx...",
  "nftAssetId": "5hBdbmWf9yNjKVbgqREhx...",
  "explorerUrl": "https://explorer.solana.com/tx/5hBdbmWf9yNjKVbgqREhx...?cluster=devnet",
  "aiAnalysisStatus": "queued",
  "createdAt": "2026-09-04T10:00:00Z"
}
```

**Response (500 - NFT Mint Failed):**

```json
{
  "statusCode": 500,
  "message": "Submission saved but NFT minting failed: <error details>"
}
```

**Note:** Submission is saved to database even if NFT minting fails (status: "nft_failed").

**Errors:**

- 400: Invalid Solana wallet address / Invalid team or hackathon ID
- 409: Team already submitted
- 500: NFT minting failed (submission saved with nft_failed status)

#### GET /submissions/:id

Get submission by ID with NFT details.

**Response (200):**

```json
{
  "id": "clxx123...",
  "teamId": "team-demo-123",
  "hackathonId": "hack-demo-456",
  "projectName": "My Project",
  "description": "...",
  "githubUrl": "...",
  "demoUrl": "...",
  "walletAddress": "4sArSbZUgHtaCuVNWZBZj5E8rKE6GiJJoLUdR75LHs95",
  "transactionSignature": "5hBdbmWf9yNjKVbgqREhx...",
  "nftAssetId": "5hBdbmWf9yNjKVbgqREhx...",
  "status": "confirmed",
  "createdAt": "...",
  "updatedAt": "...",
  "team": { "id": "...", "name": "..." },
  "hackathon": { "id": "...", "name": "..." },
  "solanaTransaction": {
    "signature": "...",
    "walletAddress": "...",
    "status": "confirmed",
    "confirmedAt": "..."
  },
  "explorerUrl": "https://explorer.solana.com/tx/...?cluster=devnet"
}
```

**Errors:**

- 404: Submission not found

#### GET /submissions/:id/ai-analysis

Returns the durable database status and, once complete, the validated analysis.

```json
{
  "jobId": "cm...",
  "queueJobId": "ai-...",
  "status": "completed",
  "attempts": 1,
  "maxAttempts": 3,
  "completed": true,
  "error": null,
  "results": {
    "provider": "omniroute",
    "protocol": "anthropic",
    "requestedModel": "azync-analysis-v1",
    "resolvedModel": "claude-sonnet-4.5",
    "output": {
      "summary": {},
      "technologies": [],
      "requirements": [],
      "rubricAnalysis": [],
      "concerns": [],
      "judgeQuestions": []
    },
    "metrics": {
      "inputTokens": 0,
      "outputTokens": 0,
      "latencyMs": 0,
      "costUsd": null
    }
  }
}
```

Statuses are `not_queued`, `queued`, `processing`, `retrying`, `completed`, `failed`, or `not_found`. A failed response includes a sanitized error code and message. `404` means the submission does not exist.

#### POST /submissions/:id/retry-mint

Retry NFT minting for submissions with "nft_failed" status.

**Response (200 - Success):**

```json
{
  "id": "clxx123...",
  "status": "confirmed",
  "transactionSignature": "...",
  "nftAssetId": "...",
  "explorerUrl": "https://explorer.solana.com/tx/...?cluster=devnet"
}
```

**Errors:**

- 400: NFT already minted successfully
- 404: Submission not found
- 500: Retry failed

### Solana

#### GET /solana/health

Check Solana service health.

**Response (200):**

```json
{
  "status": "ok",
  "network": "devnet"
}
```

## Database Schema

8 models:

- **Team:** Teams participating in hackathons
- **Hackathon:** Hackathon events
- **Submission:** Project submissions (status: "pending_nft" | "confirmed" | "nft_failed")
  - `transactionSignature`: Solana transaction hash
  - `nftAssetId`: Compressed NFT asset ID
  - `aiAnalysisJobId`: durable AI job identifier
  - `aiAnalysisCompleted`: completion flag
- **SolanaTransaction:** NFT mint transaction records
  - Links to Submission
  - Stores signature, walletAddress, nftAssetId, network, status, confirmations
- **AiJob:** Durable queue status, retry state, versions, and gateway metadata
- **Evidence:** Immutable-source snapshots collected from GitHub, Solana, and demo URLs
- **AiAnalysis:** Versioned, validated AI analysis history
- **AiAnalysisEvidence:** Links every analysis to the evidence snapshot it used

**Submission Status Flow:**

1. `pending_nft` - Submission created, minting in progress
2. `confirmed` - NFT minted successfully
3. `nft_failed` - Submission saved but NFT minting failed (can retry)

After a successful mint, AI queueing is attempted. Queue failure does not roll back the confirmed submission.

View schema:

```bash
npx prisma studio
```

## Solana Integration

### Compressed NFTs via Metaplex Bubblegum

- **Network:** Solana devnet
- **Protocol:** Metaplex Bubblegum V2 (Compressed NFTs)
- **Cost:** ~$0.0003 per mint (vs ~$0.01 for standard NFTs)
- **Capacity:** 16,384 submissions per Merkle tree (maxDepth 14)

### NFT Metadata

Each submission NFT contains:

- **Name:** `{hackathonName} - {projectName}`
- **Symbol:** `AHSUB` (Azync HackHub Submission)
- **Attributes:**
  - Hackathon name
  - Team name
  - Project name
  - Submission timestamp
  - Metadata hash (SHA256)
  - GitHub URL
  - Demo URL

### Merkle Tree Configuration

- **maxDepth:** 14 (16,384 cNFTs capacity)
- **maxBufferSize:** 64 (concurrent minting support)
- **canopyDepth:** 8 (reduces proof size in transactions)

### Verifying NFTs on Solana Explorer

After submission, check the transaction on Solana devnet:

```
https://explorer.solana.com/tx/{transactionSignature}?cluster=devnet
```

## AI Orchestrator

### AI Memory v2

Each submission now has durable, versioned memory instead of rebuilding an opaque prompt from scratch:

```text
repository HEAD + rules/rubric
  -> immutable artifact versions
  -> versioned context snapshot + change manifest
  -> current evidence + previous validated analysis checkpoint
  -> complete revalidated analysis
```

- `AiArtifactVersion` stores immutable repository artifacts and their hashes. Only changed artifacts create new versions; unchanged GitHub HEAD data is reused.
- `AiContextSnapshot` records the parent snapshot, refresh mode, artifact/evidence links, and added/changed/removed artifact keys.
- `AiAnalysis.previousAnalysisId` forms an auditable analysis chain. Previous model output is always treated as untrusted context and every new result must still pass the complete schema and evidence validators.
- Exact repeated requests remain idempotent. Changes to repository HEAD, rules, rubric, prompt, or schema create a new context version.
- Repository collection is deterministic and bounded: manifests and README are collected, then a curated set of relevant source entrypoints is selected while generated/vendor directories are excluded.

### Private judge sessions

Judge chat is isolated by `submission + hackathon + authenticated judge`. The API checks the JWT and `HackathonJudge` assignment before decrypting any content.

- Every chat session receives a random 256-bit data-encryption key (DEK).
- Titles and messages use AES-256-GCM. The DEK is wrapped by `AI_DATA_ENCRYPTION_KEY`.
- Authenticated additional data binds ciphertext to the owner, session, submission, hackathon, role, message ID, and context version. Moving ciphertext to another owner/session therefore fails authentication.
- Plaintext message/title columns are cleared after encryption, and encryption metadata is never returned by the API.
- Stored GitHub OAuth access tokens are also AES-256-GCM encrypted and bound to the user identity.
- The JWT is an authorization credential, not an encryption key. Signing-key rotation does not make stored chat unreadable.

Generate a local key without printing it:

```powershell
npm run security:init-local
```

Production must provide a base64-encoded 32-byte `AI_DATA_ENCRYPTION_KEY`. Keep `AI_DATA_ENCRYPTION_KEY_VERSION` stable until a key rewrap migration is implemented and completed.

### Processing flow

```text
POST /submissions
  -> mint compressed NFT synchronously
  -> persist confirmed submission
  -> enqueue small ID-only BullMQ job
  -> collect or reuse versioned GitHub artifacts, finalized Solana, and demo evidence
  -> create a context snapshot and deterministic change manifest
  -> build trusted rules/rubric + isolated untrusted participant content
  -> call fixed OmniRoute combo (Anthropic; optional OpenAI-compatible fallback)
  -> validate complete JSON with Zod and evidence-aware business rules
  -> perform at most one repair call
  -> atomically persist analysis lineage, evidence links, and completed job status
```

The database is the source of truth. Redis transports jobs but does not own analysis state.

### Queue behavior

- Queue: `ai-analysis`; job: `analyze-submission`
- Default retries: 3 with exponential backoff
- Default worker concurrency: 2, configurable from 1–20
- Deterministic fingerprints make repeated enqueue requests idempotent
- Retryable failures include timeouts, rate limits, and temporary gateway errors
- Authentication, malformed configuration, and persistently invalid output fail permanently

### Evidence and security

- GitHub URLs are canonicalized and evidence is pinned to a commit SHA.
- Solana evidence checks the configured cluster genesis hash and finalized transaction state.
- Demo probing rejects credentials, non-HTTP protocols, and private/reserved destinations; redirects and response sizes are bounded.
- README, source files, descriptions, and model output are always untrusted.
- Prompt delimiters are escaped, and participant content never enters the system message.
- `PASS` and positive rubric findings require IDs of deterministically verified evidence.
- AI results are advisory; this service does not select winners or mutate judge scores.

### OmniRoute configuration

`OMNIROUTE_PRIMARY_MODEL` must be a fixed model/combo such as `azync-analysis-v1`; `auto/*` routing is rejected. Leave `OMNIROUTE_FALLBACK_MODEL` empty unless a separate fixed fallback combo and connection have been configured. Never commit or paste the application API key into documentation or logs.

Run a provider smoke test without printing the response body or secret:

```bash
npm run test:ai-provider
```

Token counts, latency, requested/resolved model, protocol, correlation ID, and selected connection are persisted. `costUsd` remains `null` when OmniRoute does not return authoritative billing data.

### Metrics

`MetricsTracker` aggregates job counts, success/failure totals, tokens, latency, and known cost directly in PostgreSQL. Provider, evidence, queue, worker, and orchestrator logs are structured JSON and deliberately omit prompts, response bodies, and credentials.

## Testing

Run unit tests:

```bash
npm test
```

Run specific test file:

```bash
npm test -- submissions.service.spec.ts
```

The E2E harness uses a dedicated local PostgreSQL instance (port 5433), Redis
(port 6380), unique Compose project/volumes, and deterministic AI/Solana
fixtures. It never uses live GitHub, AI, wallet, or Solana credentials. Run the
complete isolated check:

```bash
npm run test:e2e:ci
```

For lifecycle debugging, reuse one explicit run ID. Fixed host ports permit one
run at a time; `test:e2e:up` acquires a lock and `test:e2e:down` removes only
that run's Compose project, volumes, and lock.

```powershell
$env:AZYNC_E2E_RUN_ID = [guid]::NewGuid().ToString()
npm run test:e2e:up
npm run test:e2e:migrate
npm run test:e2e
npm run test:e2e:down
```

```bash
export AZYNC_E2E_RUN_ID="$(node -e "console.log(require('node:crypto').randomUUID())")"
npm run test:e2e:up
npm run test:e2e:migrate
npm run test:e2e
npm run test:e2e:down
```

Run deterministic prompt-injection tests through the harness:

```bash
npm run test:e2e:ci
```

Run the full submission → queue → worker → evidence → analysis integration test. PostgreSQL and Redis must be running; Solana and AI network calls are replaced with deterministic fixtures:

```bash
npm run test:e2e:ci
```

## Rate Limiting

API is rate-limited to **3 requests per minute per IP** via `@nestjs/throttler`.

## Next Steps

- **Frontend:** Build submission form with Solana wallet integration
- **Judge UI:** Render evidence-linked AI suggestions and uncertainty
- **Operations:** Add authenticated metrics and queue dashboards if needed

## Troubleshooting

**"Prisma Client not generated"**

```bash
npx prisma generate
```

**"Database connection failed"**
Check PostgreSQL is running and DATABASE_URL is correct.

**"Port 3001 already in use"**
Change PORT in `.env` or kill existing process.

**"SOLANA_AUTHORITY_SECRET_KEY not set"**
Run `npm run create-merkle-tree` to generate Solana credentials and update `.env`.

**"Solana transaction failed: Attempt to debit an account but found no record"**
Your Solana wallet needs devnet SOL. Visit https://faucet.solana.com and airdrop 2 SOL.

**"NFT minting failed"**

- Check Solana RPC URL is reachable (https://api.devnet.solana.com)
- Verify Merkle tree address is correct
- Check wallet has sufficient SOL for transaction fees
- Use POST /submissions/:id/retry-mint to retry failed mints

**"Redis connection failed"**

Run `docker start azync-redis`, then verify with `npm run test:redis`. Confirm `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `REDIS_DB`.

**"AI analysis failed with AI_NOT_CONFIGURED"**

Set `OMNIROUTE_API_KEY` locally and keep `OMNIROUTE_PRIMARY_MODEL` fixed to `azync-analysis-v1`. Restart the backend after changing `.env`.

**"AI analysis is retrying"**

Check structured worker logs for a sanitized error code. Verify the Tailscale machine hosting OmniRoute remains online and the Funnel URL is reachable.

**"GitHub evidence unavailable"**

Public requests work without a token but are heavily rate limited. Set `GITHUB_TOKEN` locally for authenticated API limits. The token is optional and must not be committed.

## Development Commands

```bash
# Start development server
npm run start:dev

# Build for production
npm run build

# Run tests
npm test

# Run AI security and integration tests
npm run test:e2e -- prompt-injection.e2e-spec.ts
npm run test:e2e -- ai-analysis.e2e-spec.ts

# Verify Redis and the AI queue
npm run test:redis

# Verify OmniRoute without printing secrets or response content
npm run test:ai-provider

# Run Prisma Studio (database GUI)
npx prisma studio

# Create Merkle tree (one-time setup)
npm run create-merkle-tree

# View API documentation
# Server must be running
open http://localhost:3001/api
```

## Solana Devnet Resources

- **Faucet:** https://faucet.solana.com (airdrop 2 SOL)
- **Explorer:** https://explorer.solana.com/?cluster=devnet
- **RPC Endpoint:** https://api.devnet.solana.com
- **Metaplex Bubblegum Docs:** https://developers.metaplex.com/bubblegum

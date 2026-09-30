# Docker Deployment Guide - Azync HackHub Backend

## 📦 Prerequisites

- Docker Desktop installed (Windows/Mac) or Docker Engine (Linux)
- Docker Compose v2.x
- Git
- Terminal/PowerShell

## 🚀 Quick Start

### 1. Clone & Setup

```bash
cd d:\Azync-HackHub\azync-hackhub-backend

# Copy environment template
cp .env.example .env

# Edit .env with your actual values
notepad .env  # Windows
# or
nano .env     # Linux/Mac
```

### 2. Build & Run (Production)

```bash
# Build Docker image
npm run docker:build

# Start services (backend + Redis)
npm run docker:up

# Check logs
npm run docker:logs

# Verify backend is running
curl http://localhost:3001/api
```

### 3. Development Mode (với hot reload)

```bash
# Start development environment
npm run docker:dev

# Logs in real-time
docker-compose -f docker-compose.yml -f docker-compose.dev.yml logs -f

# Stop dev environment
npm run docker:dev:down
```

## 📋 Available Docker Commands

| Command                   | Description                            |
| ------------------------- | -------------------------------------- |
| `npm run docker:build`    | Build production Docker image          |
| `npm run docker:up`       | Start backend + Redis (detached)       |
| `npm run docker:down`     | Stop and remove containers             |
| `npm run docker:logs`     | Follow backend logs                    |
| `npm run docker:restart`  | Restart backend container              |
| `npm run docker:dev`      | Start development mode with hot reload |
| `npm run docker:dev:down` | Stop development environment           |
| `npm run docker:clean`    | Remove containers, volumes, and images |

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Docker Compose Network          │
│                                         │
│  ┌──────────────┐    ┌──────────────┐  │
│  │   Backend    │───▶│    Redis     │  │
│  │  (NestJS)    │    │   (Queue)    │  │
│  │  Port: 3001  │    │  Port: 6379  │  │
│  └──────┬───────┘    └──────────────┘  │
│         │                               │
└─────────┼───────────────────────────────┘
          │
          ▼
    External Services:
    - Supabase (PostgreSQL)
    - Anthropic API
    - Solana Devnet
```

## 🔧 Configuration

### Required Environment Variables

Edit `.env` file with these values:

```env
# Database - Get from Supabase Dashboard
DATABASE_URL="postgresql://postgres:password@db.xxx.supabase.co:5432/postgres"

# JWT Secret - Generate strong random string
JWT_SECRET="your-256-bit-secret-key"

# 32 random bytes, base64 encoded. Never reuse JWT_SECRET here.
AI_DATA_ENCRYPTION_KEY="generate-with-npm-run-security:init-local"
AI_DATA_ENCRYPTION_KEY_VERSION="v1"
AI_DATA_ENCRYPTION_MIGRATE_ON_STARTUP="true"

# GitHub OAuth - Create at github.com/settings/developers
GITHUB_CLIENT_ID="Iv1.xxx"
GITHUB_CLIENT_SECRET="xxx"
GITHUB_ORG_NAME="azync-hackhub-contests"

# Anthropic AI - Get from console.anthropic.com
ANTHROPIC_API_KEY="sk-ant-xxx"

# Solana - For devnet testing
SOLANA_RPC_URL="https://api.devnet.solana.com"
SOLANA_PRIVATE_KEY="base58-encoded-private-key"

# Frontend CORS
FRONTEND_URL="http://localhost:3000"
```

For Docker Desktop local setup, generate the encryption key in the ignored `.env.docker.local` file:

```powershell
npm run security:init-local
docker compose --env-file .env.docker.local -f docker-compose.full.yml up -d --build
```

The full compose stack keeps PostgreSQL and Redis on the private Compose network; only backend port `3001` is published. Startup waits for both dependencies, applies Prisma migrations, performs the idempotent seed, and then starts NestJS.

### Redis Configuration

Redis runs inside Docker with:

- **Port:** 6379 (exposed to host)
- **Persistence:** Volume `redis-data` (data survives container restarts)
- **Command:** `redis-server --appendonly yes` (AOF persistence)

Backend connects via `REDIS_HOST=redis` (Docker internal network).

## 📊 Health Checks

### Backend Health Check

The Dockerfile includes a built-in health check:

```bash
# Inside container (every 30s)
node -e "require('http').get('http://localhost:3001/api', (r) => {
  process.exit(r.statusCode === 200 ? 0 : 1)
})"
```

### Manual Health Check

```bash
# Check backend status
curl http://localhost:3001/api

# Check Redis
docker exec azync-hackhub-redis redis-cli ping
# Should return: PONG
```

## 🐛 Debugging

### View Logs

```bash
# Backend logs only
npm run docker:logs

# All services
docker-compose logs -f

# Redis logs
docker-compose logs -f redis

# Last 100 lines
docker-compose logs --tail=100 backend
```

### Access Container Shell

```bash
# Backend container
docker exec -it azync-hackhub-backend sh

# Redis CLI
docker exec -it azync-hackhub-redis redis-cli
```

### Check Container Status

```bash
docker-compose ps

# Expected output:
# NAME                    STATUS              PORTS
# azync-hackhub-backend   Up 5 minutes        0.0.0.0:3001->3001/tcp
# azync-hackhub-redis     Up 5 minutes        0.0.0.0:6379->6379/tcp
```

## 🔄 Database Migrations

Migrations run automatically on container start via:

```bash
npx prisma migrate deploy && node dist/main.js
```

### Manual Migration

```bash
# Enter backend container
docker exec -it azync-hackhub-backend sh

# Run migration
npx prisma migrate deploy

# Generate Prisma Client (if needed)
npx prisma generate
```

## 🚨 Troubleshooting

### GitHub webhook cannot reach Docker Desktop

GitHub cannot deliver to `localhost`. Expose backend port `3001` through a public HTTPS webhook proxy or a dedicated Tailscale Funnel path, then configure:

```env
BACKEND_URL=https://your-public-host.example.com/hackhub
GITHUB_WEBHOOK_SECRET=a-long-random-secret-shared-with-github
```

The registered payload URL becomes `https://your-public-host.example.com/hackhub/webhooks/github`. Do not route PostgreSQL or Redis through the public endpoint. The backend rejects unsigned, incorrectly signed, and replay-conflicting deliveries before processing them.

### Backend Won't Start

```bash
# Check logs for errors
npm run docker:logs

# Common issues:
# 1. DATABASE_URL incorrect → verify Supabase connection string
# 2. Redis not ready → wait 10s and check redis logs
# 3. Port 3001 in use → stop other services or change PORT in .env
```

### Redis Connection Failed

```bash
# Check Redis is running
docker-compose ps redis

# Test connection
docker exec azync-hackhub-redis redis-cli ping

# Restart Redis
docker-compose restart redis
```

### Out of Memory

```bash
# Check resource usage
docker stats

# Increase Docker Desktop memory (Settings → Resources)
# Recommended: 4GB+ for backend + Redis
```

### Permission Errors

```bash
# On Linux, fix file ownership
sudo chown -R $USER:$USER .

# Rebuild image
npm run docker:build
```

## 🧹 Cleanup

```bash
# Stop and remove everything
npm run docker:clean

# This removes:
# - Containers
# - Networks
# - Volumes (Redis data)
# - Built images

# Rebuild from scratch
npm run docker:build
npm run docker:up
```

## 🚀 Production Deployment

### Option 1: Docker Registry (Recommended)

```bash
# Tag image
docker tag azync-hackhub-backend your-registry.com/azync-hackhub-backend:v1.0.0

# Push to registry
docker push your-registry.com/azync-hackhub-backend:v1.0.0

# On production server
docker pull your-registry.com/azync-hackhub-backend:v1.0.0
docker-compose up -d
```

### Option 2: Railway / Render

```bash
# Both support Dockerfile deployment
# 1. Connect GitHub repo
# 2. Set environment variables in dashboard
# 3. Deploy automatically on git push
```

### Option 3: VPS (DigitalOcean, AWS EC2)

```bash
# Install Docker on server
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Clone repo
git clone https://github.com/your-org/azync-hackhub-backend.git
cd azync-hackhub-backend

# Setup environment
cp .env.example .env
nano .env  # Edit with production values

# Run
npm run docker:build
npm run docker:up

# Setup reverse proxy (Nginx/Caddy) for HTTPS
```

## 📈 Monitoring

### Docker Stats

```bash
# Real-time resource usage
docker stats azync-hackhub-backend azync-hackhub-redis
```

### Logs Rotation

Add to `docker-compose.yml`:

```yaml
services:
  backend:
    logging:
      driver: 'json-file'
      options:
        max-size: '10m'
        max-file: '3'
```

## 🔐 Security Best Practices

1. **Never commit `.env` file** - It's in `.gitignore`
2. **Use strong JWT_SECRET** - Generate with `openssl rand -base64 32`
3. **Change default passwords** - Especially for production databases
4. **Keep images updated** - Rebuild regularly with `docker pull node:20-alpine`
5. **Use non-root user** - Already configured in Dockerfile
6. **Enable HTTPS** - Use reverse proxy (Nginx/Caddy/Traefik)
7. **Firewall rules** - Only expose necessary ports (3001, not 6379 publicly)

## 📞 Support

Issues? Check:

1. Logs: `npm run docker:logs`
2. Container status: `docker-compose ps`
3. Environment variables: `cat .env`
4. GitHub Issues: [Create an issue](https://github.com/your-org/azync-hackhub-backend/issues)

---

**Last Updated:** 2026-09-05
**Docker Version:** 24.x
**Docker Compose Version:** 2.x

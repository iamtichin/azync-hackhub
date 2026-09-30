# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build application
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Runtime tooling is also used by Compose health/readiness checks.
RUN apk add --no-cache curl dumb-init openssl postgresql-client

# Create the unprivileged runtime identity before copying application files.
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy package files
COPY --chown=nestjs:nodejs package*.json ./
COPY --chown=nestjs:nodejs prisma ./prisma/

# Copy built application from builder
COPY --chown=nestjs:nodejs --from=builder /app/dist ./dist
# The locked builder dependencies include Prisma CLI and ts-node for startup seeding.
COPY --chown=nestjs:nodejs --from=builder /app/node_modules ./node_modules

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD curl -fsS http://localhost:3001/api > /dev/null || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start application
CMD ["node", "dist/src/main.js"]

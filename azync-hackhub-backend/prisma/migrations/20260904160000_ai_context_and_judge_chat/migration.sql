CREATE TYPE "AiContextStatus" AS ENUM ('ACTIVE', 'STALE');
CREATE TYPE "AiChatSessionStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiChatRole" AS ENUM ('USER', 'ASSISTANT');

ALTER TABLE "AiJob" ADD COLUMN "sourceRevision" TEXT;

CREATE TABLE "AiContextSession" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "hackathonId" TEXT NOT NULL,
  "status" "AiContextStatus" NOT NULL DEFAULT 'ACTIVE',
  "contextVersion" INTEGER NOT NULL DEFAULT 0,
  "latestRevision" TEXT,
  "latestSnapshotHash" TEXT,
  "lastAnalyzedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiContextSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiContextSnapshot" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "sourceRevision" TEXT,
  "snapshotHash" TEXT NOT NULL,
  "rulesVersion" TEXT NOT NULL,
  "rubricVersion" TEXT NOT NULL,
  "context" JSONB NOT NULL,
  "delta" JSONB NOT NULL,
  "analysisId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiContextSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiContextSnapshotEvidence" (
  "snapshotId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  CONSTRAINT "AiContextSnapshotEvidence_pkey" PRIMARY KEY ("snapshotId", "evidenceId")
);

CREATE TABLE "AiChatSession" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "hackathonId" TEXT NOT NULL,
  "contextSessionId" TEXT NOT NULL,
  "judgeId" TEXT NOT NULL,
  "title" TEXT,
  "status" "AiChatSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "contextVersion" INTEGER NOT NULL DEFAULT 0,
  "rulesVersion" TEXT NOT NULL,
  "rubricVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiChatSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiChatMessage" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "role" "AiChatRole" NOT NULL,
  "content" TEXT NOT NULL,
  "contextVersion" INTEGER NOT NULL,
  "model" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "latencyMs" INTEGER NOT NULL DEFAULT 0,
  "correlationId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiChatMessageEvidence" (
  "messageId" TEXT NOT NULL,
  "evidenceId" TEXT NOT NULL,
  CONSTRAINT "AiChatMessageEvidence_pkey" PRIMARY KEY ("messageId", "evidenceId")
);

CREATE UNIQUE INDEX "AiContextSession_submissionId_key" ON "AiContextSession"("submissionId");
CREATE INDEX "AiContextSession_hackathonId_updatedAt_idx" ON "AiContextSession"("hackathonId", "updatedAt");
CREATE UNIQUE INDEX "AiContextSnapshot_analysisId_key" ON "AiContextSnapshot"("analysisId");
CREATE UNIQUE INDEX "AiContextSnapshot_sessionId_version_key" ON "AiContextSnapshot"("sessionId", "version");
CREATE UNIQUE INDEX "AiContextSnapshot_sessionId_snapshotHash_key" ON "AiContextSnapshot"("sessionId", "snapshotHash");
CREATE INDEX "AiContextSnapshot_sessionId_createdAt_idx" ON "AiContextSnapshot"("sessionId", "createdAt");
CREATE INDEX "AiChatSession_submissionId_judgeId_updatedAt_idx" ON "AiChatSession"("submissionId", "judgeId", "updatedAt");
CREATE INDEX "AiChatSession_hackathonId_judgeId_updatedAt_idx" ON "AiChatSession"("hackathonId", "judgeId", "updatedAt");
CREATE INDEX "AiChatMessage_sessionId_createdAt_idx" ON "AiChatMessage"("sessionId", "createdAt");

ALTER TABLE "AiContextSession" ADD CONSTRAINT "AiContextSession_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContextSession" ADD CONSTRAINT "AiContextSession_hackathonId_fkey" FOREIGN KEY ("hackathonId") REFERENCES "Hackathon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContextSnapshot" ADD CONSTRAINT "AiContextSnapshot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiContextSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContextSnapshot" ADD CONSTRAINT "AiContextSnapshot_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AiAnalysis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiContextSnapshotEvidence" ADD CONSTRAINT "AiContextSnapshotEvidence_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "AiContextSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContextSnapshotEvidence" ADD CONSTRAINT "AiContextSnapshotEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiChatSession" ADD CONSTRAINT "AiChatSession_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiChatSession" ADD CONSTRAINT "AiChatSession_hackathonId_fkey" FOREIGN KEY ("hackathonId") REFERENCES "Hackathon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiChatSession" ADD CONSTRAINT "AiChatSession_contextSessionId_fkey" FOREIGN KEY ("contextSessionId") REFERENCES "AiContextSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiChatSession" ADD CONSTRAINT "AiChatSession_judgeId_fkey" FOREIGN KEY ("judgeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiChatMessage" ADD CONSTRAINT "AiChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AiChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiChatMessageEvidence" ADD CONSTRAINT "AiChatMessageEvidence_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AiChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiChatMessageEvidence" ADD CONSTRAINT "AiChatMessageEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the existing AiAnalysis rows in place. Legacy fields remain nullable/
-- defaulted while new analyses use the versioned output and provenance columns.

CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'RETRYING', 'COMPLETED', 'FAILED');
CREATE TYPE "EvidenceType" AS ENUM ('GITHUB_REPOSITORY', 'GITHUB_FILE', 'GITHUB_TEST_SIGNAL', 'SOLANA_TRANSACTION', 'SOLANA_ACCOUNT', 'DEMO_URL');
CREATE TYPE "EvidenceStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'UNAVAILABLE');

ALTER TABLE "AiAnalysis" DROP CONSTRAINT "AiAnalysis_submissionId_fkey";
DROP INDEX "AiAnalysis_submissionId_key";

ALTER TABLE "AiAnalysis"
ADD COLUMN "analysisVersion" TEXT NOT NULL DEFAULT 'legacy-v0',
ADD COLUMN "architectureVersion" TEXT NOT NULL DEFAULT 'legacy-v0',
ADD COLUMN "costUsd" DECIMAL(12,6),
ADD COLUMN "gatewayCorrelationId" TEXT,
ADD COLUMN "gatewaySessionId" TEXT,
ADD COLUMN "inputHash" TEXT NOT NULL DEFAULT 'legacy-unversioned',
ADD COLUMN "inputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "jobId" TEXT,
ADD COLUMN "latencyMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "output" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "outputTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "promptVersion" TEXT NOT NULL DEFAULT 'legacy-v0',
ADD COLUMN "protocol" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "requestedModel" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "resolvedModel" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "schemaVersion" TEXT NOT NULL DEFAULT 'legacy-v0',
ADD COLUMN "selectedConnectionId" TEXT,
ADD COLUMN "validationReport" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "strengths" SET DEFAULT ARRAY[]::TEXT[],
ALTER COLUMN "improvements" SET DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Hackathon"
ADD COLUMN "rubric" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "rubricVersion" TEXT NOT NULL DEFAULT 'rubric-v1',
ADD COLUMN "rules" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "rulesVersion" TEXT NOT NULL DEFAULT 'rules-v1';

CREATE TABLE "AiJob" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "bullmqJobId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "architectureVersion" TEXT NOT NULL,
    "analysisVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "inputHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "validationReport" JSONB,
    "requestedModel" TEXT,
    "resolvedModel" TEXT,
    "protocol" TEXT,
    "gatewayCorrelationId" TEXT,
    "gatewaySessionId" TEXT,
    "selectedConnectionId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "snapshotKey" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "source" TEXT NOT NULL,
    "status" "EvidenceStatus" NOT NULL,
    "reference" TEXT NOT NULL,
    "sourceRevision" TEXT,
    "locator" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "contentHash" TEXT,
    "collectorVersion" TEXT NOT NULL,
    "errorCode" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiAnalysisEvidence" (
    "analysisId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    CONSTRAINT "AiAnalysisEvidence_pkey" PRIMARY KEY ("analysisId","evidenceId")
);

CREATE UNIQUE INDEX "AiJob_bullmqJobId_key" ON "AiJob"("bullmqJobId");
CREATE UNIQUE INDEX "AiJob_idempotencyKey_key" ON "AiJob"("idempotencyKey");
CREATE INDEX "AiJob_submissionId_queuedAt_idx" ON "AiJob"("submissionId", "queuedAt");
CREATE INDEX "AiJob_status_queuedAt_idx" ON "AiJob"("status", "queuedAt");
CREATE UNIQUE INDEX "Evidence_snapshotKey_key" ON "Evidence"("snapshotKey");
CREATE INDEX "Evidence_submissionId_type_idx" ON "Evidence"("submissionId", "type");
CREATE INDEX "Evidence_status_collectedAt_idx" ON "Evidence"("status", "collectedAt");
CREATE UNIQUE INDEX "AiAnalysis_jobId_key" ON "AiAnalysis"("jobId");
CREATE INDEX "AiAnalysis_submissionId_createdAt_idx" ON "AiAnalysis"("submissionId", "createdAt");
CREATE UNIQUE INDEX "AiAnalysis_submissionId_inputHash_promptVersion_schemaVersi_key" ON "AiAnalysis"("submissionId", "inputHash", "promptVersion", "schemaVersion");

ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiJob" ADD CONSTRAINT "AiJob_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAnalysisEvidence" ADD CONSTRAINT "AiAnalysisEvidence_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "AiAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiAnalysisEvidence" ADD CONSTRAINT "AiAnalysisEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

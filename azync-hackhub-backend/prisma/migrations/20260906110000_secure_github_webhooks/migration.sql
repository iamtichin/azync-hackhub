ALTER TABLE "GitHubRepository"
ADD COLUMN "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN "lastPushAt" TIMESTAMP(3),
ADD COLUMN "lastCommitSha" TEXT,
ADD COLUMN "lastPullRequestAt" TIMESTAMP(3),
ADD COLUMN "lastWorkflowRunAt" TIMESTAMP(3),
ADD COLUMN "lastWorkflowStatus" TEXT,
ADD COLUMN "lastWorkflowConclusion" TEXT;

CREATE TABLE "GitHubWebhookDelivery" (
  "id" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "hookId" TEXT,
  "repositoryFullName" TEXT,
  "payloadHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "result" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "GitHubWebhookDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubWebhookDelivery_deliveryId_key"
ON "GitHubWebhookDelivery"("deliveryId");

CREATE INDEX "GitHubWebhookDelivery_status_receivedAt_idx"
ON "GitHubWebhookDelivery"("status", "receivedAt");

CREATE INDEX "GitHubWebhookDelivery_repositoryFullName_receivedAt_idx"
ON "GitHubWebhookDelivery"("repositoryFullName", "receivedAt");

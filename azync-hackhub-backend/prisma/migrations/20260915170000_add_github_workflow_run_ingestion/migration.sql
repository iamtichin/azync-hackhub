CREATE TABLE "GitHubWorkflowRun" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "runAttempt" INTEGER NOT NULL,
  "headSha" TEXT NOT NULL,
  "headBranch" TEXT NOT NULL,
  "triggerEvent" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "conclusion" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "testStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "coverageStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "trustLimitations" JSONB NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GitHubWorkflowRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "GitHubWorkflowRun"
ADD CONSTRAINT "GitHubWorkflowRun_repositoryId_fkey"
FOREIGN KEY ("repositoryId") REFERENCES "GitHubRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "GitHubWorkflowRun_repositoryId_runId_runAttempt_key"
ON "GitHubWorkflowRun"("repositoryId", "runId", "runAttempt");

CREATE INDEX "GitHubWorkflowRun_repositoryId_updatedAt_idx"
ON "GitHubWorkflowRun"("repositoryId", "updatedAt");

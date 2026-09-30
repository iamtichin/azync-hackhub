ALTER TABLE "Submission"
ADD COLUMN "slidesUrl" TEXT,
ADD COLUMN "participantBlockchainEvidenceUrl" TEXT,
ADD COLUMN "receivedStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
ADD COLUMN "mintStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN "aiStatus" TEXT NOT NULL DEFAULT 'NOT_QUEUED',
ADD COLUMN "finalSnapshot" JSONB,
ADD COLUMN "finalizedAt" TIMESTAMP(3),
ADD COLUMN "receiptVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "SubmissionDraft" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "hackathonId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "updatedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubmissionDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SubmissionDraft_teamId_hackathonId_key" ON "SubmissionDraft"("teamId", "hackathonId");
CREATE INDEX "SubmissionDraft_updatedById_updatedAt_idx" ON "SubmissionDraft"("updatedById", "updatedAt");

ALTER TABLE "SubmissionDraft"
ADD CONSTRAINT "SubmissionDraft_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmissionDraft"
ADD CONSTRAINT "SubmissionDraft_hackathonId_fkey"
FOREIGN KEY ("hackathonId") REFERENCES "Hackathon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubmissionDraft"
ADD CONSTRAINT "SubmissionDraft_updatedById_fkey"
FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

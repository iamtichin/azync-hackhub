CREATE TABLE "HackathonJudge" (
  "id" TEXT NOT NULL,
  "hackathonId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'judge',
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HackathonJudge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HackathonJudge_hackathonId_userId_key" ON "HackathonJudge"("hackathonId", "userId");
CREATE INDEX "HackathonJudge_userId_idx" ON "HackathonJudge"("userId");
ALTER TABLE "HackathonJudge" ADD CONSTRAINT "HackathonJudge_hackathonId_fkey" FOREIGN KEY ("hackathonId") REFERENCES "Hackathon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HackathonJudge" ADD CONSTRAINT "HackathonJudge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

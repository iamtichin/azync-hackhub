ALTER TABLE "User" ADD COLUMN "university" TEXT;
ALTER TABLE "User" ADD COLUMN "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Hackathon" ADD COLUMN "description" TEXT;
ALTER TABLE "Hackathon" ADD COLUMN "coverUrl" TEXT;
-- Existing events remain visible; new application writes explicitly use the schema default (false).
ALTER TABLE "Hackathon" ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT true;
-- Backfill has preserved historic visibility above; future database-level inserts are drafts.
ALTER TABLE "Hackathon" ALTER COLUMN "isPublished" SET DEFAULT false;

CREATE TABLE "Track" (
  "id" TEXT NOT NULL,
  "hackathonId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Track_hackathonId_name_key" ON "Track"("hackathonId", "name");
CREATE INDEX "Track_hackathonId_isActive_idx" ON "Track"("hackathonId", "isActive");
ALTER TABLE "Track" ADD CONSTRAINT "Track_hackathonId_fkey" FOREIGN KEY ("hackathonId") REFERENCES "Hackathon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HackathonRegistration" ADD COLUMN "trackId" TEXT;
ALTER TABLE "Submission" ADD COLUMN "trackId" TEXT;
CREATE INDEX "HackathonRegistration_trackId_idx" ON "HackathonRegistration"("trackId");
CREATE INDEX "Submission_trackId_idx" ON "Submission"("trackId");
ALTER TABLE "HackathonRegistration" ADD CONSTRAINT "HackathonRegistration_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;

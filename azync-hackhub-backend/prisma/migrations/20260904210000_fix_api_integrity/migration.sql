ALTER TABLE "SolanaTransaction" ALTER COLUMN "signature" DROP NOT NULL;
UPDATE "SolanaTransaction" SET "signature" = NULL WHERE "signature" = '';
ALTER TABLE "SolanaTransaction" ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SolanaTransaction" ADD COLUMN "slot" BIGINT;
ALTER TABLE "SolanaTransaction" ADD COLUMN "errorMessage" TEXT;

ALTER TABLE "GitHubRepository" ADD COLUMN "webhookConfigured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GitHubRepository" ADD COLUMN "webhookError" TEXT;

ALTER TABLE "Hackathon" ADD COLUMN "organizerId" TEXT;
CREATE INDEX "Hackathon_organizerId_idx" ON "Hackathon"("organizerId");
ALTER TABLE "Hackathon" ADD CONSTRAINT "Hackathon_organizerId_fkey"
  FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

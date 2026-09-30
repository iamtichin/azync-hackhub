CREATE TABLE "TeamActivity" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "subjectType" TEXT,
  "subjectId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamActivity_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TeamActivity"
ADD CONSTRAINT "TeamActivity_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamActivity"
ADD CONSTRAINT "TeamActivity_actorId_fkey"
FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "TeamActivity_teamId_createdAt_id_idx"
ON "TeamActivity"("teamId", "createdAt", "id");

CREATE INDEX "TeamActivity_actorId_createdAt_idx"
ON "TeamActivity"("actorId", "createdAt");

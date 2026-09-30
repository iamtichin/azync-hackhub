-- Versioned submission artifacts provide replayable, incrementally refreshed AI context.
ALTER TABLE "AiAnalysis"
  ADD COLUMN "previousAnalysisId" TEXT,
  ADD COLUMN "refreshMode" TEXT NOT NULL DEFAULT 'FULL',
  ADD COLUMN "changeManifest" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "AiContextSnapshot"
  ADD COLUMN "parentSnapshotId" TEXT,
  ADD COLUMN "refreshMode" TEXT NOT NULL DEFAULT 'FULL',
  ADD COLUMN "changeManifest" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "AiArtifactVersion" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "artifactKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "path" TEXT,
  "sourceRevision" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'CURRENT',
  "supersedesId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiArtifactVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiContextSnapshotArtifact" (
  "snapshotId" TEXT NOT NULL,
  "artifactId" TEXT NOT NULL,
  CONSTRAINT "AiContextSnapshotArtifact_pkey" PRIMARY KEY ("snapshotId", "artifactId")
);

CREATE UNIQUE INDEX "AiArtifactVersion_submissionId_artifactKey_sourceRevision_contentHash_key"
  ON "AiArtifactVersion"("submissionId", "artifactKey", "sourceRevision", "contentHash");
CREATE INDEX "AiArtifactVersion_submissionId_status_type_idx"
  ON "AiArtifactVersion"("submissionId", "status", "type");
CREATE INDEX "AiArtifactVersion_submissionId_sourceRevision_idx"
  ON "AiArtifactVersion"("submissionId", "sourceRevision");

ALTER TABLE "AiArtifactVersion"
  ADD CONSTRAINT "AiArtifactVersion_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContextSnapshotArtifact"
  ADD CONSTRAINT "AiContextSnapshotArtifact_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "AiContextSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContextSnapshotArtifact"
  ADD CONSTRAINT "AiContextSnapshotArtifact_artifactId_fkey"
  FOREIGN KEY ("artifactId") REFERENCES "AiArtifactVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Chat plaintext becomes nullable. Existing rows are encrypted by the application
-- startup migration after the deployment key is available.
ALTER TABLE "AiChatSession"
  ADD COLUMN "titleCiphertext" TEXT,
  ADD COLUMN "titleIv" TEXT,
  ADD COLUMN "titleAuthTag" TEXT,
  ADD COLUMN "encryptedDek" TEXT,
  ADD COLUMN "dekIv" TEXT,
  ADD COLUMN "dekAuthTag" TEXT,
  ADD COLUMN "encryptionVersion" TEXT;

ALTER TABLE "AiChatMessage"
  ALTER COLUMN "content" DROP NOT NULL,
  ADD COLUMN "contentCiphertext" TEXT,
  ADD COLUMN "contentIv" TEXT,
  ADD COLUMN "contentAuthTag" TEXT,
  ADD COLUMN "encryptionVersion" TEXT;

ALTER TABLE "User"
  ADD COLUMN "accessTokenCiphertext" TEXT,
  ADD COLUMN "accessTokenIv" TEXT,
  ADD COLUMN "accessTokenAuthTag" TEXT,
  ADD COLUMN "accessTokenKeyVersion" TEXT;

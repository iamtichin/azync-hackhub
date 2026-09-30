-- Provisioning is recoverable: record external-repository state, invitation
-- outcomes and visibility so retries can reconcile rather than create again.
ALTER TABLE "GitHubRepository"
  ADD COLUMN "provisioningStatus" TEXT NOT NULL DEFAULT 'READY',
  ADD COLUMN "provisioningError" TEXT,
  ADD COLUMN "collaborators" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "WinnerAward" (
    "id" TEXT NOT NULL,
    "hackathonId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "selectedById" TEXT NOT NULL,
    "recipientAddress" TEXT NOT NULL,
    "decisionSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'selected',
    "signature" TEXT,
    "nftAssetId" TEXT,
    "merkleTree" TEXT,
    "leafIndex" BIGINT,
    "credentialHash" TEXT,
    "metadataUri" TEXT,
    "metadataDataHash" TEXT,
    "metadataCreator" TEXT,
    "assetOwner" TEXT,
    "network" TEXT NOT NULL DEFAULT 'devnet',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "mintAttemptId" TEXT,
    "mintLeaseExpiresAt" TIMESTAMP(3),
    "lastValidBlockHeight" BIGINT,
    "slot" BIGINT,
    "errorMessage" TEXT,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WinnerAward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WinnerAward_hackathonId_key" ON "WinnerAward"("hackathonId");
CREATE UNIQUE INDEX "WinnerAward_submissionId_key" ON "WinnerAward"("submissionId");
CREATE UNIQUE INDEX "WinnerAward_signature_key" ON "WinnerAward"("signature");
CREATE UNIQUE INDEX "WinnerAward_credentialHash_key" ON "WinnerAward"("credentialHash");
CREATE INDEX "WinnerAward_selectedById_idx" ON "WinnerAward"("selectedById");
CREATE INDEX "WinnerAward_status_idx" ON "WinnerAward"("status");

ALTER TABLE "WinnerAward" ADD CONSTRAINT "WinnerAward_hackathonId_fkey" FOREIGN KEY ("hackathonId") REFERENCES "Hackathon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WinnerAward" ADD CONSTRAINT "WinnerAward_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WinnerAward" ADD CONSTRAINT "WinnerAward_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

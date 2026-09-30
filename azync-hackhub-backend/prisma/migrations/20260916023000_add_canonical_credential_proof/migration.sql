ALTER TABLE "SolanaTransaction"
ADD COLUMN "merkleTree" TEXT,
ADD COLUMN "leafIndex" BIGINT,
ADD COLUMN "credentialHash" TEXT,
ADD COLUMN "metadataUri" TEXT,
ADD COLUMN "metadataDataHash" TEXT,
ADD COLUMN "assetOwner" TEXT;

CREATE INDEX "SolanaTransaction_credentialHash_idx" ON "SolanaTransaction"("credentialHash");

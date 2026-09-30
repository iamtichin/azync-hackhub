-- Durable JWT deny-list: logout must remain effective across application instances.
CREATE TABLE "RevokedSession" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RevokedSession_jti_key" ON "RevokedSession"("jti");
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
CREATE INDEX "RevokedSession_userId_idx" ON "RevokedSession"("userId");

ALTER TABLE "RevokedSession"
  ADD CONSTRAINT "RevokedSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

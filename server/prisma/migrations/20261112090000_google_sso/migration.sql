-- Comptes Google (pas de mot de passe) et codes d'autorisation du SSO interne.
ALTER TABLE "Student" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "Student" ADD COLUMN "googleId" TEXT;
CREATE UNIQUE INDEX "Student_googleId_key" ON "Student"("googleId");

CREATE TABLE "SsoCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "challenge" TEXT,
    "nonce" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SsoCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SsoCode_codeHash_key" ON "SsoCode"("codeHash");
CREATE INDEX "SsoCode_expiresAt_idx" ON "SsoCode"("expiresAt");

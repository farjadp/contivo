-- Social sign-in (spec 2026-11-22-social-login-design.md §8, §14 H3). Facebook is out of v1.
-- Additive only: one enum, two new tables, one FK to users (ON DELETE CASCADE).
-- No existing table, column or index is altered or dropped.
--
-- Rollback (loses every linked social identity; users keep their accounts, but
-- OAuth-only users, who have no password, could no longer sign in):
--   DROP TABLE "oauth_accounts";
--   DROP TABLE "oauth_tx_used";
--   DROP TYPE "OAuthProvider";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261123090000_oauth_accounts';

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('GOOGLE', 'GITHUB');

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_tx_used" (
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_tx_used_pkey" PRIMARY KEY ("jti")
);

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key" ON "oauth_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_userId_provider_key" ON "oauth_accounts"("userId", "provider");

-- CreateIndex
CREATE INDEX "oauth_tx_used_expiresAt_idx" ON "oauth_tx_used"("expiresAt");

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

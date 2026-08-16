-- CreateEnum
CREATE TYPE "SiteConnectionStatus" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "slug" TEXT;

-- CreateTable
CREATE TABLE "site_connections" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "status" "SiteConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "revalidateUrl" TEXT,
    "revalidateSecret" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "lastRevalidateAt" TIMESTAMP(3),
    "lastRevalidateStatus" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "site_connections_keyHash_key" ON "site_connections"("keyHash");

-- CreateIndex
CREATE INDEX "site_connections_workspaceId_idx" ON "site_connections"("workspaceId");

-- CreateIndex
CREATE INDEX "site_connections_userId_idx" ON "site_connections"("userId");

-- CreateIndex
CREATE INDEX "content_items_workspaceId_status_publishedAtUtc_idx" ON "content_items"("workspaceId", "status", "publishedAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "content_items_workspaceId_slug_key" ON "content_items"("workspaceId", "slug");

-- AddForeignKey
ALTER TABLE "site_connections" ADD CONSTRAINT "site_connections_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


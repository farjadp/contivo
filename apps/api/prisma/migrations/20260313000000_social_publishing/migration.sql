-- social_publishing migration
-- Creates SocialConnection, SocialPublishJob, SocialPublishLog tables
-- along with enums: SocialPlatform, SocialConnectionStatus, SocialPublishStatus
-- and updates ContentStatus enum with new variants.

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('LINKEDIN', 'X', 'FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM ('CONNECTED', 'EXPIRED', 'REVOKED', 'FAILED', 'PENDING_REAUTH');

-- CreateEnum
CREATE TYPE "SocialPublishStatus" AS ENUM ('DRAFT', 'READY', 'SCHEDULED', 'PUBLISH_QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- AlterEnum: Add new variants to ContentStatus
ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'READY';
ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED';
ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'PUBLISHING';
ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'PUBLISHED';
ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- AlterTable: Add new columns to content_items
ALTER TABLE "content_items"
  ADD COLUMN IF NOT EXISTS "scheduledAtUtc"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduledTimezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS "publishedAtUtc"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failedReason"     TEXT,
  ADD COLUMN IF NOT EXISTS "campaign"         TEXT,
  ADD COLUMN IF NOT EXISTS "notes"            TEXT;

-- CreateTable: SocialConnection
CREATE TABLE IF NOT EXISTS "social_connections" (
    "id"                      TEXT NOT NULL,
    "workspaceId"             TEXT NOT NULL,
    "platform"                "SocialPlatform" NOT NULL,
    "authProvider"            TEXT NOT NULL DEFAULT 'oauth2',
    "accountName"             TEXT NOT NULL,
    "accountIdentifier"       TEXT NOT NULL,
    "encryptedAccessTokenRef" TEXT,
    "encryptedRefreshTokenRef" TEXT,
    "tokenExpiresAt"          TIMESTAMP(3),
    "scopesJson"              JSONB NOT NULL DEFAULT '[]',
    "status"                  "SocialConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "isDefault"               BOOLEAN NOT NULL DEFAULT false,
    "lastSyncAt"              TIMESTAMP(3),
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on social_connections
CREATE INDEX IF NOT EXISTS "social_connections_workspaceId_idx" ON "social_connections"("workspaceId");
CREATE INDEX IF NOT EXISTS "social_connections_workspaceId_platform_idx" ON "social_connections"("workspaceId", "platform");

-- AddForeignKey: social_connections → workspaces
ALTER TABLE "social_connections"
  ADD CONSTRAINT "social_connections_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: SocialPublishJob
CREATE TABLE IF NOT EXISTS "social_publish_jobs" (
    "id"                  TEXT NOT NULL,
    "workspaceId"         TEXT NOT NULL,
    "contentItemId"       TEXT,
    "socialConnectionId"  TEXT NOT NULL,
    "platform"            "SocialPlatform" NOT NULL,
    "status"              "SocialPublishStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAtUtc"      TIMESTAMP(3),
    "timezone"            TEXT NOT NULL DEFAULT 'UTC',
    "publishedAtUtc"      TIMESTAMP(3),
    "externalPostId"      TEXT,
    "externalPostUrl"     TEXT,
    "lastError"           TEXT,
    "retryCount"          INTEGER NOT NULL DEFAULT 0,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_publish_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on social_publish_jobs
CREATE INDEX IF NOT EXISTS "social_publish_jobs_workspaceId_idx" ON "social_publish_jobs"("workspaceId");
CREATE INDEX IF NOT EXISTS "social_publish_jobs_workspaceId_status_idx" ON "social_publish_jobs"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "social_publish_jobs_socialConnectionId_idx" ON "social_publish_jobs"("socialConnectionId");

-- AddForeignKey: social_publish_jobs → workspaces
ALTER TABLE "social_publish_jobs"
  ADD CONSTRAINT "social_publish_jobs_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: social_publish_jobs → social_connections
ALTER TABLE "social_publish_jobs"
  ADD CONSTRAINT "social_publish_jobs_socialConnectionId_fkey"
  FOREIGN KEY ("socialConnectionId") REFERENCES "social_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: SocialPublishLog
CREATE TABLE IF NOT EXISTS "social_publish_logs" (
    "id"              TEXT NOT NULL,
    "publishJobId"    TEXT NOT NULL,
    "action"          TEXT NOT NULL,
    "status"          TEXT NOT NULL,
    "requestSummary"  TEXT,
    "responseSummary" TEXT,
    "errorMessage"    TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_publish_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex on social_publish_logs
CREATE INDEX IF NOT EXISTS "social_publish_logs_publishJobId_idx" ON "social_publish_logs"("publishJobId");

-- AddForeignKey: social_publish_logs → social_publish_jobs
ALTER TABLE "social_publish_logs"
  ADD CONSTRAINT "social_publish_logs_publishJobId_fkey"
  FOREIGN KEY ("publishJobId") REFERENCES "social_publish_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

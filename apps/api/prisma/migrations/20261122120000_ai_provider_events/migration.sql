-- AI provider failover (spec 2026-11-22-ai-provider-failover-design.md).
-- Additive only: one new table with three indexes, one column with a constant
-- default (metadata-only on Postgres 11+, no table rewrite).
-- workspaceId/userId are plain columns, no FK (same as ai_usage_logs.workspaceId).
--
-- Rollback (loses failover events and every user's review toggle):
--   DROP TABLE "ai_provider_events";
--   ALTER TABLE "autopilot_policies" DROP COLUMN "requireReview";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261122120000_ai_provider_events';

-- AlterTable
ALTER TABLE "autopilot_policies" ADD COLUMN     "requireReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_provider_events" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "errorClass" TEXT NOT NULL,
    "status" INTEGER,
    "message" TEXT,
    "failedOverTo" TEXT,
    "eventType" TEXT NOT NULL DEFAULT 'attempt_failed',
    "workspaceId" TEXT,
    "userId" TEXT,

    CONSTRAINT "ai_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_events_provider_createdAt_idx" ON "ai_provider_events"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "ai_provider_events_createdAt_idx" ON "ai_provider_events"("createdAt");

-- CreateIndex
CREATE INDEX "ai_provider_events_errorClass_createdAt_idx" ON "ai_provider_events"("errorClass", "createdAt");

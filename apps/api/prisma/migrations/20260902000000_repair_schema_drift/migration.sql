-- Repair: make the migration history describe the real schema again.
--
-- The schema had been moved forward with `prisma db push` for months, so the
-- migrations folder stopped being a faithful record of it. Replaying every
-- migration onto an empty database produced a schema missing ten tables
-- (strategic_reports, the three keyword/SERP tables, and the six that page
-- code had been creating at runtime with CREATE TABLE IF NOT EXISTS), plus a
-- set of columns, enum values, indexes and foreign keys. Any fresh
-- environment built from migrations — CI, a new region, a restored branch —
-- would have come up subtly wrong, and `migrate deploy` was unusable.
--
-- This migration is the difference, generated with `prisma migrate diff` and
-- verified by replaying the whole folder onto an empty shadow database and
-- diffing the result against schema.prisma.
--
-- Existing databases (local and production) already contain everything below,
-- because db push put it there. They are baselined with
-- `prisma migrate resolve --applied 20260902000000_repair_schema_drift`
-- rather than running this file.
--
-- Note for anyone replaying this on a database with data: the ContentStatus
-- enum is recreated without the unused EXPORTED variant, so rows still
-- holding EXPORTED would have to be migrated first. There are none.

-- AlterEnum
BEGIN;
CREATE TYPE "ContentStatus_new" AS ENUM ('DRAFT', 'GENERATED', 'EDITED', 'READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'ARCHIVED');
ALTER TABLE "content_items" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "content_items" ALTER COLUMN "status" TYPE "ContentStatus_new" USING ("status"::text::"ContentStatus_new");
ALTER TYPE "ContentStatus" RENAME TO "ContentStatus_old";
ALTER TYPE "ContentStatus_new" RENAME TO "ContentStatus";
DROP TYPE "ContentStatus_old";
ALTER TABLE "content_items" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- AlterEnum
ALTER TYPE "SocialPlatform" ADD VALUE 'TIKTOK';

-- DropForeignKey
ALTER TABLE "social_publish_jobs" DROP CONSTRAINT "social_publish_jobs_socialConnectionId_fkey";

-- DropForeignKey
ALTER TABLE "social_publish_jobs" DROP CONSTRAINT "social_publish_jobs_workspaceId_fkey";

-- DropIndex
DROP INDEX "autopilot_policies_workspaceId_key";

-- AlterTable
ALTER TABLE "autopilot_policies" ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Autopilot',
ADD COLUMN     "recipeKey" TEXT;

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "agentId" TEXT,
ALTER COLUMN "scheduledTimezone" DROP NOT NULL,
ALTER COLUMN "scheduledTimezone" DROP DEFAULT;

-- AlterTable
ALTER TABLE "social_connections" ALTER COLUMN "scopesJson" DROP NOT NULL,
ALTER COLUMN "scopesJson" DROP DEFAULT,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "social_publish_jobs" ALTER COLUMN "timezone" DROP NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "strategic_reports" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "docxPath" TEXT NOT NULL,
    "pdfPath" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileSize" INTEGER NOT NULL,
    "sectionsIncluded" JSONB NOT NULL,
    "competitorsCount" INTEGER NOT NULL,
    "keywordsAnalyzed" INTEGER NOT NULL,
    "chartsGenerated" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategic_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_keywords" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "competitorDomain" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER NOT NULL DEFAULT 0,
    "difficulty" INTEGER NOT NULL DEFAULT 0,
    "competition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rankingPosition" INTEGER,
    "rankingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keyword_opportunities" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "searchVolume" INTEGER NOT NULL DEFAULT 0,
    "competition" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opportunityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sourceCompetitor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "keyword_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "serp_analyses" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "rawResults" JSONB NOT NULL,
    "analysis" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "serp_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "action" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user_controls" (
    "user_id" TEXT NOT NULL,
    "access_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "suspended_at" TIMESTAMPTZ(6),
    "suspended_reason" TEXT,
    "reactivated_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_controls_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "admin_workspace_controls" (
    "workspace_id" TEXT NOT NULL,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "archived_reason" TEXT,
    "restored_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_workspace_controls_pkey" PRIMARY KEY ("workspace_id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "competitor_discovery_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "run_number" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "discovered_count" INTEGER NOT NULL DEFAULT 0,
    "competitors_snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_framework_metadata" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "content_item_id" TEXT,
    "event_name" TEXT NOT NULL,
    "framework_id" TEXT NOT NULL,
    "framework_name" TEXT NOT NULL,
    "framework_category" TEXT NOT NULL,
    "selection_mode" TEXT NOT NULL DEFAULT 'auto',
    "selection_reason" TEXT,
    "goal" TEXT,
    "platform" TEXT,
    "funnel_stage" TEXT,
    "quality_scores" JSONB,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "fallback_framework_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_framework_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "strategic_reports_workspaceId_idx" ON "strategic_reports"("workspaceId");

-- CreateIndex
CREATE INDEX "strategic_reports_userId_idx" ON "strategic_reports"("userId");

-- CreateIndex
CREATE INDEX "strategic_reports_reportDate_idx" ON "strategic_reports"("reportDate");

-- CreateIndex
CREATE INDEX "competitor_keywords_workspaceId_idx" ON "competitor_keywords"("workspaceId");

-- CreateIndex
CREATE INDEX "competitor_keywords_workspaceId_competitorDomain_idx" ON "competitor_keywords"("workspaceId", "competitorDomain");

-- CreateIndex
CREATE INDEX "keyword_opportunities_workspaceId_idx" ON "keyword_opportunities"("workspaceId");

-- CreateIndex
CREATE INDEX "keyword_opportunities_workspaceId_opportunityScore_idx" ON "keyword_opportunities"("workspaceId", "opportunityScore");

-- CreateIndex
CREATE INDEX "serp_analyses_workspaceId_idx" ON "serp_analyses"("workspaceId");

-- CreateIndex
CREATE INDEX "serp_analyses_workspaceId_keyword_idx" ON "serp_analyses"("workspaceId", "keyword");

-- CreateIndex
CREATE INDEX "idx_activity_logs_user_created" ON "activity_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_activity_logs_workspace_created" ON "activity_logs"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_admin_user_controls_status" ON "admin_user_controls"("access_status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_admin_workspace_controls_archived" ON "admin_workspace_controls"("is_archived", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "idx_comp_discovery_user_created" ON "competitor_discovery_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_comp_discovery_workspace_created" ON "competitor_discovery_runs"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "competitor_discovery_runs_workspace_id_run_number_key" ON "competitor_discovery_runs"("workspace_id", "run_number");

-- CreateIndex
CREATE INDEX "idx_framework_metadata_content_item_created" ON "content_framework_metadata"("content_item_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_framework_metadata_created" ON "content_framework_metadata"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_framework_metadata_framework_created" ON "content_framework_metadata"("framework_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_framework_metadata_workspace_created" ON "content_framework_metadata"("workspace_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "autopilot_policies_workspaceId_idx" ON "autopilot_policies"("workspaceId");

-- CreateIndex
CREATE INDEX "content_items_agentId_idx" ON "content_items"("agentId");

-- CreateIndex
CREATE INDEX "social_publish_jobs_scheduledAtUtc_status_idx" ON "social_publish_jobs"("scheduledAtUtc", "status");

-- AddForeignKey
ALTER TABLE "strategic_reports" ADD CONSTRAINT "strategic_reports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_keywords" ADD CONSTRAINT "competitor_keywords_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keyword_opportunities" ADD CONSTRAINT "keyword_opportunities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "serp_analyses" ADD CONSTRAINT "serp_analyses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "autopilot_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_publish_jobs" ADD CONSTRAINT "social_publish_jobs_socialConnectionId_fkey" FOREIGN KEY ("socialConnectionId") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


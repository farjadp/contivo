-- Funnel + AI-cost tracking. Additive only: nullable columns without
-- defaults (no table rewrite), two DROP NOT NULLs (metadata-only), two indexes.
--
-- Rollback (only safe while no row has userId/estimatedCostUsd NULL):
--   DROP INDEX "users_cohort_idx";
--   DROP INDEX "ai_usage_logs_workspaceId_idx";
--   ALTER TABLE "users" DROP COLUMN "cohort", DROP COLUMN "lastSeenAt";
--   ALTER TABLE "ai_usage_logs" DROP COLUMN "provider", DROP COLUMN "workspaceId";
--   -- restoring NOT NULL requires deleting/backfilling NULL rows first:
--   ALTER TABLE "ai_usage_logs" ALTER COLUMN "userId" SET NOT NULL,
--     ALTER COLUMN "estimatedCostUsd" SET NOT NULL;
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261121120000_funnel_tracking';

-- AlterTable
ALTER TABLE "ai_usage_logs" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "workspaceId" TEXT,
ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "estimatedCostUsd" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cohort" TEXT,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ai_usage_logs_workspaceId_idx" ON "ai_usage_logs"("workspaceId");

-- CreateIndex
CREATE INDEX "users_cohort_idx" ON "users"("cohort");


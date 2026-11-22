-- B8 quality gate on manually generated drafts (spec 2026-11-22-manual-quality-gate-design.md).
-- Additive only: one nullable JSONB column, no default, no backfill, no index
-- (metadata-only on Postgres, no table rewrite). Null = never gated; legacy
-- rows and customer-written posts keep behaving as before.
--
-- Rollback (loses every stored quality verdict):
--   ALTER TABLE "content_items" DROP COLUMN "qualityVerdict";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261122180000_content_quality_verdict';

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "qualityVerdict" JSONB;

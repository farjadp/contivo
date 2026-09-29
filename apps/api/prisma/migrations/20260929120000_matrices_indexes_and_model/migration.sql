-- Positioning matrices follow-up (final review of the matrices rebuild).
--
-- Generated, not hand-typed, the same way 20260929000000_positioning_matrices
-- was: `prisma migrate diff --from-migrations prisma/migrations
-- --to-schema-datamodel prisma/schema.prisma --shadow-database-url
-- <throwaway-db> --script`. The diff proposed nothing touching the three
-- hand-written indexes (discovery_runs_one_active_per_workspace,
-- matrix_runs_one_active_per_workspace, and the NULLS NOT DISTINCT
-- matrix_overrides_workspaceId_chartKey_competitorId_key); any future
-- generated migration that drops or re-creates them must be edited by hand.
--
-- 1. Indexes on the two foreign keys Postgres does not index on its own:
--    matrix_charts.runId (charts of a run) and matrix_scores.chartId (scores
--    of a chart). Both are read on every projection rebuild.
-- 2. matrix_runs.model: the OpenAI model the run used (spec §6.7).

-- AlterTable
ALTER TABLE "matrix_runs" ADD COLUMN     "model" TEXT;

-- CreateIndex
CREATE INDEX "matrix_charts_runId_idx" ON "matrix_charts"("runId");

-- CreateIndex
CREATE INDEX "matrix_scores_chartId_idx" ON "matrix_scores"("chartId");


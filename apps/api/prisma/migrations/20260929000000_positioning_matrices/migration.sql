-- Positioning matrices rebuild (see .superpowers/sdd/2026-09-29-positioning-matrices).
--
-- The table/column DDL is generated, not hand-typed, the same way
-- 20260927000000_competitor_discovery was: `prisma migrate diff
-- --from-migrations prisma/migrations --to-schema-datamodel
-- prisma/schema.prisma --shadow-database-url <throwaway-db> --script`.
--
-- Two indexes at the end are written by hand because schema.prisma cannot
-- express them:
--   1. matrix_runs_one_active_per_workspace: a partial unique index, at most
--      one PENDING/RUNNING MatrixRun per workspace (Prisma has no partial
--      index syntax).
--   2. matrix_overrides_workspaceId_chartKey_competitorId_key is re-created
--      with NULLS NOT DISTINCT (Postgres 15+). A TARGET override has
--      competitorId NULL, and the default NULLs-are-distinct behaviour would
--      let two of them coexist. The generated CREATE UNIQUE INDEX above is
--      dropped and replaced.

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "matrixAxes" JSONB;

-- CreateTable
CREATE TABLE "matrix_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "basis" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "competitorSet" JSONB NOT NULL,
    "axesUsed" JSONB,
    "axisCandidates" JSONB,
    "crossChart" JSONB,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "matrix_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matrix_charts" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "xLabel" TEXT NOT NULL,
    "yLabel" TEXT NOT NULL,
    "marketPattern" TEXT NOT NULL,
    "opportunity" TEXT NOT NULL,
    "contentAngles" JSONB NOT NULL,
    "whiteSpace" JSONB,

    CONSTRAINT "matrix_charts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matrix_scores" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "competitorId" TEXT,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "xScore" INTEGER NOT NULL,
    "yScore" INTEGER NOT NULL,
    "xReason" TEXT NOT NULL,
    "yReason" TEXT NOT NULL,
    "evidenceRefs" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "matrix_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matrix_overrides" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "chartKey" TEXT NOT NULL,
    "competitorId" TEXT,
    "xScore" INTEGER,
    "yScore" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matrix_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matrix_runs_workspaceId_startedAt_idx" ON "matrix_runs"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "matrix_charts_workspaceId_key_idx" ON "matrix_charts"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "matrix_overrides_workspaceId_chartKey_competitorId_key" ON "matrix_overrides"("workspaceId", "chartKey", "competitorId");

-- AddForeignKey
ALTER TABLE "matrix_runs" ADD CONSTRAINT "matrix_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matrix_charts" ADD CONSTRAINT "matrix_charts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "matrix_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matrix_scores" ADD CONSTRAINT "matrix_scores_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "matrix_charts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matrix_overrides" ADD CONSTRAINT "matrix_overrides_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One PENDING/RUNNING matrix run per workspace (schema.prisma cannot express it).
CREATE UNIQUE INDEX IF NOT EXISTS "matrix_runs_one_active_per_workspace"
ON "matrix_runs" ("workspaceId")
WHERE "status" IN ('PENDING', 'RUNNING');

-- A TARGET override has competitorId NULL; NULLs must collide here.
DROP INDEX IF EXISTS "matrix_overrides_workspaceId_chartKey_competitorId_key";
CREATE UNIQUE INDEX "matrix_overrides_workspaceId_chartKey_competitorId_key"
ON "matrix_overrides" ("workspaceId", "chartKey", "competitorId") NULLS NOT DISTINCT;

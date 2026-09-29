-- Competitor discovery rebuild (see .superpowers/sdd/2026-09-26-competitor-discovery).
--
-- Like 20260923000000_content_language before it, this repairs a gap the
-- same way that one described: the schema had already moved forward with
-- `prisma db push` (this repo's normal local-dev workflow — see the
-- dev-quirks memory) by the time this migration was written, so there is no
-- migration on disk for the `workspaces.targetCountry`/`targetLanguage`
-- columns, the eight new `competitors` columns, or the `discovery_runs`
-- table. Production runs `prisma migrate deploy`, never `db push` — without
-- this file, deploying this branch would 500 every query that touches
-- `discovery_runs`, because the table the code expects would not exist
-- there at all.
--
-- The table/column DDL below is generated, not hand-typed, exactly the way
-- 20260902000000_repair_schema_drift's own comment recommends for this
-- situation: `prisma migrate diff --from-migrations prisma/migrations
-- --to-schema-datamodel prisma/schema.prisma --shadow-database-url
-- <throwaway-db> --script`, run against a disposable shadow database and
-- diffed against schema.prisma so it matches what `db push` already put on
-- every existing database exactly. Verified directly against this repo's
-- local dev database's real `\d competitors` / `\d workspaces` output
-- before being committed here — see the fix-round report.
--
-- Two things generated DDL alone cannot capture, added by hand:
--   1. The `targetCountry`/`targetLanguage` backfill, translated line for
--      line from `backfill-target-market.ts` (FA -> IR/fa, only where
--      `targetCountry IS NULL`, so a workspace that already has its own
--      target market — or was already promoted by this same statement on a
--      database this migration runs the DDL on for real — is never
--      touched). The standalone script still exists for a database that
--      already has these columns (from `db push`) but was never promoted;
--      this migration's copy is what makes a *fresh* database (one that
--      runs this file for real, not baselined onto it) end up in the same
--      state a `db push` + `backfill-target-market.ts` database would.
--   2. `discovery_runs_one_active_per_workspace`, a partial unique index
--      (`UNIQUE ... WHERE status IN (...)`) enforcing "at most one
--      PENDING/RUNNING DiscoveryRun per workspace". Prisma's schema
--      language has no partial-index syntax, so this can never appear in a
--      generated diff or as a `db push` change — see
--      `add-discovery-run-active-constraint.ts`'s own comment for the full
--      reasoning. That script remains for a database (like this repo's
--      local one) that already has the table from `db push` but not yet
--      this index; this migration is what gives it to a fresh database too.
--
-- This repo's local database already has every column and table below (put
-- there by `db push` while this feature was being built) and the partial
-- index (added by `add-discovery-run-active-constraint.ts`, already run —
-- see the fix-round report). Applying this file's DDL there again would be
-- redundant at best and would error on the already-existing objects at
-- worst, so it is baselined instead:
--   npx prisma migrate resolve --applied 20260926000000_competitor_discovery
-- exactly as 20260902000000_repair_schema_drift's own comment describes for
-- "existing databases (local and production) already contain everything
-- below, because db push put it there".

-- AlterTable
ALTER TABLE "competitors" ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "discoveryRunId" TEXT,
ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "keyFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "positioning" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "sources" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "targetCountry" TEXT,
ADD COLUMN     "targetLanguage" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "discovery_runs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stage" TEXT,
    "market" JSONB NOT NULL,
    "queries" JSONB,
    "sourceStats" JSONB,
    "savedCount" INTEGER NOT NULL DEFAULT 0,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_runs_workspaceId_startedAt_idx" ON "discovery_runs"("workspaceId", "startedAt");

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: backfill targetCountry/targetLanguage from contentLanguage
-- (mirrors backfill-target-market.ts exactly — FA -> IR/fa, only where
-- targetCountry IS NULL, so a workspace that already chose its own target
-- market, or was already promoted, is never overwritten).
UPDATE "workspaces"
SET "targetCountry" = 'IR', "targetLanguage" = 'fa'
WHERE "targetCountry" IS NULL AND "contentLanguage" = 'FA';

-- CreateIndex: at most one PENDING/RUNNING DiscoveryRun per workspace.
-- A plain `@@unique` cannot express the `WHERE status IN (...)` qualifier,
-- so this is raw SQL rather than anything `schema.prisma` can declare.
-- `startCompetitorDiscovery` (apps/web/src/app/actions/growth-competitors.ts)
-- already checks for an active run before creating one, but that is a
-- check-then-act race under concurrency; this index is the actual
-- guarantee, and that action catches the resulting P2002.
CREATE UNIQUE INDEX IF NOT EXISTS "discovery_runs_one_active_per_workspace"
ON "discovery_runs" ("workspaceId")
WHERE "status" IN ('PENDING', 'RUNNING');

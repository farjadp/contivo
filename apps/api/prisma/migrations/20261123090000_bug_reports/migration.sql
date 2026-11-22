-- In-app bug reports (spec 2026-11-22-bug-reports-design.md, section 4).
-- Additive only: one new table, three indexes, two nullable foreign keys.
-- No existing table is altered. userId/workspaceId are ON DELETE SET NULL, so
-- deleting a user or workspace never fails and never removes the report; app
-- code clears message/context on user deletion and a retention purge deletes
-- old rows (see spec).
--
-- Rollback (loses every stored bug report):
--   DROP TABLE "bug_reports";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261123090000_bug_reports';

-- CreateTable
CREATE TABLE "bug_reports" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceId" TEXT,
    "message" TEXT,
    "locale" TEXT,
    "route" TEXT,
    "appVersion" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bug_reports_referenceCode_key" ON "bug_reports"("referenceCode");

-- CreateIndex
CREATE INDEX "bug_reports_status_createdAt_idx" ON "bug_reports"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "bug_reports_fingerprint_idx" ON "bug_reports"("fingerprint");

-- CreateIndex
CREATE INDEX "bug_reports_userId_idx" ON "bug_reports"("userId");

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

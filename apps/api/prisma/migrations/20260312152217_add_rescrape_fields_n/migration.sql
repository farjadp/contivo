-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN     "archivedSummaries" JSONB,
ADD COLUMN     "rescrapeCount" INTEGER NOT NULL DEFAULT 0;

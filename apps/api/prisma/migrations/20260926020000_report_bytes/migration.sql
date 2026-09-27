-- Keep strategy reports out of the public directory (Mission Control: "Strategy
-- reports are world-readable in /public/reports").
--
-- Additive and nullable. Existing rows keep their `pdfPath` and read exactly as
-- before; only reports generated after this carry their bytes here, and those
-- are served through an authenticated route instead of as static files.

-- AlterTable
ALTER TABLE "strategic_reports" ADD COLUMN     "pdfData" BYTEA,
ADD COLUMN     "htmlData" BYTEA;

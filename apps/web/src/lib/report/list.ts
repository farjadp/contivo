import type { Prisma } from '@prisma/client';

/**
 * The columns a report list shows. `pdfData` and `htmlData` are left out on
 * purpose: each report is ~650 KB, and listing twenty of them shipped all of
 * it to the browser on every workspace page. The file itself is served by
 * /api/reports/[id].
 */
export const REPORT_LIST_SELECT = {
  id: true,
  workspaceId: true,
  userId: true,
  docxPath: true,
  pdfPath: true,
  reportDate: true,
  fileSize: true,
  sectionsIncluded: true,
  competitorsCount: true,
  keywordsAnalyzed: true,
  chartsGenerated: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StrategicReportSelect;

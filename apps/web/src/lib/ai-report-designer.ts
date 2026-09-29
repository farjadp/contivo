/**
 * ai-report-designer.ts
 *
 * Builds the strategic report document.
 *
 * This used to ask a model for a complete styled HTML page and print whatever
 * came back. That made the model responsible for layout, colour, page breaks
 * and chart geometry, none of which it can do consistently: the charts came
 * out with every company stacked in the middle under overlapping labels, the
 * palette was the red system the product retired, and a malformed response
 * meant no report at all.
 *
 * Now the document is rendered from a template in `lib/report/` and the model
 * only writes prose. The normalisers below survive from the old file because
 * the DB's snake_case shapes are still what has to be read.
 */

import { DEFAULT_CONTENT_LANGUAGE, type ContentLanguage } from '@/lib/content-language';
import { generateNarrative } from '@/lib/report/narrative';
import { renderReportDocument } from '@/lib/report/template';
import type { ScatterChart } from '@/lib/report/scatter';

export interface ReportWorkspaceData {
  companyName: string;
  websiteUrl: string | null;
  /** Identifies this run; printed on the cover as a human-readable reference. */
  reportId: string;
  generatedAt: Date;
  brandSummary: any;
  competitors: any[];
  matrices: any;
  keywords: any;
  offerings: any;
  language?: ContentLanguage;
}

/**
 * The DB stores `chart_name`, `axes.x/y`, `x_score/y_score` and `website` (there is no `domain`). Earlier code
 * read `chart.name`, `chart.xAxis` and `c.x`, which were all undefined and put
 * the word "undefined" into finished PDFs.
 */
function normaliseMatrices(matrices: any): ScatterChart[] {
  return (matrices?.charts ?? []).map((chart: any) => ({
    chartName: chart.chart_name ?? '',
    xAxis: chart.axes?.x ?? 'X',
    yAxis: chart.axes?.y ?? 'Y',
    companies: (chart.companies ?? []).map((c: any) => ({
      name: c.name ?? '',
      type: c.type ?? 'DIRECT',
      domain: c.website,
      xScore: Number(c.x_score),
      yScore: Number(c.y_score),
    })),
  }));
}

/** The DB field is `primary_keywords`, not `primaryKeywords`. */
function normaliseKeywords(keywords: any) {
  return (keywords?.competitors ?? []).slice(0, 6).map((c: any) => ({
    name: c.competitor ?? '',
    domain: c.domain,
    primaryKeywords: Array.isArray(c.primary_keywords) ? c.primary_keywords : [],
    secondaryKeywords: Array.isArray(c.secondary_keywords) ? c.secondary_keywords : [],
    contentStrategyGoal: c.content_strategy?.main_goal,
  }));
}

/**
 * Returns a complete, self-contained HTML document. It carries its own
 * stylesheet, so the copy saved to disk is readable on its own — the previous
 * version relied on a Tailwind CDN script injected during PDF conversion, and
 * the saved `.html` opened with no styling at all.
 */
export async function generateReportHTML(data: ReportWorkspaceData): Promise<string> {
  const language = data.language ?? DEFAULT_CONTENT_LANGUAGE;
  const matrices = normaliseMatrices(data.matrices);
  const keywords = normaliseKeywords(data.keywords);
  const contentGaps = (data.keywords?.content_gaps ?? []).slice(0, 4);
  const offerings = (data.offerings?.client_offerings?.offerings ?? [])
    .slice(0, 6)
    .map((o: any) => ({ name: o.name ?? '', description: o.description, pricing: o.pricing }));

  const { narrative, degraded } = await generateNarrative({
    companyName: data.companyName,
    language,
    brandSummary: data.brandSummary,
    matrices,
    keywords,
    contentGaps,
    offerings,
  });

  if (degraded) {
    console.warn('[ai-report-designer] rendering report without model commentary');
  }

  return renderReportDocument({
    reportId: data.reportId,
    generatedAt: data.generatedAt,
    language,
    companyName: data.companyName,
    websiteUrl: data.websiteUrl,
    brandSummary: data.brandSummary,
    matrices,
    competitors: (data.competitors ?? []).map((c: any) => ({
      name: c.name ?? '',
      domain: c.domain ?? null,
      type: c.type ?? null,
    })),
    keywords,
    contentGaps,
    offerings,
    narrative,
    degraded,
  });
}

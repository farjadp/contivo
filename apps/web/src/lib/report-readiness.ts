/**
 * What a strategic report still needs before it can be generated.
 *
 * The same four conditions were written out twice — once in the server action
 * that generates the report and once in the workspace page that decides
 * whether to offer the button — as English sentences pushed into an array.
 * Two copies of one rule drift, and these had already started to: the list is
 * shown to the reader, so every edit had to be made in both places or the
 * button and the explanation would disagree.
 *
 * They are codes rather than sentences for the same reason the setup warnings
 * are: the list crosses from the server to a display component, and a sentence
 * would arrive in whichever language the producer happened to be running in.
 */

export const REPORT_REQUIREMENTS = [
  'brandMemory',
  'marketMatrices',
  'competitorKeywords',
  'productsServices',
] as const;

export type ReportRequirement = (typeof REPORT_REQUIREMENTS)[number];

/** How many positioning charts a report needs before it has a market frame. */
export const REQUIRED_MATRIX_CHARTS = 5;

/**
 * The single definition of "not ready yet". Both callers pass the workspace's
 * raw `brandSummary` and `audienceInsights`, so neither can apply a slightly
 * different version of the rule.
 */
export function missingReportRequirements(
  brandSummary: unknown,
  insights: any,
): ReportRequirement[] {
  const missing: ReportRequirement[] = [];

  if (!brandSummary) missing.push('brandMemory');

  // DB key: competitiveMatrices.charts (array)
  const charts = insights?.competitiveMatrices?.charts;
  if (!Array.isArray(charts) || charts.length < REQUIRED_MATRIX_CHARTS) {
    missing.push('marketMatrices');
  }

  // DB key: competitorKeywordsIntel.competitors (array)
  if (!insights?.competitorKeywordsIntel?.competitors?.length) {
    missing.push('competitorKeywords');
  }

  // DB key: productsServicesIntel.client_offerings.offerings (array).
  // snake_case on purpose — the model returns client_offerings, not clientOfferings.
  if (!insights?.productsServicesIntel?.client_offerings?.offerings?.length) {
    missing.push('productsServices');
  }

  return missing;
}

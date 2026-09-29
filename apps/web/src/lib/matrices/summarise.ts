import type { AxisDefinition, MatrixLanguage } from './axes';
import { MatrixAiError, callStructured } from './openai';
import { LANGUAGE_NAME, type ScoredCompany } from './score-chart';
import { describeBand, type WhiteSpace } from './white-space';

/**
 * The words under each chart. The white-space cell is computed by the caller
 * and handed in; the model is asked to put that cell into words, never to find
 * a gap of its own.
 */

const MAX_ANGLES = 3;

export type ChartSummary = {
  marketPattern: string;
  opportunity: string;
  contentAngles: Array<{ angle: string; audienceSegment: string }>;
};

export type CrossChartSummary = {
  crossChartSummary: string;
  strongestDifferentiation: string;
  targetAudienceSegment: string;
};

export const CHART_SUMMARY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['market_pattern', 'opportunity', 'content_angles'],
  properties: {
    market_pattern: { type: 'string' },
    opportunity: { type: 'string' },
    content_angles: {
      type: 'array',
      maxItems: MAX_ANGLES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['angle', 'audience_segment'],
        properties: {
          angle: { type: 'string' },
          audience_segment: { type: 'string' },
        },
      },
    },
  },
} as const satisfies Record<string, unknown>;

export const CROSS_CHART_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cross_chart_summary', 'strongest_differentiation', 'target_audience_segment'],
  properties: {
    cross_chart_summary: { type: 'string' },
    strongest_differentiation: { type: 'string' },
    target_audience_segment: { type: 'string' },
  },
} as const satisfies Record<string, unknown>;

/** Plain words for the open cell, e.g. "Breadth of offer: low One thing; Specialisation: high Niche expert". */
export function describeWhiteSpace(axis: AxisDefinition, whiteSpace: WhiteSpace | null): string | null {
  if (!whiteSpace) return null;
  const x = `${axis.x.label}: ${describeBand(whiteSpace.xBand, axis.x.low, axis.x.high)}`;
  const y = `${axis.y.label}: ${describeBand(whiteSpace.yBand, axis.y.low, axis.y.high)}`;
  return `${x}; ${y}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function describeScored(s: ScoredCompany): string {
  const role = s.type === 'TARGET' ? 'TARGET (the company we are writing for)' : s.type;
  return `- ${s.name} [${role}] x=${s.xScore} y=${s.yScore}. X: ${s.xReason || 'no reason given'} Y: ${s.yReason || 'no reason given'}`;
}

/** An opportunity shorter than this is a label, not the one or two sentences asked for (spec §15 E3). */
export const MIN_OPPORTUNITY_WORDS = 8;

function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

/**
 * Why an opportunity is not acceptable prose, or null when it is: under
 * MIN_OPPORTUNITY_WORDS words, or nothing but the white-space cell's own
 * coordinates handed back.
 */
export function opportunityProblem(opportunity: string, gap: string | null): string | null {
  if (wordCount(opportunity) < MIN_OPPORTUNITY_WORDS) {
    return `chart summary opportunity is under ${MIN_OPPORTUNITY_WORDS} words`;
  }
  if (gap && opportunity.trim().toLowerCase() === gap.trim().toLowerCase()) {
    return 'chart summary opportunity only repeats the white-space cell';
  }
  return null;
}

/** Known counts summed; null only when no call reported one. */
function sumTokens(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

async function requestChartSummary(
  axis: AxisDefinition,
  scores: ScoredCompany[],
  gap: string | null,
  language: MatrixLanguage,
): Promise<{ summary: ChartSummary; tokens: number | null }> {
  const system = [
    'You turn one positioning chart into content strategy. Use only the scores and reasons given; do not invent companies or facts.',
    `X axis: ${axis.x.label}. 1 = ${axis.x.low}. 10 = ${axis.x.high}.`,
    `Y axis: ${axis.y.label}. 1 = ${axis.y.low}. 10 = ${axis.y.high}.`,
    'market_pattern: one or two sentences on where the competitors cluster and where the target stands relative to them.',
    gap
      ? `The open space near the target has already been computed: ${gap}. opportunity must be one or two full sentences about that cell, using those axis terms: say why it is open (which competitors sit where, from the scores given) and what the target could claim there. Do not just repeat the cell's coordinates. Do not name a different gap.`
      : 'No open space near the target was found. opportunity must be one or two full sentences that say plainly that no clear gap exists near the target and why (where the competitors crowd it, from the scores given), and must not invent one.',
    `content_angles: at most ${MAX_ANGLES}. Each is a content angle the target could own on this chart, with the audience segment it speaks to.`,
    `Write every field in ${LANGUAGE_NAME[language]}.`,
  ].join('\n');
  const user = [
    `Chart: ${axis.name}`,
    gap ? `Open space near the target: ${gap}` : 'Open space near the target: none (no clear gap)',
    '',
    'Companies:',
    ...scores.map(describeScored),
  ].join('\n');

  const { data, tokens } = await callStructured<{
    market_pattern?: unknown;
    opportunity?: unknown;
    content_angles?: unknown;
  }>({ name: 'chart_summary', schema: CHART_SUMMARY_SCHEMA, system, user });

  const marketPattern = clean(data?.market_pattern);
  const opportunity = clean(data?.opportunity);
  if (!marketPattern) throw new MatrixAiError('chart summary returned an empty market pattern', tokens);
  if (!opportunity) throw new MatrixAiError('chart summary returned an empty opportunity', tokens);

  const contentAngles = (Array.isArray(data?.content_angles) ? data.content_angles : [])
    .filter(isRecord)
    .map((a) => ({ angle: clean(a.angle), audienceSegment: clean(a.audience_segment) }))
    .filter((a) => a.angle && a.audienceSegment)
    .slice(0, MAX_ANGLES);

  return { summary: { marketPattern, opportunity, contentAngles }, tokens };
}

/**
 * One chart's summary. An opportunity that is not real prose gets exactly one
 * retry of the whole chart summary; a second miss fails with the tokens of
 * both calls, so the run's spend stays a true floor.
 */
export async function summariseChart(
  axis: AxisDefinition,
  scores: ScoredCompany[],
  whiteSpace: WhiteSpace | null,
  language: MatrixLanguage,
): Promise<{ summary: ChartSummary; tokens: number | null }> {
  const gap = describeWhiteSpace(axis, whiteSpace);

  const first = await requestChartSummary(axis, scores, gap, language);
  if (!opportunityProblem(first.summary.opportunity, gap)) return first;

  let second: { summary: ChartSummary; tokens: number | null };
  try {
    second = await requestChartSummary(axis, scores, gap, language);
  } catch (error) {
    if (error instanceof MatrixAiError) throw new MatrixAiError(error.message, sumTokens(first.tokens, error.tokens));
    throw error;
  }
  const tokens = sumTokens(first.tokens, second.tokens);
  const problem = opportunityProblem(second.summary.opportunity, gap);
  if (problem) throw new MatrixAiError(problem, tokens);
  return { summary: second.summary, tokens };
}

export async function summariseAcrossCharts(
  charts: Array<{ axis: AxisDefinition; summary: ChartSummary }>,
  language: MatrixLanguage,
): Promise<{ summary: CrossChartSummary; tokens: number | null }> {
  const system = [
    'You read the summaries of several positioning charts for one company and say what they add up to. Use only what the summaries say.',
    'cross_chart_summary: two or three sentences on the picture across all charts.',
    'strongest_differentiation: the one way the target stands apart most clearly.',
    'target_audience_segment: the audience that differentiation speaks to best.',
    `Write every field in ${LANGUAGE_NAME[language]}.`,
  ].join('\n');
  const user = charts
    .map(({ axis, summary }) =>
      [
        `## ${axis.name}`,
        `Pattern: ${summary.marketPattern}`,
        `Opportunity: ${summary.opportunity}`,
        ...summary.contentAngles.map((a) => `Angle: ${a.angle} (for ${a.audienceSegment})`),
      ].join('\n'),
    )
    .join('\n\n');

  const { data, tokens } = await callStructured<{
    cross_chart_summary?: unknown;
    strongest_differentiation?: unknown;
    target_audience_segment?: unknown;
  }>({ name: 'cross_chart_summary', schema: CROSS_CHART_SCHEMA, system, user });

  const summary: CrossChartSummary = {
    crossChartSummary: clean(data?.cross_chart_summary),
    strongestDifferentiation: clean(data?.strongest_differentiation),
    targetAudienceSegment: clean(data?.target_audience_segment),
  };
  for (const [field, value] of Object.entries(summary)) {
    if (!value) throw new MatrixAiError(`cross-chart summary returned an empty ${field}`, tokens);
  }
  return { summary, tokens };
}

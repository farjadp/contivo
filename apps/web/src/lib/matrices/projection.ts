import { confidenceBand } from './scoring';
import { findWhiteSpace, type WhiteSpace } from './white-space';
import type { ChartKind, CompanyType, MatrixOverride, MatrixScore } from './types';

/**
 * Turning stored rows back into the payload every reader already understands.
 *
 * The matrices live in three tables (run, charts, scores) plus a separate
 * override layer, but content ideation, the narrative writer, the strategic
 * report, report-readiness and workspace progress all read one JSON blob on
 * the workspace. This builds that blob. The tables are the truth; the blob is
 * a cache, rebuilt after every run and after every single override.
 *
 * Two rules this file enforces, both learned the hard way:
 *
 * 1. **A manual correction outlives a regeneration.** The old flow wrote the
 *    user's edits into the same field the model writes, so the next "generate"
 *    silently erased every correction they had made. Overrides are a separate
 *    layer applied on top, and the AI's own number is kept alongside so the
 *    chart can show both.
 * 2. **An override for a competitor that no longer exists is ignored, not
 *    applied and not deleted.** Deleting would lose the user's judgement if
 *    the competitor comes back; applying would put a ghost on the chart.
 */

export type ProjectedEvidence = { id: string; url: string; title: string };

export type ProjectedCompany = {
  /** The competitor row this point is, null for the target. What an override is addressed by. */
  competitor_id: string | null;
  name: string;
  website: string;
  type: CompanyType;
  x_score: number;
  y_score: number;
  x_reason: string;
  y_reason: string;
  confidence_score: number;
  confidence_band: 'high' | 'medium' | 'low';
  estimated: boolean;
  /** Cited evidence that still exists, in cited order. */
  evidence: ProjectedEvidence[];
  /** True when the point cited evidence and none of it is available any more. */
  evidence_missing: boolean;
  /** Present only when the user moved this point. */
  override?: { ai_x_score: number; ai_y_score: number; note: string | null };
};

export type ProjectedChart = {
  chart_key: string;
  chart_kind: ChartKind;
  chart_name: string;
  axes: { x: string; y: string };
  companies: ProjectedCompany[];
  summary: { market_pattern: string; positioning_opportunity: string };
  content_angles: Array<{ angle: string; audience_segment: string }>;
  white_space: WhiteSpace | null;
};

export type ProjectionInput = {
  runId: string;
  generatedAt: string;
  /** What the run was allowed to build on; mirrored for the "unconfirmed" label. */
  competitorBasis: 'ACCEPTED' | 'UNCONFIRMED_HIGH';
  language: string;
  charts: Array<{
    key: string;
    kind: ChartKind;
    name: string;
    xLabel: string;
    yLabel: string;
    marketPattern: string;
    opportunity: string;
    contentAngles: Array<{ angle: string; audienceSegment: string }>;
    scores: Array<MatrixScore & { xReason: string; yReason: string; evidenceRefs: string[] }>;
  }>;
  overrides: MatrixOverride[];
  /** Evidence that exists right now, keyed by competitorId ('TARGET' for the target). */
  evidenceById: Record<string, ProjectedEvidence[]>;
  /** Competitor ids that exist right now, for staleness and orphan overrides. */
  liveCompetitorIds: string[];
  /** The competitor ids the run was built from. */
  runCompetitorIds: string[];
  crossChartSummary: string;
  strongestDifferentiation: string;
  targetAudienceSegment: string;
  /** Tokens the run spent; the old blob carried this and readers show it. */
  tokensUsed: number;
};

export type Projection = {
  generated_at: string;
  run_id: string;
  source: 'AI';
  competitor_basis: 'ACCEPTED' | 'UNCONFIRMED_HIGH';
  language: string;
  stale: boolean;
  charts: ProjectedChart[];
  cross_chart_summary: string;
  strongest_differentiation_opportunity: string;
  target_audience_segment: string;
  tokens_used: number;
};

function clampScore(value: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

function overrideKey(chartKey: string, competitorId: string | null): string {
  return `${chartKey}::${competitorId ?? 'TARGET'}`;
}

/**
 * True when the accepted competitor set has moved since the run. The charts
 * stay usable — a slightly old map beats no map — but the UI says so, because
 * a matrix missing the competitor the user just accepted looks like a bug.
 */
export function isStale(runCompetitorIds: string[], liveCompetitorIds: string[]): boolean {
  const run = new Set(runCompetitorIds);
  const live = new Set(liveCompetitorIds);
  if (run.size !== live.size) return true;
  for (const id of run) if (!live.has(id)) return true;
  return false;
}

export function buildProjection(input: ProjectionInput): Projection {
  const live = new Set(input.liveCompetitorIds);

  const overridesByKey = new Map<string, MatrixOverride>();
  for (const override of input.overrides) {
    // The target (null competitorId) always exists; a competitor's override
    // only counts while that competitor is still on the workspace.
    if (override.competitorId !== null && !live.has(override.competitorId)) continue;
    overridesByKey.set(overrideKey(override.chartKey, override.competitorId), override);
  }

  const charts: ProjectedChart[] = input.charts.map((chart) => {
    const companies: ProjectedCompany[] = chart.scores.map((score) => {
      const aiX = clampScore(score.xScore);
      const aiY = clampScore(score.yScore);
      const override = overridesByKey.get(overrideKey(chart.key, score.competitorId));

      const x = override?.xScore != null ? clampScore(override.xScore) : aiX;
      const y = override?.yScore != null ? clampScore(override.yScore) : aiY;
      const available = new Map((input.evidenceById[score.competitorId ?? 'TARGET'] ?? []).map((e) => [e.id, e]));
      const evidence: ProjectedEvidence[] = [];
      for (const ref of score.evidenceRefs) {
        const found = available.get(ref);
        if (found) evidence.push(found);
      }
      // Cited something, none of it survives: the claim is now unsupported.
      const evidenceMissing = score.evidenceRefs.length > 0 && evidence.length === 0;
      const moved = x !== aiX || y !== aiY;

      return {
        competitor_id: score.competitorId,
        name: score.name,
        website: score.domain ? `https://${score.domain}` : '',
        type: score.type,
        x_score: x,
        y_score: y,
        x_reason: score.xReason,
        y_reason: score.yReason,
        confidence_score: score.confidence,
        confidence_band: confidenceBand(score.confidence),
        estimated: score.estimated || evidenceMissing,
        evidence,
        evidence_missing: evidenceMissing,
        ...(override && moved
          ? { override: { ai_x_score: aiX, ai_y_score: aiY, note: override.note ?? null } }
          : {}),
      };
    });

    return {
      chart_key: chart.key,
      chart_kind: chart.kind,
      chart_name: chart.name,
      axes: { x: chart.xLabel, y: chart.yLabel },
      companies,
      summary: { market_pattern: chart.marketPattern, positioning_opportunity: chart.opportunity },
      content_angles: chart.contentAngles.map((item) => ({
        angle: item.angle,
        audience_segment: item.audienceSegment,
      })),
      // Recomputed from the *shown* positions, so a user who moves a point
      // sees the gap move with it rather than reading a stale claim.
      white_space: findWhiteSpace(
        companies.map((company) => ({
          competitorId: null,
          name: company.name,
          domain: company.website,
          type: company.type,
          xScore: company.x_score,
          yScore: company.y_score,
          confidence: company.confidence_score,
          estimated: company.estimated,
        })),
      ),
    };
  });

  return {
    generated_at: input.generatedAt,
    run_id: input.runId,
    source: 'AI',
    competitor_basis: input.competitorBasis,
    language: input.language,
    stale: isStale(input.runCompetitorIds, input.liveCompetitorIds),
    charts,
    cross_chart_summary: input.crossChartSummary,
    strongest_differentiation_opportunity: input.strongestDifferentiation,
    target_audience_segment: input.targetAudienceSegment,
    tokens_used: input.tokensUsed,
  };
}

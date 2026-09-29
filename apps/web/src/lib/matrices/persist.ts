import { prisma } from '@/lib/db';
import { selectCompetitors } from '@/lib/competitors/selection';

import { buildProjection, type Projection, type ProjectionInput } from './projection';
import type { ChartKind, CompanyType } from './types';

/**
 * Writes the projection blob from the tables. The tables are the truth; the
 * blob at `audienceInsights.competitiveMatrices` is a cache every existing
 * reader keeps using. Called after each run and after each override.
 */

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseCompetitorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    const id = asRecord(item).competitorId;
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

function parseAngles(value: unknown): Array<{ angle: string; audienceSegment: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item);
    return { angle: str(row.angle), audienceSegment: str(row.audienceSegment) };
  });
}

export async function rebuildMatricesProjection(workspaceId: string): Promise<Projection | null> {
  const run = await prisma.matrixRun.findFirst({
    where: { workspaceId, status: 'DONE' },
    orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
    include: { charts: { orderBy: { order: 'asc' }, include: { scores: true } } },
  });
  if (!run) return null;

  const [overrides, competitors] = await Promise.all([
    prisma.matrixOverride.findMany({ where: { workspaceId } }),
    prisma.competitor.findMany({ where: { workspaceId } }),
  ]);

  const cross = asRecord(run.crossChart);
  const input: ProjectionInput = {
    runId: run.id,
    generatedAt: (run.finishedAt ?? run.startedAt).toISOString(),
    competitorBasis: run.basis as 'ACCEPTED' | 'UNCONFIRMED_HIGH',
    language: run.language,
    charts: run.charts.map((chart) => ({
      key: chart.key,
      kind: chart.kind as ChartKind,
      name: chart.name,
      xLabel: chart.xLabel,
      yLabel: chart.yLabel,
      marketPattern: chart.marketPattern,
      opportunity: chart.opportunity,
      contentAngles: parseAngles(chart.contentAngles),
      scores: chart.scores.map((score) => ({
        competitorId: score.competitorId,
        name: score.name,
        domain: score.domain,
        type: score.type as CompanyType,
        xScore: score.xScore,
        yScore: score.yScore,
        xReason: score.xReason,
        yReason: score.yReason,
        confidence: score.confidence,
        estimated: score.estimated,
      })),
    })),
    overrides: overrides.map((row) => ({
      chartKey: row.chartKey,
      competitorId: row.competitorId,
      xScore: row.xScore,
      yScore: row.yScore,
      note: row.note,
    })),
    liveCompetitorIds: selectCompetitors(competitors).competitors.map((row) => row.id),
    runCompetitorIds: parseCompetitorIds(run.competitorSet),
    crossChartSummary: str(cross.crossChartSummary),
    strongestDifferentiation: str(cross.strongestDifferentiation),
    targetAudienceSegment: str(cross.targetAudienceSegment),
    tokensUsed: run.tokensUsed,
  };

  const projection = buildProjection(input);

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { audienceInsights: true } });
  const insights = asRecord(workspace?.audienceInsights);
  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { audienceInsights: { ...insights, competitiveMatrices: projection } as never },
  });

  return projection;
}

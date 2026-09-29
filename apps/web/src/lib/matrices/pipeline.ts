/**
 * The background run that turns a PENDING MatrixRun into charts.
 *
 * Mirrors `runDiscoveryPipeline`: claim PENDING -> RUNNING, every later write
 * guarded on the run still being RUNNING, one SAVE transaction whose first
 * statement is the guarded DONE write. It fails closed: any failure writes
 * nothing but the run's FAILED status, and the projection is not touched.
 *
 * See docs/superpowers/specs/2026-09-26-positioning-matrices-design.md §5 and §9.
 */
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { isStaleRun } from '@/lib/competitors/pipeline';
import { sanitizeUpstreamText } from '@/lib/competitors/redact';
import { RUN_ERROR, withRunErrorCode } from '@/lib/competitors/run-errors';
import { runWithConcurrency } from '@/lib/run-with-concurrency';

import { axesForRun, parseStoredMarketAxes, type AxisDefinition, type MatrixLanguage } from './axes';
import { buildEvidenceBundle, competitorEvidence, hasBrandSummary } from './bundle';
import { MATRIX_ENRICH_BUDGET_MS, enrichEvidenceLessCompetitors, mergeEvidence } from './enrich';
import { MatrixAiError } from './openai';
import { rebuildMatricesProjection } from './persist';
import { proposeMarketAxes } from './propose-axes';
import { applyCoreAgreement, scoreChart, type ScoredCompany } from './score-chart';
import { summariseAcrossCharts, summariseChart, type ChartSummary } from './summarise';
import { findWhiteSpace, type WhiteSpace } from './white-space';

/** A PENDING/RUNNING run older than this is presumed dead and reaped. NEEDS_AXES is never reaped. */
export const MATRIX_STALE_RUN_MINUTES = 10;
export const MATRIX_STAGES = ['AXES', 'SCORE', 'SUMMARISE', 'SAVE'] as const;
export const SCORE_CONCURRENCY = 3;

type Stage = (typeof MATRIX_STAGES)[number];

const SUMMARISE_CONCURRENCY = 3;
const MIN_COMPETITORS = 2;

/**
 * Thrown when a guarded write finds the run no longer RUNNING (reaped, or
 * finished by something else). The pipeline stops and writes nothing more.
 */
export class RunNoLongerActiveError extends Error {
  constructor(runId: string) {
    super(`Matrix run ${runId} is no longer RUNNING; stopping without further writes`);
    this.name = 'RunNoLongerActiveError';
  }
}

async function updateWhileRunning(runId: string, data: Prisma.MatrixRunUpdateManyMutationInput): Promise<void> {
  const { count } = await prisma.matrixRun.updateMany({ where: { id: runId, status: 'RUNNING' }, data });
  if (count === 0) throw new RunNoLongerActiveError(runId);
}

function setStage(runId: string, stage: Stage) {
  return updateWhileRunning(runId, { stage });
}

function loadRun(runId: string) {
  return prisma.matrixRun.findUnique({
    where: { id: runId },
    include: { workspace: { include: { competitors: true } } },
  });
}

type SnapshotEntry = { competitorId: string; type: string | null };

function parseCompetitorSet(value: unknown): SnapshotEntry[] {
  if (!Array.isArray(value)) return [];
  const out: SnapshotEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.competitorId !== 'string' || !record.competitorId) continue;
    out.push({ competitorId: record.competitorId, type: typeof record.type === 'string' ? record.type : null });
  }
  return out;
}

/** The stored snapshot with `skipped: true` on the given ids; every other field and entry as stored. */
function markSkipped(value: unknown, skippedIds: Set<string>): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    return typeof record.competitorId === 'string' && skippedIds.has(record.competitorId)
      ? { ...record, skipped: true }
      : record;
  });
}

/**
 * Sums every call's token count. A call whose count is unknown (`null`) adds
 * nothing, so the stored figure is the sum of the known ones: a floor. A
 * failed call that still reported its spend (`MatrixAiError.tokens`) counts.
 * (`TokenAccumulator` in the discovery pipeline is not exported; the column
 * here is a plain NOT NULL Int, so a running sum is all that is needed.)
 */
class TokenTally {
  total = 0;

  add(value: number | null | undefined): void {
    if (typeof value === 'number') this.total += value;
  }

  /** Runs one model call, counting its tokens whether it succeeds or fails with a MatrixAiError. */
  async track<T extends { tokens: number | null }>(call: () => Promise<T>): Promise<T> {
    try {
      const result = await call();
      this.add(result.tokens);
      return result;
    } catch (error) {
      if (error instanceof MatrixAiError) this.add(error.tokens);
      throw error;
    }
  }
}

export async function runMatrixPipeline(runId: string): Promise<void> {
  const tokens = new TokenTally();
  let run: Awaited<ReturnType<typeof loadRun>> | null = null;

  try {
    run = await loadRun(runId);
    if (!run) return;

    // Scoped to PENDING: a run the action already marked FAILED, or the
    // reaper timed out, or a second dispatch already claimed, is left alone.
    const claimed = await prisma.matrixRun.updateMany({
      where: { id: runId, status: 'PENDING' },
      data: { status: 'RUNNING' },
    });
    if (claimed.count === 0) return;

    const workspace = run.workspace;
    const storedCompetitorSet = run.competitorSet;
    // Snapshotted when the run was created; never re-read from the workspace.
    const language: MatrixLanguage = run.language === 'fa' ? 'fa' : 'en';

    // Exactly the snapshotted competitors that still exist, in snapshot order,
    // with the snapshot's type.
    const byId = new Map(workspace.competitors.map((c) => [c.id, c]));
    const competitors = parseCompetitorSet(run.competitorSet).flatMap((entry) => {
      const row = byId.get(entry.competitorId);
      if (!row) return [];
      return [
        {
          id: row.id,
          name: row.name,
          domain: row.domain,
          type: entry.type ?? row.type,
          positioning: row.positioning,
          keyFeatures: row.keyFeatures,
          labels: row.labels,
          evidence: row.evidence,
        },
      ];
    });
    if (competitors.length < MIN_COMPETITORS) throw new Error('not enough competitors');
    if (!hasBrandSummary(workspace.brandSummary)) throw new Error('no brand summary');

    // --- EVIDENCE (spec §15 E1/E2) ---------------------------------------
    // A competitor with nothing citable stored gets its own site read; one
    // that still has nothing afterwards is left out, never scored from air.
    const now = Date.now;
    const found = await enrichEvidenceLessCompetitors(competitors, {
      deadline: now() + MATRIX_ENRICH_BUDGET_MS,
      now,
    });
    const evidenceById = new Map<string, unknown>(competitors.map((c) => [c.id, c.evidence]));
    for (const [id, items] of found) evidenceById.set(id, mergeEvidence(evidenceById.get(id), items));
    const skippedIds = new Set(
      competitors.filter((c) => competitorEvidence(evidenceById.get(c.id)).length === 0).map((c) => c.id),
    );

    if (found.size > 0 || skippedIds.size > 0) {
      await prisma.$transaction(async (tx) => {
        // First statement is the guarded run write: a reaped run matches
        // nothing and no competitor's evidence is touched.
        const guarded = await tx.matrixRun.updateMany({
          where: { id: runId, status: 'RUNNING' },
          data: { competitorSet: markSkipped(storedCompetitorSet, skippedIds) as Prisma.InputJsonValue },
        });
        if (guarded.count === 0) throw new RunNoLongerActiveError(runId);

        for (const [id, items] of found) {
          // Re-read inside the transaction so a concurrent change to the
          // stored evidence is appended to, not overwritten.
          const row = await tx.competitor.findUnique({ where: { id }, select: { evidence: true } });
          if (!row) continue;
          const merged = mergeEvidence(row.evidence, items);
          await tx.competitor.update({
            where: { id },
            data: { evidence: merged as Prisma.InputJsonValue },
          });
          evidenceById.set(id, merged);
        }
      });
    }

    const usable = competitors
      .filter((c) => !skippedIds.has(c.id))
      .map((c) => ({ ...c, evidence: evidenceById.get(c.id) }));
    if (usable.length < MIN_COMPETITORS) {
      throw new Error(
        withRunErrorCode(
          RUN_ERROR.NOT_ENOUGH_EVIDENCE,
          `${usable.length} of ${competitors.length} competitors have evidence to score`,
        ),
      );
    }

    const bundle = buildEvidenceBundle({
      workspace: {
        name: workspace.name,
        websiteUrl: workspace.websiteUrl,
        brandSummary: workspace.brandSummary,
        audienceInsights: workspace.audienceInsights,
      },
      competitors: usable,
    });

    // --- AXES -----------------------------------------------------------
    await setStage(runId, 'AXES');
    const market = parseStoredMarketAxes(workspace.matrixAxes);
    if (market.length === 0) {
      const { candidates } = await tokens.track(() =>
        proposeMarketAxes(bundle, language, { brandName: workspace.name, targetCountry: workspace.targetCountry }),
      );
      await updateWhileRunning(runId, {
        status: 'NEEDS_AXES',
        axisCandidates: candidates as unknown as Prisma.InputJsonValue,
        tokensUsed: tokens.total,
        finishedAt: new Date(),
      });
      await writeActivityLog({
        userId: run.userId,
        workspaceId: workspace.id,
        action: 'MATRICES_AXES_PROPOSED',
        detail: { runId, candidates: candidates.length, tokens: tokens.total },
      });
      return;
    }

    // --- SCORE ----------------------------------------------------------
    await setStage(runId, 'SCORE');
    const axes: AxisDefinition[] = axesForRun(language, market);
    const rawScores = await runWithConcurrency(axes, SCORE_CONCURRENCY, async (axis) => {
      const { scores } = await tokens.track(() => scoreChart(bundle, axis, language));
      return scores;
    });
    // axesForRun puts the two core charts first.
    const [coreA, coreB] = applyCoreAgreement(rawScores[0], rawScores[1]);
    const scores: ScoredCompany[][] = [coreA, coreB, ...rawScores.slice(2)];

    // --- SUMMARISE ------------------------------------------------------
    await setStage(runId, 'SUMMARISE');
    const charts = await runWithConcurrency(
      axes,
      SUMMARISE_CONCURRENCY,
      async (axis, index): Promise<{ whiteSpace: WhiteSpace | null; summary: ChartSummary }> => {
        const whiteSpace = findWhiteSpace(scores[index]);
        const { summary } = await tokens.track(() => summariseChart(axis, scores[index], whiteSpace, language));
        return { whiteSpace, summary };
      },
    );
    const { summary: crossChart } = await tokens.track(() =>
      summariseAcrossCharts(
        axes.map((axis, index) => ({ axis, summary: charts[index].summary })),
        language,
      ),
    );

    // --- SAVE -----------------------------------------------------------
    await setStage(runId, 'SAVE');
    const tokensUsed = tokens.total;

    // First statement is the guarded DONE write: if the run was reaped, it
    // matches nothing and the transaction throws before a chart is written.
    await prisma.$transaction(async (tx) => {
      const finished = await tx.matrixRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: {
          status: 'DONE',
          axesUsed: axes.map((axis) => ({ key: axis.key, kind: axis.kind, x: axis.x, y: axis.y })),
          crossChart: crossChart as unknown as Prisma.InputJsonValue,
          tokensUsed,
          // The same default the model calls use (openai.ts); spec §6.7.
          model: process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1',
          finishedAt: new Date(),
        },
      });
      if (finished.count === 0) throw new RunNoLongerActiveError(runId);

      for (const [index, axis] of axes.entries()) {
        const { summary, whiteSpace } = charts[index];
        await tx.matrixChart.create({
          data: {
            runId,
            workspaceId: workspace.id,
            key: axis.key,
            kind: axis.kind,
            order: index,
            name: axis.name,
            xLabel: axis.x.label,
            yLabel: axis.y.label,
            marketPattern: summary.marketPattern,
            opportunity: summary.opportunity,
            contentAngles: summary.contentAngles,
            whiteSpace: whiteSpace ?? Prisma.JsonNull,
            scores: {
              create: scores[index].map((s) => ({
                competitorId: s.competitorId,
                name: s.name,
                domain: s.domain,
                type: s.type,
                xScore: s.xScore,
                yScore: s.yScore,
                xReason: s.xReason,
                yReason: s.yReason,
                evidenceRefs: s.evidenceRefs,
                confidence: s.confidence,
                estimated: s.estimated,
              })),
            },
          },
        });
      }
    });

    // The tables are the truth. A failed projection rebuild leaves the run DONE.
    try {
      await rebuildMatricesProjection(workspace.id);
    } catch (projectionError) {
      console.error('runMatrixPipeline: projection rebuild failed for run', runId, projectionError);
      await writeActivityLog({
        userId: run.userId,
        workspaceId: workspace.id,
        action: 'MATRICES_PROJECTION_FAILED',
        detail: {
          runId,
          error: sanitizeUpstreamText(
            projectionError instanceof Error ? projectionError.message : String(projectionError),
          ),
        },
      });
    }

    await writeActivityLog({
      userId: run.userId,
      workspaceId: workspace.id,
      action: 'MATRICES_GENERATED',
      detail: { runId, charts: axes.length, tokens: tokensUsed },
    });
  } catch (error) {
    if (error instanceof RunNoLongerActiveError) {
      console.warn('runMatrixPipeline:', error.message);
      return;
    }

    const message =
      sanitizeUpstreamText(error instanceof Error ? error.message : String(error)) ?? 'Matrix run failed';
    try {
      const failed = await prisma.matrixRun.updateMany({
        where: { id: runId, status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'FAILED', error: message, tokensUsed: tokens.total, finishedAt: new Date() },
      });
      if (run && failed.count > 0) {
        await writeActivityLog({
          userId: run.userId,
          workspaceId: run.workspace.id,
          action: 'MATRICES_RUN_FAILED',
          detail: { runId, error: message, tokens: tokens.total },
        });
      }
    } catch (writeError) {
      // Must never throw. The run stays RUNNING; the reaper will catch it.
      console.error('runMatrixPipeline: failed to record failure for run', runId, writeError);
    }
  }
}

/**
 * Marks this workspace's PENDING/RUNNING matrix runs older than
 * `MATRIX_STALE_RUN_MINUTES` as FAILED (`TIMED_OUT`). NEEDS_AXES is a
 * terminal pause and is never reaped.
 */
export async function reapStaleMatrixRuns(workspaceId: string): Promise<void> {
  const inFlight = await prisma.matrixRun.findMany({
    where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true, status: true, startedAt: true },
  });

  const now = new Date();
  const staleIds = inFlight.filter((run) => isStaleRun(run, now, MATRIX_STALE_RUN_MINUTES)).map((run) => run.id);
  if (staleIds.length === 0) return;

  // Guarded on status too: a run whose SAVE committed in between keeps its result.
  await prisma.matrixRun.updateMany({
    where: { id: { in: staleIds }, status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', error: RUN_ERROR.TIMED_OUT, finishedAt: now },
  });
}

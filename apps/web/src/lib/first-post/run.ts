/**
 * first-post/run.ts
 *
 * The one background run behind "Write my first post" (spec §3):
 * matrices (auto axes) → competitor keywords → one LinkedIn idea → a full
 * preview draft through the existing quality gate, saved as a GENERATED
 * pipeline item. Started by /api/first-post/run with nothing but the run id.
 *
 * Rules:
 * - Every step calls the same function the manual UI calls. No gate is
 *   changed or bypassed: ideation still runs loadIdeationContext (matricesGate
 *   + keywords check) itself.
 * - A step already satisfied is SKIPPED (retry = a new run), with the stored
 *   summary, so the view shows real results.
 * - An "other angle" run (kind 'otherAngle') runs idea + draft only, steering
 *   away from the topics of earlier first-post drafts.
 * - Run rows are awaited (they are the state). A failure writes one
 *   STEP_FAILED with a closed errorKind; raw errors stay in the server log.
 * - 0 credits: nothing here charges (spec D8).
 */
import type { Workspace } from '@prisma/client';

import { generateCompetitorKeywordsCore, type KeywordsErrorKey } from '@/lib/competitor-keywords/generate';
import { classifyRunError } from '@/lib/competitors/run-errors';
import { selectCompetitors } from '@/lib/competitors/selection';
import { generateDraftPreviewCore, ideateForWorkspace, saveIdeaToPipelineCore } from '@/lib/content-engine';
import { prisma } from '@/lib/db';
import { parseRunCompetitorIds, snapshotCompetitorIds } from '@/lib/matrices/competitor-set';
import { runMatrixPipeline } from '@/lib/matrices/pipeline';
import { isStale } from '@/lib/matrices/projection';
import { createMatrixRunRow } from '@/lib/matrices/start-run';
import { matricesGate } from '@/lib/report-readiness';

import { claimRun, readRunRows, readRunStarted, writeStepRow, type RunKind } from './run-log';
import {
  FIRST_POST_RUN_FINISHED,
  type FirstPostErrorKind,
  type FirstPostStep,
  type StepSummary,
} from './types';

/** Market axes a first-post matrices run picks by itself (spec D4: 2 core + 2 market = 4 charts). */
export const FIRST_POST_AUTO_AXES = 2;

type Actor = { userId: string; workspaceId: string };
type RunCtx = { runId: string; actor: Actor };

/** Thrown inside a step to stop the run with a closed errorKind. */
class StepFailure extends Error {
  constructor(readonly errorKind: FirstPostErrorKind) {
    super(errorKind);
    this.name = 'StepFailure';
  }
}

const asRecord = (value: unknown): Record<string, any> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : null;

function insightsOf(workspace: Pick<Workspace, 'audienceInsights'>): Record<string, any> {
  return asRecord(workspace.audienceInsights) ?? {};
}

/** `{ charts, competitors }` from the stored projection only. */
export function matricesSummary(matrices: unknown): StepSummary {
  const m = asRecord(matrices);
  const charts = Array.isArray(m?.charts) ? m.charts : [];
  const summary: StepSummary = { charts: charts.length };
  const ids = new Set<string>();
  for (const chart of charts) {
    for (const company of Array.isArray(chart?.companies) ? chart.companies : []) {
      if (typeof company?.competitor_id === 'string' && company.competitor_id) ids.add(company.competitor_id);
    }
  }
  if (ids.size > 0) summary.competitors = ids.size;
  return summary;
}

/** `{ competitors, gaps, topGap }` from the stored keywords only; topGap is content_gaps[0].topic. */
export function keywordsSummary(intel: unknown): StepSummary {
  const k = asRecord(intel);
  const competitors = Array.isArray(k?.competitors) ? k.competitors.length : 0;
  const gaps = Array.isArray(k?.content_gaps) ? k.content_gaps : [];
  const summary: StepSummary = { competitors, gaps: gaps.length };
  const topGap = typeof gaps[0]?.topic === 'string' ? gaps[0].topic.trim() : '';
  if (topGap) summary.topGap = topGap;
  return summary;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function keywordsErrorKind(key: KeywordsErrorKey): FirstPostErrorKind {
  if (key === 'notEnoughCompetitorSignals') return 'notEnoughCompetitorSignals';
  if (key === 'keywordsAiFailed') return 'aiUnavailable';
  return 'generic';
}

function matrixErrorKind(error: string | null): FirstPostErrorKind {
  const kind = classifyRunError(error);
  return kind === 'timedOut' || kind === 'dispatch' || kind === 'notEnoughEvidence' || kind === 'aiUnavailable'
    ? kind
    : 'generic';
}

async function loadOwnedWorkspace(actor: Actor) {
  return prisma.workspace.findFirst({ where: { id: actor.workspaceId, userId: actor.userId } });
}

/** Same staleness rule as getMatrixStatus (growth-matrices.ts): latest DONE run's set vs the live selection. */
async function matricesAreStale(workspaceId: string): Promise<boolean> {
  const [latestDone, rows] = await Promise.all([
    prisma.matrixRun.findFirst({
      where: { workspaceId, status: 'DONE' },
      orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
      select: { competitorSet: true },
    }),
    prisma.competitor.findMany({ where: { workspaceId } }),
  ]);
  if (!latestDone) return false;
  const { competitors } = selectCompetitors(rows);
  return isStale(parseRunCompetitorIds(latestDone.competitorSet), snapshotCompetitorIds(competitors.map((c) => c.id)));
}

async function done(ctx: RunCtx, step: FirstPostStep, startedAt: number, summary: StepSummary) {
  await writeStepRow({
    ...ctx.actor,
    action: 'FIRST_POST_STEP_DONE',
    detail: { runId: ctx.runId, step, ms: Date.now() - startedAt, summary },
  });
}

async function skipped(ctx: RunCtx, step: FirstPostStep, summary: StepSummary) {
  await writeStepRow({ ...ctx.actor, action: 'FIRST_POST_STEP_SKIPPED', detail: { runId: ctx.runId, step, summary } });
}

/** Step 1. Skipped when matricesGate is ok and the competitor set has not moved. */
async function matricesStep(ctx: RunCtx, workspace: Workspace): Promise<void> {
  const stored = insightsOf(workspace).competitiveMatrices;
  if (matricesGate(stored).ok && !(await matricesAreStale(workspace.id))) {
    await skipped(ctx, 'matrices', matricesSummary(stored));
    return;
  }

  const startedAt = Date.now();
  const created = await createMatrixRunRow({ userId: ctx.actor.userId, workspace });
  if (!created.ok) {
    console.warn('runFirstPost: matrix run not created', ctx.runId, created.errorKey);
    throw new StepFailure('generic');
  }
  // In process, not a second HTTP hop. Never throws: a failure is the run's FAILED status.
  await runMatrixPipeline(created.runId, { autoAxes: FIRST_POST_AUTO_AXES });

  const matrixRun = await prisma.matrixRun.findUnique({
    where: { id: created.runId },
    select: { status: true, error: true },
  });
  if (matrixRun?.status === 'FAILED') throw new StepFailure(matrixErrorKind(matrixRun.error));
  if (matrixRun?.status !== 'DONE') throw new StepFailure('generic');

  const reread = await loadOwnedWorkspace(ctx.actor);
  const matrices = reread ? insightsOf(reread).competitiveMatrices : null;
  // 0 usable proposed axes leaves 2 core charts: below the gate, said honestly.
  if (!matricesGate(matrices).ok) throw new StepFailure('notEnoughAxes');
  await done(ctx, 'matrices', startedAt, matricesSummary(matrices));
}

/** Step 2. Skipped when the workspace already has competitor keywords. */
async function keywordsStep(ctx: RunCtx, workspace: Workspace): Promise<void> {
  const stored = insightsOf(workspace).competitorKeywordsIntel;
  if (Array.isArray(stored?.competitors) && stored.competitors.length > 0) {
    await skipped(ctx, 'keywords', keywordsSummary(stored));
    return;
  }
  const startedAt = Date.now();
  const result = await generateCompetitorKeywordsCore(ctx.actor);
  if (!result.ok) throw new StepFailure(keywordsErrorKind(result.errorKey));
  await done(ctx, 'keywords', startedAt, keywordsSummary(result.payload));
}

function steeringNotesFor(avoidTopics: string[]): string | null {
  const topics = [...new Set(avoidTopics.map((t) => t.trim()).filter(Boolean))];
  if (topics.length === 0) return null;
  return [
    'Write about a clearly different topic and angle from these earlier drafts:',
    ...topics.map((t) => `- ${t.slice(0, 200)}`),
  ].join('\n');
}

/**
 * Steps 3 and 4: one LinkedIn idea, then the full preview through the quality
 * gate, saved as a GENERATED pipeline item with its verdict. Writes the step
 * rows and RUN_FINISHED; throws StepFailure on a failed step.
 */
export async function runIdeaAndDraft(ctx: RunCtx, avoidTopics: string[]): Promise<void> {
  const { actor } = ctx;
  let step: FirstPostStep = 'idea';
  try {
    const ideaStartedAt = Date.now();
    const steeringNotes = steeringNotesFor(avoidTopics);
    const ideation = await ideateForWorkspace(actor, {
      platform: 'linkedin',
      requestedIdeaCount: 1,
      selectionMode: 'auto',
      includeImages: false,
      autoInsertToCalendar: false,
      ...(steeringNotes ? { steeringNotes } : {}),
    });
    if ('error' in ideation) {
      console.warn('runFirstPost: ideation failed', ctx.runId, ideation.error);
      throw new StepFailure('generic');
    }
    const idea = ideation.ideas[0];
    if (!idea?.topic) throw new StepFailure('generic');
    await done(ctx, 'idea', ideaStartedAt, { topic: idea.topic });

    step = 'draft';
    const draftStartedAt = Date.now();
    const preview = await generateDraftPreviewCore(actor, idea);
    if ('error' in preview || !preview.preview) {
      const error = 'error' in preview ? preview.error : 'empty preview';
      console.warn('runFirstPost: preview failed', ctx.runId, error);
      // Null body from the provider chain = no AI answered.
      throw new StepFailure(error === 'AI generation failed' ? 'aiUnavailable' : 'generic');
    }
    const saved = await saveIdeaToPipelineCore(
      actor,
      { ...idea, auto_insert_to_calendar: false },
      { body: preview.preview, verdictToken: preview.verdictToken },
    );
    if ('error' in saved || !saved.id) {
      console.warn('runFirstPost: save failed', ctx.runId, 'error' in saved ? saved.error : 'no id');
      throw new StepFailure('generic');
    }
    const approved = preview.verdict.approved === true;
    await done(ctx, 'draft', draftStartedAt, { words: countWords(preview.preview), approved: approved ? 1 : 0 });
    await writeStepRow({
      ...actor,
      action: FIRST_POST_RUN_FINISHED,
      detail: { runId: ctx.runId, contentItemId: saved.id, approved },
    });
  } catch (error) {
    if (error instanceof StepFailure) throw Object.assign(error, { step });
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { step });
  }
}

/** Topics of the content items earlier first-post runs finished with (for "other angle"). */
async function previousTopics(actor: Actor): Promise<string[]> {
  const rows = await readRunRows(actor.workspaceId);
  const ids = rows
    .filter((r) => r.action === FIRST_POST_RUN_FINISHED)
    .map((r) => asRecord(r.detail)?.contentItemId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return [];
  const items = await prisma.contentItem.findMany({
    where: { id: { in: ids }, workspaceId: actor.workspaceId, userId: actor.userId },
    select: { topic: true },
  });
  return items.map((item) => item.topic);
}

function firstStepOf(kind: RunKind): FirstPostStep {
  return kind === 'otherAngle' ? 'idea' : 'matrices';
}

export async function runFirstPost(runId: string): Promise<void> {
  const started = await readRunStarted(runId);
  if (!started) return;
  const actor: Actor = { userId: started.userId, workspaceId: started.workspaceId };
  const ctx: RunCtx = { runId: started.runId, actor };
  if (!(await claimRun({ runId: started.runId, ...actor }))) return;

  let step: FirstPostStep = firstStepOf(started.kind);
  try {
    const workspace = await loadOwnedWorkspace(actor);
    if (!workspace) throw new StepFailure('generic');

    if (started.kind === 'otherAngle') {
      // The draft already exists, so both are satisfied; ideation's own gate re-checks.
      const insights = insightsOf(workspace);
      await skipped(ctx, 'matrices', matricesSummary(insights.competitiveMatrices));
      await skipped(ctx, 'keywords', keywordsSummary(insights.competitorKeywordsIntel));
      await runIdeaAndDraft(ctx, await previousTopics(actor));
      return;
    }

    step = 'matrices';
    await matricesStep(ctx, workspace);
    step = 'keywords';
    // Re-read: the matrices step may have rewritten audienceInsights.
    await keywordsStep(ctx, (await loadOwnedWorkspace(actor)) ?? workspace);
    step = 'idea';
    await runIdeaAndDraft(ctx, []);
  } catch (error) {
    const failedStep = (error as { step?: FirstPostStep } | null)?.step ?? step;
    const errorKind: FirstPostErrorKind = error instanceof StepFailure ? error.errorKind : 'generic';
    if (!(error instanceof StepFailure)) console.error('runFirstPost: step threw', runId, failedStep, error);
    try {
      await writeStepRow({ ...actor, action: 'FIRST_POST_STEP_FAILED', detail: { runId, step: failedStep, errorKind } });
    } catch (writeError) {
      // Must never throw. With no terminal row the state turns timedOut after FIRST_POST_STALE_MS.
      console.error('runFirstPost: failed to record failure for run', runId, writeError);
    }
  }
}

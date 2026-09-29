'use server';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { writeActivityLog } from '@/lib/activity-log';
import { actionError } from '@/lib/action-errors';
import { triggerBackgroundRun } from '@/lib/background-run';
import { classifyRunError, RUN_ERROR, withRunErrorCode } from '@/lib/competitors/run-errors';
import { selectCompetitors, type SelectionBasis } from '@/lib/competitors/selection';
import {
  languageFromContent,
  normaliseMarketAxes,
  parseStoredMarketAxes,
  type StoredMarketAxis,
} from '@/lib/matrices/axes';
import { hasBrandSummary } from '@/lib/matrices/bundle';
import { parseRunCompetitorIds, snapshotCompetitorIds, snapshotCompetitors } from '@/lib/matrices/competitor-set';
import { rebuildMatricesProjection } from '@/lib/matrices/persist';
import { reapStaleMatrixRuns } from '@/lib/matrices/pipeline';
import { isStale } from '@/lib/matrices/projection';

export type MatrixRunView = {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'NEEDS_AXES' | 'DONE' | 'FAILED';
  stage: string | null;
  tokensUsed: number;
  errorKind: 'timedOut' | 'dispatch' | 'generic' | null;
  axisCandidates: StoredMarketAxis[];
  startedAt: string;
  finishedAt: string | null;
};

export type MatrixStatus = {
  run: MatrixRunView | null;
  savedAxes: StoredMarketAxis[];
  basis: SelectionBasis;
  competitorCount: number;
  hasBrandSummary: boolean;
  /**
   * Whether the competitor set has moved since the latest DONE run, compared
   * now (spec §4: on read), not when the blob was last written. False when
   * there is no DONE run.
   */
  stale: boolean;
  matrices: unknown;
};

/** A proposal offers four market axes; the chooser keeps three. */
const MAX_AXIS_CANDIDATES = 4;
const MAX_NOTE = 280;
const RUN_STATUSES = ['PENDING', 'RUNNING', 'NEEDS_AXES', 'DONE', 'FAILED'] as const;

type Owned = { userId: string; workspace: NonNullable<Awaited<ReturnType<typeof findOwned>>> };

async function findOwned(workspaceId: string, userId: string) {
  return prisma.workspace.findFirst({ where: { id: workspaceId, userId } });
}

/** Session + ownership. A missing workspace and someone else's look identical. */
async function authorise(workspaceId: string): Promise<Owned | { error: string }> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };
  if (!workspaceId) return { error: await actionError('workspaceIdRequired') };
  const workspace = await findOwned(workspaceId, session.userId as string);
  if (!workspace) return { error: await actionError('workspaceNotFound') };
  return { userId: session.userId as string, workspace };
}

function toRunView(run: {
  id: string;
  status: string;
  stage: string | null;
  tokensUsed: number;
  error: string | null;
  axisCandidates: unknown;
  startedAt: Date;
  finishedAt: Date | null;
}): MatrixRunView {
  const kind = run.status === 'FAILED' ? classifyRunError(run.error) : null;
  return {
    id: run.id,
    status: (RUN_STATUSES as readonly string[]).includes(run.status) ? (run.status as MatrixRunView['status']) : 'FAILED',
    stage: run.stage,
    tokensUsed: run.tokensUsed,
    // Only the kinds this surface has copy for; the raw error never leaves the server.
    errorKind: kind === null ? null : kind === 'timedOut' || kind === 'dispatch' ? kind : 'generic',
    axisCandidates: normaliseMarketAxes(run.axisCandidates, MAX_AXIS_CANDIDATES),
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
  };
}

async function startRun(owned: Owned): Promise<{ runId: string } | { error: string }> {
  const { userId, workspace } = owned;
  const workspaceId = workspace.id;

  // A run stuck past the stale window is presumed dead; reap it before the
  // already-running check so it cannot block new runs forever.
  await reapStaleMatrixRuns(workspaceId);

  const active = await prisma.matrixRun.findFirst({
    where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  });
  if (active) return { error: await actionError('matrixAlreadyRunning') };

  const rows = await prisma.competitor.findMany({ where: { workspaceId } });
  const { competitors, basis } = selectCompetitors(rows);
  if (basis === 'NONE' || competitors.length < 2) return { error: await actionError('needTwoReviewedMatrices') };
  if (!hasBrandSummary(workspace.brandSummary)) return { error: await actionError('matrixNeedsBrandSummary') };

  const competitorSet = snapshotCompetitors(competitors).map((c) => ({
    competitorId: c.id,
    domain: c.domain ?? '',
    type: c.type ?? 'DIRECT',
  }));

  let run: { id: string };
  try {
    run = await prisma.matrixRun.create({
      data: {
        workspaceId,
        userId,
        status: 'PENDING',
        basis,
        language: languageFromContent(workspace.contentLanguage),
        competitorSet: competitorSet as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  } catch (error) {
    // matrix_runs_one_active_per_workspace (partial unique index) is what
    // actually stops two concurrent starts; this makes them agree on the error.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: await actionError('matrixAlreadyRunning') };
    }
    throw error;
  }

  await writeActivityLog({ userId, workspaceId, action: 'MATRICES_STARTED', detail: { runId: run.id, basis } });

  const dispatch = await triggerBackgroundRun('/api/matrices/run', { runId: run.id });
  if (!dispatch.ok) {
    // Only while still PENDING: a timed-out trigger may still have reached the
    // route, which then owns the run. In that case the run is live.
    const failed = await prisma.matrixRun.updateMany({
      where: { id: run.id, status: 'PENDING' },
      data: {
        status: 'FAILED',
        error: withRunErrorCode(RUN_ERROR.DISPATCH_FAILED, dispatch.error),
        finishedAt: new Date(),
      },
    });
    if (failed.count === 0) return { runId: run.id };
    await writeActivityLog({
      userId,
      workspaceId,
      action: 'MATRICES_DISPATCH_FAILED',
      detail: { runId: run.id, error: dispatch.error },
    });
    return { error: await actionError('matrixDispatchFailed') };
  }

  return { runId: run.id };
}

export async function startMatrixRun(workspaceId: string): Promise<{ runId: string } | { error: string }> {
  const owned = await authorise(workspaceId);
  if ('error' in owned) return owned;
  return startRun(owned);
}

function latestDoneRun(workspaceId: string) {
  return prisma.matrixRun.findFirst({
    where: { workspaceId, status: 'DONE' },
    orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
    select: { id: true, competitorSet: true },
  });
}

function blobRunId(matrices: unknown): string | null {
  if (!matrices || typeof matrices !== 'object' || Array.isArray(matrices)) return null;
  const id = (matrices as Record<string, unknown>).run_id;
  return typeof id === 'string' && id ? id : null;
}

export async function getMatrixStatus(workspaceId: string): Promise<MatrixStatus | { error: string }> {
  const owned = await authorise(workspaceId);
  if ('error' in owned) return owned;
  const { workspace } = owned;

  await reapStaleMatrixRuns(workspace.id);

  const [latestRun, latestDone, rows] = await Promise.all([
    prisma.matrixRun.findFirst({ where: { workspaceId: workspace.id }, orderBy: { startedAt: 'desc' } }),
    latestDoneRun(workspace.id),
    prisma.competitor.findMany({ where: { workspaceId: workspace.id } }),
  ]);
  const { competitors, basis } = selectCompetitors(rows);
  const insights = workspace.audienceInsights;
  let matrices =
    insights && typeof insights === 'object' && !Array.isArray(insights)
      ? ((insights as Record<string, unknown>).competitiveMatrices ?? null)
      : null;

  // Self-heal: the blob is a cache of the latest DONE run. If it is from some
  // other run (a failed projection write, or an older read-modify-write that
  // landed last), rebuild it from the tables now rather than show the wrong run.
  // A failed rebuild keeps the stored blob: the status must still load.
  if (latestDone && blobRunId(matrices) !== latestDone.id) {
    try {
      const rebuilt = await rebuildMatricesProjection(workspace.id);
      if (rebuilt) matrices = rebuilt;
    } catch (error) {
      console.error(`[matrices] self-heal rebuild failed for workspace ${workspace.id}`, error);
    }
  }

  // Compared on read, with the live side capped exactly like the snapshot.
  const stale = latestDone
    ? isStale(parseRunCompetitorIds(latestDone.competitorSet), snapshotCompetitorIds(competitors.map((c) => c.id)))
    : false;

  return {
    run: latestRun ? toRunView(latestRun) : null,
    savedAxes: parseStoredMarketAxes(workspace.matrixAxes),
    basis,
    competitorCount: competitors.length,
    hasBrandSummary: hasBrandSummary(workspace.brandSummary),
    stale,
    matrices,
  };
}

export async function saveMatrixAxes(
  workspaceId: string,
  axes: StoredMarketAxis[],
): Promise<{ runId: string } | { error: string }> {
  const owned = await authorise(workspaceId);
  if ('error' in owned) return owned;

  const parsed = parseStoredMarketAxes(axes);
  if (parsed.length === 0) return { error: await actionError('matrixAxesRequired') };

  await prisma.workspace.update({
    where: { id: owned.workspace.id },
    data: { matrixAxes: parsed as unknown as Prisma.InputJsonValue },
  });
  return startRun(owned);
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

function clampScore(value: number | null | undefined): number | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(10, Math.round(value)));
}

/** null is the target; anything else must be a real, non-empty id. */
function isCompetitorIdShape(competitorId: unknown): competitorId is string | null {
  return competitorId === null || (typeof competitorId === 'string' && competitorId.length > 0);
}

async function latestDoneRunShape(workspaceId: string) {
  return prisma.matrixRun.findFirst({
    where: { workspaceId, status: 'DONE' },
    orderBy: [{ finishedAt: 'desc' }, { startedAt: 'desc' }],
    select: { id: true, charts: { select: { key: true, scores: { select: { competitorId: true } } } } },
  });
}

export async function setMatrixOverride(
  workspaceId: string,
  chartKey: string,
  competitorId: string | null,
  patch: { xScore?: number | null; yScore?: number | null; note?: string | null },
): Promise<{ matrices: unknown } | { error: string }> {
  // Checked before anything reaches Prisma: an undefined competitorId in a
  // where clause is dropped, which would widen the match to every row.
  if (!isCompetitorIdShape(competitorId)) return { error: await actionError('matrixOverrideInvalid') };
  const owned = await authorise(workspaceId);
  if ('error' in owned) return owned;
  const { userId } = owned;
  const invalid = async () => ({ error: await actionError('matrixOverrideInvalid') });

  if (!chartKey || typeof chartKey !== 'string' || !patch || typeof patch !== 'object') return invalid();

  const rawNote = patch.note;
  if (rawNote !== undefined && rawNote !== null && (typeof rawNote !== 'string' || rawNote.length > MAX_NOTE)) {
    return invalid();
  }
  for (const v of [patch.xScore, patch.yScore]) {
    if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v))) return invalid();
  }

  const run = await latestDoneRunShape(workspaceId);
  const chart = run?.charts.find((c) => c.key === chartKey);
  if (!run || !chart) return invalid();
  if (competitorId !== null && !chart.scores.some((s) => s.competitorId === competitorId)) return invalid();

  const note = typeof rawNote === 'string' ? rawNote.trim() : rawNote;
  const xScore = clampScore(patch.xScore);
  const yScore = clampScore(patch.yScore);

  // Everything unset or nulled is a clear, not an empty row.
  const clearing = patch.xScore === null && patch.yScore === null && (note === null || note === undefined || note === '');
  if (clearing) return removeOverride(workspaceId, userId, chartKey, competitorId);

  if (xScore === undefined && yScore === undefined && note === undefined) return invalid();

  const where = { workspaceId, chartKey, competitorId };
  const data: { xScore?: number | null; yScore?: number | null; note?: string | null } = {};
  if (xScore !== undefined) data.xScore = xScore;
  if (yScore !== undefined) data.yScore = yScore;
  if (note !== undefined) data.note = note === '' ? null : note;

  // Prisma's compound-unique upsert rejects a null competitorId (the target),
  // so find-then-write. The index is NULLS NOT DISTINCT: a race surfaces as
  // P2002 on create, and the loser retries as an update once.
  const write = () =>
    prisma.$transaction(async (tx) => {
      const existing = await tx.matrixOverride.findFirst({ where });
      if (existing) return tx.matrixOverride.update({ where: { id: existing.id }, data });
      return tx.matrixOverride.create({ data: { ...where, ...data } });
    });
  try {
    await write();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    await write();
  }

  const matrices = await rebuildMatricesProjection(workspaceId);
  await writeActivityLog({
    userId,
    workspaceId,
    action: 'MATRIX_SCORE_OVERRIDDEN',
    detail: { chartKey, competitorId },
  });
  return { matrices };
}

async function removeOverride(
  workspaceId: string,
  userId: string,
  chartKey: string,
  competitorId: string | null,
): Promise<{ matrices: unknown }> {
  await prisma.matrixOverride.deleteMany({ where: { workspaceId, chartKey, competitorId } });
  const matrices = await rebuildMatricesProjection(workspaceId);
  await writeActivityLog({
    userId,
    workspaceId,
    action: 'MATRIX_SCORE_OVERRIDE_CLEARED',
    detail: { chartKey, competitorId },
  });
  return { matrices };
}

export async function clearMatrixOverride(
  workspaceId: string,
  chartKey: string,
  competitorId: string | null,
): Promise<{ matrices: unknown } | { error: string }> {
  const invalid = async () => ({ error: await actionError('matrixOverrideInvalid') });
  // Before any Prisma call: deleteMany with competitorId undefined would clear
  // every override on the chart.
  if (!isCompetitorIdShape(competitorId)) return invalid();
  const owned = await authorise(workspaceId);
  if ('error' in owned) return owned;
  if (!chartKey || typeof chartKey !== 'string') return invalid();
  // The target (null) is on every chart; a competitor must be on this one.
  if (competitorId !== null) {
    const run = await latestDoneRunShape(workspaceId);
    const chart = run?.charts.find((c) => c.key === chartKey);
    if (!chart || !chart.scores.some((s) => s.competitorId === competitorId)) return invalid();
  }
  return removeOverride(workspaceId, owned.userId, chartKey, competitorId);
}

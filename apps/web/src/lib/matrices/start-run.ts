/**
 * Starting a positioning-matrices run, without a session.
 *
 * Moved out of `app/actions/growth-matrices.ts` (startRun) so the first-post
 * run (lib/first-post/run.ts) can create a run row in process. The action
 * keeps its exact results: it resolves the session and ownership, then calls
 * `createMatrixRunRow` and `dispatchMatrixRun` and translates the error key.
 *
 * Callers must have checked that `owned.userId` owns `owned.workspace`.
 */
import { Prisma, type Workspace } from '@prisma/client';

import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { triggerBackgroundRun } from '@/lib/background-run';
import { RUN_ERROR, withRunErrorCode } from '@/lib/competitors/run-errors';
import { selectCompetitors } from '@/lib/competitors/selection';
import { languageFromContent } from '@/lib/matrices/axes';
import { hasBrandSummary } from '@/lib/matrices/bundle';
import { snapshotCompetitors } from '@/lib/matrices/competitor-set';
import { reapStaleMatrixRuns } from '@/lib/matrices/pipeline';

export type MatrixOwned = {
  userId: string;
  workspace: Pick<Workspace, 'id' | 'brandSummary' | 'contentLanguage'>;
};

/** Keys of `messages/*\/errors.json`. Translated by the action, never here. */
export type CreateMatrixRunResult =
  | { ok: true; runId: string }
  | { ok: false; errorKey: 'matrixAlreadyRunning' | 'needTwoReviewedMatrices' | 'matrixNeedsBrandSummary' };

export type DispatchMatrixRunResult = { ok: true; runId: string } | { ok: false; errorKey: 'matrixDispatchFailed' };

/** Reap, active check, competitor selection, PENDING row, MATRICES_STARTED. Throws on an unexpected database error. */
export async function createMatrixRunRow(owned: MatrixOwned): Promise<CreateMatrixRunResult> {
  const { userId, workspace } = owned;
  const workspaceId = workspace.id;

  // A run stuck past the stale window is presumed dead; reap it before the
  // already-running check so it cannot block new runs forever.
  await reapStaleMatrixRuns(workspaceId);

  const active = await prisma.matrixRun.findFirst({
    where: { workspaceId, status: { in: ['PENDING', 'RUNNING'] } },
    select: { id: true },
  });
  if (active) return { ok: false, errorKey: 'matrixAlreadyRunning' };

  const rows = await prisma.competitor.findMany({ where: { workspaceId } });
  const { competitors, basis } = selectCompetitors(rows);
  if (basis === 'NONE' || competitors.length < 2) return { ok: false, errorKey: 'needTwoReviewedMatrices' };
  if (!hasBrandSummary(workspace.brandSummary)) return { ok: false, errorKey: 'matrixNeedsBrandSummary' };

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
      return { ok: false, errorKey: 'matrixAlreadyRunning' };
    }
    throw error;
  }

  await writeActivityLog({ userId, workspaceId, action: 'MATRICES_STARTED', detail: { runId: run.id, basis } });
  return { ok: true, runId: run.id };
}

/** Hands the run to `/api/matrices/run`. A failed trigger fails the run while it is still PENDING. */
export async function dispatchMatrixRun(run: {
  runId: string;
  userId: string;
  workspaceId: string;
}): Promise<DispatchMatrixRunResult> {
  const dispatch = await triggerBackgroundRun('/api/matrices/run', { runId: run.runId });
  if (dispatch.ok) return { ok: true, runId: run.runId };

  // Only while still PENDING: a timed-out trigger may still have reached the
  // route, which then owns the run. In that case the run is live.
  const failed = await prisma.matrixRun.updateMany({
    where: { id: run.runId, status: 'PENDING' },
    data: {
      status: 'FAILED',
      error: withRunErrorCode(RUN_ERROR.DISPATCH_FAILED, dispatch.error),
      finishedAt: new Date(),
    },
  });
  if (failed.count === 0) return { ok: true, runId: run.runId };
  await writeActivityLog({
    userId: run.userId,
    workspaceId: run.workspaceId,
    action: 'MATRICES_DISPATCH_FAILED',
    detail: { runId: run.runId, error: dispatch.error },
  });
  return { ok: false, errorKey: 'matrixDispatchFailed' };
}

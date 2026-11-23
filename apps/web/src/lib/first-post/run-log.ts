/**
 * first-post/run-log.ts
 *
 * The first-post run's state lives in `activity_logs` (spec D5). These are
 * its own rows, so every write here is awaited and throws on failure: a run
 * row that silently failed to land would make the view lie about the run.
 * Other first-post events stay fire-and-forget through writeActivityLog.
 *
 * The FIRST_POST_RUN_STARTED row id IS the run id (`firstPostRunId`). Two
 * concurrent starts compute the same id, so the second insert hits P2002:
 * that is the lock.
 */
import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

import {
  FIRST_POST_OTHER_ANGLE,
  FIRST_POST_RUN_ACTIONS,
  FIRST_POST_RUN_STARTED,
  firstPostRunId,
  type FirstPostLogRow,
  type RunFinishedDetail,
  type RunStartedDetail,
  type StepDoneDetail,
  type StepFailedDetail,
  type StepSkippedDetail,
} from './types';

/** How many run rows one read derives the state from (spec §13). */
export const RUN_ROWS_WINDOW = 50;

export type RunKind = NonNullable<RunStartedDetail['kind']>;

export type InsertRunStartedResult =
  | { ok: true; runId: string }
  | { ok: false; reason: 'alreadyRunning'; runId: string };

export async function insertRunStarted(input: {
  userId: string;
  workspaceId: string;
  attempt: number;
  accepted: number;
  kind?: RunKind;
}): Promise<InsertRunStartedResult> {
  const runId = firstPostRunId(input.workspaceId, input.attempt);
  const detail: RunStartedDetail = {
    runId,
    attempt: input.attempt,
    accepted: input.accepted,
    kind: input.kind ?? 'start',
  };
  try {
    await prisma.activity_logs.create({
      data: {
        id: runId,
        user_id: input.userId,
        workspace_id: input.workspaceId,
        action: FIRST_POST_RUN_STARTED,
        detail: detail as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'alreadyRunning', runId };
    }
    throw error;
  }
  return { ok: true, runId };
}

export type StepRow =
  | { action: 'FIRST_POST_STEP_DONE'; detail: StepDoneDetail }
  | { action: 'FIRST_POST_STEP_SKIPPED'; detail: StepSkippedDetail }
  | { action: 'FIRST_POST_STEP_FAILED'; detail: StepFailedDetail }
  | { action: 'FIRST_POST_RUN_FINISHED'; detail: RunFinishedDetail };

/** One awaited run row. Throws on failure. */
export async function writeStepRow(input: { userId: string; workspaceId: string } & StepRow): Promise<void> {
  await prisma.activity_logs.create({
    data: {
      id: randomUUID(),
      user_id: input.userId,
      workspace_id: input.workspaceId,
      action: input.action,
      detail: input.detail as unknown as Prisma.InputJsonValue,
    },
  });
}

/** The newest RUN_ROWS_WINDOW run rows of the workspace, oldest first, shaped for deriveFirstPostState. */
export async function readRunRows(workspaceId: string): Promise<FirstPostLogRow[]> {
  const rows = await prisma.activity_logs.findMany({
    where: { workspace_id: workspaceId, action: { in: [...FIRST_POST_RUN_ACTIONS] } },
    orderBy: { created_at: 'desc' },
    take: RUN_ROWS_WINDOW,
    select: { id: true, action: true, detail: true, created_at: true },
  });
  return rows
    .map((row) => ({ id: row.id, action: row.action, detail: row.detail, createdAt: row.created_at }))
    .reverse();
}

export type RunStartedRow = { runId: string; userId: string; workspaceId: string; kind: RunKind };

/**
 * The run row by id, or null unless it is a FIRST_POST_RUN_STARTED row with a
 * workspace. User and workspace come from this row, written by an
 * ownership-checked action, never from a request body.
 */
export async function readRunStarted(runId: string): Promise<RunStartedRow | null> {
  if (!runId) return null;
  const row = await prisma.activity_logs.findUnique({
    where: { id: runId },
    select: { id: true, user_id: true, workspace_id: true, action: true, detail: true },
  });
  if (!row || row.action !== FIRST_POST_RUN_STARTED || !row.workspace_id || !row.user_id) return null;
  const detail = row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail) ? (row.detail as Record<string, unknown>) : {};
  return {
    runId: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    kind: detail.kind === 'otherAngle' ? 'otherAngle' : 'start',
  };
}

/** The attempt number of the next run: every RUN_STARTED row so far, plus one. */
export async function nextAttempt(workspaceId: string): Promise<number> {
  const count = await prisma.activity_logs.count({
    where: { workspace_id: workspaceId, action: FIRST_POST_RUN_STARTED },
  });
  return count + 1;
}

export async function countOtherAngles(workspaceId: string): Promise<number> {
  return prisma.activity_logs.count({ where: { workspace_id: workspaceId, action: FIRST_POST_OTHER_ANGLE } });
}

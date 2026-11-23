'use server';

/**
 * First post, Concept B (spec 2026-11-23-first-post-b §3, §6, §11).
 *
 * Every action: session, then ownership with workspace.findFirst({ id, userId })
 * (a missing workspace and someone else's look the same). Failures are
 * RETURNED, never thrown: `{ ok: false, code, error }`, where `code` is a
 * closed list the view switches on and `error` is translated copy. A thrown
 * error becomes `{ error, ref }` through guardedAction.
 *
 * Retry = startFirstPost again: the new run skips the steps already
 * satisfied (lib/first-post/run.ts).
 */
import { writeActivityLog } from '@/lib/activity-log';
import { actionError } from '@/lib/action-errors';
import { getSession } from '@/lib/auth';
import { triggerBackgroundRun } from '@/lib/background-run';
import { guardedAction } from '@/lib/bug-report/action-failure';
import { prisma } from '@/lib/db';
import { loadFirstPostState, type FirstPostLoad } from '@/lib/first-post/load';
import { claimRun, insertRunStarted, nextAttempt, writeStepRow, type RunKind } from '@/lib/first-post/run-log';
import {
  FIRST_POST_DRAFT_EDITED,
  FIRST_POST_OTHER_ANGLE,
  FIRST_POST_OTHER_ANGLE_LIMIT,
  type FirstPostStep,
} from '@/lib/first-post/types';

export type FirstPostActionCode =
  | 'notAuthenticated'
  | 'workspaceIdRequired'
  | 'workspaceNotFound'
  | 'needTwoReviewed'
  | 'alreadyRunning'
  | 'dispatchFailed'
  | 'retryLimit'
  | 'draftExists'
  | 'noDraft'
  | 'otherAngleLimit';

export type FirstPostActionResult =
  | { ok: true; runId: string }
  | { ok: false; code: FirstPostActionCode; error: string; runId?: string }
  /** A thrown error, recorded by guardedAction. */
  | { error: string; ref?: string };

const MIN_ACCEPTED = 2;

const ERROR_KEY: Record<FirstPostActionCode, string> = {
  notAuthenticated: 'notAuthenticated',
  workspaceIdRequired: 'workspaceIdRequired',
  workspaceNotFound: 'workspaceNotFound',
  needTwoReviewed: 'needTwoReviewed',
  alreadyRunning: 'firstPostAlreadyRunning',
  dispatchFailed: 'firstPostDispatchFailed',
  retryLimit: 'firstPostRetryLimit',
  draftExists: 'firstPostDraftExists',
  noDraft: 'firstPostNoDraft',
  otherAngleLimit: 'firstPostOtherAngleLimit',
};

async function fail(code: FirstPostActionCode, runId?: string) {
  return { ok: false as const, code, error: await actionError(ERROR_KEY[code]), ...(runId ? { runId } : {}) };
}

type Owner = { userId: string; workspaceId: string };

async function authorise(workspaceId: string): Promise<Owner | { code: FirstPostActionCode }> {
  const session = await getSession();
  if (!session) return { code: 'notAuthenticated' };
  if (!workspaceId) return { code: 'workspaceIdRequired' };
  const userId = session.userId as string;
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, userId }, select: { id: true } });
  if (!workspace) return { code: 'workspaceNotFound' };
  return { userId, workspaceId: workspace.id };
}

/**
 * Hands the run to /api/first-post/run. On a failed trigger the run is failed
 * with `dispatch` only if this call wins the claim: a timed-out trigger may
 * still have reached the route, which then owns (and has claimed) the run.
 */
async function dispatch(owner: Owner, runId: string, kind: RunKind): Promise<FirstPostActionResult> {
  const result = await triggerBackgroundRun('/api/first-post/run', { runId });
  if (result.ok) return { ok: true, runId };

  // The raw text stays in the server log; the client gets the closed code.
  console.error('startFirstPost: dispatch failed', runId, result.error);
  if (!(await claimRun({ runId, ...owner }))) return { ok: true, runId };
  const step: FirstPostStep = kind === 'otherAngle' ? 'idea' : 'matrices';
  await writeStepRow({ ...owner, action: 'FIRST_POST_STEP_FAILED', detail: { runId, step, errorKind: 'dispatch' } });
  return fail('dispatchFailed', runId);
}

async function start(owner: Owner, load: FirstPostLoad, kind: RunKind): Promise<FirstPostActionResult> {
  const inserted = await insertRunStarted({
    ...owner,
    attempt: await nextAttempt(owner.workspaceId),
    accepted: load.facts.accepted,
    kind,
  });
  if (!inserted.ok) return fail('alreadyRunning', inserted.runId);
  return { ok: true, runId: inserted.runId };
}

export async function startFirstPost(workspaceId: string): Promise<FirstPostActionResult> {
  return guardedAction('startFirstPost', workspaceId || null, async () => {
    const owner = await authorise(workspaceId);
    if ('code' in owner) return fail(owner.code);

    const load = await loadFirstPostState(owner.userId, owner.workspaceId);
    const { state } = load;
    if (state.phase === 'running') return fail('alreadyRunning', state.runId);
    if (state.phase === 'draft' || state.phase === 'publishing' || state.phase === 'published') return fail('draftExists');
    // 1 retry per step until a credit policy exists (spec §15 Q5).
    if (state.phase === 'failed' && state.retriesLeft === 0) return fail('retryLimit', state.runId);
    if (load.facts.accepted < MIN_ACCEPTED) return fail('needTwoReviewed');

    const started = await start(owner, load, 'start');
    if (!('ok' in started) || !started.ok) return started;
    return dispatch(owner, started.runId, 'start');
  });
}

export async function getFirstPostState(workspaceId: string): Promise<FirstPostLoad | { error: string; ref?: string }> {
  return guardedAction('getFirstPostState', workspaceId || null, async () => {
    const owner = await authorise(workspaceId);
    if ('code' in owner) return { error: await actionError(ERROR_KEY[owner.code]) };
    return loadFirstPostState(owner.userId, owner.workspaceId);
  });
}

/** Reruns idea + draft only, avoiding the earlier topics. Capped at FIRST_POST_OTHER_ANGLE_LIMIT per workspace. */
export async function firstPostOtherAngle(workspaceId: string): Promise<FirstPostActionResult> {
  return guardedAction('firstPostOtherAngle', workspaceId || null, async () => {
    const owner = await authorise(workspaceId);
    if ('code' in owner) return fail(owner.code);

    const load = await loadFirstPostState(owner.userId, owner.workspaceId);
    const { state } = load;
    if (state.phase === 'running') return fail('alreadyRunning', state.runId);
    if (state.phase !== 'draft') return fail('noDraft');
    if (load.otherAnglesUsed >= FIRST_POST_OTHER_ANGLE_LIMIT) return fail('otherAngleLimit');

    const started = await start(owner, load, 'otherAngle');
    if (!('ok' in started) || !started.ok) return started;

    // Awaited (it is the cap's counter) but never throws: writeActivityLog logs and swallows.
    await writeActivityLog({
      ...owner,
      action: FIRST_POST_OTHER_ANGLE,
      detail: { runId: started.runId, previousContentItemId: state.contentItemId, n: load.otherAnglesUsed + 1 },
    });
    return dispatch(owner, started.runId, 'otherAngle');
  });
}

/** A character count as a non-negative integer, or null when it is not a number. */
function charCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

/**
 * Funnel (spec §7): the first-post draft was edited and saved. Lengths only,
 * never the text. A missing session, a bad id, someone else's item or a bad
 * count is a silent no-op; the caller does not wait on it and it never throws.
 */
export async function logFirstPostDraftEdit(contentId: string, charsBefore: number, charsAfter: number): Promise<void> {
  try {
    const session = await getSession();
    if (!session) return;
    if (typeof contentId !== 'string' || !contentId) return;
    const before = charCount(charsBefore);
    const after = charCount(charsAfter);
    if (before === null || after === null) return;

    const userId = session.userId as string;
    const item = await prisma.contentItem.findFirst({
      where: { id: contentId, userId },
      select: { id: true, workspaceId: true },
    });
    if (!item?.workspaceId) return;

    await writeActivityLog({
      userId,
      workspaceId: item.workspaceId,
      action: FIRST_POST_DRAFT_EDITED,
      detail: { contentId: item.id, charsBefore: before, charsAfter: after },
    });
  } catch (error) {
    console.error('logFirstPostDraftEdit failed:', error);
  }
}

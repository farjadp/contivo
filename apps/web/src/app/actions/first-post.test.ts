import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  prismaMock: { workspace: { findFirst: vi.fn() }, contentItem: { findFirst: vi.fn() } },
  sessionMock: { getSession: vi.fn() },
  loadMock: { loadFirstPostState: vi.fn() },
  runLog: { insertRunStarted: vi.fn(), nextAttempt: vi.fn(), claimRun: vi.fn(), writeStepRow: vi.fn() },
  backgroundRun: { triggerBackgroundRun: vi.fn() },
  activityLog: { writeActivityLog: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: h.prismaMock }));
vi.mock('@/lib/auth', () => h.sessionMock);
vi.mock('@/lib/first-post/load', () => h.loadMock);
vi.mock('@/lib/first-post/run-log', () => h.runLog);
vi.mock('@/lib/background-run', () => h.backgroundRun);
vi.mock('@/lib/activity-log', () => h.activityLog);
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));

import { firstPostOtherAngle, getFirstPostState, logFirstPostDraftEdit, startFirstPost } from './first-post';

const WHY = { matrixCharts: 0, matricesReady: false, keywordCompetitors: 0, gaps: 0, topGap: null };

function loaded(state: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    state,
    facts: { accepted: 2, suggestions: 3, items: {}, latestJobByItem: {}, linkedIn: { connected: false } },
    draft: null,
    why: WHY,
    otherAnglesUsed: 0,
    ...extra,
  };
}

const CONFIRM = { phase: 'confirm', accepted: 2, suggestions: 3 };
const DRAFT = { phase: 'draft', contentItemId: 'item-1', approved: true, linkedIn: { connected: false } };

beforeEach(() => {
  vi.clearAllMocks();
  h.sessionMock.getSession.mockResolvedValue({ userId: 'u1' });
  h.prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws1', userId: 'u1' });
  h.loadMock.loadFirstPostState.mockResolvedValue(loaded(CONFIRM));
  h.runLog.nextAttempt.mockResolvedValue(1);
  h.runLog.insertRunStarted.mockImplementation(async ({ workspaceId, attempt }: { workspaceId: string; attempt: number }) => ({
    ok: true,
    runId: `fpr_${workspaceId}_${attempt}`,
  }));
  h.runLog.claimRun.mockResolvedValue(true);
  h.runLog.writeStepRow.mockResolvedValue(undefined);
  h.backgroundRun.triggerBackgroundRun.mockResolvedValue({ ok: true });
});

describe('authorisation (every action)', () => {
  it('unauthenticated → notAuthenticated, nothing read', async () => {
    h.sessionMock.getSession.mockResolvedValue(null);
    for (const action of [startFirstPost, getFirstPostState, firstPostOtherAngle]) {
      expect(await action('ws1')).toMatchObject({ error: 'notAuthenticated' });
    }
    expect(h.prismaMock.workspace.findFirst).not.toHaveBeenCalled();
    expect(h.loadMock.loadFirstPostState).not.toHaveBeenCalled();
  });

  it("someone else's workspace → workspaceNotFound, looked up by { id, userId }", async () => {
    h.prismaMock.workspace.findFirst.mockResolvedValue(null);
    for (const action of [startFirstPost, getFirstPostState, firstPostOtherAngle]) {
      expect(await action('ws-x')).toMatchObject({ error: 'workspaceNotFound' });
    }
    expect(h.prismaMock.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws-x', userId: 'u1' } }),
    );
    expect(h.runLog.insertRunStarted).not.toHaveBeenCalled();
  });
});

describe('startFirstPost', () => {
  it('writes the run row and dispatches { runId } only', async () => {
    const result = await startFirstPost('ws1');

    expect(result).toEqual({ ok: true, runId: 'fpr_ws1_1' });
    expect(h.runLog.insertRunStarted).toHaveBeenCalledWith({
      userId: 'u1',
      workspaceId: 'ws1',
      attempt: 1,
      accepted: 2,
      kind: 'start',
    });
    expect(h.backgroundRun.triggerBackgroundRun).toHaveBeenCalledWith('/api/first-post/run', { runId: 'fpr_ws1_1' });
  });

  it('fewer than 2 accepted → needTwoReviewed, no run', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(
      loaded({ phase: 'confirm', accepted: 1, suggestions: 3 }, { facts: { accepted: 1 } }),
    );
    expect(await startFirstPost('ws1')).toMatchObject({ ok: false, code: 'needTwoReviewed', error: 'needTwoReviewed' });
    expect(h.runLog.insertRunStarted).not.toHaveBeenCalled();
  });

  it('a double start: the second insert hits P2002 and gets alreadyRunning with the run id', async () => {
    h.runLog.insertRunStarted
      .mockResolvedValueOnce({ ok: true, runId: 'fpr_ws1_1' })
      .mockResolvedValueOnce({ ok: false, reason: 'alreadyRunning', runId: 'fpr_ws1_1' });

    const [first, second] = await Promise.all([startFirstPost('ws1'), startFirstPost('ws1')]);

    expect(first).toEqual({ ok: true, runId: 'fpr_ws1_1' });
    expect(second).toMatchObject({ ok: false, code: 'alreadyRunning', error: 'firstPostAlreadyRunning', runId: 'fpr_ws1_1' });
    expect(h.backgroundRun.triggerBackgroundRun).toHaveBeenCalledTimes(1);
  });

  it('a run already active in the state → alreadyRunning without a new row', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(
      loaded({ phase: 'running', runId: 'fpr_ws1_3', done: [], current: 'keywords', startedAt: '' }),
    );
    expect(await startFirstPost('ws1')).toMatchObject({ code: 'alreadyRunning', runId: 'fpr_ws1_3' });
    expect(h.runLog.insertRunStarted).not.toHaveBeenCalled();
  });

  it('a dispatch failure writes a STEP_FAILED dispatch row and says so', async () => {
    h.backgroundRun.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'fetch failed (ECONNREFUSED)' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await startFirstPost('ws1');
    spy.mockRestore();

    expect(result).toMatchObject({ ok: false, code: 'dispatchFailed', error: 'firstPostDispatchFailed', runId: 'fpr_ws1_1' });
    expect(h.runLog.claimRun).toHaveBeenCalledWith({ runId: 'fpr_ws1_1', userId: 'u1', workspaceId: 'ws1' });
    expect(h.runLog.writeStepRow).toHaveBeenCalledWith({
      userId: 'u1',
      workspaceId: 'ws1',
      action: 'FIRST_POST_STEP_FAILED',
      detail: { runId: 'fpr_ws1_1', step: 'matrices', errorKind: 'dispatch' },
    });
  });

  it('a timed-out trigger whose run the route already claimed is live: ok, no failure row', async () => {
    h.backgroundRun.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'timeout' });
    h.runLog.claimRun.mockResolvedValue(false);
    expect(await startFirstPost('ws1')).toEqual({ ok: true, runId: 'fpr_ws1_1' });
    expect(h.runLog.writeStepRow).not.toHaveBeenCalled();
  });

  it('retry after a failure starts the next attempt; after the same step failed twice it refuses', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(
      loaded({ phase: 'failed', runId: 'fpr_ws1_1', done: [], failed: 'keywords', errorKind: 'generic', retriesLeft: 1 }),
    );
    h.runLog.nextAttempt.mockResolvedValue(2);
    expect(await startFirstPost('ws1')).toEqual({ ok: true, runId: 'fpr_ws1_2' });

    h.loadMock.loadFirstPostState.mockResolvedValue(
      loaded({ phase: 'failed', runId: 'fpr_ws1_2', done: [], failed: 'keywords', errorKind: 'generic', retriesLeft: 0 }),
    );
    expect(await startFirstPost('ws1')).toMatchObject({ ok: false, code: 'retryLimit', error: 'firstPostRetryLimit' });
    expect(h.runLog.insertRunStarted).toHaveBeenCalledTimes(1);
  });

  it('a draft already exists → draftExists (Other angle is the way to a new one)', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(loaded(DRAFT));
    expect(await startFirstPost('ws1')).toMatchObject({ ok: false, code: 'draftExists', error: 'firstPostDraftExists' });
    expect(h.runLog.insertRunStarted).not.toHaveBeenCalled();
  });
});

describe('getFirstPostState', () => {
  it('returns loadFirstPostState for the owner', async () => {
    const value = loaded(DRAFT);
    h.loadMock.loadFirstPostState.mockResolvedValue(value);
    expect(await getFirstPostState('ws1')).toBe(value);
    expect(h.loadMock.loadFirstPostState).toHaveBeenCalledWith('u1', 'ws1');
  });
});

describe('firstPostOtherAngle', () => {
  it('starts an otherAngle run from a draft, logs FIRST_POST_OTHER_ANGLE with ids only, and dispatches', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(loaded(DRAFT, { otherAnglesUsed: 1 }));
    h.runLog.nextAttempt.mockResolvedValue(2);

    const result = await firstPostOtherAngle('ws1');

    expect(result).toEqual({ ok: true, runId: 'fpr_ws1_2' });
    expect(h.runLog.insertRunStarted).toHaveBeenCalledWith(expect.objectContaining({ attempt: 2, kind: 'otherAngle' }));
    expect(h.activityLog.writeActivityLog).toHaveBeenCalledWith({
      userId: 'u1',
      workspaceId: 'ws1',
      action: 'FIRST_POST_OTHER_ANGLE',
      detail: { runId: 'fpr_ws1_2', previousContentItemId: 'item-1', n: 2 },
    });
    expect(h.backgroundRun.triggerBackgroundRun).toHaveBeenCalledWith('/api/first-post/run', { runId: 'fpr_ws1_2' });
  });

  it('stops at 3 per workspace', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(loaded(DRAFT, { otherAnglesUsed: 3 }));
    expect(await firstPostOtherAngle('ws1')).toMatchObject({ ok: false, code: 'otherAngleLimit', error: 'firstPostOtherAngleLimit' });
    expect(h.runLog.insertRunStarted).not.toHaveBeenCalled();
  });

  it('needs a draft: running → alreadyRunning, anything else → noDraft', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(
      loaded({ phase: 'running', runId: 'fpr_ws1_2', done: [], current: 'idea', startedAt: '' }),
    );
    expect(await firstPostOtherAngle('ws1')).toMatchObject({ code: 'alreadyRunning' });
    h.loadMock.loadFirstPostState.mockResolvedValue(loaded(CONFIRM));
    expect(await firstPostOtherAngle('ws1')).toMatchObject({ code: 'noDraft', error: 'firstPostNoDraft' });
    expect(h.runLog.insertRunStarted).not.toHaveBeenCalled();
  });

  it('a dispatch failure fails the idea step (the first step an other-angle run does)', async () => {
    h.loadMock.loadFirstPostState.mockResolvedValue(loaded(DRAFT));
    h.backgroundRun.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'x' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await firstPostOtherAngle('ws1');
    spy.mockRestore();
    expect(h.runLog.writeStepRow.mock.calls[0][0].detail).toEqual({ runId: 'fpr_ws1_1', step: 'idea', errorKind: 'dispatch' });
  });
});

describe('logFirstPostDraftEdit', () => {
  it('writes FIRST_POST_DRAFT_EDITED with ids and lengths only, item looked up by { id, userId }', async () => {
    h.prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'item-1', workspaceId: 'ws1' });

    await logFirstPostDraftEdit('item-1', 812, 640);

    expect(h.prismaMock.contentItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'item-1', userId: 'u1' } }),
    );
    expect(h.activityLog.writeActivityLog).toHaveBeenCalledWith({
      userId: 'u1',
      workspaceId: 'ws1',
      action: 'FIRST_POST_DRAFT_EDITED',
      detail: { contentId: 'item-1', charsBefore: 812, charsAfter: 640 },
    });
  });

  it('rounds the counts to integers', async () => {
    h.prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'item-1', workspaceId: 'ws1' });
    await logFirstPostDraftEdit('item-1', 10.4, 11.6);
    expect(h.activityLog.writeActivityLog.mock.calls[0][0].detail).toEqual({
      contentId: 'item-1',
      charsBefore: 10,
      charsAfter: 12,
    });
  });

  it("is a no-op for no session, a bad id, someone else's item and bad counts", async () => {
    h.sessionMock.getSession.mockResolvedValueOnce(null);
    await logFirstPostDraftEdit('item-1', 1, 2);
    expect(h.prismaMock.contentItem.findFirst).not.toHaveBeenCalled();

    await logFirstPostDraftEdit('', 1, 2);
    await logFirstPostDraftEdit('item-1', Number.NaN, 2);
    await logFirstPostDraftEdit('item-1', 1, -3);
    expect(h.prismaMock.contentItem.findFirst).not.toHaveBeenCalled();

    h.prismaMock.contentItem.findFirst.mockResolvedValue(null);
    await logFirstPostDraftEdit('item-x', 1, 2);
    expect(h.activityLog.writeActivityLog).not.toHaveBeenCalled();
  });

  it('never throws on a database error', async () => {
    h.prismaMock.contentItem.findFirst.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(logFirstPostDraftEdit('item-1', 1, 2)).resolves.toBeUndefined();
    expect(h.activityLog.writeActivityLog).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

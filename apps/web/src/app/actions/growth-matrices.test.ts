import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { prismaMock, sessionMock, activityLogMock, backgroundRunMock, pipelineMock, persistMock } = vi.hoisted(() => {
  const prismaMock: Record<string, any> = {
    workspace: { findFirst: vi.fn(), update: vi.fn() },
    competitor: { findMany: vi.fn() },
    matrixRun: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    matrixOverride: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  return {
    prismaMock,
    sessionMock: { getSession: vi.fn() },
    activityLogMock: { writeActivityLog: vi.fn() },
    backgroundRunMock: { triggerBackgroundRun: vi.fn() },
    pipelineMock: { reapStaleMatrixRuns: vi.fn() },
    persistMock: { rebuildMatricesProjection: vi.fn() },
  };
});

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => sessionMock);
vi.mock('@/lib/activity-log', () => activityLogMock);
vi.mock('@/lib/background-run', () => backgroundRunMock);
vi.mock('@/lib/matrices/pipeline', () => pipelineMock);
vi.mock('@/lib/matrices/persist', () => persistMock);
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));

import {
  clearMatrixOverride,
  getMatrixStatus,
  saveMatrixAxes,
  setMatrixOverride,
  startMatrixRun,
} from './growth-matrices';

const brandSummary = { summary: 'We sell things', offerings: ['a'], audiences: ['b'] };
const workspace = { id: 'ws-1', userId: 'user-1', contentLanguage: 'EN', brandSummary };

function competitor(id: string) {
  return {
    id,
    domain: `${id}.com`,
    type: 'DIRECT',
    userDecision: 'ACCEPTED',
    confidence: 0.9,
    source: 'MANUAL',
    discoveryRunId: null,
    evidence: [],
  };
}

const axis = {
  key: 'speed',
  x: { label: 'Speed', low: 'slow', high: 'fast' },
  y: { label: 'Price', low: 'cheap', high: 'dear' },
  rationale: 'why',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  sessionMock.getSession.mockResolvedValue({ userId: 'user-1' });
  prismaMock.workspace.findFirst.mockResolvedValue(workspace);
  prismaMock.competitor.findMany.mockResolvedValue([competitor('c1'), competitor('c2')]);
  prismaMock.matrixRun.findFirst.mockResolvedValue(null);
  prismaMock.matrixRun.create.mockResolvedValue({ id: 'run-1' });
  prismaMock.matrixRun.updateMany.mockResolvedValue({ count: 1 });
  backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: true });
  persistMock.rebuildMatricesProjection.mockResolvedValue({ charts: [] });
});

describe('startMatrixRun', () => {
  it('refuses a workspace that is not the caller\'s', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(null);
    const result = await startMatrixRun('ws-x');
    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws-x', userId: 'user-1' } }),
    );
    expect(prismaMock.matrixRun.create).not.toHaveBeenCalled();
  });

  it('refuses while a run is active', async () => {
    prismaMock.matrixRun.findFirst.mockResolvedValue({ id: 'live' });
    expect(await startMatrixRun('ws-1')).toEqual({ error: 'matrixAlreadyRunning' });
    expect(pipelineMock.reapStaleMatrixRuns).toHaveBeenCalledWith('ws-1');
    expect(prismaMock.matrixRun.create).not.toHaveBeenCalled();
  });

  it('refuses when no competitors are selectable', async () => {
    prismaMock.competitor.findMany.mockResolvedValue([]);
    expect(await startMatrixRun('ws-1')).toEqual({ error: 'needTwoReviewedMatrices' });
    expect(prismaMock.matrixRun.create).not.toHaveBeenCalled();
  });

  it('refuses with fewer than two competitors', async () => {
    prismaMock.competitor.findMany.mockResolvedValue([competitor('c1')]);
    expect(await startMatrixRun('ws-1')).toEqual({ error: 'needTwoReviewedMatrices' });
  });

  it('refuses without a brand summary', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue({ ...workspace, brandSummary: null });
    expect(await startMatrixRun('ws-1')).toEqual({ error: 'matrixNeedsBrandSummary' });
    expect(prismaMock.matrixRun.create).not.toHaveBeenCalled();
  });

  it('creates a PENDING run with the competitor snapshot and dispatches it', async () => {
    const result = await startMatrixRun('ws-1');
    expect(result).toEqual({ runId: 'run-1' });
    const data = prismaMock.matrixRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ workspaceId: 'ws-1', userId: 'user-1', status: 'PENDING', basis: 'ACCEPTED', language: 'en' });
    expect(data.competitorSet).toEqual([
      { competitorId: 'c1', domain: 'c1.com', type: 'DIRECT' },
      { competitorId: 'c2', domain: 'c2.com', type: 'DIRECT' },
    ]);
    expect(backgroundRunMock.triggerBackgroundRun).toHaveBeenCalledWith('/api/matrices/run', { runId: 'run-1' });
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRICES_STARTED' }),
    );
  });

  it('caps the snapshot at 12 competitors', async () => {
    prismaMock.competitor.findMany.mockResolvedValue(Array.from({ length: 15 }, (_, i) => competitor(`c${i}`)));
    await startMatrixRun('ws-1');
    expect(prismaMock.matrixRun.create.mock.calls[0][0].data.competitorSet).toHaveLength(12);
  });

  it('maps the active-run unique index violation to already running', async () => {
    prismaMock.matrixRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    expect(await startMatrixRun('ws-1')).toEqual({ error: 'matrixAlreadyRunning' });
    expect(backgroundRunMock.triggerBackgroundRun).not.toHaveBeenCalled();
  });

  it('marks the run FAILED when dispatch fails', async () => {
    backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'boom' });
    expect(await startMatrixRun('ws-1')).toEqual({ error: 'matrixDispatchFailed' });
    const call = prismaMock.matrixRun.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'run-1', status: 'PENDING' });
    expect(call.data.status).toBe('FAILED');
    expect(call.data.error).toMatch(/^DISPATCH_FAILED/);
  });

  it('returns the run id when the guarded FAILED update matched nothing', async () => {
    backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'timeout' });
    prismaMock.matrixRun.updateMany.mockResolvedValue({ count: 0 });
    expect(await startMatrixRun('ws-1')).toEqual({ runId: 'run-1' });
  });
});

describe('getMatrixStatus', () => {
  it('never exposes the raw error and reports errorKind', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue({
      ...workspace,
      matrixAxes: null,
      audienceInsights: { competitiveMatrices: { charts: [] } },
    });
    prismaMock.matrixRun.findFirst.mockResolvedValue({
      id: 'r',
      status: 'FAILED',
      stage: 'SCORE',
      tokensUsed: 5,
      error: 'DISPATCH_FAILED: OPENAI_API_KEY is not set',
      axisCandidates: null,
      startedAt: new Date('2026-09-29T00:00:00Z'),
      finishedAt: new Date('2026-09-29T00:01:00Z'),
    });
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(status.run?.errorKind).toBe('dispatch');
    expect(JSON.stringify(status)).not.toContain('OPENAI_API_KEY');
    expect(status.basis).toBe('ACCEPTED');
    expect(status.competitorCount).toBe(2);
    expect(status.hasBrandSummary).toBe(true);
    expect(status.matrices).toEqual({ charts: [] });
  });

  it('returns workspaceNotFound for a workspace that is not the caller\'s', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(null);
    expect(await getMatrixStatus('ws-x')).toEqual({ error: 'workspaceNotFound' });
  });

  /** latest = the newest run of any status; done = the newest DONE run. */
  function runs(latest: unknown, done: unknown) {
    prismaMock.matrixRun.findFirst.mockImplementation(async (args: { where: { status?: string } }) =>
      args.where.status === 'DONE' ? done : latest,
    );
  }
  const doneRun = (id: string, ids: string[]) => ({
    id,
    status: 'DONE',
    stage: null,
    tokensUsed: 10,
    error: null,
    axisCandidates: null,
    startedAt: new Date('2026-09-29T00:00:00Z'),
    finishedAt: new Date('2026-09-29T00:01:00Z'),
    competitorSet: ids.map((competitorId) => ({ competitorId, domain: `${competitorId}.com`, type: 'DIRECT' })),
  });
  const withBlob = (runId: string | undefined) =>
    prismaMock.workspace.findFirst.mockResolvedValue({
      ...workspace,
      matrixAxes: null,
      audienceInsights: { competitiveMatrices: { run_id: runId, charts: [], stale: false } },
    });

  it('reports stale when a competitor was accepted after the latest DONE run', async () => {
    withBlob('done-1');
    runs(doneRun('done-1', ['c1']), doneRun('done-1', ['c1']));
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(status.stale).toBe(true);
  });

  it('is not stale when the live set matches the run, in any order', async () => {
    withBlob('done-1');
    runs(doneRun('done-1', ['c2', 'c1']), doneRun('done-1', ['c2', 'c1']));
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(status.stale).toBe(false);
  });

  it('is not stale with 13 selected competitors when the run holds the capped 12', async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`);
    prismaMock.competitor.findMany.mockResolvedValue([...ids].reverse().map(competitor));
    withBlob('done-1');
    runs(doneRun('done-1', ids.slice(0, 12)), doneRun('done-1', ids.slice(0, 12)));
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(status.stale).toBe(false);
    expect(status.competitorCount).toBe(13);
  });

  it('is not stale when there is no DONE run', async () => {
    withBlob(undefined);
    runs(null, null);
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(status.stale).toBe(false);
    expect(persistMock.rebuildMatricesProjection).not.toHaveBeenCalled();
  });

  it('shows all four proposed axes to the chooser', async () => {
    withBlob(undefined);
    const candidates = ['a', 'b', 'c', 'd'].map((key) => ({ ...axis, key }));
    runs({ ...doneRun('r', []), status: 'NEEDS_AXES', axisCandidates: candidates }, null);
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(status.run?.axisCandidates.map((a) => a.key)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('rebuilds the saved result when it is not from the latest DONE run, and returns the rebuilt one', async () => {
    withBlob('done-1');
    runs(doneRun('done-2', ['c1', 'c2']), doneRun('done-2', ['c1', 'c2']));
    persistMock.rebuildMatricesProjection.mockResolvedValue({ run_id: 'done-2', charts: [] });
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(persistMock.rebuildMatricesProjection).toHaveBeenCalledWith('ws-1');
    expect(status.matrices).toEqual({ run_id: 'done-2', charts: [] });
  });

  it('does not rebuild when the saved result is already the latest DONE run', async () => {
    withBlob('done-1');
    runs(doneRun('done-1', ['c1', 'c2']), doneRun('done-1', ['c1', 'c2']));
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(persistMock.rebuildMatricesProjection).not.toHaveBeenCalled();
    expect(status.matrices).toMatchObject({ run_id: 'done-1' });
  });

  it('keeps the saved result when a rebuild produces nothing', async () => {
    withBlob('done-1');
    runs(doneRun('done-2', ['c1', 'c2']), doneRun('done-2', ['c1', 'c2']));
    persistMock.rebuildMatricesProjection.mockResolvedValue(null);
    const status = await getMatrixStatus('ws-1');
    if ('error' in status) throw new Error('unexpected');
    expect(status.matrices).toMatchObject({ run_id: 'done-1' });
  });
});

describe('saveMatrixAxes', () => {
  it('rejects an empty axes list', async () => {
    expect(await saveMatrixAxes('ws-1', [])).toEqual({ error: 'matrixAxesRequired' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('saves the axes, then starts a run', async () => {
    const result = await saveMatrixAxes('ws-1', [axis]);
    expect(result).toEqual({ runId: 'run-1' });
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: 'ws-1' },
      data: { matrixAxes: [axis] },
    });
    expect(backgroundRunMock.triggerBackgroundRun).toHaveBeenCalledWith('/api/matrices/run', { runId: 'run-1' });
  });
});

describe('overrides', () => {
  beforeEach(() => {
    prismaMock.matrixRun.findFirst.mockResolvedValue({
      id: 'done',
      charts: [{ key: 'offer', scores: [{ competitorId: null }, { competitorId: 'c1' }] }],
    });
    prismaMock.matrixOverride.findFirst.mockResolvedValue(null);
    prismaMock.matrixOverride.create.mockResolvedValue({});
  });

  it('rejects an unknown chart', async () => {
    const result = await setMatrixOverride('ws-1', 'nope', 'c1', { xScore: 3 });
    expect(result).toEqual({ error: 'matrixOverrideInvalid' });
    expect(prismaMock.matrixOverride.create).not.toHaveBeenCalled();
  });

  it('rejects a competitor that is not in the run', async () => {
    const result = await setMatrixOverride('ws-1', 'offer', 'zzz', { xScore: 3 });
    expect(result).toEqual({ error: 'matrixOverrideInvalid' });
  });

  it('rejects a note over 280 characters', async () => {
    const result = await setMatrixOverride('ws-1', 'offer', 'c1', { note: 'x'.repeat(281) });
    expect(result).toEqual({ error: 'matrixOverrideInvalid' });
  });

  it('clamps 14 to 10, creates the row, rebuilds the projection and returns it', async () => {
    const result = await setMatrixOverride('ws-1', 'offer', 'c1', { xScore: 14, yScore: 0 });
    expect(prismaMock.matrixOverride.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: 'ws-1',
      chartKey: 'offer',
      competitorId: 'c1',
      xScore: 10,
      yScore: 1,
    });
    expect(persistMock.rebuildMatricesProjection).toHaveBeenCalledWith('ws-1');
    expect(result).toEqual({ matrices: { charts: [] } });
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRIX_SCORE_OVERRIDDEN' }),
    );
  });

  it('updates the existing row, including for the target (null competitor)', async () => {
    prismaMock.matrixOverride.findFirst.mockResolvedValue({ id: 'o1' });
    await setMatrixOverride('ws-1', 'offer', null, { xScore: 4 });
    expect(prismaMock.matrixOverride.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', chartKey: 'offer', competitorId: null },
    });
    expect(prismaMock.matrixOverride.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o1' } }),
    );
    expect(prismaMock.matrixOverride.create).not.toHaveBeenCalled();
  });

  it('retries the update once when a concurrent create wins the race', async () => {
    prismaMock.matrixOverride.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'o2' });
    prismaMock.matrixOverride.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    const result = await setMatrixOverride('ws-1', 'offer', null, { xScore: 4 });
    expect(prismaMock.matrixOverride.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'o2' } }),
    );
    expect(result).toEqual({ matrices: { charts: [] } });
  });

  it('treats an all-null patch as clearing', async () => {
    await setMatrixOverride('ws-1', 'offer', 'c1', { xScore: null, yScore: null, note: '' });
    expect(prismaMock.matrixOverride.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', chartKey: 'offer', competitorId: 'c1' },
    });
    expect(prismaMock.matrixOverride.create).not.toHaveBeenCalled();
    expect(persistMock.rebuildMatricesProjection).toHaveBeenCalled();
  });

  it('rejects a competitorId that is neither null nor a non-empty string before touching the database', async () => {
    for (const bad of [undefined, '', 42, {}]) {
      vi.clearAllMocks();
      expect(await setMatrixOverride('ws-1', 'offer', bad as never, { xScore: 3 })).toEqual({ error: 'matrixOverrideInvalid' });
      expect(await clearMatrixOverride('ws-1', 'offer', bad as never)).toEqual({ error: 'matrixOverrideInvalid' });
      expect(prismaMock.matrixRun.findFirst).not.toHaveBeenCalled();
      expect(prismaMock.matrixOverride.deleteMany).not.toHaveBeenCalled();
      expect(prismaMock.matrixOverride.findFirst).not.toHaveBeenCalled();
    }
  });

  it('clearMatrixOverride rejects a competitor that is not in the latest run\'s chart', async () => {
    expect(await clearMatrixOverride('ws-1', 'offer', 'zzz')).toEqual({ error: 'matrixOverrideInvalid' });
    expect(await clearMatrixOverride('ws-1', 'nope', 'c1')).toEqual({ error: 'matrixOverrideInvalid' });
    expect(prismaMock.matrixOverride.deleteMany).not.toHaveBeenCalled();
  });

  it('clearMatrixOverride clears a competitor that is in the chart', async () => {
    await clearMatrixOverride('ws-1', 'offer', 'c1');
    expect(prismaMock.matrixOverride.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', chartKey: 'offer', competitorId: 'c1' },
    });
  });

  it('clearMatrixOverride deletes and rebuilds', async () => {
    const result = await clearMatrixOverride('ws-1', 'offer', null);
    expect(prismaMock.matrixOverride.deleteMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', chartKey: 'offer', competitorId: null },
    });
    expect(persistMock.rebuildMatricesProjection).toHaveBeenCalledWith('ws-1');
    expect(result).toEqual({ matrices: { charts: [] } });
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRIX_SCORE_OVERRIDE_CLEARED' }),
    );
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { prismaMock, activityLogMock, backgroundRunMock, pipelineMock } = vi.hoisted(() => ({
  prismaMock: {
    competitor: { findMany: vi.fn() },
    matrixRun: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  },
  activityLogMock: { writeActivityLog: vi.fn() },
  backgroundRunMock: { triggerBackgroundRun: vi.fn() },
  pipelineMock: { reapStaleMatrixRuns: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => activityLogMock);
vi.mock('@/lib/background-run', () => backgroundRunMock);
vi.mock('@/lib/matrices/pipeline', () => pipelineMock);

import { createMatrixRunRow, dispatchMatrixRun } from './start-run';

const workspace = { id: 'ws-1', contentLanguage: 'FA', brandSummary: { summary: 'We sell things' } };
const owned = { userId: 'user-1', workspace };

function competitor(id: string) {
  return { id, domain: `${id}.com`, type: 'DIRECT', userDecision: 'ACCEPTED', confidence: 0.9, evidence: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.competitor.findMany.mockResolvedValue([competitor('c2'), competitor('c1')]);
  prismaMock.matrixRun.findFirst.mockResolvedValue(null);
  prismaMock.matrixRun.create.mockResolvedValue({ id: 'run-1' });
  prismaMock.matrixRun.updateMany.mockResolvedValue({ count: 1 });
  backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: true });
});

describe('createMatrixRunRow', () => {
  it('reaps first, snapshots the selected competitors, creates a PENDING run and logs MATRICES_STARTED', async () => {
    const result = await createMatrixRunRow(owned);

    expect(result).toEqual({ ok: true, runId: 'run-1' });
    expect(pipelineMock.reapStaleMatrixRuns).toHaveBeenCalledWith('ws-1');
    const data = prismaMock.matrixRun.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ workspaceId: 'ws-1', userId: 'user-1', status: 'PENDING', basis: 'ACCEPTED', language: 'fa' });
    expect(data.competitorSet.map((c: { competitorId: string }) => c.competitorId)).toEqual(['c1', 'c2']);
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      action: 'MATRICES_STARTED',
      detail: { runId: 'run-1', basis: 'ACCEPTED' },
    });
    expect(backgroundRunMock.triggerBackgroundRun).not.toHaveBeenCalled();
  });

  it('refuses while a run is active', async () => {
    prismaMock.matrixRun.findFirst.mockResolvedValue({ id: 'other' });
    expect(await createMatrixRunRow(owned)).toEqual({ ok: false, errorKey: 'matrixAlreadyRunning' });
    expect(prismaMock.matrixRun.create).not.toHaveBeenCalled();
  });

  it('maps a concurrent create (P2002) to matrixAlreadyRunning', async () => {
    prismaMock.matrixRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
    );
    expect(await createMatrixRunRow(owned)).toEqual({ ok: false, errorKey: 'matrixAlreadyRunning' });
  });

  it('rethrows any other database error', async () => {
    prismaMock.matrixRun.create.mockRejectedValue(new Error('connection refused'));
    await expect(createMatrixRunRow(owned)).rejects.toThrow('connection refused');
  });

  it('needs 2 selected competitors and a brand summary', async () => {
    prismaMock.competitor.findMany.mockResolvedValue([competitor('c1')]);
    expect(await createMatrixRunRow(owned)).toEqual({ ok: false, errorKey: 'needTwoReviewedMatrices' });

    prismaMock.competitor.findMany.mockResolvedValue([competitor('c1'), competitor('c2')]);
    expect(await createMatrixRunRow({ userId: 'user-1', workspace: { ...workspace, brandSummary: null } })).toEqual({
      ok: false,
      errorKey: 'matrixNeedsBrandSummary',
    });
  });
});

describe('dispatchMatrixRun', () => {
  const run = { runId: 'run-1', userId: 'user-1', workspaceId: 'ws-1' };

  it('triggers the background route with the run id only', async () => {
    expect(await dispatchMatrixRun(run)).toEqual({ ok: true, runId: 'run-1' });
    expect(backgroundRunMock.triggerBackgroundRun).toHaveBeenCalledWith('/api/matrices/run', { runId: 'run-1' });
  });

  it('marks a still-PENDING run FAILED with DISPATCH_FAILED and logs it', async () => {
    backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'fetch failed' });

    expect(await dispatchMatrixRun(run)).toEqual({ ok: false, errorKey: 'matrixDispatchFailed' });
    const write = prismaMock.matrixRun.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: 'run-1', status: 'PENDING' });
    expect(write.data).toMatchObject({ status: 'FAILED', error: 'DISPATCH_FAILED: fetch failed' });
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRICES_DISPATCH_FAILED', detail: { runId: 'run-1', error: 'fetch failed' } }),
    );
  });

  it('a timed-out trigger whose run the route already claimed is live, not failed', async () => {
    backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'timeout' });
    prismaMock.matrixRun.updateMany.mockResolvedValue({ count: 0 });

    expect(await dispatchMatrixRun(run)).toEqual({ ok: true, runId: 'run-1' });
    expect(activityLogMock.writeActivityLog).not.toHaveBeenCalled();
  });
});

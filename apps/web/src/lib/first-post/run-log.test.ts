import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    activity_logs: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import {
  claimRun,
  countOtherAngles,
  insertRunStarted,
  nextAttempt,
  readRunRows,
  readRunStarted,
  writeStepRow,
} from './run-log';

const p2002 = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.activity_logs.create.mockResolvedValue({});
});

describe('insertRunStarted', () => {
  it('writes the RUN_STARTED row with the deterministic id as its primary key', async () => {
    const result = await insertRunStarted({ userId: 'u1', workspaceId: 'ws1', attempt: 2, accepted: 3 });

    expect(result).toEqual({ ok: true, runId: 'fpr_ws1_2' });
    expect(prismaMock.activity_logs.create).toHaveBeenCalledWith({
      data: {
        id: 'fpr_ws1_2',
        user_id: 'u1',
        workspace_id: 'ws1',
        action: 'FIRST_POST_RUN_STARTED',
        detail: { runId: 'fpr_ws1_2', attempt: 2, accepted: 3, kind: 'start' },
      },
    });
  });

  it('records the kind for an other-angle run', async () => {
    await insertRunStarted({ userId: 'u1', workspaceId: 'ws1', attempt: 3, accepted: 2, kind: 'otherAngle' });
    expect(prismaMock.activity_logs.create.mock.calls[0][0].data.detail.kind).toBe('otherAngle');
  });

  it('P2002 (a concurrent start computed the same id) is alreadyRunning: that is the lock', async () => {
    prismaMock.activity_logs.create.mockRejectedValue(p2002());
    expect(await insertRunStarted({ userId: 'u1', workspaceId: 'ws1', attempt: 1, accepted: 2 })).toEqual({
      ok: false,
      reason: 'alreadyRunning',
      runId: 'fpr_ws1_1',
    });
  });

  it('any other database error is thrown, never read as a start', async () => {
    prismaMock.activity_logs.create.mockRejectedValue(new Error('db down'));
    await expect(insertRunStarted({ userId: 'u1', workspaceId: 'ws1', attempt: 1, accepted: 2 })).rejects.toThrow('db down');
  });
});

describe('writeStepRow', () => {
  it('awaits one insert with a random id and the given detail', async () => {
    await writeStepRow({
      userId: 'u1',
      workspaceId: 'ws1',
      action: 'FIRST_POST_STEP_DONE',
      detail: { runId: 'fpr_ws1_1', step: 'keywords', ms: 12, summary: { competitors: 2 } },
    });
    const data = prismaMock.activity_logs.create.mock.calls[0][0].data;
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data).toMatchObject({ user_id: 'u1', workspace_id: 'ws1', action: 'FIRST_POST_STEP_DONE' });
    expect(data.detail).toEqual({ runId: 'fpr_ws1_1', step: 'keywords', ms: 12, summary: { competitors: 2 } });
  });

  it('throws when the write fails: the run rows are the state', async () => {
    prismaMock.activity_logs.create.mockRejectedValue(new Error('db down'));
    await expect(
      writeStepRow({ userId: 'u1', workspaceId: 'ws1', action: 'FIRST_POST_STEP_FAILED', detail: { runId: 'r', step: 'idea', errorKind: 'generic' } }),
    ).rejects.toThrow('db down');
  });
});

describe('reads', () => {
  it('readRunRows: the newest 50 run rows of the workspace, oldest first, as FirstPostLogRow', async () => {
    const t1 = new Date('2026-11-23T10:00:00Z');
    const t2 = new Date('2026-11-23T10:01:00Z');
    prismaMock.activity_logs.findMany.mockResolvedValue([
      { id: 'b', action: 'FIRST_POST_STEP_DONE', detail: { runId: 'fpr_ws1_1' }, created_at: t2 },
      { id: 'fpr_ws1_1', action: 'FIRST_POST_RUN_STARTED', detail: { runId: 'fpr_ws1_1' }, created_at: t1 },
    ]);

    const rows = await readRunRows('ws1');

    const query = prismaMock.activity_logs.findMany.mock.calls[0][0];
    expect(query.where).toEqual({
      workspace_id: 'ws1',
      action: {
        in: [
          'FIRST_POST_RUN_STARTED',
          'FIRST_POST_STEP_DONE',
          'FIRST_POST_STEP_SKIPPED',
          'FIRST_POST_STEP_FAILED',
          'FIRST_POST_RUN_FINISHED',
        ],
      },
    });
    expect(query.orderBy).toEqual({ created_at: 'desc' });
    expect(query.take).toBe(50);
    expect(rows.map((r) => r.id)).toEqual(['fpr_ws1_1', 'b']);
    expect(rows[0].createdAt).toBe(t1);
  });

  it('readRunStarted: only a FIRST_POST_RUN_STARTED row with a workspace counts', async () => {
    prismaMock.activity_logs.findUnique.mockResolvedValueOnce({
      id: 'fpr_ws1_1',
      user_id: 'u1',
      workspace_id: 'ws1',
      action: 'FIRST_POST_RUN_STARTED',
      detail: { runId: 'fpr_ws1_1', attempt: 1, accepted: 2, kind: 'otherAngle' },
    });
    expect(await readRunStarted('fpr_ws1_1')).toEqual({
      runId: 'fpr_ws1_1',
      userId: 'u1',
      workspaceId: 'ws1',
      kind: 'otherAngle',
    });

    prismaMock.activity_logs.findUnique.mockResolvedValueOnce({
      id: 'x',
      user_id: 'u1',
      workspace_id: 'ws1',
      action: 'STEP_VIEWED',
      detail: {},
    });
    expect(await readRunStarted('x')).toBeNull();

    prismaMock.activity_logs.findUnique.mockResolvedValueOnce(null);
    expect(await readRunStarted('missing')).toBeNull();

    prismaMock.activity_logs.findUnique.mockResolvedValueOnce({
      id: 'y',
      user_id: 'u1',
      workspace_id: null,
      action: 'FIRST_POST_RUN_STARTED',
      detail: {},
    });
    expect(await readRunStarted('y')).toBeNull();
  });

  it('nextAttempt counts every RUN_STARTED row of the workspace', async () => {
    prismaMock.activity_logs.count.mockResolvedValue(2);
    expect(await nextAttempt('ws1')).toBe(3);
    expect(prismaMock.activity_logs.count).toHaveBeenCalledWith({
      where: { workspace_id: 'ws1', action: 'FIRST_POST_RUN_STARTED' },
    });
  });

  it('countOtherAngles counts FIRST_POST_OTHER_ANGLE rows', async () => {
    prismaMock.activity_logs.count.mockResolvedValue(1);
    expect(await countOtherAngles('ws1')).toBe(1);
    expect(prismaMock.activity_logs.count).toHaveBeenCalledWith({
      where: { workspace_id: 'ws1', action: 'FIRST_POST_OTHER_ANGLE' },
    });
  });
});

describe('claimRun', () => {
  it('inserts one claim row per run; the first caller wins', async () => {
    expect(await claimRun({ runId: 'fpr_ws1_1', userId: 'u1', workspaceId: 'ws1' })).toBe(true);
    expect(prismaMock.activity_logs.create).toHaveBeenCalledWith({
      data: {
        id: 'fpr_ws1_1:claim',
        user_id: 'u1',
        workspace_id: 'ws1',
        action: 'FIRST_POST_RUN_CLAIMED',
        detail: { runId: 'fpr_ws1_1' },
      },
    });

    prismaMock.activity_logs.create.mockRejectedValue(p2002());
    expect(await claimRun({ runId: 'fpr_ws1_1', userId: 'u1', workspaceId: 'ws1' })).toBe(false);
  });

  it('throws any other database error', async () => {
    prismaMock.activity_logs.create.mockRejectedValue(new Error('db down'));
    await expect(claimRun({ runId: 'r', userId: 'u1', workspaceId: 'ws1' })).rejects.toThrow('db down');
  });
});

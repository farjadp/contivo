import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { bugReport: { deleteMany: vi.fn(), updateMany: vi.fn() } },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { purgeBugReportsForUser, purgeBugReportsForWorkspace, purgeOldBugReports } from './retention';

beforeEach(() => vi.clearAllMocks());

describe('retention', () => {
  it('deletes rows older than 90 days', async () => {
    prismaMock.bugReport.deleteMany.mockResolvedValue({ count: 3 });
    const now = new Date('2026-11-22T00:00:00Z');
    expect(await purgeOldBugReports(now)).toBe(3);
    const cutoff: Date = prismaMock.bugReport.deleteMany.mock.calls[0][0].where.createdAt.lt;
    expect(cutoff.toISOString()).toBe('2026-08-24T00:00:00.000Z');
  });

  it('honours a custom window', async () => {
    prismaMock.bugReport.deleteMany.mockResolvedValue({ count: 0 });
    await purgeOldBugReports(new Date('2026-11-22T00:00:00Z'), 30);
    expect(prismaMock.bugReport.deleteMany.mock.calls[0][0].where.createdAt.lt.toISOString()).toBe('2026-10-23T00:00:00.000Z');
  });

  it('erases message and context for a user, keeping the rows', async () => {
    prismaMock.bugReport.updateMany.mockResolvedValue({ count: 2 });
    expect(await purgeBugReportsForUser('u1')).toBe(2);
    expect(prismaMock.bugReport.updateMany).toHaveBeenCalledWith({ where: { userId: 'u1' }, data: { message: null, context: {} } });
  });

  it('erases message and context for a workspace', async () => {
    prismaMock.bugReport.updateMany.mockResolvedValue({ count: 1 });
    await purgeBugReportsForWorkspace('w1');
    expect(prismaMock.bugReport.updateMany).toHaveBeenCalledWith({ where: { workspaceId: 'w1' }, data: { message: null, context: {} } });
  });
});

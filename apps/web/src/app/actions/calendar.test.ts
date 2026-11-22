import { beforeEach, describe, expect, it, vi } from 'vitest';

// updateContentAndSchedule must store the customer's wall-clock time in the
// zone they chose, as a UTC instant — independent of the server's own zone.
// Run with TZ=UTC to match production (Railway).

const { prismaMock, activityLogMock } = vi.hoisted(() => ({
  prismaMock: {
    contentItem: { update: vi.fn() },
  },
  activityLogMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'user-1' })) }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));

import { updateContentAndSchedule } from './calendar';

function payload(overrides: Partial<Parameters<typeof updateContentAndSchedule>[0]> = {}) {
  return {
    contentId: 'item-1',
    content: 'Body',
    platform: 'blog',
    publishDate: '2026-11-24',
    publishTime: '09:00',
    timezone: 'America/Toronto',
    ...overrides,
  };
}

function updateData(): { scheduledAtUtc: Date | null; status: string; scheduledTimezone: string | null } {
  const call = prismaMock.contentItem.update.mock.calls[0]?.[0] as {
    data: { scheduledAtUtc: Date | null; status: string; scheduledTimezone: string | null };
  };
  return call.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentItem.update.mockResolvedValue({ id: 'item-1', workspaceId: 'ws-1' });
});

describe('updateContentAndSchedule time zone', () => {
  it('stores 09:00 Toronto (EST) as 14:00Z', async () => {
    await updateContentAndSchedule(payload());
    expect(updateData().scheduledAtUtc?.toISOString()).toBe('2026-11-24T14:00:00.000Z');
    expect(updateData().status).toBe('SCHEDULED');
    expect(updateData().scheduledTimezone).toBe('America/Toronto');
  });

  it('stores 09:00 London summer (BST) as 08:00Z', async () => {
    await updateContentAndSchedule(
      payload({ publishDate: '2026-07-01', publishTime: '09:00', timezone: 'Europe/London' }),
    );
    expect(updateData().scheduledAtUtc?.toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });

  it('keeps the item READY with no schedule when no date is given', async () => {
    await updateContentAndSchedule(payload({ publishDate: '', publishTime: '' }));
    expect(updateData().scheduledAtUtc).toBeNull();
    expect(updateData().status).toBe('READY');
  });

  it('rejects a date and time it cannot read instead of saving a wrong instant', async () => {
    await expect(
      updateContentAndSchedule(payload({ publishDate: '2026-13-40', publishTime: '09:00' })),
    ).rejects.toThrow('Could not read that publish date and time.');
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });
});

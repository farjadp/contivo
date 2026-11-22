import { beforeEach, describe, expect, it, vi } from 'vitest';

// updateContentAndSchedule must store the customer's wall-clock time in the
// zone they chose, as a UTC instant — independent of the server's own zone.
// Run with TZ=UTC to match production (Railway).

const { prismaMock, activityLogMock } = vi.hoisted(() => ({
  prismaMock: {
    contentItem: { update: vi.fn(), findFirst: vi.fn() },
  },
  activityLogMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'user-1' })) }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));

import { scheduleContentItem, updateContentAndSchedule, updateContentStatus } from './calendar';

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
  prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'item-1', workspaceId: 'ws-1', content: 'Body', qualityVerdict: null });
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

// B8: the gate is enforced on the server, not only by hiding buttons.
describe('quality gate enforcement', () => {
  const FAILED = { approved: false, rejectedBy: 'low_score', reasons: ['Below threshold: clarity 4/10.'], judgeModel: 'm1', source: 'pipeline' };
  const schedule = { contentId: 'item-1', platform: 'linkedin', publishDate: '2026-11-24', publishTime: '09:00', timezone: 'America/Toronto' };

  function blocked() {
    prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'item-1', workspaceId: 'ws-1', content: 'Body', qualityVerdict: FAILED });
  }

  it('refuses to approve, schedule or edit-and-schedule a blocked item', async () => {
    blocked();
    await expect(updateContentStatus('item-1', 'READY')).rejects.toThrow('quality_gate_blocked');
    await expect(scheduleContentItem(schedule)).rejects.toThrow('quality_gate_blocked');
    await expect(updateContentAndSchedule(payload())).rejects.toThrow('quality_gate_blocked');
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });

  it('still lets a blocked item move back to draft or be archived', async () => {
    blocked();
    await updateContentStatus('item-1', 'ARCHIVED');
    expect(updateData().status).toBe('ARCHIVED');
  });

  it('publishes anyway on override, and records who and when', async () => {
    blocked();
    await scheduleContentItem({ ...schedule, override: true });
    const data = prismaMock.contentItem.update.mock.calls[0][0].data;
    expect(data.status).toBe('SCHEDULED');
    expect(data.qualityVerdict.override).toMatchObject({ userId: 'user-1' });
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'QUALITY_GATE_OVERRIDDEN',
        detail: expect.objectContaining({ itemId: 'item-1', rejectedBy: 'low_score', judgeModel: 'm1' }),
      }),
    );
  });

  it('approve anyway works through updateContentStatus too', async () => {
    blocked();
    await updateContentStatus('item-1', 'READY', { override: true });
    expect(updateData().status).toBe('READY');
  });

  it('ungated items (legacy, Write a post) schedule exactly as before', async () => {
    await scheduleContentItem(schedule);
    expect(updateData().status).toBe('SCHEDULED');
    expect(prismaMock.contentItem.update.mock.calls[0][0].data).not.toHaveProperty('qualityVerdict');
  });

  it('editing the body of a gated item resets it to not_checked and holds it unscheduled', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'item-1', workspaceId: 'ws-1', content: 'Old body', qualityVerdict: { approved: true, source: 'pipeline' } });
    await updateContentAndSchedule(payload({ content: 'New body' }));
    const data = prismaMock.contentItem.update.mock.calls[0][0].data;
    expect(data.qualityVerdict).toMatchObject({ approved: false, rejectedBy: 'not_checked' });
    expect(data.status).toBe('GENERATED');
    expect(data.scheduledAtUtc).toBeNull();
  });

  it('editing an approved item without changing the body keeps its verdict and schedules', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'item-1', workspaceId: 'ws-1', content: 'Body', qualityVerdict: { approved: true, source: 'pipeline' } });
    await updateContentAndSchedule(payload());
    expect(updateData().status).toBe('SCHEDULED');
    expect(prismaMock.contentItem.update.mock.calls[0][0].data).not.toHaveProperty('qualityVerdict');
  });
});

describe('edit + publish anyway', () => {
  it('an edited gated body with override schedules and stamps the override', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'item-1', workspaceId: 'ws-1', content: 'Old', qualityVerdict: { approved: true } });
    await updateContentAndSchedule(payload({ content: 'New', override: true }));
    const data = prismaMock.contentItem.update.mock.calls[0][0].data;
    expect(data.status).toBe('SCHEDULED');
    expect(data.qualityVerdict).toMatchObject({ rejectedBy: 'not_checked', override: { userId: 'user-1' } });
  });
});

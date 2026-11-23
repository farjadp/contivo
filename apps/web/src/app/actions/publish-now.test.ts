import { beforeEach, describe, expect, it, vi } from 'vitest';

// Publish now (spec D6) = schedule at now, through the scheduler's one
// publish path. Every expected refusal is a result, because Next redacts
// thrown messages in production. Run with TZ=UTC to match production.

const { prismaMock, activityLogMock, sessionMock } = vi.hoisted(() => ({
  prismaMock: {
    contentItem: { findFirst: vi.fn(), updateMany: vi.fn() },
    socialConnection: { findFirst: vi.fn() },
    siteConnection: { findFirst: vi.fn() },
    socialPublishJob: { findFirst: vi.fn() },
  },
  activityLogMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: sessionMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));

import { getPublishProgress, publishNow, schedulePublish } from './publish-now';

const FAILED_VERDICT = { approved: false, rejectedBy: 'low_score', reasons: ['Below threshold.'], judgeModel: 'm1', source: 'pipeline' };

function item(extra: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    status: 'GENERATED',
    channel: 'linkedin',
    content: 'Secret post body',
    qualityVerdict: null,
    ...extra,
  };
}

function writtenData() {
  return prismaMock.contentItem.updateMany.mock.calls[0]?.[0]?.data;
}

function logged(action: string) {
  return activityLogMock.mock.calls.map((c) => c[0]).find((row) => row.action === action);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ userId: 'user-1' });
  prismaMock.contentItem.findFirst.mockResolvedValue(item());
  prismaMock.contentItem.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.socialConnection.findFirst.mockResolvedValue({ id: 'conn-1' });
  prismaMock.siteConnection.findFirst.mockResolvedValue(null);
  prismaMock.socialPublishJob.findFirst.mockResolvedValue(null);
  activityLogMock.mockResolvedValue(undefined);
});

describe('publishNow', () => {
  it('loads the item by id AND the session user', async () => {
    await publishNow('item-1');
    expect(prismaMock.contentItem.findFirst.mock.calls[0][0].where).toEqual({ id: 'item-1', userId: 'user-1' });
  });

  it('with a connected default account: SCHEDULED at now, in UTC', async () => {
    const before = Date.now();
    const result = await publishNow('item-1');
    expect(result.ok).toBe(true);
    const call = prismaMock.contentItem.updateMany.mock.calls[0][0];
    expect(call.where).toMatchObject({ id: 'item-1', userId: 'user-1' });
    expect(call.data.status).toBe('SCHEDULED');
    expect(call.data.scheduledTimezone).toBe('UTC');
    const at = (call.data.scheduledAtUtc as Date).getTime();
    expect(Math.abs(at - before)).toBeLessThan(1000);
  });

  it('asks for the default CONNECTED account of the item channel', async () => {
    await publishNow('item-1');
    expect(prismaMock.socialConnection.findFirst.mock.calls[0][0].where).toEqual({
      workspaceId: 'ws-1',
      platform: 'LINKEDIN',
      status: 'CONNECTED',
      isDefault: true,
    });
  });

  it('logs FIRST_POST_PUBLISH_REQUESTED and CONTENT_SCHEDULED with ids only, never the text', async () => {
    await publishNow('item-1');
    expect(logged('FIRST_POST_PUBLISH_REQUESTED')).toMatchObject({
      userId: 'user-1',
      workspaceId: 'ws-1',
      detail: { contentId: 'item-1', channel: 'linkedin' },
    });
    expect(logged('CONTENT_SCHEDULED')).toMatchObject({
      workspaceId: 'ws-1',
      detail: { contentId: 'item-1', platform: 'linkedin', timezone: 'UTC', publishNow: true },
    });
    expect(JSON.stringify(activityLogMock.mock.calls)).not.toContain('Secret post body');
  });

  it('without a connection: no_connection with the platform, and nothing written', async () => {
    prismaMock.socialConnection.findFirst.mockResolvedValue(null);
    expect(await publishNow('item-1')).toEqual({ ok: false, reason: 'no_connection', platform: 'LINKEDIN' });
    expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('a blocked verdict is quality_gate_blocked, nothing written', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ qualityVerdict: FAILED_VERDICT }));
    expect(await publishNow('item-1')).toEqual({ ok: false, reason: 'quality_gate_blocked' });
    expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
  });

  it('override passes the gate and stamps who overrode it', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ qualityVerdict: FAILED_VERDICT }));
    const result = await publishNow('item-1', { override: true });
    expect(result.ok).toBe(true);
    expect(writtenData().qualityVerdict.override).toMatchObject({ userId: 'user-1' });
    expect(logged('QUALITY_GATE_OVERRIDDEN')).toBeTruthy();
    expect(logged('FIRST_POST_PUBLISH_REQUESTED')?.detail).toMatchObject({ override: true });
  });

  it('override without a connection writes nothing, not even the override audit', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ qualityVerdict: FAILED_VERDICT }));
    prismaMock.socialConnection.findFirst.mockResolvedValue(null);
    expect(await publishNow('item-1', { override: true })).toEqual({ ok: false, reason: 'no_connection', platform: 'LINKEDIN' });
    expect(await schedulePublish({ contentId: 'item-1', platform: 'linkedin', publishDate: '2026-11-24', publishTime: '09:00', timezone: 'UTC', override: true })).toEqual({ ok: false, reason: 'no_connection', platform: 'LINKEDIN' });
    expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it("someone else's item (or a missing one) is not_found, nothing written", async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(null);
    expect(await publishNow('item-x')).toEqual({ ok: false, reason: 'not_found' });
    expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
  });

  it('without a session is not_found and reads nothing', async () => {
    sessionMock.mockResolvedValue(null);
    expect(await publishNow('item-1')).toEqual({ ok: false, reason: 'not_found' });
    expect(prismaMock.contentItem.findFirst).not.toHaveBeenCalled();
  });

  it('a blog post with an ACTIVE site is ok', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ channel: 'blog' }));
    prismaMock.siteConnection.findFirst.mockResolvedValue({ id: 'site-1' });
    const result = await publishNow('item-1');
    expect(result.ok).toBe(true);
    expect(prismaMock.siteConnection.findFirst.mock.calls[0][0].where).toEqual({ workspaceId: 'ws-1', status: 'ACTIVE' });
    expect(writtenData().status).toBe('SCHEDULED');
  });

  it('a blog post without a site is no_connection on SITE', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ channel: 'blog' }));
    expect(await publishNow('item-1')).toEqual({ ok: false, reason: 'no_connection', platform: 'SITE' });
  });

  it('an item already PUBLISHING or PUBLISHED is not scheduled again (double click, stale tab)', async () => {
    for (const status of ['PUBLISHING', 'PUBLISHED']) {
      vi.clearAllMocks();
      sessionMock.mockResolvedValue({ userId: 'user-1' });
      prismaMock.contentItem.findFirst.mockResolvedValue(item({ status }));
      const result = await publishNow('item-1');
      expect(result).toMatchObject({ ok: true, item: { status } });
      expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
      expect(activityLogMock).not.toHaveBeenCalled();
    }
  });

  it('the write itself refuses an item the scheduler claimed in the meantime', async () => {
    prismaMock.contentItem.findFirst
      .mockResolvedValueOnce(item())
      .mockResolvedValueOnce(item({ status: 'PUBLISHING' }));
    prismaMock.contentItem.updateMany.mockResolvedValue({ count: 0 });
    const result = await publishNow('item-1');
    expect(prismaMock.contentItem.updateMany.mock.calls[0][0].where.status).toEqual({ notIn: ['PUBLISHING', 'PUBLISHED'] });
    expect(result).toMatchObject({ ok: true, item: { status: 'PUBLISHING' } });
    expect(logged('CONTENT_SCHEDULED')).toBeUndefined();
  });

  it('returns the item as stored after the write', async () => {
    prismaMock.contentItem.findFirst
      .mockResolvedValueOnce(item())
      .mockResolvedValueOnce(item({ status: 'SCHEDULED' }));
    expect(await publishNow('item-1')).toMatchObject({ ok: true, item: { id: 'item-1', status: 'SCHEDULED' } });
  });
});

describe('schedulePublish', () => {
  const payload = {
    contentId: 'item-1',
    platform: 'linkedin',
    publishDate: '2026-11-24',
    publishTime: '09:00',
    timezone: 'America/Toronto',
    campaign: 'Launch',
    notes: 'n',
  };

  it("stores the customer's wall-clock time as UTC, with their zone", async () => {
    const result = await schedulePublish(payload);
    expect(result.ok).toBe(true);
    const data = writtenData();
    expect(data.status).toBe('SCHEDULED');
    expect((data.scheduledAtUtc as Date).toISOString()).toBe('2026-11-24T14:00:00.000Z');
    expect(data.scheduledTimezone).toBe('America/Toronto');
    expect(data).toMatchObject({ campaign: 'Launch', notes: 'n' });
  });

  it('logs CONTENT_SCHEDULED only, not a first-post publish request', async () => {
    await schedulePublish(payload);
    expect(logged('CONTENT_SCHEDULED')?.detail).toMatchObject({
      contentId: 'item-1',
      scheduledAtUtc: '2026-11-24T14:00:00.000Z',
      timezone: 'America/Toronto',
    });
    expect(logged('FIRST_POST_PUBLISH_REQUESTED')).toBeUndefined();
  });

  it('an unreadable date is invalid_date, nothing read or written', async () => {
    expect(await schedulePublish({ ...payload, publishDate: '2026-13-40' })).toEqual({ ok: false, reason: 'invalid_date' });
    expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
  });

  it('no connection and a blocked gate are results, as in publishNow', async () => {
    prismaMock.socialConnection.findFirst.mockResolvedValue(null);
    expect(await schedulePublish(payload)).toEqual({ ok: false, reason: 'no_connection', platform: 'LINKEDIN' });
    prismaMock.socialConnection.findFirst.mockResolvedValue({ id: 'conn-1' });
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ qualityVerdict: FAILED_VERDICT }));
    expect(await schedulePublish(payload)).toEqual({ ok: false, reason: 'quality_gate_blocked' });
    expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
  });

  it("someone else's item is not_found", async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(null);
    expect(await schedulePublish(payload)).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('getPublishProgress', () => {
  function job(extra: Record<string, unknown> = {}) {
    return {
      platform: 'LINKEDIN',
      status: 'PUBLISHED',
      externalPostUrl: 'https://www.linkedin.com/feed/update/urn:li:share:1',
      lastError: null,
      publishedAtUtc: new Date('2026-11-23T15:00:00Z'),
      connection: { status: 'CONNECTED' },
      ...extra,
    };
  }

  it('reads the item by id AND user, and its newest job in the same workspace', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ status: 'SCHEDULED', failedReason: null, publishedAtUtc: null }));
    await getPublishProgress('item-1');
    expect(prismaMock.contentItem.findFirst.mock.calls[0][0].where).toEqual({ id: 'item-1', userId: 'user-1' });
    const q = prismaMock.socialPublishJob.findFirst.mock.calls[0][0];
    expect(q.where).toEqual({ contentItemId: 'item-1', workspaceId: 'ws-1' });
    expect(q.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('PUBLISHED + a job URL → published with that URL', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ status: 'PUBLISHED', failedReason: null, publishedAtUtc: null }));
    prismaMock.socialPublishJob.findFirst.mockResolvedValue(job());
    expect(await getPublishProgress('item-1')).toEqual({
      status: 'PUBLISHED',
      outcome: {
        kind: 'published',
        url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
        platform: 'LINKEDIN',
        publishedAtUtc: '2026-11-23T15:00:00.000Z',
      },
    });
  });

  it('a javascript: URL from the provider is dropped', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ status: 'PUBLISHED', failedReason: null, publishedAtUtc: null }));
    prismaMock.socialPublishJob.findFirst.mockResolvedValue(job({ externalPostUrl: 'javascript:alert(1)' }));
    const progress = await getPublishProgress('item-1');
    expect(progress.outcome).toMatchObject({ kind: 'published', url: null });
  });

  it('a failed job with no connection offers connect', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(
      item({ status: 'FAILED', failedReason: '[NO_CONNECTION] No default LINKEDIN connection found.', publishedAtUtc: null }),
    );
    prismaMock.socialPublishJob.findFirst.mockResolvedValue(null);
    const progress = await getPublishProgress('item-1');
    expect(progress.status).toBe('FAILED');
    expect(progress.outcome).toMatchObject({ kind: 'failed', code: 'NO_CONNECTION', action: { action: 'connect', tab: 'social' } });
  });

  it('still waiting: no outcome, the status says where it is', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(item({ status: 'PUBLISHING', failedReason: null, publishedAtUtc: null }));
    expect(await getPublishProgress('item-1')).toEqual({ outcome: null, status: 'PUBLISHING' });
  });

  it("someone else's item, or no session: nothing", async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(null);
    expect(await getPublishProgress('item-x')).toEqual({ outcome: null, status: null });
    expect(prismaMock.socialPublishJob.findFirst).not.toHaveBeenCalled();
    sessionMock.mockResolvedValue(null);
    expect(await getPublishProgress('item-1')).toEqual({ outcome: null, status: null });
  });
});

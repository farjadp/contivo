import { beforeEach, describe, expect, it, vi } from 'vitest';

// W2 (spec D7): nothing is scheduled unless something can publish it. The
// check mirrors what the API scheduler looks for at due time
// (social-scheduler.service.ts: CONNECTED + isDefault for the platform), and
// what the web blog publisher looks for (an ACTIVE site connection).

const { socialFindFirst, siteFindFirst } = vi.hoisted(() => ({
  socialFindFirst: vi.fn(),
  siteFindFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    socialConnection: { findFirst: socialFindFirst },
    siteConnection: { findFirst: siteFindFirst },
  },
}));

import { assertPublishTarget, PublishTargetMissingError } from './publish-readiness';

beforeEach(() => {
  vi.clearAllMocks();
  socialFindFirst.mockResolvedValue(null);
  siteFindFirst.mockResolvedValue(null);
});

describe('assertPublishTarget', () => {
  it('is ok with a CONNECTED default connection for the channel platform', async () => {
    socialFindFirst.mockResolvedValue({ id: 'conn-1' });
    expect(await assertPublishTarget('ws-1', 'linkedin')).toEqual({ ok: true });
    expect(socialFindFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', platform: 'LINKEDIN', status: 'CONNECTED', isDefault: true },
      select: { id: true },
    });
  });

  it('maps the channel to its platform (twitter → X)', async () => {
    await assertPublishTarget('ws-1', 'twitter');
    expect(socialFindFirst.mock.calls[0][0].where.platform).toBe('X');
  });

  it('returns no_connection with the platform when there is none, without throwing', async () => {
    expect(await assertPublishTarget('ws-1', 'linkedin')).toEqual({
      ok: false,
      reason: 'no_connection',
      platform: 'LINKEDIN',
    });
  });

  it('blog is ok with an ACTIVE site connection', async () => {
    siteFindFirst.mockResolvedValue({ id: 'site-1' });
    expect(await assertPublishTarget('ws-1', 'blog')).toEqual({ ok: true });
    expect(siteFindFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', status: 'ACTIVE' },
      select: { id: true },
    });
    expect(socialFindFirst).not.toHaveBeenCalled();
  });

  it('blog without an active site is no_connection on SITE', async () => {
    expect(await assertPublishTarget('ws-1', 'blog')).toEqual({ ok: false, reason: 'no_connection', platform: 'SITE' });
  });

  it('a channel nothing publishes (email, unknown) is refused with platform null, no query', async () => {
    expect(await assertPublishTarget('ws-1', 'email')).toEqual({ ok: false, reason: 'no_connection', platform: null });
    expect(await assertPublishTarget('ws-1', 'carrier-pigeon')).toEqual({
      ok: false,
      reason: 'no_connection',
      platform: null,
    });
    expect(socialFindFirst).not.toHaveBeenCalled();
    expect(siteFindFirst).not.toHaveBeenCalled();
  });

  it('an item without a workspace has nothing to publish through', async () => {
    expect(await assertPublishTarget(null, 'linkedin')).toEqual({
      ok: false,
      reason: 'no_connection',
      platform: 'LINKEDIN',
    });
    expect(socialFindFirst).not.toHaveBeenCalled();
  });

  it('lets a database error through instead of reporting a healthy default', async () => {
    socialFindFirst.mockRejectedValue(new Error('db down'));
    await expect(assertPublishTarget('ws-1', 'linkedin')).rejects.toThrow('db down');
  });
});

describe('PublishTargetMissingError', () => {
  it('carries the code as its message, for callers that still throw', () => {
    const err = new PublishTargetMissingError('LINKEDIN');
    expect(err.message).toBe('no_connection');
    expect(err.code).toBe('no_connection');
    expect(err.platform).toBe('LINKEDIN');
  });
});

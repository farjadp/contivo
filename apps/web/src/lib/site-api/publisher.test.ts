import { beforeEach, describe, expect, it, vi } from 'vitest';

// A slug the user chose before publishing is the URL; only items without one
// get an auto slug from the title (spec 2026-11-21, write-own-post).

const { prismaMock, activityLogMock, buildUniqueSlugMock } = vi.hoisted(() => ({
  prismaMock: {
    contentItem: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    siteConnection: { findFirst: vi.fn(), update: vi.fn() },
  },
  activityLogMock: vi.fn(),
  buildUniqueSlugMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('./posts', () => ({ buildUniqueSlug: buildUniqueSlugMock }));

import { publishDueWebContent, revalidateWorkspaceSite } from './publisher';

type UpdateManyArgs = { where: Record<string, unknown>; data: { slug: string; status: string } };

function dueItem(overrides: Record<string, unknown> = {}) {
  return { id: 'item-1', workspaceId: 'ws-1', topic: 'چطور محتوا بنویسیم', userId: 'user-1', slug: null, ...overrides };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  prismaMock.siteConnection.update.mockResolvedValue({});
  prismaMock.siteConnection.findFirst.mockResolvedValue({
    id: 'site-1',
    name: 'Site',
    revalidateUrl: null,
    revalidateSecret: null,
  });
  prismaMock.contentItem.updateMany.mockResolvedValue({ count: 1 });
  buildUniqueSlugMock.mockResolvedValue('post-abcdefgh');
});

describe('publishDueWebContent slug', () => {
  it('selects the stored slug', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([]);
    await publishDueWebContent();
    const args = prismaMock.contentItem.findMany.mock.calls[0]?.[0] as { select: Record<string, boolean> };
    expect(args.select.slug).toBe(true);
  });

  it('publishes with the pre-set slug and does not generate one', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem({ slug: 'how-to-write-content' })]);
    const [outcome] = await publishDueWebContent();
    expect(outcome?.slug).toBe('how-to-write-content');
    expect(outcome?.published).toBe(true);
    expect(buildUniqueSlugMock).not.toHaveBeenCalled();
    const args = prismaMock.contentItem.updateMany.mock.calls[0]?.[0] as UpdateManyArgs;
    expect(args.data.slug).toBe('how-to-write-content');
    expect(args.data.status).toBe('PUBLISHED');
  });

  it('falls back to an auto slug when none is set', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem()]);
    const [outcome] = await publishDueWebContent();
    expect(buildUniqueSlugMock).toHaveBeenCalledWith('ws-1', 'چطور محتوا بنویسیم', 'item-1');
    expect(outcome?.slug).toBe('post-abcdefgh');
  });

  it('treats an empty stored slug as unset', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem({ slug: '' })]);
    const [outcome] = await publishDueWebContent();
    expect(buildUniqueSlugMock).toHaveBeenCalled();
    expect(outcome?.slug).toBe('post-abcdefgh');
  });
});

describe('publishDueWebContent revalidate event', () => {
  it('still sends post.published', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue({
      id: 'site-1',
      name: 'Site',
      revalidateUrl: 'https://site.test/api/revalidate',
      revalidateSecret: null,
    });
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem({ slug: 'live' })]);
    await publishDueWebContent();
    const init = fetchMock.mock.calls[0]?.[1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({ slug: 'live', event: 'post.published' });
  });
});

describe('revalidateWorkspaceSite', () => {
  const activeSite = {
    id: 'site-1',
    name: 'Site',
    revalidateUrl: 'https://site.test/api/revalidate',
    revalidateSecret: 'shh',
  };

  it('returns null when the workspace has no active site', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(null);
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBeNull();
    expect(prismaMock.siteConnection.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the site has no revalidate URL', async () => {
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the slug and event with the bearer secret', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(activeSite);
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe('https://site.test/api/revalidate');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer shh');
    expect(JSON.parse(init.body)).toEqual({ slug: 'live', event: 'post.updated' });
    expect(prismaMock.siteConnection.update).toHaveBeenCalledWith({
      where: { id: 'site-1' },
      data: { lastRevalidateAt: expect.any(Date), lastRevalidateStatus: 200 },
    });
  });

  it('returns false on a non-2xx response', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(activeSite);
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
  });

  it('returns false and does not throw when fetch fails', async () => {
    prismaMock.siteConnection.findFirst.mockResolvedValue(activeSite);
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
  });

  it('returns false and does not throw when the site lookup fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prismaMock.siteConnection.findFirst.mockRejectedValue(new Error('db down'));
    expect(await revalidateWorkspaceSite('ws-1', 'live', 'post.updated')).toBe(false);
    expect(errSpy.mock.calls[0]?.[0]).toBe('[site-publisher] revalidate failed');
    errSpy.mockRestore();
  });
});

describe('publishDueWebContent with no site connection', () => {
  it('parks the item as FAILED with a NO_SITE coded reason', async () => {
    prismaMock.contentItem.findMany.mockResolvedValue([dueItem()]);
    prismaMock.siteConnection.findFirst.mockResolvedValue(null);
    const [outcome] = await publishDueWebContent();
    expect(outcome?.published).toBe(false);
    expect(outcome?.error).toBe('no_site_connection');
    const args = prismaMock.contentItem.update.mock.calls[0]?.[0] as { data: { status: string; failedReason: string } };
    expect(args.data.status).toBe('FAILED');
    expect(args.data.failedReason).toMatch(/^\[NO_SITE\] No active site connection/);
  });
});

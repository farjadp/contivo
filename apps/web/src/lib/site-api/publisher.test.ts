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

import { publishDueWebContent } from './publisher';

type UpdateManyArgs = { where: Record<string, unknown>; data: { slug: string; status: string } };

function dueItem(overrides: Record<string, unknown> = {}) {
  return { id: 'item-1', workspaceId: 'ws-1', topic: 'چطور محتوا بنویسیم', userId: 'user-1', slug: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
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

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// Posts a user writes themselves (spec 2026-11-21, write-own-post). No AI, no
// network, no database: prisma, the session and the activity log are mocked,
// and fetch is stubbed so any network call fails the "no fetch" assertions.

const { prismaMock, activityLogMock, sessionMock, revalidateMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findFirst: vi.fn() },
    contentItem: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  activityLogMock: vi.fn(),
  sessionMock: vi.fn(),
  revalidateMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: sessionMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('@/lib/site-api/publisher', () => ({ revalidateWorkspaceSite: revalidateMock }));

import { createOwnPost, updatePublishedPost, updateOwnPostMeta } from './own-post';

const fetchMock = vi.fn();

type CreateArgs = { data: Record<string, unknown> };
type UpdateArgs = { where: Record<string, unknown>; data: Record<string, unknown> };
type FindArgs = { where: Record<string, unknown> };

function createData(): Record<string, unknown> {
  return (prismaMock.contentItem.create.mock.calls[0]?.[0] as CreateArgs).data;
}
function updateCall(): UpdateArgs {
  return prismaMock.contentItem.update.mock.calls[0]?.[0] as UpdateArgs;
}

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
}

function existingItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    channel: 'blog',
    topic: 'Old title',
    slug: null,
    status: 'READY',
    publishedAtUtc: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  sessionMock.mockResolvedValue({ userId: 'user-1' });
  prismaMock.workspace.findFirst.mockResolvedValue({ id: 'ws-1' });
  revalidateMock.mockResolvedValue(true);
  prismaMock.contentItem.findFirst.mockResolvedValue(null);
  prismaMock.contentItem.create.mockImplementation(async (args: CreateArgs) => ({ id: 'new-1', ...args.data }));
  prismaMock.contentItem.update.mockImplementation(async (args: UpdateArgs) => ({
    ...existingItem(),
    ...args.data,
  }));
});

describe('createOwnPost', () => {
  it('creates a READY blog article from the user text, no AI', async () => {
    const result = await createOwnPost({
      workspaceId: 'ws-1',
      title: '  My own post  ',
      content: '\n# Heading\n\nBody text\n',
      channel: 'blog',
      slug: ' My-Own-Post ',
    });

    expect(result.ok).toBe(true);
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws-1', userId: 'user-1' } }),
    );
    expect(createData()).toEqual({
      userId: 'user-1',
      workspaceId: 'ws-1',
      type: 'ARTICLE',
      channel: 'blog',
      topic: 'My own post',
      content: '# Heading\n\nBody text',
      status: 'READY',
      creditsCost: 0,
      slug: 'my-own-post',
    });
    expect(activityLogMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      action: 'CONTENT_WRITTEN_BY_USER',
      detail: { contentId: 'new-1', channel: 'blog' },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the blog slug null when none is given', async () => {
    await createOwnPost({ workspaceId: 'ws-1', title: 'T', content: 'B', channel: 'blog', slug: '  ' });
    expect(createData().slug).toBeNull();
    expect(prismaMock.contentItem.findFirst).not.toHaveBeenCalled();
  });

  it('creates a LinkedIn POST and ignores any slug', async () => {
    const result = await createOwnPost({
      workspaceId: 'ws-1',
      title: 'Linked',
      content: 'Body',
      channel: 'linkedin',
      slug: 'NOT valid!',
    });
    expect(result.ok).toBe(true);
    expect(createData().type).toBe('POST');
    expect(createData().channel).toBe('linkedin');
    expect(createData().slug).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns not_found for a workspace the user does not own', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(null);
    const result = await createOwnPost({ workspaceId: 'ws-other', title: 'T', content: 'B', channel: 'blog' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(prismaMock.contentItem.create).not.toHaveBeenCalled();
  });

  it('rejects an invalid slug without rewriting it', async () => {
    const result = await createOwnPost({ workspaceId: 'ws-1', title: 'T', content: 'B', channel: 'blog', slug: 'my post' });
    expect(result).toEqual({ ok: false, error: 'slug_invalid' });
    expect(prismaMock.contentItem.create).not.toHaveBeenCalled();
  });

  it('rejects a slug already used in the workspace', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue({ id: 'other' });
    const result = await createOwnPost({ workspaceId: 'ws-1', title: 'T', content: 'B', channel: 'blog', slug: 'taken' });
    expect(result).toEqual({ ok: false, error: 'slug_taken' });
    expect((prismaMock.contentItem.findFirst.mock.calls[0]?.[0] as FindArgs).where).toEqual({
      workspaceId: 'ws-1',
      slug: 'taken',
    });
    expect(prismaMock.contentItem.create).not.toHaveBeenCalled();
  });

  it('maps a unique-constraint race (P2002) to slug_taken', async () => {
    prismaMock.contentItem.create.mockRejectedValue(p2002());
    const result = await createOwnPost({ workspaceId: 'ws-1', title: 'T', content: 'B', channel: 'blog', slug: 'race' });
    expect(result).toEqual({ ok: false, error: 'slug_taken' });
  });

  it('rethrows other database errors', async () => {
    prismaMock.contentItem.create.mockRejectedValue(new Error('db down'));
    await expect(
      createOwnPost({ workspaceId: 'ws-1', title: 'T', content: 'B', channel: 'blog' }),
    ).rejects.toThrow('db down');
  });

  it('validates title, body and channel', async () => {
    expect(await createOwnPost({ workspaceId: 'ws-1', title: ' ', content: 'B', channel: 'blog' })).toEqual({
      ok: false,
      error: 'title_required',
    });
    expect(await createOwnPost({ workspaceId: 'ws-1', title: 'T', content: ' ', channel: 'blog' })).toEqual({
      ok: false,
      error: 'body_required',
    });
    expect(
      await createOwnPost({ workspaceId: 'ws-1', title: 'T', content: 'B', channel: 'twitter' as 'blog' }),
    ).toEqual({ ok: false, error: 'invalid_channel' });
    expect(prismaMock.contentItem.create).not.toHaveBeenCalled();
  });

  it('throws Unauthorized without a session', async () => {
    sessionMock.mockResolvedValue(null);
    await expect(
      createOwnPost({ workspaceId: 'ws-1', title: 'T', content: 'B', channel: 'blog' }),
    ).rejects.toThrow('Unauthorized');
  });
});

describe('updateOwnPostMeta', () => {
  it('changes the title of an item the user owns', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem());
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: '  New title ' });
    expect(result.ok).toBe(true);
    expect((prismaMock.contentItem.findFirst.mock.calls[0]?.[0] as FindArgs).where).toEqual({
      id: 'item-1',
      userId: 'user-1',
    });
    expect(updateCall().where).toEqual({ id: 'item-1' });
    expect(updateCall().data).toEqual({ topic: 'New title' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns not_found for an item the user does not own', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(null);
    const result = await updateOwnPostMeta({ contentId: 'item-x', title: 'T' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });

  it('sets a new slug on an unpublished blog item, checking others in the workspace', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem()).mockResolvedValueOnce(null);
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: 'Fresh-Slug' });
    expect(result.ok).toBe(true);
    expect((prismaMock.contentItem.findFirst.mock.calls[1]?.[0] as FindArgs).where).toEqual({
      workspaceId: 'ws-1',
      slug: 'fresh-slug',
      NOT: { id: 'item-1' },
    });
    expect(updateCall().data).toEqual({ topic: 'T', slug: 'fresh-slug' });
  });

  it('clears the slug when given empty on an unpublished item', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem({ slug: 'old' }));
    await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: '' });
    expect(updateCall().data).toEqual({ topic: 'T', slug: null });
  });

  it('rejects an invalid slug', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem());
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: 'bad slug' });
    expect(result).toEqual({ ok: false, error: 'slug_invalid' });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });

  it('rejects a slug used by another item', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem()).mockResolvedValueOnce({ id: 'other' });
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: 'taken' });
    expect(result).toEqual({ ok: false, error: 'slug_taken' });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });

  it('maps P2002 on update to slug_taken', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem()).mockResolvedValueOnce(null);
    prismaMock.contentItem.update.mockRejectedValue(p2002());
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: 'race' });
    expect(result).toEqual({ ok: false, error: 'slug_taken' });
  });

  it('freezes the slug once published', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(
      existingItem({ slug: 'live', status: 'PUBLISHED', publishedAtUtc: new Date('2026-11-01T00:00:00Z') }),
    );
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: 'changed' });
    expect(result).toEqual({ ok: false, error: 'slug_frozen' });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });

  it('freezes the slug while publishing', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem({ slug: 'live', status: 'PUBLISHING' }));
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: 'changed' });
    expect(result).toEqual({ ok: false, error: 'slug_frozen' });
  });

  it('accepts the same slug after publish and only changes the title', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(
      existingItem({ slug: 'live', status: 'PUBLISHED', publishedAtUtc: new Date('2026-11-01T00:00:00Z') }),
    );
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'Retitled', slug: ' Live ' });
    expect(result.ok).toBe(true);
    expect(updateCall().data).toEqual({ topic: 'Retitled' });
  });

  it('leaves a published slug untouched when no slug or an empty one is sent', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(
      existingItem({ slug: 'live', status: 'PUBLISHED', publishedAtUtc: new Date('2026-11-01T00:00:00Z') }),
    );
    await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: '' });
    expect(updateCall().data).toEqual({ topic: 'T' });
  });

  it('ignores the slug for non-blog items', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem({ channel: 'linkedin' }));
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'T', slug: 'bad slug!' });
    expect(result.ok).toBe(true);
    expect(updateCall().data).toEqual({ topic: 'T' });
  });

  it('validates the title', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(existingItem());
    const result = await updateOwnPostMeta({ contentId: 'item-1', title: 'a'.repeat(201) });
    expect(result).toEqual({ ok: false, error: 'title_too_long' });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });
});

describe('updatePublishedPost', () => {
  const published = (overrides: Record<string, unknown> = {}) =>
    existingItem({
      slug: 'live',
      status: 'PUBLISHED',
      publishedAtUtc: new Date('2026-11-01T00:00:00Z'),
      scheduledAtUtc: new Date('2026-11-01T00:00:00Z'),
      ...overrides,
    });

  it('updates only title and body of a published blog post and revalidates', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(published());
    const result = await updatePublishedPost({ contentId: 'item-1', title: '  Fixed title ', content: '\nFixed body\n' });
    expect(result.ok).toBe(true);
    expect((prismaMock.contentItem.findFirst.mock.calls[0]?.[0] as FindArgs).where).toEqual({
      id: 'item-1',
      userId: 'user-1',
    });
    expect(updateCall().where).toEqual({ id: 'item-1' });
    expect(updateCall().data).toEqual({ topic: 'Fixed title', content: 'Fixed body' });
    expect(revalidateMock).toHaveBeenCalledWith('ws-1', 'live', 'post.updated');
    expect(activityLogMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      action: 'CONTENT_EDITED_AFTER_PUBLISH',
      detail: { contentId: 'item-1', revalidated: true },
    });
  });

  it('returns not_found for an item the user does not own', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(null);
    const result = await updatePublishedPost({ contentId: 'item-x', title: 'T', content: 'B' });
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it.each([
    ['READY', { status: 'READY', publishedAtUtc: null }],
    ['SCHEDULED', { status: 'SCHEDULED', publishedAtUtc: null }],
    ['PUBLISHING', { status: 'PUBLISHING' }],
    ['linkedin', { channel: 'linkedin' }],
    ['no workspace', { workspaceId: null }],
  ])('refuses %s with not_editable', async (_label, overrides) => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(published(overrides));
    const result = await updatePublishedPost({ contentId: 'item-1', title: 'T', content: 'B' });
    expect(result).toEqual({ ok: false, error: 'not_editable' });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('validates title and body', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValue(published());
    expect(await updatePublishedPost({ contentId: 'item-1', title: ' ', content: 'B' })).toEqual({
      ok: false,
      error: 'title_required',
    });
    expect(await updatePublishedPost({ contentId: 'item-1', title: 'T', content: '  ' })).toEqual({
      ok: false,
      error: 'body_required',
    });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
  });

  it('still saves when the revalidate ping fails', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(published());
    revalidateMock.mockResolvedValue(false);
    const result = await updatePublishedPost({ contentId: 'item-1', title: 'T', content: 'B' });
    expect(result.ok).toBe(true);
    expect(activityLogMock.mock.calls[0]?.[0]).toMatchObject({ detail: { contentId: 'item-1', revalidated: false } });
  });

  it('still saves when the revalidate helper throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(published());
    revalidateMock.mockRejectedValue(new Error('boom'));
    const result = await updatePublishedPost({ contentId: 'item-1', title: 'T', content: 'B' });
    expect(result.ok).toBe(true);
    expect(activityLogMock.mock.calls[0]?.[0]).toMatchObject({ detail: { contentId: 'item-1', revalidated: false } });
    errSpy.mockRestore();
  });

  it('skips the ping when the published item has no slug', async () => {
    prismaMock.contentItem.findFirst.mockResolvedValueOnce(published({ slug: null }));
    const result = await updatePublishedPost({ contentId: 'item-1', title: 'T', content: 'B' });
    expect(result.ok).toBe(true);
    expect(revalidateMock).not.toHaveBeenCalled();
    expect(activityLogMock.mock.calls[0]?.[0]).toMatchObject({ detail: { contentId: 'item-1', revalidated: null } });
  });

  it('throws Unauthorized without a session', async () => {
    sessionMock.mockResolvedValue(null);
    await expect(updatePublishedPost({ contentId: 'item-1', title: 'T', content: 'B' })).rejects.toThrow('Unauthorized');
  });
});

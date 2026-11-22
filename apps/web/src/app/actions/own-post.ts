'use server';

// apps/web/src/app/actions/own-post.ts
//
// Posts the user writes themselves (spec 2026-11-21, write-own-post). No AI
// call anywhere: the item is created READY from the user's own text and goes
// through the normal schedule -> publish-due -> Content API path.

import { Prisma, type ContentItem } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { writeActivityLog } from '@/lib/activity-log';
import { revalidateWorkspaceSite } from '@/lib/site-api/publisher';
import {
  normalizeSlugInput,
  validatePostBody,
  validatePostSlug,
  validatePostTitle,
  type OwnPostError,
} from '@/lib/content-slug';

export type OwnPostChannel = 'blog' | 'linkedin';

export type OwnPostResult = { ok: true; item: ContentItem } | { ok: false; error: OwnPostError };

export interface CreateOwnPostInput {
  workspaceId: string;
  title: string;
  content: string;
  channel: OwnPostChannel;
  slug?: string;
}

export interface UpdateOwnPostMetaInput {
  contentId: string;
  title: string;
  slug?: string | null;
}

export interface UpdatePublishedPostInput {
  contentId: string;
  title: string;
  content: string;
}

const TYPE_BY_CHANNEL: Record<OwnPostChannel, 'ARTICLE' | 'POST'> = {
  blog: 'ARTICLE',
  linkedin: 'POST',
};

function isOwnPostChannel(value: unknown): value is OwnPostChannel {
  return value === 'blog' || value === 'linkedin';
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function requireUserId(): Promise<string> {
  const session = await getSession();
  if (!session?.userId) throw new Error('Unauthorized');
  return session.userId;
}

export async function createOwnPost(input: CreateOwnPostInput): Promise<OwnPostResult> {
  const userId = await requireUserId();

  if (!isOwnPostChannel(input.channel)) return { ok: false, error: 'invalid_channel' };

  const titleError = validatePostTitle(input.title ?? '');
  if (titleError) return { ok: false, error: titleError };
  const bodyError = validatePostBody(input.content ?? '');
  if (bodyError) return { ok: false, error: bodyError };

  // Slug only applies to blog items; LinkedIn ignores it entirely.
  let slug: string | null = null;
  if (input.channel === 'blog' && input.slug) {
    const normalized = normalizeSlugInput(input.slug);
    if (normalized.length > 0) {
      const slugError = validatePostSlug(normalized);
      if (slugError) return { ok: false, error: slugError };
      slug = normalized;
    }
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: input.workspaceId, userId },
    select: { id: true },
  });
  if (!workspace) return { ok: false, error: 'not_found' };

  if (slug) {
    const clash = await prisma.contentItem.findFirst({
      where: { workspaceId: workspace.id, slug },
      select: { id: true },
    });
    if (clash) return { ok: false, error: 'slug_taken' };
  }

  let item: ContentItem;
  try {
    item = await prisma.contentItem.create({
      data: {
        userId,
        workspaceId: workspace.id,
        type: TYPE_BY_CHANNEL[input.channel],
        channel: input.channel,
        topic: input.title.trim(),
        content: input.content.trim(),
        status: 'READY',
        creditsCost: 0,
        slug,
      },
    });
  } catch (error) {
    // Two saves racing for the same slug: @@unique([workspaceId, slug]) wins.
    if (isUniqueViolation(error)) return { ok: false, error: 'slug_taken' };
    throw error;
  }

  await writeActivityLog({
    userId,
    workspaceId: workspace.id,
    action: 'CONTENT_WRITTEN_BY_USER',
    detail: { contentId: item.id, channel: input.channel },
  });

  return { ok: true, item };
}

/**
 * Title and slug for any content item the user owns, AI-generated or not.
 * The slug is the live URL, so once an item is (being) published a different
 * slug is refused rather than silently ignored.
 */
export async function updateOwnPostMeta(input: UpdateOwnPostMetaInput): Promise<OwnPostResult> {
  const userId = await requireUserId();

  const item = await prisma.contentItem.findFirst({
    where: { id: input.contentId, userId },
  });
  if (!item) return { ok: false, error: 'not_found' };

  const titleError = validatePostTitle(input.title ?? '');
  if (titleError) return { ok: false, error: titleError };

  const data: { topic: string; slug?: string | null } = { topic: input.title.trim() };

  if (item.channel === 'blog' && input.slug !== undefined) {
    const normalized = input.slug === null ? '' : normalizeSlugInput(input.slug);
    const published =
      item.publishedAtUtc !== null || item.status === 'PUBLISHED' || item.status === 'PUBLISHING';

    if (published) {
      if (normalized.length > 0 && normalized !== item.slug) return { ok: false, error: 'slug_frozen' };
      // Same slug or nothing sent: leave the live slug untouched.
    } else if (normalized.length === 0) {
      data.slug = null;
    } else {
      const slugError = validatePostSlug(normalized);
      if (slugError) return { ok: false, error: slugError };

      if (item.workspaceId) {
        const clash = await prisma.contentItem.findFirst({
          where: { workspaceId: item.workspaceId, slug: normalized, NOT: { id: item.id } },
          select: { id: true },
        });
        if (clash) return { ok: false, error: 'slug_taken' };
      }
      data.slug = normalized;
    }
  }

  try {
    const updated = await prisma.contentItem.update({ where: { id: item.id }, data });
    return { ok: true, item: updated };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'slug_taken' };
    throw error;
  }
}

/**
 * Edit a live blog post in place (spec 2026-11-22, edit-published-post).
 * Only title and body change; status, slug and publish dates stay as they
 * are, so the URL is stable and the blog shows "Updated" from updatedAt.
 * LinkedIn is refused: the post on LinkedIn cannot be changed from here.
 */
export async function updatePublishedPost(input: UpdatePublishedPostInput): Promise<OwnPostResult> {
  const userId = await requireUserId();

  const item = await prisma.contentItem.findFirst({
    where: { id: input.contentId, userId },
  });
  if (!item) return { ok: false, error: 'not_found' };

  if (item.status !== 'PUBLISHED' || item.channel !== 'blog' || !item.workspaceId) {
    return { ok: false, error: 'not_editable' };
  }
  const workspaceId = item.workspaceId;

  const titleError = validatePostTitle(input.title ?? '');
  if (titleError) return { ok: false, error: titleError };
  const bodyError = validatePostBody(input.content ?? '');
  if (bodyError) return { ok: false, error: bodyError };

  const updated = await prisma.contentItem.update({
    where: { id: item.id },
    data: { topic: input.title.trim(), content: input.content.trim() },
  });

  // The Content API already serves the new text; a failed ping only means the
  // site cache refreshes on its own schedule, so it never fails the save.
  let revalidated: boolean | null = null;
  if (item.slug) {
    try {
      revalidated = await revalidateWorkspaceSite(workspaceId, item.slug, 'post.updated');
    } catch (error) {
      console.error('[own-post] revalidate after edit failed', item.id, error);
      revalidated = false;
    }
  }

  await writeActivityLog({
    userId,
    workspaceId,
    action: 'CONTENT_EDITED_AFTER_PUBLISH',
    detail: { contentId: item.id, revalidated },
  });

  return { ok: true, item: updated };
}

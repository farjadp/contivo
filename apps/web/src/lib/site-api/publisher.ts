/**
 * site-api/publisher.ts
 *
 * Publishes website content. The social equivalent lives in the Nest API
 * (SocialSchedulerService); blog items had no publisher at all, which is why
 * ContentChannel.blog was a dead enum.
 *
 * Publishing a blog post means: assign a permanent slug, flip the item to
 * PUBLISHED, and tell the site to revalidate. The site itself pulls the body
 * from /api/v1/posts, so we never push content anywhere.
 */

import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';

import { buildUniqueSlug } from './posts';

/** Channels served by the Content API rather than a social adapter. */
const WEB_CHANNELS = ['blog'] as const;

const REVALIDATE_TIMEOUT_MS = 8000;

export type PublishOutcome = {
  itemId: string;
  workspaceId: string;
  slug: string | null;
  published: boolean;
  revalidated: boolean | null;
  error?: string;
};

/**
 * Publishes every web-channel item whose scheduled time has arrived.
 * Safe to call repeatedly: only SCHEDULED rows are touched, and each is
 * flipped in a single conditional update so two concurrent ticks cannot
 * publish the same item twice.
 */
export async function publishDueWebContent(options: { now?: Date; limit?: number } = {}) {
  const now = options.now ?? new Date();
  const limit = Math.max(1, Math.min(50, options.limit ?? 10));

  const due = await prisma.contentItem.findMany({
    where: {
      status: 'SCHEDULED',
      channel: { in: [...WEB_CHANNELS] as never },
      scheduledAtUtc: { lte: now },
      workspaceId: { not: null },
    },
    orderBy: { scheduledAtUtc: 'asc' },
    take: limit,
    select: { id: true, workspaceId: true, topic: true, userId: true },
  });

  const outcomes: PublishOutcome[] = [];
  for (const item of due) {
    outcomes.push(await publishItem(item));
  }
  return outcomes;
}

async function publishItem(item: {
  id: string;
  workspaceId: string | null;
  topic: string;
  userId: string;
}): Promise<PublishOutcome> {
  const workspaceId = item.workspaceId as string;
  const base = { itemId: item.id, workspaceId };

  try {
    const site = await prisma.siteConnection.findFirst({
      where: { workspaceId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });

    if (!site) {
      // Nothing can serve this post. Park it rather than looping every tick.
      await prisma.contentItem.update({
        where: { id: item.id },
        data: {
          status: 'FAILED',
          failedReason: 'No active site connection for this workspace. Add one on the Connections page.',
        },
      });
      return { ...base, slug: null, published: false, revalidated: null, error: 'no_site_connection' };
    }

    const slug = await buildUniqueSlug(workspaceId, item.topic, item.id);
    const publishedAt = new Date();

    // Conditional on status so a concurrent tick that already published this
    // item results in count 0 here rather than a double publish.
    const { count } = await prisma.contentItem.updateMany({
      where: { id: item.id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHED', publishedAtUtc: publishedAt, slug, failedReason: null },
    });

    if (count === 0) {
      return { ...base, slug: null, published: false, revalidated: null, error: 'already_published' };
    }

    const revalidated = await pingRevalidate(site, slug);

    await writeActivityLog({
      userId: item.userId,
      workspaceId,
      action: 'WEB_CONTENT_PUBLISHED',
      detail: {
        itemId: item.id,
        slug,
        siteId: site.id,
        siteName: site.name,
        publishedAt: publishedAt.toISOString(),
        revalidated,
      },
    });

    return { ...base, slug, published: true, revalidated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[site-publisher] failed to publish', item.id, err);
    return { ...base, slug: null, published: false, revalidated: null, error: message };
  }
}

/**
 * Tells the site a post went live. Fire-and-check: a failed revalidate must
 * never un-publish the post — the content is already available from the API.
 */
async function pingRevalidate(
  site: { id: string; revalidateUrl: string | null; revalidateSecret: string | null },
  slug: string,
): Promise<boolean | null> {
  if (!site.revalidateUrl) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REVALIDATE_TIMEOUT_MS);
  try {
    const res = await fetch(site.revalidateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(site.revalidateSecret ? { Authorization: `Bearer ${site.revalidateSecret}` } : {}),
      },
      body: JSON.stringify({ slug, event: 'post.published' }),
      signal: controller.signal,
    });
    await prisma.siteConnection.update({
      where: { id: site.id },
      data: { lastRevalidateAt: new Date(), lastRevalidateStatus: res.status },
    });
    return res.ok;
  } catch {
    await prisma.siteConnection
      .update({
        where: { id: site.id },
        data: { lastRevalidateAt: new Date(), lastRevalidateStatus: 0 },
      })
      .catch(() => undefined);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

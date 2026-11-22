/**
 * publish-outcome.ts
 *
 * Decides what the Pipeline and the Connections page say about a post once it
 * has gone through publishing: where it landed, or why it did not and what the
 * user can do about it. Pure, so the rules are tested without a browser.
 */

import type { SocialConnectionStatus, SocialPlatform } from '@contivo/types';

/** Connection states that only a new sign-in with the provider can fix. */
const RECONNECT_STATUSES: ReadonlySet<string> = new Set<SocialConnectionStatus>([
  'EXPIRED',
  'REVOKED',
  'PENDING_REAUTH',
  'FAILED',
]);

/**
 * Platforms with an OAuth connect flow today: the allow-list in
 * `getSocialConnectUrl` (actions/social-connect.ts). A subset of PLATFORM_KEYS,
 * typed against it so a renamed platform fails to compile. TELEGRAM and THREADS
 * are deliberately absent until their connect flows exist.
 */
const CONNECTABLE_PLATFORMS: ReadonlySet<string> = new Set<SocialPlatform>(['LINKEDIN', 'X', 'FACEBOOK', 'TIKTOK']);

export function needsReconnect(connectionStatus: string | null | undefined): boolean {
  return connectionStatus != null && RECONNECT_STATUSES.has(connectionStatus);
}

export function canStartConnectFlow(platform: string): boolean {
  return CONNECTABLE_PLATFORMS.has(platform.toUpperCase());
}

/**
 * The messages the scheduler and the site publisher write when there is no
 * connection to publish through at all (social-scheduler.service.ts,
 * lib/site-api/publisher.ts). Matching their text is brittle, so it is kept to
 * the two sentences we write ourselves.
 */
const MISSING_CONNECTION_PATTERNS = [/no default \w+ connection found/i, /no active site connection/i];

export function isMissingConnectionReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return MISSING_CONNECTION_PATTERNS.some((pattern) => pattern.test(reason));
}

/** The latest social publish job for one content item, as read from Prisma. */
export type LatestPublishJob = {
  platform: string;
  status: string;
  externalPostUrl: string | null;
  lastError: string | null;
  publishedAtUtc: string | null;
  connectionStatus: string | null;
};

export type PublishOutcome =
  | { kind: 'published'; url: string | null; platform: string | null; publishedAtUtc: string | null }
  | { kind: 'failed'; reason: string | null; action: 'reconnect' | 'connect' | null; platform: string | null };

/**
 * Only http(s) links are rendered as links; anything else from a provider is
 * dropped rather than put in an href.
 */
export function safePostUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function resolvePublishOutcome(
  item: { status: string; failedReason?: string | null; publishedAtUtc?: string | Date | null },
  job: LatestPublishJob | null | undefined,
): PublishOutcome | null {
  const jobPublished = job?.status === 'PUBLISHED';
  const jobFailed = job?.status === 'FAILED';

  if (item.status === 'PUBLISHED' || jobPublished) {
    const itemPublishedAt =
      item.publishedAtUtc instanceof Date ? item.publishedAtUtc.toISOString() : item.publishedAtUtc ?? null;
    return {
      kind: 'published',
      url: jobPublished ? safePostUrl(job?.externalPostUrl) : null,
      platform: job?.platform ?? null,
      publishedAtUtc: (jobPublished ? job?.publishedAtUtc : null) ?? itemPublishedAt,
    };
  }

  if (item.status === 'FAILED' || jobFailed) {
    // The item's reason is written last by the publisher; the job's error is the fallback.
    const reason = item.failedReason?.trim() || job?.lastError?.trim() || null;
    let action: 'reconnect' | 'connect' | null = null;
    if (needsReconnect(job?.connectionStatus)) action = 'reconnect';
    else if (isMissingConnectionReason(reason)) action = 'connect';
    return { kind: 'failed', reason, action, platform: job?.platform ?? null };
  }

  return null;
}

/** Keeps the newest job per content item. Input must be ordered newest first. */
export function latestJobByContentItem<T extends { contentItemId: string | null }>(
  jobs: T[],
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const job of jobs) {
    if (job.contentItemId && !latest.has(job.contentItemId)) latest.set(job.contentItemId, job);
  }
  return latest;
}

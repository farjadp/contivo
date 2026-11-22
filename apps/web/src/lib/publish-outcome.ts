/**
 * publish-outcome.ts
 *
 * Decides what the Pipeline and the Connections page say about a post once it
 * has gone through publishing: where it landed, or why it did not and what the
 * user can do about it. Pure, so the rules are tested without a browser.
 */

import {
  parseFailure,
  type PublishFailureCode,
  type SocialConnectionStatus,
  type SocialPlatform,
} from '@contivo/types';

/** Connection states that only a new sign-in with the provider can fix. */
const RECONNECT_STATUSES: ReadonlySet<string> = new Set<SocialConnectionStatus>([
  'EXPIRED',
  'REVOKED',
  'PENDING_REAUTH',
  'FAILED',
]);

/**
 * Platforms with a connect flow the web can restart today: the OAuth
 * allow-list in `getSocialConnectUrl` (actions/social-connect.ts), plus
 * TELEGRAM, which reconnects through the Telegram connect panel (API
 * `reconnect.flow === 'telegram'`). A subset of PLATFORM_KEYS, typed against
 * it so a renamed platform fails to compile. THREADS stays absent until its
 * connect flow exists.
 */
const CONNECTABLE_PLATFORMS: ReadonlySet<string> = new Set<SocialPlatform>(['LINKEDIN', 'X', 'FACEBOOK', 'TIKTOK', 'TELEGRAM']);

export function needsReconnect(connectionStatus: string | null | undefined): boolean {
  return connectionStatus != null && RECONNECT_STATUSES.has(connectionStatus);
}

export function canStartConnectFlow(platform: string): boolean {
  return CONNECTABLE_PLATFORMS.has(platform.toUpperCase());
}

/**
 * Rows written before failure codes existed carry only English. These are the
 * two sentences we wrote ourselves when nothing was connected
 * (social-scheduler.service.ts, lib/site-api/publisher.ts); matching them is
 * the fallback for `code: null` only.
 */
const LEGACY_NO_CONNECTION = /no default \w+ connection found/i;
const LEGACY_NO_SITE = /no active site connection/i;

export type FailureAction = { action: 'reconnect' | 'connect'; tab: 'social' | 'websites' };

/**
 * What the user can do about a failure, decided by its code. `null` = nothing
 * on the Connections page will fix it (bad content, rate limit, platform error).
 */
export function failureAction(
  code: PublishFailureCode | null,
  detail: string,
  connectionStatus: string | null | undefined,
): FailureAction | null {
  switch (code) {
    case 'CONNECTION_EXPIRED':
    case 'CONNECTION_REVOKED':
      return { action: 'reconnect', tab: 'social' };
    case 'NO_CONNECTION':
      return { action: 'connect', tab: 'social' };
    case 'NO_SITE':
      return { action: 'connect', tab: 'websites' };
    case null:
      // Old rows: the account's own status first, then our two English sentences.
      if (needsReconnect(connectionStatus)) return { action: 'reconnect', tab: 'social' };
      if (LEGACY_NO_SITE.test(detail)) return { action: 'connect', tab: 'websites' };
      if (LEGACY_NO_CONNECTION.test(detail)) return { action: 'connect', tab: 'social' };
      return null;
    default:
      return null;
  }
}

/**
 * What a failed row on the Connections page (Publish Queue / History) offers:
 * - reconnect: start the provider sign-in for this job's connection;
 * - openAccounts: a reconnect is needed but cannot start from the row (the
 *   platform has no connect flow yet) → the Connected accounts tab;
 * - connect: no account behind the job → connect one.
 */
export type JobFix = { kind: 'reconnect'; connectionId: string } | { kind: 'openAccounts' } | { kind: 'connect' };

export function jobFixAction(job: {
  platform: string;
  status: string;
  lastError: string | null;
  connectionStatus: string | null;
  socialConnectionId: string | null;
}): JobFix | null {
  if (job.status !== 'FAILED') return null;
  const { code, detail } = parseFailure(job.lastError);
  const action = failureAction(code, detail, job.connectionStatus);
  if (!action || action.tab !== 'social') return null;
  if (action.action === 'connect') return { kind: 'connect' };
  // The account was reconnected after this failure: Retry is the fix now.
  if (job.connectionStatus === 'CONNECTED') return null;
  if (job.connectionStatus == null || !job.socialConnectionId) return { kind: 'connect' };
  return canStartConnectFlow(job.platform)
    ? { kind: 'reconnect', connectionId: job.socialConnectionId }
    : { kind: 'openAccounts' };
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
  | {
      kind: 'failed';
      /** Localised headline key; null for rows written before codes existed. */
      code: PublishFailureCode | null;
      /** The English detail after the code, shown as a secondary line. */
      detail: string | null;
      action: FailureAction | null;
      platform: string | null;
    };

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
    const { code, detail } = parseFailure(reason);
    return {
      kind: 'failed',
      code,
      detail: detail.trim() || null,
      action: failureAction(code, detail, job?.connectionStatus),
      platform: job?.platform ?? null,
    };
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

/**
 * publish-readiness.ts
 *
 * W2 (spec 2026-11-23-first-post-b-design.md D7): nothing is scheduled unless
 * something can publish it. The check is the same one the publishers make at
 * due time, moved to schedule time so the refusal is visible:
 * - social channels: a CONNECTED + isDefault SocialConnection for the
 *   channel's platform (apps/api social-scheduler.service.ts);
 * - blog: an ACTIVE SiteConnection (lib/site-api/publisher.ts).
 *
 * A missing connection is a result, never a throw. Database errors are not
 * caught: an unreadable connection table must not look like "connected".
 */

import { CHANNEL_TO_PLATFORM, type ContentChannel, type SocialPlatform } from '@contivo/types';

import { prisma } from '@/lib/db';

/** What a refusal points at: a social platform, the website, or null when no publisher exists for the channel. */
export type PublishTargetPlatform = SocialPlatform | 'SITE' | null;

export type PublishTargetResult = { ok: true } | { ok: false; reason: 'no_connection'; platform: PublishTargetPlatform };

export const NO_CONNECTION = 'no_connection';

/**
 * For callers that must keep throwing (scheduleContentItem). The message is
 * the code, like QualityGateBlockedError, because Next redacts thrown
 * messages in production and the client can only match on a code.
 */
export class PublishTargetMissingError extends Error {
  readonly code = NO_CONNECTION;
  constructor(readonly platform: PublishTargetPlatform) {
    super(NO_CONNECTION);
    this.name = 'PublishTargetMissingError';
  }
}

function platformFor(channel: string): SocialPlatform | null {
  if (!Object.prototype.hasOwnProperty.call(CHANNEL_TO_PLATFORM, channel)) return null;
  return CHANNEL_TO_PLATFORM[channel as ContentChannel];
}

export async function assertPublishTarget(
  workspaceId: string | null | undefined,
  channel: string,
): Promise<PublishTargetResult> {
  if (channel === 'blog') {
    if (!workspaceId) return { ok: false, reason: NO_CONNECTION, platform: 'SITE' };
    const site = await prisma.siteConnection.findFirst({
      where: { workspaceId, status: 'ACTIVE' },
      select: { id: true },
    });
    return site ? { ok: true } : { ok: false, reason: NO_CONNECTION, platform: 'SITE' };
  }

  const platform = platformFor(channel);
  // email, or a channel we do not know: nothing would ever publish it.
  if (!platform) return { ok: false, reason: NO_CONNECTION, platform: null };
  if (!workspaceId) return { ok: false, reason: NO_CONNECTION, platform };

  const connection = await prisma.socialConnection.findFirst({
    where: { workspaceId, platform, status: 'CONNECTED', isDefault: true },
    select: { id: true },
  });
  return connection ? { ok: true } : { ok: false, reason: NO_CONNECTION, platform };
}

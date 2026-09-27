import type { ContentChannel } from '@prisma/client';

/**
 * Channels Autopilot can publish to today.
 * Social channels need a connected default SocialConnection; `blog` needs an
 * active SiteConnection and is served by the Content API instead.
 *
 * `instagram` is deliberately absent. Its adapter is a stub whose `publish`
 * returns a failure unconditionally and whose `validateConnection` returns
 * false, and `SocialOAuthService` has no instagram branch, so an account
 * cannot be connected in the first place. Offering it here put a channel in
 * the agent editor that could never post — the run simply skipped it, and the
 * marketing pages went on selling it. Put it back in the same commit that
 * makes the adapter work, not before.
 *
 * `facebook` and `tiktok` are absent for a harder reason: `ContentChannel` has
 * no such value, so no content can be authored for them at all, however well
 * their adapters work.
 */
export const PUBLISHABLE_CHANNELS: ContentChannel[] = ['linkedin', 'twitter', 'blog'];

/** Channels published through the Content API rather than a social adapter. */
export const WEB_CHANNELS: ContentChannel[] = ['blog'];

export const CHANNEL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  instagram: 'Instagram',
  blog: 'Blog',
  email: 'Email',
};

/*
  Kept complete on purpose, including instagram: a ContentItem written by
  Instant Content can still carry that channel, and this map is what turns a
  stored channel into a platform name for display.
*/
export const CHANNEL_TO_PLATFORM: Partial<Record<ContentChannel, string>> = {
  linkedin: 'LINKEDIN',
  twitter: 'X',
  instagram: 'INSTAGRAM',
};

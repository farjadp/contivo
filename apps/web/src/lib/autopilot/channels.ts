import type { ContentChannel } from '@prisma/client';

/**
 * Channels Autopilot can publish to today.
 * Social channels need a connected default SocialConnection; `blog` needs an
 * active SiteConnection and is served by the Content API instead.
 * `telegram` posts through the Contivo bot to a channel connected on the
 * Connections page (TelegramAdapter in the API).
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
export const PUBLISHABLE_CHANNELS: ContentChannel[] = ['linkedin', 'twitter', 'telegram', 'blog'];

/** Channels published through the Content API rather than a social adapter. */
export const WEB_CHANNELS: ContentChannel[] = ['blog'];

export const CHANNEL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  instagram: 'Instagram',
  blog: 'Blog',
  email: 'Email',
  telegram: 'Telegram',
  threads: 'Threads',
};

/*
  The one channel → platform table lives in @contivo/types (shared with the
  API scheduler), so a new channel cannot be half-added. `null` means the
  channel is not published through a SocialConnection (blog, email).
*/
export { CHANNEL_TO_PLATFORM } from '@contivo/types';

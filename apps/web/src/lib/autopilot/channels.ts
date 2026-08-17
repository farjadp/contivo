import type { ContentChannel } from '@prisma/client';

/**
 * Channels Autopilot can publish to today.
 * Social channels need a connected default SocialConnection; `blog` needs an
 * active SiteConnection and is served by the Content API instead.
 */
export const PUBLISHABLE_CHANNELS: ContentChannel[] = ['linkedin', 'twitter', 'instagram', 'blog'];

/** Channels published through the Content API rather than a social adapter. */
export const WEB_CHANNELS: ContentChannel[] = ['blog'];

export const CHANNEL_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X (Twitter)',
  instagram: 'Instagram',
  blog: 'Blog',
  email: 'Email',
};

export const CHANNEL_TO_PLATFORM: Partial<Record<ContentChannel, string>> = {
  linkedin: 'LINKEDIN',
  twitter: 'X',
  instagram: 'INSTAGRAM',
};

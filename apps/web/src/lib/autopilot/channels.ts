import type { ContentChannel } from '@prisma/client';

/** Channels Autopilot can publish to today (must mirror runner's CHANNEL_TO_PLATFORM). */
export const PUBLISHABLE_CHANNELS: ContentChannel[] = ['linkedin', 'twitter', 'instagram'];

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

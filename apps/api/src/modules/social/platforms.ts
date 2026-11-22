/**
 * platforms.ts
 *
 * Platform keys for the social module. The platform list itself comes from the
 * Prisma enum / `PLATFORM_KEYS` in @contivo/types; this file only names the
 * subsets the module needs, typed against that enum so a typo or a removed
 * platform fails to compile.
 */

import { CHANNEL_TO_PLATFORM, type ContentChannel } from '@contivo/types';
import type { SocialPlatform } from '@prisma/client';


/** Platforms that connect through our OAuth redirect flow, in URL form. */
export const OAUTH_PLATFORMS = ['linkedin', 'x', 'facebook', 'tiktok'] as const satisfies readonly Lowercase<SocialPlatform>[];
export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

export function isOAuthPlatform(value: string): value is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(value);
}

/** ContentItem.channel → SocialPlatform, from the shared table. null = not a social channel. */
export function channelToPlatform(channel: string): SocialPlatform | null {
  const key = String(channel ?? '').trim().toLowerCase() as ContentChannel;
  return (CHANNEL_TO_PLATFORM[key] as SocialPlatform | null | undefined) ?? null;
}

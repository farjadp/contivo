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

/**
 * How the web (re)connects a platform:
 * - `oauth`: getSocialConnectUrl(platform, workspaceId) and navigate.
 * - `telegram`: POST /social/telegram/connect-sessions, show the t.me deep
 *   link, poll the session, then confirm with the code the bot sent.
 * - `unsupported`: no connect flow on this deployment yet.
 */
export type ConnectFlow = 'oauth' | 'telegram' | 'unsupported';

export function connectFlowFor(platform: string): ConnectFlow {
  const key = String(platform ?? '').toLowerCase();
  if (isOAuthPlatform(key)) return 'oauth';
  if (key === 'telegram') return 'telegram';
  return 'unsupported';
}

/** ContentItem.channel → SocialPlatform, from the shared table. null = not a social channel. */
export function channelToPlatform(channel: string): SocialPlatform | null {
  const key = String(channel ?? '').trim().toLowerCase() as ContentChannel;
  return (CHANNEL_TO_PLATFORM[key] as SocialPlatform | null | undefined) ?? null;
}

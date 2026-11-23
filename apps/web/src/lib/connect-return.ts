/**
 * connect-return.ts
 *
 * Where a successful OAuth connect sends the customer, and the one thing it
 * tells them to do next.
 *
 * It used to land on /connections with a green "Account connected" line and
 * nothing else. The customer had come from the setup chain of one workspace,
 * and nothing led back to it: Farjad had to re-select the workspace to find
 * his way (23 Nov). Now a connect that names its workspace returns to that
 * workspace's page, which shows one next action.
 */

import type { Journey, JourneyStep } from '@/lib/workspace-journey';

/** Platforms whose connect goes through the provider's consent screen. Mirrors apps/api social/platforms.ts. */
export const CONNECTED_PLATFORM_NAMES = {
  linkedin: 'LinkedIn',
  x: 'X',
  facebook: 'Facebook',
  tiktok: 'TikTok',
} as const;

export type ConnectedPlatform = keyof typeof CONNECTED_PLATFORM_NAMES;

/** Narrows a query value to a known platform. Anything else is dropped, never echoed. */
export function parseConnectedPlatform(raw: unknown): ConnectedPlatform | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONNECTED_PLATFORM_NAMES, value)
    ? (value as ConnectedPlatform)
    : null;
}

/** The workspace page, with the platform that was just connected. */
export function connectReturnHref(workspaceId: string, platform: ConnectedPlatform | null) {
  return {
    pathname: '/growth/[id]' as const,
    params: { id: workspaceId },
    query: { connected: platform ?? 'linkedin' },
  };
}

export type ConnectedNextAction =
  /** Nothing published yet: the shortest way to a first post is writing one. */
  | { kind: 'firstPost'; href: string }
  /** Already publishing: carry on with whatever setup step is next. */
  | { kind: 'journey'; step: JourneyStep }
  /** Already publishing and setup is complete. */
  | { kind: 'pipeline'; href: string };

/**
 * One action, never a menu. A workspace with nothing published is sent to
 * write its first post — the pipeline's own editor needs no charts or
 * keywords, so this works whatever state the rest of setup is in.
 */
export function connectedNextAction(
  workspaceId: string,
  journey: Pick<Journey, 'next'>,
  publishedCount: number,
): ConnectedNextAction {
  const pipeline = `/growth/${workspaceId}?tab=pipeline`;
  if (publishedCount <= 0) return { kind: 'firstPost', href: `${pipeline}&write=1` };
  if (journey.next && journey.next.id !== 'channel') return { kind: 'journey', step: journey.next };
  return { kind: 'pipeline', href: pipeline };
}

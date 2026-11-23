/**
 * channel-interest.ts
 *
 * The networks the connect step lists as "coming soon", and the name their
 * "notify me" requests are stored under.
 *
 * Decided 23 Nov (strategy/2026-11-23-first-post-path.md, section A): list
 * every planned network so nobody hunts for one, and count who asks for which
 * so the build order follows demand. Substack and Medium are deliberately not
 * here (decided no on 21 Nov).
 *
 * Telegram is built, but a deployment without its bot token cannot connect
 * it; there it is shown as coming soon like the rest.
 */

export const COMING_SOON_NETWORKS = ['telegram', 'x', 'wordpress', 'facebook', 'instagram', 'threads'] as const;

export type ComingSoonNetwork = (typeof COMING_SOON_NETWORKS)[number];

/** One activity_logs row per request: workspace, network (in `detail`), time. */
export const CHANNEL_INTEREST_ACTION = 'CHANNEL_INTEREST';

export function isComingSoonNetwork(value: unknown): value is ComingSoonNetwork {
  return typeof value === 'string' && (COMING_SOON_NETWORKS as readonly string[]).includes(value);
}

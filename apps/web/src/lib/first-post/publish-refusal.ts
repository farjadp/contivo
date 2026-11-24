/**
 * first-post/publish-refusal.ts
 *
 * The bar owns "Publish now" (CPO, spec first-post B §4.4). When publishNow
 * refuses, the bar opens the first-post tab with `?publish=<refusal>` so the
 * view's publish panel can say why. Pure, safe on server and client.
 */

export const PUBLISH_REFUSAL_PARAM = 'publish';

export const PUBLISH_REFUSALS = ['noConnection', 'gateBlocked', 'notFound'] as const;
export type PublishRefusal = (typeof PUBLISH_REFUSALS)[number];

const FROM_REASON: Record<string, PublishRefusal> = {
  no_connection: 'noConnection',
  quality_gate_blocked: 'gateBlocked',
  not_found: 'notFound',
};

/** publishNow's refusal reason as the closed refusal list; anything else is `notFound`. */
export function refusalFromReason(reason: string): PublishRefusal {
  return FROM_REASON[reason] ?? 'notFound';
}

/** `href` with the refusal in its query, replacing any earlier one. */
export function publishRefusalHref(href: string, refusal: PublishRefusal): string {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set(PUBLISH_REFUSAL_PARAM, refusal);
  return `${path}?${params.toString()}`;
}

/** The `?publish=` value, when it is one of the refusals; anything else is null. */
export function parsePublishRefusal(raw: string | string[] | undefined): PublishRefusal | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (PUBLISH_REFUSALS as readonly string[]).includes(value ?? '') ? (value as PublishRefusal) : null;
}

/**
 * `href` without `?publish=`: the view clears it once the refusal is on
 * screen, so a reload or a shared link does not repeat an old refusal.
 */
export function withoutPublishRefusal(href: string): string {
  const [beforeHash, hash] = href.split('#', 2);
  const [path, query = ''] = beforeHash.split('?', 2);
  const params = new URLSearchParams(query);
  params.delete(PUBLISH_REFUSAL_PARAM);
  const rest = params.toString();
  return `${path}${rest ? `?${rest}` : ''}${hash !== undefined ? `#${hash}` : ''}`;
}

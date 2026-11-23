/**
 * Fingerprint: groups reports that share a cause. Ten users whose OpenAI account ran out
 * of credit while building matrices must land in one group, whatever their ids or locale.
 */

import { createHash } from 'node:crypto';

import type { CauseCode } from './types';

const LOCALES = new Set(['en', 'fa', 'it', 'es', 'he', 'fr', 'ar', 'zh']);
const ID_SEGMENT = /^(?:c[a-z0-9]{20,30}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)$/i;

/** '/fa/growth/clxyz.../matrices?x=1' -> '/growth/:id/matrices'. Pathname only, no locale, ids collapsed. */
export function routePattern(route: string | null | undefined): string {
  if (!route) return '/';
  const path = route.split(/[?#]/)[0];
  const parts = path.split('/').filter(Boolean);
  if (parts.length > 0 && LOCALES.has(parts[0].toLowerCase())) parts.shift();
  const mapped = parts.map((p) => (ID_SEGMENT.test(p) ? ':id' : p.toLowerCase()));
  return '/' + mapped.join('/');
}

export function computeFingerprint(input: {
  causeCode?: CauseCode | null;
  failedAction?: string | null;
  runType?: string | null;
  route?: string | null;
}): string {
  const what = (input.failedAction || input.runType || '-').toLowerCase();
  const key = [input.causeCode || 'NONE', what, routePattern(input.route)].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

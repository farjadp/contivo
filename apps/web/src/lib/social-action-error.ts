/**
 * social-action-error.ts
 *
 * Turns a failed social server action (`{ error, code }` from
 * actions/social.ts) into what the UI shows under its own headline: a
 * localised sentence keyed by `code`, or the API's own words for `rejected`
 * (a 4xx whose message is the only specific thing we know).
 */

import type { SocialActionErrorCode } from '@/app/actions/social';

export type SocialActionDetail =
  | { kind: 'message'; key: SocialActionErrorCode }
  | { kind: 'raw'; text: string };

export function socialActionDetail(result: {
  error?: string;
  code?: SocialActionErrorCode;
}): SocialActionDetail | null {
  if (!result.error && !result.code) return null;
  if (!result.code || result.code === 'rejected') {
    const text = result.error?.trim();
    return text ? { kind: 'raw', text } : { kind: 'message', key: 'rejected' };
  }
  return { kind: 'message', key: result.code };
}

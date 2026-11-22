/**
 * social-action-error.ts
 *
 * Turns a failed social server action (`{ error, code }` from
 * actions/social.ts) into what the UI shows under its own headline: a
 * localised sentence keyed by the refusal `reason` the API gave (Retry /
 * Cancel), else by `code`, or the API's own words for `rejected` with no
 * known reason (a 4xx whose message is the only specific thing we know).
 * Keys index `errors.socialAction`.
 */

import type { PublishJobRefusal } from '@contivo/types';

import type { SocialActionErrorCode } from '@/app/actions/social';

export type SocialActionDetail =
  | { kind: 'message'; key: SocialActionErrorCode | `refusal.${PublishJobRefusal}` }
  | { kind: 'raw'; text: string };

export function socialActionDetail(result: {
  error?: string;
  code?: SocialActionErrorCode;
  reason?: PublishJobRefusal;
}): SocialActionDetail | null {
  if (!result.error && !result.code) return null;
  if (result.reason) return { kind: 'message', key: `refusal.${result.reason}` };
  if (!result.code || result.code === 'rejected') {
    const text = result.error?.trim();
    return text ? { kind: 'raw', text } : { kind: 'message', key: 'rejected' };
  }
  return { kind: 'message', key: result.code };
}

/**
 * Which `?error=` values the sign-in page is willing to explain.
 *
 * The OAuth callback redirects to `/sign-in?error=<code>`. The query string is
 * attacker-writable, so only the exact codes the callback emits map to copy
 * (`auth.oauthErrors.<code>`); anything else, including arrays, other casing
 * and prototype keys, resolves to null and the page shows nothing. The raw
 * value is never rendered.
 */

import { isOAuthErrorCode, type OAuthErrorCode } from '@/lib/oauth/errors';

export function oauthErrorCode(raw: unknown): OAuthErrorCode | null {
  return isOAuthErrorCode(raw) ? raw : null;
}

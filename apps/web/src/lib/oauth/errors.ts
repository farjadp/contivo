/**
 * Error codes the OAuth callback puts on `/{locale}/sign-in?error=<code>`.
 * The sign-in page renders its own copy for these; provider text is never
 * shown, so an unknown or forged value must render nothing.
 */
export const OAUTH_ERROR_CODES = [
  'cancelled',
  'invalid_state',
  'provider_error',
  'no_verified_email',
  'email_in_use',
  'suspended',
  'rate_limited',
] as const;

export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number];

export function isOAuthErrorCode(value: unknown): value is OAuthErrorCode {
  return typeof value === 'string' && (OAUTH_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * A refusal with a public code. `reason` is for our own activity log only
 * (never provider text, never an email address).
 */
export class OAuthFlowError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    readonly reason: string = code,
    /** The user the refusal concerns, when there is one (for the log row). */
    readonly userId?: string,
  ) {
    super(`oauth:${code}:${reason}`);
    this.name = 'OAuthFlowError';
  }
}

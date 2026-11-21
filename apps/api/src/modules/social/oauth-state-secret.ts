/**
 * oauth-state-secret.ts
 *
 * OAUTH_STATE_SECRET keys two things on the API:
 *   - the AES-GCM OAuth `state` (built and verified here, in SocialOAuthService);
 *   - the HMAC connect handoff token, which the WEB app signs
 *     (apps/web/src/app/actions/social-connect.ts) and this API verifies
 *     (connect-handoff.ts). So the value must be identical on contivo-web and
 *     contivo-api.
 *
 * No default: the repository is public, so a fallback string is a known key
 * that lets anyone forge a handoff token for any user and workspace.
 */

export const OAUTH_STATE_SECRET_ENV = 'OAUTH_STATE_SECRET';

export function getOAuthStateSecret(): string {
  const secret = process.env[OAUTH_STATE_SECRET_ENV];
  if (!secret || secret.trim() === '') {
    throw new Error(
      `${OAUTH_STATE_SECRET_ENV} is not set. It signs OAuth state and connect handoff tokens and has no default. ` +
        'Generate one with `openssl rand -base64 32` and set the same value on contivo-web and contivo-api.',
    );
  }
  return secret;
}

/**
 * Google sign-in: OpenID Connect, authorization code + PKCE + nonce.
 *
 * Arctic builds the authorization URL and does the code exchange (so token
 * endpoint quirks are its problem). Everything that decides whether to trust
 * the result is here, explicit, with `jose`: the id_token signature against
 * Google's JWKS, issuer, audience, authorized party, expiry, nonce and a
 * strictly boolean `email_verified`. The access token is never used; nothing
 * the provider returns is stored or logged.
 */

import { Google } from 'arctic';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { OAuthFlowError } from './errors';
import { providerCredentials, redirectUri } from './providers';
import type { ProviderIdentity } from './resolve';

const GOOGLE_SCOPES = ['openid', 'email', 'profile'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google signs id_tokens with either form of the issuer. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

function client(): { arctic: Google; clientId: string } {
  const creds = providerCredentials('google');
  if (!creds) throw new OAuthFlowError('provider_error', 'google_not_configured');
  return { arctic: new Google(creds.clientId, creds.clientSecret, redirectUri('google')), clientId: creds.clientId };
}

/** The URL to send the browser to. No offline access, account chooser every time. */
export function googleAuthorizationUrl(input: { state: string; verifier: string; nonce: string }): URL {
  const { arctic } = client();
  const url = arctic.createAuthorizationURL(input.state, input.verifier, GOOGLE_SCOPES);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('prompt', 'select_account');
  return url;
}

let jwks: JWTVerifyGetKey | null = null;
function googleKeys(): JWTVerifyGetKey {
  if (!jwks) jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

/** Tests only: forget the cached key set. */
export function resetGoogleKeysForTests(): void {
  jwks = null;
}

/**
 * Verify the id_token and turn it into an identity. Any failure, including
 * the key set being unreachable, refuses (fail closed).
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
): Promise<ProviderIdentity> {
  let claims: Record<string, unknown>;
  try {
    const { payload } = await jwtVerify(idToken, googleKeys(), {
      algorithms: ['RS256'],
      issuer: GOOGLE_ISSUERS,
      audience: expected.clientId,
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    claims = payload as Record<string, unknown>;
  } catch {
    throw new OAuthFlowError('provider_error', 'id_token_invalid');
  }

  // Authorized party: when present it must be us; required if several audiences.
  const aud = claims.aud;
  if (claims.azp !== undefined ? claims.azp !== expected.clientId : Array.isArray(aud) && aud.length > 1) {
    throw new OAuthFlowError('provider_error', 'azp_mismatch');
  }
  if (typeof claims.nonce !== 'string' || claims.nonce !== expected.nonce) {
    throw new OAuthFlowError('provider_error', 'nonce_mismatch');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new OAuthFlowError('provider_error', 'no_subject');
  }

  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  // Strictly the boolean true: the string "true" or 1 is not accepted.
  const emailVerified = claims.email_verified === true && email.length > 0;

  return {
    provider: 'google',
    providerAccountId: claims.sub,
    email: email || null,
    emailVerified,
    name: typeof claims.name === 'string' ? claims.name : null,
  };
}

/**
 * Exchange the authorization code (with the PKCE verifier) and verify the
 * result. Provider and Arctic error text is dropped here: callers see only a
 * code. Tokens never leave this function.
 */
export async function googleIdentityFromCode(input: {
  code: string;
  verifier: string;
  nonce: string;
}): Promise<ProviderIdentity> {
  const { arctic, clientId } = client();
  let idToken: string;
  try {
    const tokens = await arctic.validateAuthorizationCode(input.code, input.verifier);
    idToken = tokens.idToken();
  } catch {
    throw new OAuthFlowError('provider_error', 'code_exchange_failed');
  }
  return verifyGoogleIdToken(idToken, { clientId, nonce: input.nonce });
}

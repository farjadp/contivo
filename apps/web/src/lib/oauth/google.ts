/**
 * Google sign-in: OpenID Connect, authorization code + PKCE + nonce.
 *
 * The authorization URL and the code exchange are plain Node (no OAuth
 * library: the ones we looked at are marked unsupported on npm). Everything
 * that decides whether to trust the result is explicit, with `jose`: the id_token signature against
 * Google's JWKS, issuer, audience, authorized party, expiry, nonce and a
 * strictly boolean `email_verified`. The access token is never used; nothing
 * the provider returns is stored or logged.
 */

import { createHash } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

import { OAuthFlowError } from './errors';
import { providerCredentials, redirectUri } from './providers';
import type { ProviderIdentity } from './resolve';

const GOOGLE_SCOPES = ['openid', 'email', 'profile'];
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
/** Google signs id_tokens with either form of the issuer. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_TIMEOUT_MS = 10_000;
const TOKEN_MAX_BYTES = 64 * 1024;

function credentials(): { clientId: string; clientSecret: string } {
  const creds = providerCredentials('google');
  if (!creds) throw new OAuthFlowError('provider_error', 'google_not_configured');
  return creds;
}

/** The URL to send the browser to. No offline access, account chooser every time. */
export function googleAuthorizationUrl(input: { state: string; verifier: string; nonce: string }): URL {
  const { clientId } = credentials();
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri('google'));
  url.searchParams.set('scope', GOOGLE_SCOPES.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', createHash('sha256').update(input.verifier).digest('base64url'));
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('prompt', 'select_account');
  return url;
}

/**
 * POST the code (with the PKCE verifier) to Google and return only the
 * id_token. Timeout, no redirects, capped body; the response text is never
 * logged or surfaced, and the access token is dropped unread.
 */
async function exchangeCode(code: string, verifier: string): Promise<string> {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri('google'),
    }),
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error('token endpoint refused');
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > TOKEN_MAX_BYTES) throw new Error('token response too large');
  const text = await response.text();
  if (text.length > TOKEN_MAX_BYTES) throw new Error('token response too large');
  const body = JSON.parse(text) as { id_token?: unknown };
  if (typeof body.id_token !== 'string' || !body.id_token) throw new Error('no id_token');
  return body.id_token;
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
 * result. Provider error text is dropped here: callers see only a
 * code. Tokens never leave this function.
 */
export async function googleIdentityFromCode(input: {
  code: string;
  verifier: string;
  nonce: string;
}): Promise<ProviderIdentity> {
  const { clientId } = credentials();
  let idToken: string;
  try {
    idToken = await exchangeCode(input.code, input.verifier);
  } catch {
    throw new OAuthFlowError('provider_error', 'code_exchange_failed');
  }
  return verifyGoogleIdToken(idToken, { clientId, nonce: input.nonce });
}

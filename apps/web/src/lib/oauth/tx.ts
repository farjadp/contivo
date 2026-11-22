/**
 * The OAuth transaction cookie: everything the callback needs to finish what
 * `start` began, sealed so the browser can neither read nor alter it.
 *
 * Encrypted JWT (dir + A256GCM) under a key derived with HKDF from JWT_SECRET
 * and its own `info`, so it can never be confused with a session token and no
 * new secret is needed. Binding to the provider, a typ and an audience stops a
 * cookie for one flow being accepted by another.
 */

import { hkdfSync, randomBytes, randomUUID } from 'node:crypto';

import { EncryptJWT, jwtDecrypt } from 'jose';

import type { OAuthProviderId } from './providers';

export const TX_TTL_SECONDS = 10 * 60;
const TX_TYP = 'oauth-tx+jwt';
const TX_AUDIENCE = 'contivo:oauth-tx';
const HKDF_INFO = 'contivo:oauth-tx:v1';

export interface OAuthTx {
  provider: OAuthProviderId;
  state: string;
  verifier: string;
  nonce: string;
  locale: string;
  cohort: string | null;
  site: string | null;
  /** Single-use id, recorded in oauth_tx_used by the callback. */
  jti: string;
  /** Epoch seconds. */
  exp: number;
}

/** Production: the `__Host-` form (Secure, Path=/, no Domain). Chosen from NODE_ENV, not the request. */
export function txCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-oauth_tx' : 'oauth_tx';
}

export function txCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
} {
  return { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
}

function secret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set.');
  }
  return 'contivo-local-development-only-key';
}

function txKey(): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret(), 'contivo-oauth-tx-salt', HKDF_INFO, 32));
}

/** 32 random bytes, base64url: used for state, nonce and the PKCE verifier. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newTxId(): string {
  return randomUUID();
}

export async function sealTx(tx: Omit<OAuthTx, 'jti' | 'exp'> & { jti?: string; exp?: number }): Promise<string> {
  const exp = tx.exp ?? Math.floor(Date.now() / 1000) + TX_TTL_SECONDS;
  const claims: Partial<typeof tx> = { ...tx };
  delete claims.exp;
  return new EncryptJWT({ ...claims })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM', typ: TX_TYP })
    .setAudience(TX_AUDIENCE)
    .setJti(tx.jti ?? newTxId())
    .setIssuedAt()
    .setExpirationTime(exp)
    .encrypt(txKey());
}

/**
 * The transaction, or null for anything wrong with it: missing, altered,
 * expired, a different flow's, or for another provider than the path's.
 * Never throws on bad input.
 */
export async function openTx(token: string | undefined, provider: OAuthProviderId): Promise<OAuthTx | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtDecrypt(token, txKey(), {
      audience: TX_AUDIENCE,
      typ: TX_TYP,
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
      requiredClaims: ['jti', 'exp'],
    });
    const p = payload as Record<string, unknown>;
    if (p.provider !== provider) return null;
    if (
      typeof p.state !== 'string' ||
      typeof p.verifier !== 'string' ||
      typeof p.nonce !== 'string' ||
      typeof p.locale !== 'string' ||
      typeof p.jti !== 'string' ||
      typeof p.exp !== 'number'
    ) {
      return null;
    }
    return {
      provider,
      state: p.state,
      verifier: p.verifier,
      nonce: p.nonce,
      locale: p.locale,
      cohort: typeof p.cohort === 'string' ? p.cohort : null,
      site: typeof p.site === 'string' ? p.site : null,
      jti: p.jti,
      exp: p.exp,
    };
  } catch {
    return null;
  }
}

/**
 * site-api/keys.ts
 *
 * API keys for the public Content API.
 *
 * The plaintext key is generated once, returned to the user once, and never
 * stored. Only its SHA-256 hash lives in the database, so a database dump
 * does not hand anyone read access to customers' content.
 *
 * SHA-256 rather than bcrypt is deliberate here: these are 256-bit random
 * tokens, not human-chosen passwords, so there is nothing to brute-force and
 * a per-request bcrypt would make every API read slow. The hash is a lookup
 * key, which also lets us find the row in one indexed query.
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';

const KEY_PREFIX = 'ctv_live_';
const KEY_BYTES = 32;

export type GeneratedKey = {
  /** Full key — shown to the user exactly once, never persisted. */
  plaintext: string;
  /** SHA-256 of the plaintext; what we store and query by. */
  hash: string;
  /** Short visible fragment for identifying the key in the UI. */
  prefix: string;
};

export function generateSiteKey(): GeneratedKey {
  const secret = randomBytes(KEY_BYTES).toString('base64url');
  const plaintext = `${KEY_PREFIX}${secret}`;
  return {
    plaintext,
    hash: hashSiteKey(plaintext),
    prefix: `${KEY_PREFIX}${secret.slice(0, 6)}`,
  };
}

export function hashSiteKey(plaintext: string): string {
  return createHash('sha256').update(plaintext.trim(), 'utf8').digest('hex');
}

/**
 * Extracts the key from an Authorization header.
 * Accepts `Bearer <key>` and a bare key, which is what people try first.
 */
export function extractBearerKey(header: string | null): string | null {
  if (!header) return null;
  const value = header.trim();
  if (!value) return null;
  const bearer = value.match(/^Bearer\s+(.+)$/i);
  const candidate = (bearer ? bearer[1] : value).trim();
  return candidate.startsWith(KEY_PREFIX) ? candidate : null;
}

/**
 * Constant-time comparison of two hex hashes. The DB lookup is already by
 * exact hash, so this is belt-and-braces against any future code path that
 * compares values directly.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

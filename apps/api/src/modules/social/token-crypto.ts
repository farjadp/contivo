/**
 * token-crypto.ts
 *
 * Encryption for the OAuth tokens stored in socialConnection
 * (encryptedAccessTokenRef / encryptedRefreshTokenRef).
 *
 * Format (v1):  v1:<iv base64>:<auth tag base64>:<ciphertext base64>
 *   - AES-256-GCM, random 12-byte IV per value, 16-byte auth tag.
 *   - Key = HKDF-SHA256(SOCIAL_TOKEN_SECRET, salt = KDF_SALT, info = KDF_INFO), 32 bytes.
 *
 * Legacy format: base64 of the token XORed against the repeating UTF-8 bytes of
 * SOCIAL_TOKEN_SECRET. It is still decrypted so existing rows keep working
 * until scripts/reencrypt-social-tokens.ts has rewritten them; it is never
 * written any more.
 *
 * There is deliberately no default secret. The repository is public, so any
 * fallback string is a published key.
 */

import * as crypto from 'crypto';

export const SOCIAL_TOKEN_SECRET_ENV = 'SOCIAL_TOKEN_SECRET';

const VERSION_PREFIX = 'v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KDF_SALT = 'contivo-social-token';
const KDF_INFO = 'contivo/social-token/aes-256-gcm/v1';

/** Returns SOCIAL_TOKEN_SECRET or throws. Call at startup to fail fast. */
export function getSocialTokenSecret(): string {
  const secret = process.env[SOCIAL_TOKEN_SECRET_ENV];
  if (!secret || secret.trim() === '') {
    throw new Error(
      `${SOCIAL_TOKEN_SECRET_ENV} is not set. It encrypts stored social OAuth tokens and has no default. ` +
        'Generate one with `openssl rand -base64 32`. If tokens already exist, it must be the value they were written with.',
    );
  }
  return secret;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), KDF_SALT, KDF_INFO, 32));
}

/** True when the stored value is in the old XOR format (anything not v1). */
export function isLegacy(ref: string): boolean {
  return !ref.startsWith(VERSION_PREFIX);
}

export function encryptToken(token: string): string {
  const key = deriveKey(getSocialTokenSecret());
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Decrypts v1 (authenticated; throws on tamper) or legacy XOR values. */
export function decryptToken(ref: string): string {
  const secret = getSocialTokenSecret();
  if (isLegacy(ref)) return legacyXorDecrypt(ref, secret);

  const parts = ref.slice(VERSION_PREFIX.length).split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted token: expected v1:<iv>:<tag>:<ciphertext>');
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ctB64, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed encrypted token: bad IV or auth tag length');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  // final() throws "Unsupported state or unable to authenticate data" on tamper or wrong key.
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * The pre-v1 algorithm, byte for byte: XOR the raw base64-decoded bytes
 * against the repeating UTF-8 key, then read the result as UTF-8.
 */
export function legacyXorDecrypt(ref: string, secret: string): string {
  return xorBytes(Buffer.from(ref, 'base64'), secret).toString('utf8');
}

/** Old encryption. Exported only so tests can produce real legacy values. */
export function legacyXorEncrypt(token: string, secret: string): string {
  return xorBytes(Buffer.from(token, 'utf8'), secret).toString('base64');
}

function xorBytes(input: Buffer, secret: string): Buffer {
  const keyBytes = Buffer.from(secret, 'utf8');
  const out = Buffer.alloc(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] ^ keyBytes[i % keyBytes.length];
  }
  return out;
}

/**
 * Run: pnpm --filter @contivo/api test   (node:test via ts-node, no extra deps)
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  decryptToken,
  encryptToken,
  getSocialTokenSecret,
  isLegacy,
  legacyXorEncrypt,
} from '../src/modules/social/token-crypto';

const TEST_SECRET = 'test-only-secret-not-used-anywhere';
// Realistic token shape, including characters outside base64.
const TOKEN = 'AQXk-9_z.long~access/token+value==';

describe('token-crypto', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.SOCIAL_TOKEN_SECRET;
    process.env.SOCIAL_TOKEN_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.SOCIAL_TOKEN_SECRET;
    else process.env.SOCIAL_TOKEN_SECRET = saved;
  });

  it('round-trips and writes the v1 format', () => {
    const ref = encryptToken(TOKEN);
    assert.match(ref, /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    const [, iv, tag] = ref.split(':');
    assert.equal(Buffer.from(iv, 'base64').length, 12);
    assert.equal(Buffer.from(tag, 'base64').length, 16);
    assert.equal(isLegacy(ref), false);
    assert.equal(decryptToken(ref), TOKEN);
  });

  it('round-trips non-ASCII and empty tokens', () => {
    for (const t of ['', 'توکن-🔑-ü']) assert.equal(decryptToken(encryptToken(t)), t);
  });

  it('never writes the same ciphertext twice (random IV)', () => {
    const a = encryptToken(TOKEN);
    const b = encryptToken(TOKEN);
    assert.notEqual(a, b);
    assert.notEqual(a.split(':')[1], b.split(':')[1]);
  });

  it('rejects tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptToken(TOKEN).split(':');
    const bytes = Buffer.from(ct, 'base64');
    bytes[0] ^= 0x01;
    assert.throws(() => decryptToken([v, iv, tag, bytes.toString('base64')].join(':')));
  });

  it('rejects a tampered auth tag', () => {
    const [v, iv, tag, ct] = encryptToken(TOKEN).split(':');
    const bytes = Buffer.from(tag, 'base64');
    bytes[15] ^= 0x80;
    assert.throws(() => decryptToken([v, iv, bytes.toString('base64'), ct].join(':')));
  });

  it('rejects a tampered IV and a malformed value', () => {
    const [v, iv, tag, ct] = encryptToken(TOKEN).split(':');
    const bytes = Buffer.from(iv, 'base64');
    bytes[0] ^= 0x01;
    assert.throws(() => decryptToken([v, bytes.toString('base64'), tag, ct].join(':')));
    assert.throws(() => decryptToken(`v1:${iv}:${tag}`), /Malformed/);
  });

  it('rejects a v1 value under a different secret', () => {
    const ref = encryptToken(TOKEN);
    process.env.SOCIAL_TOKEN_SECRET = 'a-different-secret';
    assert.throws(() => decryptToken(ref));
  });

  it('still decrypts a legacy XOR value', () => {
    // Exactly what the old SocialConnectionsService.encryptToken produced.
    const oldXor = (token: string, secret: string) => {
      const key = Buffer.from(secret, 'utf8');
      const input = Buffer.from(token, 'utf8');
      const out = Buffer.alloc(input.length);
      for (let i = 0; i < input.length; i++) out[i] = input[i] ^ key[i % key.length];
      return out.toString('base64');
    };
    const legacy = oldXor(TOKEN, TEST_SECRET);
    assert.equal(legacyXorEncrypt(TOKEN, TEST_SECRET), legacy);
    assert.equal(isLegacy(legacy), true);
    assert.equal(decryptToken(legacy), TOKEN);
  });

  for (const value of [undefined, '', '   ']) {
    it(`throws naming SOCIAL_TOKEN_SECRET when it is ${JSON.stringify(value)}`, () => {
      if (value === undefined) delete process.env.SOCIAL_TOKEN_SECRET;
      else process.env.SOCIAL_TOKEN_SECRET = value;
      assert.throws(() => getSocialTokenSecret(), /SOCIAL_TOKEN_SECRET/);
      assert.throws(() => encryptToken(TOKEN), /SOCIAL_TOKEN_SECRET/);
      assert.throws(() => decryptToken('abc'), /SOCIAL_TOKEN_SECRET/);
    });
  }
});

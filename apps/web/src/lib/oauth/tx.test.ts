import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

import { openTx, sealTx, txCookieName } from './tx';

const base = {
  provider: 'google' as const,
  state: 's',
  verifier: 'v',
  nonce: 'n',
  locale: 'fa',
  cohort: 'mentee-nov26',
  site: 'https://a.com',
};

afterEach(() => vi.unstubAllEnvs());

describe('oauth tx cookie', () => {
  it('round-trips every field', async () => {
    const tx = await openTx(await sealTx(base), 'google');
    expect(tx).toMatchObject(base);
    expect(tx?.jti).toMatch(/[0-9a-f-]{36}/);
  });

  it('is encrypted: the state and verifier are not readable in the token', async () => {
    const token = await sealTx({ ...base, state: 'plainly-visible-state' });
    expect(token.split('.')).toHaveLength(5);
    expect(token).not.toContain('plainly-visible-state');
    expect(Buffer.from(token.split('.')[3] ?? '', 'base64url').toString()).not.toContain('plainly-visible-state');
  });

  it('rejects a flipped byte', async () => {
    const token = await sealTx(base);
    const parts = token.split('.');
    const ct = Buffer.from(parts[3], 'base64url');
    ct[0] ^= 0x01;
    parts[3] = ct.toString('base64url');
    expect(await openTx(parts.join('.'), 'google')).toBeNull();
  });

  it('rejects a missing, empty or garbage cookie', async () => {
    expect(await openTx(undefined, 'google')).toBeNull();
    expect(await openTx('', 'google')).toBeNull();
    expect(await openTx('a.b.c.d.e', 'google')).toBeNull();
  });

  it('rejects a cookie for another provider than the path', async () => {
    expect(await openTx(await sealTx(base), 'github')).toBeNull();
  });

  it('rejects an expired transaction', async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    expect(await openTx(await sealTx({ ...base, exp: past }), 'google')).toBeNull();
  });

  it('rejects a token sealed under a different secret', async () => {
    const token = await sealTx(base);
    vi.stubEnv('JWT_SECRET', 'some-other-secret');
    expect(await openTx(token, 'google')).toBeNull();
  });

  it('rejects a session-style signed JWT (cannot be confused with the session token)', async () => {
    const key = new TextEncoder().encode('contivo-local-development-only-key');
    const session = await new SignJWT({ provider: 'google' }).setProtectedHeader({ alg: 'HS256' }).sign(key);
    expect(await openTx(session, 'google')).toBeNull();
  });

  it('uses the __Host- name in production and the plain name elsewhere, from NODE_ENV', () => {
    expect(txCookieName()).toBe('oauth_tx');
    vi.stubEnv('NODE_ENV', 'production');
    expect(txCookieName()).toBe('__Host-oauth_tx');
  });
});

/**
 * ensureFreshToken: refresh shortly before expiry, one refresh per connection
 * at a time, both tokens persisted together, and a failed refresh re-reads the
 * row before declaring the connection EXPIRED.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import type { RefreshResult, SocialAdapter } from '../src/modules/social/adapters/social-adapter.interface';
import { PermanentPublishError, TransientPublishError } from '../src/modules/social/publish-errors';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { decryptToken, encryptToken } from '../src/modules/social/token-crypto';
import { TokenRefreshService, type LockStore } from '../src/modules/social/token-refresh.service';

import { fakePrisma } from './helpers/fake-prisma';

function memoryLocks(): LockStore & { acquired: number } {
  const held = new Set<string>();
  return {
    acquired: 0,
    async acquire(key) {
      if (held.has(key)) return null;
      held.add(key);
      this.acquired++;
      return 'tok';
    },
    async release(key) {
      held.delete(key);
    },
  };
}

function setup(opts: { expiresInMs: number; refresh: (calls: number) => Promise<RefreshResult> }) {
  const prisma = fakePrisma({
    socialConnection: [
      {
        id: 'c1',
        platform: 'X',
        accountIdentifier: 'x-1',
        status: 'CONNECTED',
        encryptedAccessTokenRef: encryptToken('a-old'),
        encryptedRefreshTokenRef: encryptToken('r-old'),
        tokenExpiresAt: new Date(Date.now() + opts.expiresInMs),
      },
    ],
  });
  let calls = 0;
  const adapter = {
    platform: 'X',
    credential: 'stored_token',
    async refreshToken() {
      calls++;
      return opts.refresh(calls);
    },
  } as unknown as SocialAdapter;
  const locks = memoryLocks();
  const svc = new TokenRefreshService(prisma as any, new SocialConnectionsService(prisma as any), locks, {
    waitMs: 2000,
    pollMs: 5,
  });
  return { prisma, svc, adapter, locks, calls: () => calls, row: () => prisma.socialConnection.rows[0] };
}

const ok = (n = 'new'): RefreshResult => ({
  ok: true,
  accessToken: `a-${n}`,
  refreshToken: `r-${n}`,
  expiresAt: new Date(Date.now() + 7_200_000),
});

describe('TokenRefreshService.ensureFreshToken', () => {
  it('does nothing when the token has more than 5 minutes left', async () => {
    const t = setup({ expiresInMs: 60 * 60_000, refresh: async () => ok() });
    const tokens = await t.svc.ensureFreshToken('c1', t.adapter);
    assert.equal(tokens.accessToken, 'a-old');
    assert.equal(t.calls(), 0);
  });

  it('refreshes when under 5 minutes and persists access + refresh + expiry together', async () => {
    const t = setup({ expiresInMs: 60_000, refresh: async () => ok() });
    const tokens = await t.svc.ensureFreshToken('c1', t.adapter);
    assert.equal(tokens.accessToken, 'a-new');
    assert.equal(decryptToken(t.row().encryptedAccessTokenRef), 'a-new');
    assert.equal(decryptToken(t.row().encryptedRefreshTokenRef), 'r-new');
    assert.ok(t.row().tokenExpiresAt.getTime() > Date.now() + 7_000_000);
    assert.equal(t.calls(), 1);
  });

  it('two concurrent publishes trigger one refresh and both get the new token', async () => {
    const t = setup({
      expiresInMs: 60_000,
      refresh: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return ok();
      },
    });
    const [a, b] = await Promise.all([
      t.svc.ensureFreshToken('c1', t.adapter),
      t.svc.ensureFreshToken('c1', t.adapter),
    ]);
    assert.equal(t.calls(), 1);
    assert.equal(a.accessToken, 'a-new');
    assert.equal(b.accessToken, 'a-new');
  });

  it('refresh rejected → re-reads row, still stale → EXPIRED + permanent error', async () => {
    const t = setup({ expiresInMs: 60_000, refresh: async () => ({ ok: false, reason: 'expired', detail: 'invalid_request' }) });
    await assert.rejects(t.svc.ensureFreshToken('c1', t.adapter), PermanentPublishError);
    assert.equal(t.row().status, 'EXPIRED');
  });

  it('refresh rejected but another worker already rotated the row → use the new tokens, stay CONNECTED', async () => {
    let rotate: () => void = () => {};
    const t = setup({
      expiresInMs: 60_000,
      refresh: async () => {
        rotate();
        return { ok: false, reason: 'expired', detail: 'refresh token already used' };
      },
    });
    rotate = () => {
      t.row().encryptedAccessTokenRef = encryptToken('a-other');
      t.row().encryptedRefreshTokenRef = encryptToken('r-other');
      t.row().tokenExpiresAt = new Date(Date.now() + 7_200_000);
    };
    const tokens = await t.svc.ensureFreshToken('c1', t.adapter);
    assert.equal(tokens.accessToken, 'a-other');
    assert.equal(t.row().status, 'CONNECTED');
  });

  it('transient refresh failure → TransientPublishError, status unchanged', async () => {
    const t = setup({ expiresInMs: 60_000, refresh: async () => ({ ok: false, reason: 'transient', detail: 'ENOTFOUND' }) });
    await assert.rejects(t.svc.ensureFreshToken('c1', t.adapter), TransientPublishError);
    assert.equal(t.row().status, 'CONNECTED');
  });

  it('adapters without refreshToken (LinkedIn) are passed through unchanged', async () => {
    const t = setup({ expiresInMs: 60_000, refresh: async () => ok() });
    const noRefresh = { platform: 'LINKEDIN', credential: 'stored_token' } as unknown as SocialAdapter;
    const tokens = await t.svc.ensureFreshToken('c1', noRefresh);
    assert.equal(tokens.accessToken, 'a-old');
  });
});

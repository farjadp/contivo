/**
 * Regression tests for the channels security review (P2-1..3, P3-1..2).
 * P1-1 (workspace scoping of createJob/retry/worker) came from the main hotfix;
 * its tests are social-workspace-scope.test.ts plus the P1 block below.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';
process.env.OAUTH_STATE_SECRET ??= 'test-only-oauth-state-secret';

import { AdapterFactory } from '../src/modules/social/adapters/adapter.factory';
import { failedPublishResult } from '../src/modules/social/adapters/http-health';
import { LinkedInAdapter } from '../src/modules/social/adapters/linkedin.adapter';
import { XAdapter } from '../src/modules/social/adapters/x.adapter';
import { memoryOAuthStore } from '../src/modules/social/oauth-store';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialOAuthService } from '../src/modules/social/social-oauth.service';
import { SocialPublishService } from '../src/modules/social/social-publish.service';
import { decryptToken, encryptToken } from '../src/modules/social/token-crypto';
import { TokenRefreshService, type LockStore } from '../src/modules/social/token-refresh.service';

import { fakePrisma } from './helpers/fake-prisma';

function memoryLocks(): LockStore {
  const held = new Set<string>();
  return {
    async acquire(key) {
      if (held.has(key)) return null;
      held.add(key);
      return 'tok';
    },
    async release(key) {
      held.delete(key);
    },
  };
}

function mk(onPublish: (c: any, prisma: any) => any = () => ({ success: true, externalPostId: 'x' })) {
  const prisma: any = fakePrisma({
    user: [{ id: 'attacker', role: 'USER' }, { id: 'victim', role: 'USER' }],
    workspace: [{ id: 'wA', userId: 'attacker' }, { id: 'wV', userId: 'victim' }],
    socialConnection: [
      { id: 'cV', workspaceId: 'wV', platform: 'LINKEDIN', accountIdentifier: 'victim-person', status: 'CONNECTED',
        encryptedAccessTokenRef: encryptToken('VICTIM-TOKEN'), encryptedRefreshTokenRef: null, tokenExpiresAt: null, metaJson: null },
      { id: 'cA', workspaceId: 'wA', platform: 'LINKEDIN', accountIdentifier: 'attacker-person', status: 'CONNECTED',
        encryptedAccessTokenRef: encryptToken('ATTACKER-TOKEN'), encryptedRefreshTokenRef: null, tokenExpiresAt: null, metaJson: null },
    ],
    contentItem: [
      { id: 'ciV', workspaceId: 'wV', status: 'SCHEDULED', topic: 'T', content: 'victim body', slug: null },
      { id: 'ciA', workspaceId: 'wA', status: 'PUBLISHING', topic: 'T', content: 'attacker body', slug: null },
    ],
  });
  const used: string[] = [];
  const adapter: any = {
    platform: 'LINKEDIN', credential: 'stored_token',
    async validateConnection() { return { ok: true }; },
    validatePayload() { return { valid: true, errors: [] }; },
    async publish(c: any) { used.push(c.accessToken); return onPublish(c, prisma); },
    normalizeError: String,
  };
  const factory = new AdapterFactory(adapter, adapter, adapter, adapter, adapter);
  const conns = new SocialConnectionsService(prisma);
  const enq: any[] = [];
  const svc = new SocialPublishService(
    prisma, factory, conns, { async enqueuePublish(p: any) { enq.push(p); } } as any,
    new TokenRefreshService(prisma, conns, memoryLocks()),
  );
  return { prisma, svc, used, enq };
}

describe('P2-1 cancel is final', () => {
  it('cancel during an in-flight attempt survives a transient failure (no retry, stays CANCELLED)', async () => {
    const { prisma, svc } = mk((_c, p) => {
      p.socialPublishJob.rows[0].status = 'CANCELLED';
      return { success: false, error: '429', retryable: true, failureCode: 'RATE_LIMITED' };
    });
    prisma.socialPublishJob.rows.push({ id: 'j1', workspaceId: 'wV', socialConnectionId: 'cV', platform: 'LINKEDIN', status: 'PUBLISH_QUEUED', retryCount: 0 });
    const out = await svc.processJobAsync('j1', 'cV', 'LINKEDIN', { body: 'b' }, { attemptsMade: 0, maxAttempts: 3 });
    assert.equal(out, 'CANCELLED');
    assert.equal(prisma.socialPublishJob.rows[0].status, 'CANCELLED');
  });

  it('cancel during an in-flight attempt survives a permanent failure', async () => {
    const { prisma, svc } = mk((_c, p) => {
      p.socialPublishJob.rows[0].status = 'CANCELLED';
      return { success: false, error: 'nope' };
    });
    prisma.socialPublishJob.rows.push({ id: 'j1', workspaceId: 'wV', socialConnectionId: 'cV', platform: 'LINKEDIN', status: 'PUBLISH_QUEUED', retryCount: 0 });
    await svc.processJobAsync('j1', 'cV', 'LINKEDIN', { body: 'b' }, { attemptsMade: 0, maxAttempts: 3 });
    assert.equal(prisma.socialPublishJob.rows[0].status, 'CANCELLED');
  });

  it('P3-A: cancel lands while the post is already going out → the live post wins: job AND item PUBLISHED', async () => {
    const { prisma, svc } = mk(async (_c, p) => {
      // The user's Cancel runs while adapter.publish is in flight.
      await svc.cancel('j1', 'wV', 'victim');
      assert.equal(p.socialPublishJob.rows[0].status, 'CANCELLED');
      assert.equal(p.contentItem.rows[0].status, 'READY');
      return { success: true, externalPostId: 'urn:li:share:1', externalPostUrl: 'https://linkedin.com/feed/update/1' };
    });
    prisma.contentItem.rows[0].status = 'PUBLISHING';
    prisma.socialPublishJob.rows.push({ id: 'j1', workspaceId: 'wV', socialConnectionId: 'cV', platform: 'LINKEDIN', status: 'PUBLISH_QUEUED', retryCount: 0, contentItemId: 'ciV' });
    const out = await svc.processJobAsync('j1', 'cV', 'LINKEDIN', { body: 'b' });
    assert.equal(out, 'PUBLISHED');
    assert.equal(prisma.socialPublishJob.rows[0].status, 'PUBLISHED');
    assert.equal(prisma.contentItem.rows[0].status, 'PUBLISHED', 'item must not stay READY while the post is live');
  });

  it('a job cancelled before the attempt reaches publish is never sent', async () => {
    const { prisma, svc, used } = mk();
    prisma.socialPublishJob.rows.push({ id: 'j1', workspaceId: 'wV', socialConnectionId: 'cV', platform: 'LINKEDIN', status: 'CANCELLED', retryCount: 0 });
    assert.equal(await svc.processJobAsync('j1', 'cV', 'LINKEDIN', { body: 'b' }), 'CANCELLED');
    assert.deepEqual(used, []);
  });
});

describe('P2-2 / P3-1 token refresh', () => {
  function refreshSetup(over: { status?: string } = {}) {
    const prisma: any = fakePrisma({
      socialConnection: [{
        id: 'c1', platform: 'X', accountIdentifier: 'x', status: over.status ?? 'CONNECTED',
        encryptedAccessTokenRef: encryptToken('a-old'), encryptedRefreshTokenRef: encryptToken('r-old'),
        tokenExpiresAt: new Date(Date.now() + 60_000),
      }],
    });
    const adapter: any = { platform: 'X', credential: 'stored_token', refreshToken: async () => ({ ok: true, accessToken: 'a-new', refreshToken: 'r-new', expiresAt: new Date(Date.now() + 7_200_000) }) };
    const svc = new TokenRefreshService(prisma, new SocialConnectionsService(prisma), memoryLocks(), { waitMs: 500, pollMs: 5, saveRetryDelayMs: 1 });
    return { prisma, svc, adapter, row: () => prisma.socialConnection.rows[0] };
  }

  it('the token save is retried after a transient DB error', async () => {
    const t = refreshSetup();
    const real = t.prisma.socialConnection.updateMany.bind(t.prisma.socialConnection);
    let calls = 0;
    t.prisma.socialConnection.updateMany = async (args: any) => {
      calls++;
      if (calls === 1) throw new Error('connection reset');
      return real(args);
    };
    const tokens = await t.svc.ensureFreshToken('c1', t.adapter);
    assert.equal(tokens.accessToken, 'a-new');
    assert.equal(decryptToken(t.row().encryptedRefreshTokenRef), 'r-new');
    assert.equal(calls, 2);
  });

  it('a racing worker marked it EXPIRED while we refreshed: the good refresh restores CONNECTED', async () => {
    const t = refreshSetup();
    t.adapter.refreshToken = async () => {
      t.row().status = 'EXPIRED';
      return { ok: true, accessToken: 'a-new', refreshToken: 'r-new', expiresAt: new Date(Date.now() + 7_200_000) };
    };
    await t.svc.ensureFreshToken('c1', t.adapter);
    assert.equal(t.row().status, 'CONNECTED');
  });

  it('disconnected during the refresh: tokens are NOT written back into a REVOKED row', async () => {
    const t = refreshSetup();
    t.adapter.refreshToken = async () => {
      t.row().status = 'REVOKED';
      t.row().encryptedAccessTokenRef = null;
      t.row().encryptedRefreshTokenRef = null;
      return { ok: true, accessToken: 'a-new', refreshToken: 'r-new', expiresAt: new Date(Date.now() + 7_200_000) };
    };
    await assert.rejects(t.svc.ensureFreshToken('c1', t.adapter), /disconnected|revoked/i);
    assert.equal(t.row().status, 'REVOKED');
    assert.equal(t.row().encryptedAccessTokenRef, null);
  });

  describe('adapter fetches carry a timeout signal', () => {
    const realFetch = globalThis.fetch;
    let signals: unknown[] = [];
    beforeEach(() => {
      signals = [];
      globalThis.fetch = (async (_u: string, init?: RequestInit) => {
        signals.push(init?.signal);
        return new Response('{"access_token":"a","data":{"id":"1"},"id":"1"}', { status: 200 });
      }) as typeof fetch;
      process.env.TWITTER_CLIENT_ID = 'cid';
      process.env.TWITTER_CLIENT_SECRET = 'cs';
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
    });
    const conn = { id: 'c', platform: 'X' as const, accountIdentifier: 'p', accessToken: 't', refreshToken: 'r' };

    it('LinkedIn validate + publish, X validate + publish + refresh', async () => {
      await new LinkedInAdapter().validateConnection(conn);
      await new LinkedInAdapter().publish(conn, { body: 'hi' });
      await new XAdapter().validateConnection(conn);
      await new XAdapter().publish(conn, { body: 'hi' });
      await new XAdapter().refreshToken(conn);
      assert.equal(signals.length, 5);
      for (const s of signals) assert.ok(s instanceof AbortSignal, 'every call has an AbortSignal');
    });
  });
});

describe('P3-2 platform error bodies are capped', () => {
  it('a 50 kB error body is cut to ~300 chars', () => {
    const r = failedPublishResult(500, `LinkedIn API 500: ${'x'.repeat(50_000)}`);
    assert.ok(r.error!.length <= 320, `got ${r.error!.length}`);
  });
});

describe('P2-3 OAuth state is bound to the browser and single-use', () => {
  // The nonce cookie, replay and cross-user cases live in social-oauth-csrf.test.ts
  // (from the P2-A hotfix). These pin what that file does not.
  const saved = { ...process.env };
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.LINKEDIN_CLIENT_ID = 'id';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret';
    process.env.LINKEDIN_REDIRECT_URI = 'http://localhost:3001/api/v1/social/oauth/linkedin/callback';
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('accessToken')) return new Response('{"access_token":"tok","expires_in":3600}', { status: 200 });
      return new Response('{"sub":"member-1","name":"Me"}', { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => {
    process.env = { ...saved };
    globalThis.fetch = realFetch;
  });

  function oauth() {
    const prisma: any = fakePrisma({
      user: [{ id: 'u1', role: 'USER' }, { id: 'u2', role: 'USER' }],
      workspace: [{ id: 'w1', userId: 'u1' }],
    });
    const svc = new SocialOAuthService(new SocialConnectionsService(prisma), memoryOAuthStore());
    return { prisma, svc };
  }
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
  const ticketOf = (url: string) => new URL(url).searchParams.get('pending')!;

  it('happy path: the callback parks the account, finalize by the same user saves it', async () => {
    const { svc, prisma } = oauth();
    const { url, nonce } = svc.startAuth('linkedin', 'w1', 'u1');
    const redirect = await svc.handleCallback('linkedin', 'code', stateOf(url), nonce);
    assert.match(redirect, /\/connections\?pending=/);
    assert.equal(prisma.socialConnection.rows.length, 0, 'nothing saved before finalize');
    await svc.finalizeConnect(ticketOf(redirect), 'u1');
    assert.equal(prisma.socialConnection.rows.length, 1);
  });

  it('a state issued for one platform cannot complete another', async () => {
    const { svc } = oauth();
    const { url, nonce } = svc.startAuth('linkedin', 'w1', 'u1');
    await assert.rejects(svc.handleCallback('x', 'code', stateOf(url), nonce), /platform/i);
  });

  it('a user who lost workspace access between connect and finalize is refused', async () => {
    const { svc, prisma } = oauth();
    const { url, nonce } = svc.startAuth('linkedin', 'w1', 'u1');
    const redirect = await svc.handleCallback('linkedin', 'code', stateOf(url), nonce);
    prisma.workspace.rows[0].userId = 'u2';
    await assert.rejects(svc.finalizeConnect(ticketOf(redirect), 'u1'));
    assert.equal(prisma.socialConnection.rows.length, 0);
  });
});

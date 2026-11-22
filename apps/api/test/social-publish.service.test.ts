/**
 * Publish executor: transient errors retry without touching the connection,
 * only the final attempt marks FAILED, revoked/expired map to their statuses,
 * and retry() rebuilds the payload from the ContentItem with a fresh job id.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import { AdapterFactory } from '../src/modules/social/adapters/adapter.factory';
import type {
  ConnectionHealth,
  PublishResult,
  SocialAdapter,
} from '../src/modules/social/adapters/social-adapter.interface';
import { TransientPublishError } from '../src/modules/social/publish-errors';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialPublishService } from '../src/modules/social/social-publish.service';
import { TokenRefreshService, type LockStore } from '../src/modules/social/token-refresh.service';
import { encryptToken } from '../src/modules/social/token-crypto';

import { fakePrisma, type FakePrisma } from './helpers/fake-prisma';

function fakeAdapter(
  platform: string,
  over: Partial<{ health: ConnectionHealth; result: PublishResult; credential: 'stored_token' | 'platform_env' }> = {},
) {
  const calls: { publish: unknown[] } = { publish: [] };
  const adapter: SocialAdapter & { calls: typeof calls } = {
    platform: platform as any,
    credential: over.credential ?? 'stored_token',
    calls,
    async validateConnection() {
      return over.health ?? { ok: true };
    },
    validatePayload() {
      return { valid: true, errors: [] };
    },
    async publish(_c, payload) {
      calls.publish.push(payload);
      return over.result ?? { success: true, externalPostId: 'urn:1', externalPostUrl: 'https://li/1' };
    },
    normalizeError: (e) => String(e),
  };
  return adapter;
}

function factoryWith(adapter: SocialAdapter) {
  const stub = (p: string) => fakeAdapter(p, { result: { success: false, error: 'stub' } });
  const map: Record<string, SocialAdapter> = {
    LINKEDIN: stub('LINKEDIN'),
    X: stub('X'),
    FACEBOOK: stub('FACEBOOK'),
    INSTAGRAM: stub('INSTAGRAM'),
    TIKTOK: stub('TIKTOK'),
    [adapter.platform]: adapter,
  };
  return new AdapterFactory(
    map.LINKEDIN as any,
    map.X as any,
    map.FACEBOOK as any,
    map.INSTAGRAM as any,
    map.TIKTOK as any,
  );
}

const memoryLocks = (): LockStore => {
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
};

function setup(adapter: SocialAdapter, seed?: Parameters<typeof fakePrisma>[0]) {
  const prisma = fakePrisma({
    user: [{ id: 'u1', role: 'USER' }],
    workspace: [{ id: 'w1', userId: 'u1' }],
    socialConnection: [
      {
        id: 'c1',
        workspaceId: 'w1',
        platform: adapter.platform,
        accountIdentifier: 'person-1',
        accountName: 'Me',
        status: 'CONNECTED',
        encryptedAccessTokenRef: encryptToken('access-1'),
        encryptedRefreshTokenRef: null,
        tokenExpiresAt: null,
        metaJson: null,
      },
    ],
    socialPublishJob: [
      { id: 'j1', workspaceId: 'w1', contentItemId: 'ci1', socialConnectionId: 'c1', platform: adapter.platform, status: 'PUBLISH_QUEUED', retryCount: 0 },
    ],
    contentItem: [
      { id: 'ci1', workspaceId: 'w1', userId: 'u1', channel: 'linkedin', topic: 'Topic', content: 'Real body', slug: 'real-body', status: 'PUBLISHING' },
    ],
    ...seed,
  });
  const enqueued: Array<{ payload: any; opts: any }> = [];
  const jobs = {
    async enqueuePublish(payload: any, delayMs = 0, opts: any = {}) {
      enqueued.push({ payload, opts: { delayMs, ...opts } });
    },
  };
  const connections = new SocialConnectionsService(prisma as any);
  const refresh = new TokenRefreshService(prisma as any, connections, memoryLocks());
  const service = new SocialPublishService(prisma as any, factoryWith(adapter), connections, jobs as any, refresh);
  return { prisma, service, enqueued };
}

const conn = (p: FakePrisma) => p.socialConnection.rows[0];
const job = (p: FakePrisma) => p.socialPublishJob.rows[0];
const item = (p: FakePrisma) => p.contentItem.rows[0];
const actions = (p: FakePrisma) => p.socialPublishLog.rows.map((l) => l.action);

describe('processJobAsync', () => {
  it('publishes and writes the URL back to job and item', async () => {
    const { prisma, service } = setup(fakeAdapter('LINKEDIN'));
    const out = await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'Real body' });
    assert.equal(out, 'PUBLISHED');
    assert.equal(job(prisma).status, 'PUBLISHED');
    assert.equal(job(prisma).externalPostUrl, 'https://li/1');
    assert.equal(item(prisma).status, 'PUBLISHED');
  });

  it('transient health, not final attempt: rethrows, connection stays CONNECTED, nothing FAILED', async () => {
    const { prisma, service } = setup(
      fakeAdapter('LINKEDIN', { health: { ok: false, reason: 'transient', detail: 'ENOTFOUND' } }),
    );
    await assert.rejects(
      service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }, { attemptsMade: 0, maxAttempts: 3 }),
      TransientPublishError,
    );
    assert.equal(conn(prisma).status, 'CONNECTED');
    assert.equal(job(prisma).status, 'PUBLISH_QUEUED');
    assert.match(job(prisma).lastError, /ENOTFOUND/);
    assert.equal(item(prisma).status, 'PUBLISHING');
    assert.ok(actions(prisma).includes('PUBLISH_RETRY_SCHEDULED'));
    assert.ok(!actions(prisma).includes('PUBLISH_FAILURE'));
  });

  it('transient on the final attempt: job + item FAILED + failure log, connection still CONNECTED', async () => {
    const { prisma, service } = setup(
      fakeAdapter('LINKEDIN', { health: { ok: false, reason: 'transient', detail: 'ENOTFOUND' } }),
    );
    const out = await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }, { attemptsMade: 2, maxAttempts: 3 });
    assert.equal(out, 'FAILED');
    assert.equal(conn(prisma).status, 'CONNECTED');
    assert.equal(job(prisma).status, 'FAILED');
    assert.equal(item(prisma).status, 'FAILED');
    assert.match(item(prisma).failedReason, /ENOTFOUND/);
    assert.ok(actions(prisma).includes('PUBLISH_FAILURE'));
  });

  it('retryable publish result rethrows with retryAfterSec', async () => {
    const { service } = setup(
      fakeAdapter('LINKEDIN', { result: { success: false, error: '429', retryable: true, retryAfterSec: 40 } }),
    );
    await assert.rejects(
      service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }, { attemptsMade: 0, maxAttempts: 3 }),
      (err: unknown) => err instanceof TransientPublishError && err.retryAfterSec === 40,
    );
  });

  it('non-retryable publish failure fails at once even with attempts left', async () => {
    const { prisma, service } = setup(fakeAdapter('LINKEDIN', { result: { success: false, error: 'LinkedIn API 422: dup' } }));
    const out = await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }, { attemptsMade: 0, maxAttempts: 3 });
    assert.equal(out, 'FAILED');
    assert.equal(job(prisma).lastError, 'LinkedIn API 422: dup');
  });

  it('revoked → connection REVOKED, job FAILED', async () => {
    const { prisma, service } = setup(fakeAdapter('LINKEDIN', { health: { ok: false, reason: 'revoked', detail: '403' } }));
    await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }, { attemptsMade: 0, maxAttempts: 3 });
    assert.equal(conn(prisma).status, 'REVOKED');
    assert.equal(job(prisma).status, 'FAILED');
    assert.match(job(prisma).lastError, /reconnect/i);
  });

  it('expired → connection EXPIRED', async () => {
    const { prisma, service } = setup(fakeAdapter('LINKEDIN', { health: { ok: false, reason: 'expired', detail: '401' } }));
    await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }, { attemptsMade: 0, maxAttempts: 3 });
    assert.equal(conn(prisma).status, 'EXPIRED');
  });

  it('platform_env adapter publishes without a stored token', async () => {
    const adapter = fakeAdapter('LINKEDIN', { credential: 'platform_env' });
    const { prisma, service } = setup(adapter);
    conn(prisma).encryptedAccessTokenRef = null;
    assert.equal(await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }), 'PUBLISHED');
  });

  it('stored_token adapter with no token fails clearly', async () => {
    const { prisma, service } = setup(fakeAdapter('LINKEDIN'));
    conn(prisma).encryptedAccessTokenRef = null;
    assert.equal(await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }), 'FAILED');
    assert.match(job(prisma).lastError, /token/i);
  });

  it('a connection that is not CONNECTED is not published to', async () => {
    const adapter = fakeAdapter('LINKEDIN');
    const { prisma, service } = setup(adapter);
    conn(prisma).status = 'EXPIRED';
    assert.equal(await service.processJobAsync('j1', 'c1', 'LINKEDIN', { body: 'x' }), 'FAILED');
    assert.equal(adapter.calls.publish.length, 0);
    assert.match(job(prisma).lastError, /EXPIRED/);
  });

  it('a platform with no adapter (TELEGRAM) fails with "not supported yet", no crash', async () => {
    const { prisma, service } = setup(fakeAdapter('LINKEDIN'));
    job(prisma).platform = 'TELEGRAM';
    assert.equal(await service.processJobAsync('j1', 'c1', 'TELEGRAM', { body: 'x' }), 'FAILED');
    assert.match(job(prisma).lastError, /TELEGRAM publishing is not supported yet/);
    assert.equal(item(prisma).status, 'FAILED');
  });
});

describe('retry()', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup(fakeAdapter('LINKEDIN'));
    job(ctx.prisma).status = 'FAILED';
    job(ctx.prisma).lastError = 'boom';
    item(ctx.prisma).status = 'FAILED';
    item(ctx.prisma).failedReason = 'boom';
  });

  it('rebuilds the payload from the ContentItem and enqueues with a fresh job id', async () => {
    await ctx.service.retry('j1', 'w1', 'u1');
    assert.equal(ctx.enqueued.length, 1);
    const { payload, opts } = ctx.enqueued[0];
    assert.equal(payload.metadata.body, 'Real body');
    assert.equal(payload.metadata.title, 'Topic');
    assert.equal(payload.metadata.slug, 'real-body');
    assert.equal(opts.jobId, 'j1-r1');
    assert.ok(!opts.jobId.includes(':'), 'BullMQ rejects custom ids with a single ":"');
    assert.equal(job(ctx.prisma).retryCount, 1);
    assert.equal(job(ctx.prisma).status, 'PUBLISH_QUEUED');
    assert.equal(item(ctx.prisma).status, 'PUBLISHING');
    assert.equal(item(ctx.prisma).failedReason, null);
  });

  it('second retry gets the next id', async () => {
    await ctx.service.retry('j1', 'w1', 'u1');
    job(ctx.prisma).status = 'FAILED';
    await ctx.service.retry('j1', 'w1', 'u1');
    assert.equal(ctx.enqueued[1].opts.jobId, 'j1-r2');
  });

  it('a job with no ContentItem cannot be retried (no body to rebuild)', async () => {
    job(ctx.prisma).contentItemId = null;
    await assert.rejects(ctx.service.retry('j1', 'w1', 'u1'), /no content item/i);
    assert.equal(ctx.enqueued.length, 0);
  });
});

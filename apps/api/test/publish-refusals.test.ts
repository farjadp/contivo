/**
 * QA follow-ups on the publish core:
 * - retry()/cancel() refusals carry a stable `reason` the web localises, and
 *   their human message names no internal id;
 * - no failedReason / lastError the core writes contains a cuid;
 * - disconnect clears isDefault and hands the default to the oldest other
 *   CONNECTED account of the same platform.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import { formatFailure, isPublishJobRefusal, PUBLISH_JOB_REFUSALS } from '@contivo/types';
import { HttpException } from '@nestjs/common';

import { AdapterFactory } from '../src/modules/social/adapters/adapter.factory';
import type { SocialAdapter } from '../src/modules/social/adapters/social-adapter.interface';
import { buildPublishPayload } from '../src/modules/social/publish-payload';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialPublishService } from '../src/modules/social/social-publish.service';
import { encryptToken } from '../src/modules/social/token-crypto';
import { TokenRefreshService, type LockStore } from '../src/modules/social/token-refresh.service';

import { fakePrisma, type FakePrisma } from './helpers/fake-prisma';

const JOB_ID = 'cmwr1abcde2fghij3klmn4opq';
const ITEM_ID = 'cmwr9zyxw8vuts7rqpo6nmlkj';
const CUID = /\bc[a-z0-9]{24}\b/;

const memoryLocks = (): LockStore => ({ async acquire() { return 'tok'; }, async release() {} });

function adapter(): SocialAdapter {
  return {
    platform: 'LINKEDIN' as any,
    credential: 'stored_token',
    async validateConnection() { return { ok: true }; },
    validatePayload() { return { valid: true, errors: [] }; },
    async publish() { return { success: true, externalPostId: 'urn:1', externalPostUrl: 'https://li/1' }; },
    normalizeError: (e) => String(e),
  };
}

function setup() {
  const prisma = fakePrisma({
    user: [{ id: 'u1', role: 'USER' }],
    workspace: [{ id: 'w1', userId: 'u1' }],
    socialConnection: [{
      id: 'c1', workspaceId: 'w1', platform: 'LINKEDIN', accountIdentifier: 'p1', accountName: 'Me',
      status: 'CONNECTED', encryptedAccessTokenRef: encryptToken('a'), encryptedRefreshTokenRef: null,
      tokenExpiresAt: null, metaJson: null,
    }],
    socialPublishJob: [{
      id: JOB_ID, workspaceId: 'w1', contentItemId: ITEM_ID, socialConnectionId: 'c1',
      platform: 'LINKEDIN', status: 'FAILED', retryCount: 0, lastError: '[PLATFORM_ERROR] boom',
    }],
    contentItem: [{
      id: ITEM_ID, workspaceId: 'w1', userId: 'u1', channel: 'linkedin', topic: 'T', content: 'Body',
      slug: 's', status: 'FAILED', failedReason: '[PLATFORM_ERROR] boom',
    }],
  });
  const a = adapter();
  const conns = new SocialConnectionsService(prisma as any);
  const svc = new SocialPublishService(
    prisma as any,
    new AdapterFactory(a as any, a as any, a as any, a as any, a as any),
    conns,
    { async enqueuePublish() {} } as any,
    new TokenRefreshService(prisma as any, conns, memoryLocks()),
  );
  return { prisma, svc };
}

const job = (p: FakePrisma) => p.socialPublishJob.rows[0];
const item = (p: FakePrisma) => p.contentItem.rows[0];

/** Asserts the call is refused with `reason` and a message free of ids. */
async function refused(call: Promise<unknown>, reason: string, status?: number) {
  await assert.rejects(call, (err: unknown) => {
    assert.ok(err instanceof HttpException, 'an HttpException');
    const body = err.getResponse() as { message?: unknown; reason?: unknown };
    assert.equal(body.reason, reason);
    assert.equal(typeof body.message, 'string');
    assert.doesNotMatch(body.message as string, CUID, 'no internal id in the human message');
    if (status) assert.equal(err.getStatus(), status);
    return true;
  });
}

describe('publish-job refusal reasons', () => {
  it('the shared list has every reason the API throws', () => {
    for (const r of ['JOB_NOT_FOUND', 'NOT_RETRYABLE_STATUS', 'RETRY_LIMIT', 'NO_CONTENT_ITEM', 'EMPTY_CONTENT', 'ALREADY_RETRYING', 'ALREADY_PUBLISHED']) {
      assert.ok(isPublishJobRefusal(r), r);
    }
    assert.equal(isPublishJobRefusal('MADE_UP'), false);
    assert.equal(new Set(PUBLISH_JOB_REFUSALS).size, PUBLISH_JOB_REFUSALS.length);
  });
});

describe('retry() refusals', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('unknown job → JOB_NOT_FOUND (404)', async () => {
    await refused(ctx.svc.retry('cmwrnotthere000000000000a', 'w1', 'u1'), 'JOB_NOT_FOUND', 404);
  });

  it('job not FAILED → NOT_RETRYABLE_STATUS', async () => {
    job(ctx.prisma).status = 'PUBLISHED';
    await refused(ctx.svc.retry(JOB_ID, 'w1', 'u1'), 'NOT_RETRYABLE_STATUS');
  });

  it('five retries used → RETRY_LIMIT, message has no job id', async () => {
    job(ctx.prisma).retryCount = 5;
    await refused(ctx.svc.retry(JOB_ID, 'w1', 'u1'), 'RETRY_LIMIT', 400);
  });

  it('no content item on the job → NO_CONTENT_ITEM', async () => {
    job(ctx.prisma).contentItemId = null;
    await refused(ctx.svc.retry(JOB_ID, 'w1', 'u1'), 'NO_CONTENT_ITEM');
  });

  it('content item deleted → NO_CONTENT_ITEM', async () => {
    ctx.prisma.contentItem.rows.length = 0;
    await refused(ctx.svc.retry(JOB_ID, 'w1', 'u1'), 'NO_CONTENT_ITEM');
  });

  it('content item emptied → EMPTY_CONTENT', async () => {
    item(ctx.prisma).content = '   ';
    await refused(ctx.svc.retry(JOB_ID, 'w1', 'u1'), 'EMPTY_CONTENT');
  });

  it('lost the double-click race → ALREADY_RETRYING (409)', async () => {
    const realUpdateMany = ctx.prisma.socialPublishJob.updateMany;
    ctx.prisma.socialPublishJob.updateMany = async () => ({ count: 0 });
    try {
      await refused(ctx.svc.retry(JOB_ID, 'w1', 'u1'), 'ALREADY_RETRYING', 409);
    } finally {
      ctx.prisma.socialPublishJob.updateMany = realUpdateMany;
    }
  });
});

describe('cancel() refusals', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('unknown job → JOB_NOT_FOUND (404)', async () => {
    await refused(ctx.svc.cancel('cmwrnotthere000000000000a', 'w1', 'u1'), 'JOB_NOT_FOUND', 404);
  });

  it('already published → ALREADY_PUBLISHED', async () => {
    job(ctx.prisma).status = 'PUBLISHED';
    await refused(ctx.svc.cancel(JOB_ID, 'w1', 'u1'), 'ALREADY_PUBLISHED', 400);
  });

  it('published in the same instant → ALREADY_PUBLISHED', async () => {
    job(ctx.prisma).status = 'PUBLISH_QUEUED';
    ctx.prisma.socialPublishJob.updateMany = async () => ({ count: 0 });
    await refused(ctx.svc.cancel(JOB_ID, 'w1', 'u1'), 'ALREADY_PUBLISHED');
  });
});

describe('no internal ids in stored failure details', () => {
  it('formatFailure strips cuids from the detail', () => {
    const out = formatFailure('NO_CONNECTION', `Social connection ${JOB_ID} no longer exists.`);
    assert.doesNotMatch(out, CUID);
    assert.match(out, /^\[NO_CONNECTION\] Social connection no longer exists\.$/);
  });

  it('formatFailure strips cuids from an already coded detail too', () => {
    assert.doesNotMatch(formatFailure('PLATFORM_ERROR', `[RATE_LIMITED] job ${JOB_ID} slow`), CUID);
  });

  it('formatFailure leaves ordinary words, URNs and numbers alone', () => {
    assert.equal(
      formatFailure('PLATFORM_ERROR', 'LinkedIn API 422: urn:li:person:abc123 rejected.'),
      '[PLATFORM_ERROR] LinkedIn API 422: urn:li:person:abc123 rejected.',
    );
  });

  it('an empty item body says so without the item id', () => {
    assert.throws(
      () => buildPublishPayload({ id: ITEM_ID, topic: 'T', content: '' }),
      (err: Error) => !CUID.test(err.message) && /no body/i.test(err.message),
    );
  });

  it('a connection deleted mid-flight writes a reason without its id', async () => {
    const ctx = setup();
    job(ctx.prisma).status = 'PUBLISH_QUEUED';
    item(ctx.prisma).status = 'PUBLISHING';
    const gone = 'cmwrgone00000000000000000';
    await ctx.svc.processJobAsync(JOB_ID, gone, 'LINKEDIN' as any, { body: 'x', hashtags: [] });
    assert.match(job(ctx.prisma).lastError, /^\[NO_CONNECTION\]/);
    assert.doesNotMatch(job(ctx.prisma).lastError, CUID);
    assert.doesNotMatch(item(ctx.prisma).failedReason, CUID);
  });
});

describe('disconnect and the default account', () => {
  const conn = (id: string, over: Record<string, unknown> = {}) => ({
    id, workspaceId: 'w1', platform: 'LINKEDIN', accountIdentifier: id, accountName: id,
    status: 'CONNECTED', isDefault: false, createdAt: new Date('2026-01-01'),
    encryptedAccessTokenRef: 'x', encryptedRefreshTokenRef: null, ...over,
  });
  const base = { user: [{ id: 'u1', role: 'USER' }], workspace: [{ id: 'w1', userId: 'u1' }] };
  const row = (p: FakePrisma, id: string) => p.socialConnection.rows.find((r) => r.id === id)!;

  it('clears isDefault on the disconnected row', async () => {
    const prisma = fakePrisma({ ...base, socialConnection: [conn('a', { isDefault: true })] });
    await new SocialConnectionsService(prisma as any).disconnect('a', 'w1', 'u1');
    assert.equal(row(prisma, 'a').status, 'REVOKED');
    assert.equal(row(prisma, 'a').isDefault, false);
  });

  it('hands the default to the oldest other CONNECTED account of the same platform', async () => {
    const prisma = fakePrisma({
      ...base,
      socialConnection: [
        conn('a', { isDefault: true, createdAt: new Date('2026-01-01') }),
        conn('newer', { createdAt: new Date('2026-03-01') }),
        conn('older', { createdAt: new Date('2026-02-01') }),
        conn('expired', { status: 'EXPIRED', createdAt: new Date('2025-01-01') }),
        conn('x', { platform: 'X', createdAt: new Date('2025-01-01') }),
        conn('other-ws', { workspaceId: 'w2', createdAt: new Date('2025-01-01') }),
      ],
    });
    await new SocialConnectionsService(prisma as any).disconnect('a', 'w1', 'u1');
    assert.equal(row(prisma, 'older').isDefault, true);
    for (const id of ['a', 'newer', 'expired', 'x', 'other-ws']) assert.equal(row(prisma, id).isDefault, false, id);
  });

  it('disconnecting a non-default account leaves the current default alone', async () => {
    const prisma = fakePrisma({
      ...base,
      socialConnection: [conn('d', { isDefault: true, createdAt: new Date('2026-05-01') }), conn('b')],
    });
    await new SocialConnectionsService(prisma as any).disconnect('b', 'w1', 'u1');
    assert.equal(row(prisma, 'd').isDefault, true);
    assert.equal(row(prisma, 'b').isDefault, false);
  });

  it('no other CONNECTED account: nothing becomes default', async () => {
    const prisma = fakePrisma({
      ...base,
      socialConnection: [conn('a', { isDefault: true }), conn('e', { status: 'EXPIRED' })],
    });
    await new SocialConnectionsService(prisma as any).disconnect('a', 'w1', 'u1');
    assert.ok(prisma.socialConnection.rows.every((r) => r.isDefault === false));
  });
});

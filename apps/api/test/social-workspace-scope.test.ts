/**
 * P1 — cross-workspace publish.
 *
 * createJob authorised the workspace in the body but trusted the
 * socialConnectionId and contentItemId in the same body, so a signed-in user
 * could publish through another customer's LinkedIn connection. These tests
 * pin that every id taken from a request is scoped to the authorised workspace,
 * and that the worker refuses a job whose connection belongs elsewhere (rows
 * created before the fix).
 *
 * Run: pnpm --filter @contivo/api test
 */
import 'reflect-metadata';

import { strict as assert } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialPublishService } from '../src/modules/social/social-publish.service';
import { TokenRefreshService, type LockStore } from '../src/modules/social/token-refresh.service';

import { fakePrisma } from './helpers/fake-prisma';

// Ported from the P1 hotfix onto the channels publish core: our constructor
// takes a TokenRefreshService and the shared fake-prisma helper (which knows
// `{ not }`, so the worker's NOT_CANCELLED claim is really exercised).

// Two customers, each with their own workspace, connection and content.
const ATTACKER = 'user-attacker';
const VICTIM = 'user-victim';

const memoryLocks = (): LockStore => ({ async acquire() { return 'tok'; }, async release() {} });

function setup() {
  const prisma: any = fakePrisma({
    user: [{ id: ATTACKER, role: 'USER' }, { id: VICTIM, role: 'USER' }],
    workspace: [{ id: 'ws-attacker', userId: ATTACKER }, { id: 'ws-victim', userId: VICTIM }],
    socialConnection: [
      { id: 'conn-attacker', workspaceId: 'ws-attacker', platform: 'LINKEDIN', status: 'CONNECTED', accountIdentifier: 'a' },
      { id: 'conn-victim', workspaceId: 'ws-victim', platform: 'LINKEDIN', status: 'CONNECTED', accountIdentifier: 'v' },
      { id: 'conn-attacker-x', workspaceId: 'ws-attacker', platform: 'X', status: 'CONNECTED', accountIdentifier: 'ax' },
    ],
    contentItem: [
      { id: 'item-attacker', workspaceId: 'ws-attacker', userId: ATTACKER, status: 'READY', topic: 'T', content: 'mine', slug: null },
      { id: 'item-victim', workspaceId: 'ws-victim', userId: VICTIM, status: 'FAILED', topic: 'T', content: 'theirs', slug: null },
    ],
    socialPublishJob: [
      // Rows created through the hole before the fix.
      { id: 'job-planted', workspaceId: 'ws-attacker', socialConnectionId: 'conn-victim', platform: 'LINKEDIN', status: 'PUBLISH_QUEUED', retryCount: 0, contentItemId: null },
      { id: 'job-planted-item', workspaceId: 'ws-attacker', socialConnectionId: 'conn-attacker', platform: 'LINKEDIN', status: 'FAILED', retryCount: 0, contentItemId: 'item-victim' },
    ],
  });

  const published: string[] = [];
  const adapter = {
    platform: 'LINKEDIN',
    credential: 'stored_token',
    validatePayload: () => ({ valid: true, errors: [] }),
    validateConnection: async () => ({ ok: true }),
    publish: async (conn: { id: string }) => {
      published.push(conn.id);
      return { success: true, externalPostId: 'p1' };
    },
  };
  const connections = new SocialConnectionsService(prisma);
  const enqueued: string[] = [];
  const jobs = { enqueuePublish: async (p: { jobRecordId: string }) => { enqueued.push(p.jobRecordId); } };

  const svc = new SocialPublishService(
    prisma,
    { getAdapter: () => adapter } as never,
    connections,
    jobs as never,
    new TokenRefreshService(prisma, connections, memoryLocks()),
  );
  return { svc, prisma, published, enqueued };
}

const base = { workspaceId: 'ws-attacker', platform: 'LINKEDIN' as const, body: 'hello' };

describe('P1: createJob scopes request ids to the authorised workspace', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('refuses another workspace\'s connection with 404 and creates nothing', async () => {
    await assert.rejects(
      ctx.svc.createJob({ ...base, socialConnectionId: 'conn-victim' }, ATTACKER),
      (err: any) => err?.status === 404,
    );
    assert.equal(ctx.prisma.socialPublishJob.rows.length, 2, 'no job row written (2 seeded)');
    assert.deepEqual(ctx.enqueued, []);
  });

  it('refuses another workspace\'s content item with 404', async () => {
    await assert.rejects(
      ctx.svc.createJob({ ...base, socialConnectionId: 'conn-attacker', contentItemId: 'item-victim' }, ATTACKER),
      (err: any) => err?.status === 404,
    );
    assert.equal(ctx.prisma.socialPublishJob.rows.length, 2);
  });

  it('refuses a connection whose platform differs from the job platform', async () => {
    await assert.rejects(
      ctx.svc.createJob({ ...base, socialConnectionId: 'conn-attacker-x' }, ATTACKER),
      (err: any) => err?.status === 400,
    );
  });

  it('still creates a job for the caller\'s own connection and content', async () => {
    const job = await ctx.svc.createJob(
      { ...base, socialConnectionId: 'conn-attacker', contentItemId: 'item-attacker' },
      ATTACKER,
    );
    assert.equal(job.socialConnectionId, 'conn-attacker');
    assert.deepEqual(ctx.enqueued, [job.id]);
  });
});

describe('P1: the worker refuses a job whose connection is in another workspace', () => {
  it('fails the planted job with a coded failure, without calling the platform', async () => {
    const ctx = setup();
    const outcome = await ctx.svc.processJobAsync('job-planted', 'conn-victim', 'LINKEDIN', { body: 'x' });
    assert.equal(outcome, 'FAILED');
    assert.deepEqual(ctx.published, [], 'adapter.publish must not run');
    const job = ctx.prisma.socialPublishJob.rows.find((r: any) => r.id === 'job-planted')!;
    assert.equal(job.status, 'FAILED');
    assert.match(job.lastError, /^\[NO_CONNECTION\]/);
    assert.doesNotMatch(job.lastError, /conn-victim/, 'no foreign id in the stored reason');
  });
});

describe('P1: retry reads the post from the job\'s own workspace', () => {
  it('a planted job pointing at another workspace\'s post is refused and enqueues nothing', async () => {
    const ctx = setup();
    await assert.rejects(
      ctx.svc.retry('job-planted-item', 'ws-attacker', ATTACKER),
      (err: any) => err?.status === 400 && err.getResponse().reason === 'NO_CONTENT_ITEM',
    );
    assert.deepEqual(ctx.enqueued, []);
    const item = ctx.prisma.contentItem.rows.find((r: any) => r.id === 'item-victim')!;
    assert.equal(item.status, 'FAILED', 'the victim\'s post is untouched');
  });
});

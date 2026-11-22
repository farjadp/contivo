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

import { SocialPublishService } from '../src/modules/social/social-publish.service';

type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && 'in' in v) return (v.in as unknown[]).includes(row[k]);
    return row[k] === v;
  });
}

function table(rows: Row[]) {
  return {
    rows,
    findFirst: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where?: Row } = {}) => rows.filter((r) => matches(r, where)),
    create: async ({ data }: { data: Row }) => {
      const row = { id: `job-${rows.length + 1}`, retryCount: 0, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
}

// Two customers, each with their own workspace, connection and content.
const ATTACKER = 'user-attacker';
const VICTIM = 'user-victim';

function setup() {
  const prisma = {
    socialConnection: table([
      { id: 'conn-attacker', workspaceId: 'ws-attacker', platform: 'LINKEDIN', status: 'CONNECTED', accountIdentifier: 'a' },
      { id: 'conn-victim', workspaceId: 'ws-victim', platform: 'LINKEDIN', status: 'CONNECTED', accountIdentifier: 'v' },
      { id: 'conn-attacker-x', workspaceId: 'ws-attacker', platform: 'X', status: 'CONNECTED', accountIdentifier: 'ax' },
    ]),
    contentItem: table([
      { id: 'item-attacker', workspaceId: 'ws-attacker', userId: ATTACKER },
      { id: 'item-victim', workspaceId: 'ws-victim', userId: VICTIM },
    ]),
    socialPublishJob: table([
      // A row created through the hole before the fix.
      { id: 'job-planted', workspaceId: 'ws-attacker', socialConnectionId: 'conn-victim', platform: 'LINKEDIN', status: 'FAILED', retryCount: 0, contentItemId: null },
    ]),
    socialPublishLog: { create: async () => ({}) },
    contentImage: { findFirst: async () => null },
  };

  const published: string[] = [];
  const adapter = {
    validatePayload: () => ({ valid: true, errors: [] }),
    validateConnection: async () => true,
    publish: async (conn: { id: string }) => {
      published.push(conn.id);
      return { success: true, externalPostId: 'p1' };
    },
  };
  const connections = {
    // Workspace access: each user owns exactly their own workspace.
    validateWorkspaceAccess: async (workspaceId: string, userId: string) => {
      const owner = workspaceId === 'ws-attacker' ? ATTACKER : workspaceId === 'ws-victim' ? VICTIM : null;
      if (owner !== userId) throw Object.assign(new Error('forbidden'), { status: 403 });
    },
    getDecryptedTokens: async () => ({ accessToken: 'tok', refreshToken: null }),
  };
  const enqueued: string[] = [];
  const jobs = { enqueuePublish: async (p: { jobRecordId: string }) => { enqueued.push(p.jobRecordId); } };

  const svc = new SocialPublishService(
    prisma as never,
    { getAdapter: () => adapter } as never,
    connections as never,
    jobs as never,
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
    assert.equal(ctx.prisma.socialPublishJob.rows.length, 1, 'no job row written');
    assert.deepEqual(ctx.enqueued, []);
  });

  it('refuses another workspace\'s content item with 404', async () => {
    await assert.rejects(
      ctx.svc.createJob({ ...base, socialConnectionId: 'conn-attacker', contentItemId: 'item-victim' }, ATTACKER),
      (err: any) => err?.status === 404,
    );
    assert.equal(ctx.prisma.socialPublishJob.rows.length, 1);
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
  it('fails the planted job without calling the platform', async () => {
    const ctx = setup();
    await ctx.svc.processJobAsync('job-planted', 'conn-victim', 'LINKEDIN', { body: 'x' });
    assert.deepEqual(ctx.published, [], 'adapter.publish must not run');
    const job = ctx.prisma.socialPublishJob.rows.find((r) => r.id === 'job-planted')!;
    assert.equal(job.status, 'FAILED');
  });
});

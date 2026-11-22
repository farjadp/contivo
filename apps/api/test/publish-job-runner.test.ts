/**
 * The BullMQ handler: passes attempt numbers to the service, lets transient
 * errors through for a retry, turns a recorded failure into UnrecoverableError
 * (so BullMQ shows it failed and does not retry), and honours retry-after.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { UnrecoverableError } from 'bullmq';

import { TransientPublishError } from '../src/modules/social/publish-errors';
import { publishBackoff, runPublishJob } from '../src/modules/social/publish-job-runner';

function job(attemptsMade: number, attempts = 3) {
  return { id: 'j1', attemptsMade, opts: { attempts }, data: { jobRecordId: 'j1', userId: 'u1', metadata: { body: 'b' } } } as any;
}

function deps(status: string, outcome: () => Promise<'PUBLISHED' | 'FAILED'>) {
  const seen: any[] = [];
  return {
    seen,
    prisma: { socialPublishJob: { findUnique: async () => ({ id: 'j1', socialConnectionId: 'c1', platform: 'LINKEDIN', status }) } },
    publishService: {
      processJobAsync: async (...args: any[]) => {
        seen.push(args);
        return outcome();
      },
    },
  } as any;
}

describe('runPublishJob', () => {
  it('passes attemptsMade/attempts so the service knows the final attempt', async () => {
    const d = deps('PUBLISH_QUEUED', async () => 'PUBLISHED');
    await runPublishJob(job(2), d);
    assert.deepEqual(d.seen[0][4], { attemptsMade: 2, maxAttempts: 3 });
  });

  it('transient error propagates (BullMQ retries)', async () => {
    const d = deps('PUBLISH_QUEUED', async () => {
      throw new TransientPublishError('ENOTFOUND');
    });
    await assert.rejects(runPublishJob(job(0), d), TransientPublishError);
  });

  it('a recorded FAILED becomes UnrecoverableError', async () => {
    const d = deps('PUBLISH_QUEUED', async () => 'FAILED');
    await assert.rejects(runPublishJob(job(0), d), UnrecoverableError);
  });

  it('skips PUBLISHED and CANCELLED records', async () => {
    for (const s of ['PUBLISHED', 'CANCELLED']) {
      const d = deps(s, async () => 'PUBLISHED');
      const out = await runPublishJob(job(0), d);
      assert.equal(out.skipped, true);
      assert.equal(d.seen.length, 0);
    }
  });
});

describe('publishBackoff', () => {
  it('uses retryAfterSec when the platform gave one', () => {
    assert.equal(publishBackoff(1, 'publish', new TransientPublishError('429', 45)), 45_000);
  });
  it('falls back to exponential 2s, 4s, 8s', () => {
    assert.equal(publishBackoff(1, 'publish', new Error('x')), 2000);
    assert.equal(publishBackoff(2, 'publish', new Error('x')), 4000);
    assert.equal(publishBackoff(3, 'publish', new Error('x')), 8000);
  });
});

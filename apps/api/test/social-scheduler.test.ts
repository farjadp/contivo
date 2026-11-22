/**
 * Scheduler: an unmapped channel is parked as FAILED once instead of being
 * re-read every minute; blog is left to the web publisher.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { SocialSchedulerService } from '../src/modules/social/social-scheduler.service';

import { fakePrisma } from './helpers/fake-prisma';

const due = new Date(Date.now() - 60_000);

function setup(items: Array<Record<string, unknown>>) {
  const prisma = fakePrisma({
    contentItem: items.map((i, n) => ({
      id: `ci${n}`,
      workspaceId: 'w1',
      userId: 'u1',
      topic: 'Topic',
      content: 'Body',
      slug: null,
      status: 'SCHEDULED',
      scheduledAtUtc: due,
      ...i,
    })),
    socialConnection: [
      { id: 'c-li', workspaceId: 'w1', platform: 'LINKEDIN', status: 'CONNECTED', isDefault: true },
      { id: 'c-tg', workspaceId: 'w1', platform: 'TELEGRAM', status: 'CONNECTED', isDefault: true },
    ],
  });
  const created: any[] = [];
  const publishService = {
    async createJob(dto: any) {
      created.push(dto);
      if (dto.platform === 'TELEGRAM') {
        throw new BadRequestException({ message: 'TELEGRAM publishing is not supported yet.', code: 'NO_PUBLISHER' });
      }
      return { id: 'job-1' };
    },
  };
  const scheduler = new SocialSchedulerService(prisma as any, publishService as any);
  return { prisma, scheduler, created };
}

describe('SocialSchedulerService', () => {
  it('parks an unmapped channel (email) as FAILED with a reason, once', async () => {
    const { prisma, scheduler, created } = setup([{ channel: 'email' }]);
    await scheduler.handleScheduledPublishing();
    const item = prisma.contentItem.rows[0];
    assert.equal(item.status, 'FAILED');
    assert.equal(item.failedReason, '[NO_PUBLISHER] No publisher for channel email');
    assert.equal(created.length, 0);
    await scheduler.handleScheduledPublishing();
    assert.equal(item.failedReason, '[NO_PUBLISHER] No publisher for channel email');
  });

  it('skips blog silently (the web publisher owns it)', async () => {
    const { prisma, scheduler, created } = setup([{ channel: 'blog' }]);
    await scheduler.handleScheduledPublishing();
    assert.equal(prisma.contentItem.rows[0].status, 'SCHEDULED');
    assert.equal(prisma.contentItem.rows[0].failedReason ?? null, null);
    assert.equal(created.length, 0);
  });

  it('a mapped channel gets a job whose payload is built from the item', async () => {
    const { prisma, scheduler, created } = setup([{ channel: 'linkedin', slug: 'my-slug' }]);
    await scheduler.handleScheduledPublishing();
    assert.equal(created.length, 1);
    assert.equal(created[0].platform, 'LINKEDIN');
    assert.equal(created[0].body, 'Body');
    assert.equal(created[0].title, 'Topic');
    assert.equal(created[0].slug, 'my-slug');
    assert.equal(prisma.contentItem.rows[0].status, 'PUBLISHING');
  });

  it('a mapped channel with no adapter yet (telegram) fails with the adapter error', async () => {
    const { prisma, scheduler } = setup([{ channel: 'telegram' }]);
    await scheduler.handleScheduledPublishing();
    assert.equal(prisma.contentItem.rows[0].status, 'FAILED');
    assert.match(prisma.contentItem.rows[0].failedReason, /^\[NO_PUBLISHER\] .*not supported yet/);
  });

  it('an item with an empty body fails instead of posting the topic', async () => {
    const { prisma, scheduler, created } = setup([{ channel: 'linkedin', content: '   ' }]);
    await scheduler.handleScheduledPublishing();
    assert.equal(created.length, 0);
    assert.equal(prisma.contentItem.rows[0].status, 'FAILED');
    assert.match(prisma.contentItem.rows[0].failedReason, /^\[INVALID_CONTENT\] .*no body/i);
  });
});

describe('SocialSchedulerService failure codes', () => {
  it('no default connection → [NO_CONNECTION]', async () => {
    const { prisma, scheduler } = setup([{ channel: 'linkedin' }]);
    prisma.socialConnection.rows.length = 0;
    await scheduler.handleScheduledPublishing();
    assert.match(prisma.contentItem.rows[0].failedReason, /^\[NO_CONNECTION\] /);
  });
});

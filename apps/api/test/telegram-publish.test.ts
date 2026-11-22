/**
 * End to end inside the API, against the local fake Bot API: scheduler →
 * createJob → processJobAsync → TelegramAdapter → fake Telegram.
 *
 * - a scheduled telegram item is published and the URL written back;
 * - 429 on part 2 → transient retry with retry_after; the retry posts only
 *   the parts not yet sent (no duplicate messages);
 * - bot kicked → connection REVOKED, item FAILED [CONNECTION_REVOKED];
 * - TELEGRAM_BOT_TOKEN unset → [NO_PUBLISHER], nothing sent;
 * - group migrated → the connection row gets the new chat id.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import { AdapterFactory } from '../src/modules/social/adapters/adapter.factory';
import { TelegramAdapter } from '../src/modules/social/adapters/telegram.adapter';
import { TransientPublishError } from '../src/modules/social/publish-errors';
import { publishBackoff } from '../src/modules/social/publish-job-runner';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { SocialPublishService } from '../src/modules/social/social-publish.service';
import { SocialSchedulerService } from '../src/modules/social/social-scheduler.service';
import { TelegramBotClient } from '../src/modules/social/telegram/telegram-bot.client';
import { TokenRefreshService, type LockStore } from '../src/modules/social/token-refresh.service';

import { fakePrisma, type FakePrisma } from './helpers/fake-prisma';
import { BOT_ID, fail, ok, startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram';

const locks = (): LockStore => ({ async acquire() { return 'l'; }, async release() {} });
const LONG = Array.from({ length: 4 }, (_, i) => `Para ${i} ${'متن '.repeat(700)}`).join('\n\n');

function setup(content = '**Hello** Telegram') {
  const prisma = fakePrisma({
    user: [{ id: 'u1', role: 'USER' }],
    workspace: [{ id: 'w1', userId: 'u1' }],
    socialConnection: [{
      id: 'c-tg', workspaceId: 'w1', platform: 'TELEGRAM', accountIdentifier: '-1001234567',
      accountName: 'Chan', authProvider: 'telegram_bot', status: 'CONNECTED', isDefault: true,
      encryptedAccessTokenRef: null, encryptedRefreshTokenRef: null, tokenExpiresAt: null,
      metaJson: { chatType: 'channel', title: 'Chan' },
    }],
    contentItem: [{
      id: 'ci1', workspaceId: 'w1', userId: 'u1', channel: 'telegram', topic: 'T', content,
      slug: null, status: 'SCHEDULED', scheduledAtUtc: new Date(Date.now() - 60_000),
    }],
  });
  const adapter = new TelegramAdapter(new TelegramBotClient());
  adapter.pause = async () => {};
  const a = adapter as any;
  const factory = new AdapterFactory(a, a, a, a, a, adapter);
  const connections = new SocialConnectionsService(prisma as any);
  const enqueued: any[] = [];
  const service = new SocialPublishService(
    prisma as any, factory, connections,
    { async enqueuePublish(p: any) { enqueued.push(p); } } as any,
    new TokenRefreshService(prisma as any, connections, locks()),
  );
  const scheduler = new SocialSchedulerService(prisma as any, service);
  return { prisma, service, scheduler, enqueued };
}

const item = (p: FakePrisma) => p.contentItem.rows[0];
const job = (p: FakePrisma) => p.socialPublishJob.rows[0];
const conn = (p: FakePrisma) => p.socialConnection.rows[0];

async function runQueued(s: ReturnType<typeof setup>, attempt = { attemptsMade: 0, maxAttempts: 3 }) {
  const queued = s.enqueued[s.enqueued.length - 1];
  const record = job(s.prisma);
  return s.service.processJobAsync(record.id, record.socialConnectionId, record.platform, queued.metadata, attempt);
}

describe('Telegram publish through the core', () => {
  let tg: FakeTelegram;
  const env = { ...process.env };
  before(async () => { tg = await startFakeTelegram(); });
  after(async () => { await tg.close(); });
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = '1:t';
    process.env.TELEGRAM_API_BASE = tg.base;
    tg.calls.length = 0;
  });
  afterEach(() => { process.env = { ...env }; });

  it('scheduled telegram item → published, URL and id written back', async () => {
    const s = setup();
    await s.scheduler.handleScheduledPublishing();
    assert.equal(item(s.prisma).status, 'PUBLISHING');
    assert.equal(await runQueued(s), 'PUBLISHED');

    const sent = tg.callsOf('sendMessage');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.text, '<b>Hello</b> Telegram');
    assert.equal(sent[0].body.chat_id, '-1001234567');
    assert.equal(item(s.prisma).status, 'PUBLISHED');
    const messageId = job(s.prisma).externalPostId.split(':')[1];
    assert.equal(job(s.prisma).externalPostId, `-1001234567:${messageId}`);
    assert.equal(job(s.prisma).externalPostUrl, `https://t.me/c/1234567/${messageId}`);
    const parts = s.prisma.socialPublishLog.rows.filter((l) => l.action === 'PART_SENT');
    assert.equal(parts.length, 1);
  });

  it('429 on part 2 → retried after retry_after, and only the missing parts are posted', async () => {
    const s = setup(LONG);
    await s.scheduler.handleScheduledPublishing();
    tg.queue('sendMessage', ok({ message_id: 4001, chat: { id: 1 } }), fail(429, 'Too Many Requests: retry after 4', { retry_after: 4 }));

    let thrown: unknown;
    try { await runQueued(s, { attemptsMade: 0, maxAttempts: 3 }); } catch (e) { thrown = e; }
    assert.ok(thrown instanceof TransientPublishError);
    assert.equal(publishBackoff(1, 'publish', thrown as Error), 4000);
    assert.equal(job(s.prisma).status, 'PUBLISH_QUEUED');
    assert.match(job(s.prisma).lastError, /^\[RATE_LIMITED\]/);
    assert.equal(conn(s.prisma).status, 'CONNECTED');

    const before = tg.callsOf('sendMessage').length; // 2 (one ok, one 429)
    assert.equal(await runQueued(s, { attemptsMade: 1, maxAttempts: 3 }), 'PUBLISHED');
    const retrySends = tg.callsOf('sendMessage').slice(before);
    assert.ok(!retrySends.some((c) => c.body.text.startsWith('Para 0')), 'part 1 not re-posted');
    assert.equal(job(s.prisma).externalPostId, '-1001234567:4001');
    const parts = s.prisma.socialPublishLog.rows.filter((l) => l.action === 'PART_SENT');
    const indexes = parts.map((l) => JSON.parse(l.requestSummary).index);
    assert.deepEqual(indexes, [...new Set(indexes)], 'each part recorded once');
    assert.equal(indexes.length, 1 + retrySends.length);
  });

  it('PART_SENT stores a content hash; post edited before the retry → [INVALID_CONTENT], no part re-sent', async () => {
    const s = setup(LONG);
    await s.scheduler.handleScheduledPublishing();
    tg.queue('sendMessage', ok({ message_id: 4001, chat: { id: 1 } }), fail(429, 'Too Many Requests: retry after 4', { retry_after: 4 }));
    await runQueued(s).catch(() => undefined);
    const part = s.prisma.socialPublishLog.rows.find((l) => l.action === 'PART_SENT')!;
    assert.match(JSON.parse(part.requestSummary).contentHash, /^[0-9a-f]{64}$/);

    const queued = s.enqueued[s.enqueued.length - 1];
    queued.metadata = { ...queued.metadata, body: LONG.replace('Para 0', 'Para zero') };
    const before = tg.callsOf('sendMessage').length;
    assert.equal(await runQueued(s, { attemptsMade: 1, maxAttempts: 3 }), 'FAILED');
    assert.equal(tg.callsOf('sendMessage').length, before, 'nothing sent');
    assert.match(job(s.prisma).lastError, /^\[INVALID_CONTENT\] Post changed after partial delivery/);
  });

  it('bot kicked → connection REVOKED, item FAILED with CONNECTION_REVOKED, nothing sent', async () => {
    const s = setup();
    await s.scheduler.handleScheduledPublishing();
    tg.queue('getChatMember', ok({ status: 'kicked', user: { id: BOT_ID } }));
    assert.equal(await runQueued(s), 'FAILED');
    assert.equal(conn(s.prisma).status, 'REVOKED');
    assert.match(item(s.prisma).failedReason, /^\[CONNECTION_REVOKED\]/);
    assert.equal(tg.callsOf('sendMessage').length, 0);
  });

  it('TELEGRAM_BOT_TOKEN unset → NO_PUBLISHER at job creation, nothing sent', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const s = setup();
    await s.scheduler.handleScheduledPublishing();
    assert.equal(item(s.prisma).status, 'FAILED');
    assert.match(item(s.prisma).failedReason, /^\[NO_PUBLISHER\] TELEGRAM publishing is not set up/);
    assert.equal(tg.calls.length, 0);
  });

  it('token removed between scheduling and sending → NO_PUBLISHER, not retried', async () => {
    const s = setup();
    await s.scheduler.handleScheduledPublishing();
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(await runQueued(s), 'FAILED');
    assert.match(job(s.prisma).lastError, /^\[NO_PUBLISHER\]/);
  });

  it('group upgraded to supergroup → the connection row gets the new chat id', async () => {
    const s = setup();
    conn(s.prisma).accountIdentifier = '-55';
    conn(s.prisma).metaJson = { chatType: 'group' };
    await s.scheduler.handleScheduledPublishing();
    tg.queue('sendMessage', fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -1008 }));
    assert.equal(await runQueued(s), 'PUBLISHED');
    assert.equal(conn(s.prisma).accountIdentifier, '-1008');
    assert.match(job(s.prisma).externalPostId, /^-1008:/);
  });
});

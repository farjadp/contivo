/**
 * Dev polling: only with TELEGRAM_UPDATES_MODE=polling and never in the
 * worker; feeds updates to the webhook handler and advances the offset; a 409
 * (webhook set) backs off and never deletes the webhook.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { TelegramBotClient, type TgUpdate } from '../src/modules/social/telegram/telegram-bot.client';
import { TelegramPollingService, pollingEnabled } from '../src/modules/social/telegram/telegram-polling.service';
import type { LockStore } from '../src/modules/social/token-refresh.service';

import { fail, ok, startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram';

const locks = (): LockStore & { held: Set<string> } => {
  const held = new Set<string>();
  return {
    held,
    async acquire(k) { if (held.has(k)) return null; held.add(k); return 't'; },
    async release(k) { held.delete(k); },
  };
};

describe('pollingEnabled', () => {
  it('needs mode=polling and a token, and is never on in the worker', () => {
    assert.equal(pollingEnabled({ TELEGRAM_UPDATES_MODE: 'polling', TELEGRAM_BOT_TOKEN: 'x' }), true);
    assert.equal(pollingEnabled({ TELEGRAM_UPDATES_MODE: 'polling', TELEGRAM_BOT_TOKEN: 'x', WORKER_MODE: 'true' }), false);
    assert.equal(pollingEnabled({ TELEGRAM_UPDATES_MODE: 'webhook', TELEGRAM_BOT_TOKEN: 'x' }), false);
    assert.equal(pollingEnabled({ TELEGRAM_UPDATES_MODE: 'polling' }), false);
    assert.equal(pollingEnabled({}), false);
  });
});

describe('TelegramPollingService', () => {
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

  it('feeds updates to the handler and advances the offset', async () => {
    const handled: number[] = [];
    const svc = new TelegramPollingService(new TelegramBotClient(), { handleUpdate: async (u: TgUpdate) => { handled.push(u.update_id); } } as any, locks());
    tg.queue('getUpdates', ok([{ update_id: 10 }, { update_id: 11 }]), ok([]));
    assert.equal(await svc.pollOnce(0), 0);
    assert.equal(await svc.pollOnce(0), 0);
    assert.deepEqual(handled, [10, 11]);
    const polls = tg.callsOf('getUpdates');
    assert.deepEqual(polls[0].body.allowed_updates, ['message', 'my_chat_member', 'callback_query']);
    assert.equal(polls[1].body.offset, 12);
  });

  it('409 (webhook set) backs off and never calls deleteWebhook', async () => {
    const svc = new TelegramPollingService(new TelegramBotClient(), { handleUpdate: async () => {} } as any, locks());
    tg.queue('getUpdates', fail(409, 'Conflict: can\'t use getUpdates method while webhook is active'));
    assert.ok((await svc.pollOnce(0)) >= 60_000);
    assert.equal(tg.callsOf('deleteWebhook').length, 0);
  });

  it('another poller holding the lock → no getUpdates call', async () => {
    const l = locks();
    l.held.add('social:tg-polling');
    const svc = new TelegramPollingService(new TelegramBotClient(), { handleUpdate: async () => {} } as any, l);
    assert.ok((await svc.pollOnce(0)) > 0);
    assert.equal(tg.callsOf('getUpdates').length, 0);
  });

  it('does not start when the env does not ask for it', () => {
    delete process.env.TELEGRAM_UPDATES_MODE;
    const svc = new TelegramPollingService(new TelegramBotClient(), { handleUpdate: async () => {} } as any, locks());
    svc.onApplicationBootstrap();
    assert.equal((svc as any).running, false);
  });
});

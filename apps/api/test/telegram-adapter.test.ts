/**
 * TelegramAdapter against the local fake Bot API.
 *
 * - validateConnection = getChatMember(bot): rights lost / chat gone → revoked,
 *   429 → transient with retry_after, network → transient.
 * - publish: photo rule, splitting with pauses, each sent part recorded, parts
 *   already sent skipped on retry, migrate_to_chat_id handled once, URL shape.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import type { AdapterConnection, PublishContext } from '../src/modules/social/adapters/social-adapter.interface';
import { TelegramAdapter } from '../src/modules/social/adapters/telegram.adapter';
import { TelegramBotClient } from '../src/modules/social/telegram/telegram-bot.client';

import { BOT_ID, fail, ok, startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram';

const conn = (over: Partial<AdapterConnection> = {}): AdapterConnection => ({
  id: 'c1',
  platform: 'TELEGRAM',
  accountIdentifier: '-1001234567',
  meta: { chatType: 'channel', title: 'Chan' },
  ...over,
});

function ctx(sent: Record<number, string> = {}) {
  const recorded: Array<[number, string]> = [];
  const identifiers: string[] = [];
  const context: PublishContext = {
    sentParts: new Map(Object.entries(sent).map(([k, v]) => [Number(k), v])),
    async recordPart(index, externalId) { recorded.push([index, externalId]); },
    async updateAccountIdentifier(id) { identifiers.push(id); },
  };
  return { context, recorded, identifiers };
}

describe('TelegramAdapter', () => {
  let tg: FakeTelegram;
  let adapter: TelegramAdapter;
  let pauses: number[];
  const env = { ...process.env };

  before(async () => { tg = await startFakeTelegram(); });
  after(async () => { await tg.close(); });
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = '1:t';
    process.env.TELEGRAM_API_BASE = tg.base;
    tg.calls.length = 0;
    adapter = new TelegramAdapter(new TelegramBotClient());
    pauses = [];
    adapter.pause = async (ms) => { pauses.push(ms); };
  });
  afterEach(() => { process.env = { ...env }; });

  it('platform_env credential; isConfigured follows the env', () => {
    assert.equal(adapter.credential, 'platform_env');
    assert.equal(adapter.isConfigured(), true);
    delete process.env.TELEGRAM_BOT_TOKEN;
    assert.equal(adapter.isConfigured(), false);
  });

  describe('validateConnection', () => {
    it('admin with can_post_messages → ok', async () => {
      assert.deepEqual(await adapter.validateConnection(conn()), { ok: true });
      const m = tg.callsOf('getChatMember')[0];
      assert.equal(m.body.user_id, BOT_ID);
      assert.equal(m.body.chat_id, '-1001234567');
    });

    it('admin without can_post_messages in a channel → revoked', async () => {
      tg.queue('getChatMember', ok({ status: 'administrator', user: { id: BOT_ID }, can_post_messages: false }));
      const h = await adapter.validateConnection(conn());
      assert.equal(!h.ok && h.reason, 'revoked');
    });

    it('left / kicked → revoked', async () => {
      tg.queue('getChatMember', ok({ status: 'kicked', user: { id: BOT_ID } }));
      const h = await adapter.validateConnection(conn());
      assert.equal(!h.ok && h.reason, 'revoked');
    });

    it('group member that can send → ok; restricted without send → revoked', async () => {
      tg.queue('getChatMember', ok({ status: 'member', user: { id: BOT_ID } }));
      assert.deepEqual(await adapter.validateConnection(conn({ meta: { chatType: 'supergroup' } })), { ok: true });
      tg.queue('getChatMember', ok({ status: 'restricted', user: { id: BOT_ID }, can_send_messages: false }));
      const h = await adapter.validateConnection(conn({ meta: { chatType: 'supergroup' } }));
      assert.equal(!h.ok && h.reason, 'revoked');
    });

    it('chat not found → revoked; 429 → transient with retry_after', async () => {
      tg.queue('getChatMember', fail(400, 'Bad Request: chat not found'));
      const a = await adapter.validateConnection(conn());
      assert.equal(!a.ok && a.reason, 'revoked');
      tg.queue('getChatMember', fail(429, 'Too Many Requests: retry after 5', { retry_after: 5 }));
      const b = await adapter.validateConnection(conn());
      assert.ok(!b.ok && b.reason === 'transient' && b.retryAfterSec === 5);
    });

    it('our bot token rejected (401) is transient, never the customer revoked', async () => {
      tg.queue('getMe', fail(401, 'Unauthorized'));
      const fresh = new TelegramAdapter(new TelegramBotClient());
      const h = await fresh.validateConnection(conn());
      assert.equal(!h.ok && h.reason, 'transient');
    });

    it('migrated group: checks the new chat id instead', async () => {
      tg.queue('getChatMember', fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -1009 }));
      const h = await adapter.validateConnection(conn({ accountIdentifier: '-55', meta: { chatType: 'group' } }));
      assert.deepEqual(h, { ok: true });
      assert.equal(tg.callsOf('getChatMember')[1].body.chat_id, -1009);
    });
  });

  describe('publish', () => {
    it('short post: one sendMessage with HTML, id and private URL', async () => {
      const { context, recorded } = ctx();
      const r = await adapter.publish(conn(), { body: '**Hello** world', format: 'markdown' }, context);
      assert.equal(r.success, true);
      const send = tg.callsOf('sendMessage')[0];
      assert.equal(send.body.text, '<b>Hello</b> world');
      assert.equal(send.body.parse_mode, 'HTML');
      const id = recorded[0][1];
      assert.equal(r.externalPostId, `-1001234567:${id}`);
      assert.equal(r.externalPostUrl, `https://t.me/c/1234567/${id}`);
      assert.deepEqual(pauses, []);
    });

    it('public channel URL uses the current username from getChat', async () => {
      tg.queue('getChat', ok({ id: -1001234567, type: 'channel', username: 'contivo_news' }));
      const r = await adapter.publish(conn(), { body: 'hi' }, ctx().context);
      assert.match(r.externalPostUrl!, /^https:\/\/t\.me\/contivo_news\/\d+$/);
    });

    it('image + short text → one sendPhoto with caption', async () => {
      const r = await adapter.publish(
        conn(),
        { body: 'Caption *text*', image: { data: Buffer.from('img'), mimeType: 'image/png' } },
        ctx().context,
      );
      assert.equal(r.success, true);
      assert.equal(tg.callsOf('sendPhoto').length, 1);
      assert.equal(tg.callsOf('sendPhoto')[0].body.caption, 'Caption <i>text</i>');
      assert.equal(tg.callsOf('sendMessage').length, 0);
    });

    it('image + long text → photo without caption, then text with previews off', async () => {
      const body = 'word '.repeat(400);
      const r = await adapter.publish(conn(), { body, image: { data: Buffer.from('img'), mimeType: 'image/jpeg' } }, ctx().context);
      assert.equal(r.success, true);
      assert.equal(tg.callsOf('sendPhoto')[0].body.caption, undefined);
      const text = tg.callsOf('sendMessage')[0];
      assert.deepEqual(text.body.link_preview_options, { is_disabled: true });
      assert.deepEqual(pauses, [1100]);
    });

    it('long post: several messages, ≥ 1 s apart, each part recorded; URL points at the first', async () => {
      const body = Array.from({ length: 6 }, (_, i) => `Para ${i} ${'x '.repeat(900)}`).join('\n\n');
      const { context, recorded } = ctx();
      const r = await adapter.publish(conn(), { body }, context);
      const sends = tg.callsOf('sendMessage');
      assert.ok(sends.length >= 2);
      assert.equal(recorded.length, sends.length);
      assert.deepEqual(recorded.map(([i]) => i), sends.map((_, i) => i));
      assert.equal(pauses.length, sends.length - 1);
      assert.ok(pauses.every((p) => p >= 1000));
      assert.ok(r.externalPostUrl!.endsWith(`/${recorded[0][1]}`));
    });

    it('retry skips parts already sent and keeps the first id', async () => {
      const body = Array.from({ length: 6 }, (_, i) => `Para ${i} ${'x '.repeat(900)}`).join('\n\n');
      const { context, recorded } = ctx({ 0: '501', 1: '502' });
      const r = await adapter.publish(conn(), { body }, context);
      assert.equal(r.success, true);
      assert.ok(!tg.callsOf('sendMessage').some((c) => c.body.text.startsWith('Para 0')));
      assert.ok(recorded.every(([i]) => i >= 2));
      assert.equal(r.externalPostId, '-1001234567:501');
    });

    it('429 on part 2 → retryable with retry_after; part 1 stays recorded', async () => {
      const body = Array.from({ length: 6 }, (_, i) => `Para ${i} ${'x '.repeat(900)}`).join('\n\n');
      tg.queue('sendMessage', ok({ message_id: 900, chat: { id: 1 } }), fail(429, 'Too Many Requests: retry after 9', { retry_after: 9 }));
      const { context, recorded } = ctx();
      const r = await adapter.publish(conn(), { body }, context);
      assert.equal(r.success, false);
      assert.equal(r.retryable, true);
      assert.equal(r.retryAfterSec, 9);
      assert.equal(r.failureCode, 'RATE_LIMITED');
      assert.deepEqual(recorded, [[0, '900']]);
    });

    it('bot removed while sending → CONNECTION_REVOKED, not retryable', async () => {
      tg.queue('sendMessage', fail(403, 'Forbidden: bot is not a member of the channel chat'));
      const r = await adapter.publish(conn(), { body: 'x' }, ctx().context);
      assert.equal(r.success, false);
      assert.equal(r.retryable, false);
      assert.equal(r.failureCode, 'CONNECTION_REVOKED');
    });

    it('5xx while sending → not retryable (could double-post)', async () => {
      tg.queue('sendMessage', fail(502, 'Bad Gateway'));
      const r = await adapter.publish(conn(), { body: 'x' }, ctx().context);
      assert.equal(r.retryable, false);
    });

    it('migrate_to_chat_id: stores the new id and resends once', async () => {
      tg.queue('sendMessage', fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -1007 }));
      const { context, identifiers } = ctx();
      const r = await adapter.publish(conn({ accountIdentifier: '-55', meta: { chatType: 'group' } }), { body: 'x' }, context);
      assert.equal(r.success, true);
      assert.deepEqual(identifiers, ['-1007']);
      assert.equal(tg.callsOf('sendMessage')[1].body.chat_id, '-1007');
      assert.match(r.externalPostId!, /^-1007:/);
    });

    it('hashtags and link go at the end of the post', async () => {
      await adapter.publish(conn(), { body: 'متن فارسی', hashtags: ['سئو', '#contivo'], linkUrl: 'https://contivo.app' }, ctx().context);
      assert.equal(tg.callsOf('sendMessage')[0].body.text, 'متن فارسی\n\n#سئو #contivo\n\nhttps://contivo.app');
    });

    it('no context (direct call) still publishes', async () => {
      const r = await adapter.publish(conn(), { body: 'x' });
      assert.equal(r.success, true);
    });

    it('a part sent but not recorded stops the run as a non-retryable failure', async () => {
      const body = Array.from({ length: 3 }, (_, i) => `Para ${i} ${'x '.repeat(1500)}`).join('\n\n');
      const context: PublishContext = {
        sentParts: new Map(),
        async recordPart() { throw new Error('db down'); },
        async updateAccountIdentifier() {},
      };
      const r = await adapter.publish(conn(), { body }, context);
      assert.equal(r.success, false);
      assert.equal(r.retryable, false);
      assert.equal(tg.callsOf('sendMessage').length, 1);
    });
  });

  describe('validatePayload', () => {
    it('rejects empty and absurdly long posts', () => {
      assert.equal(adapter.validatePayload({ body: '  ' }).valid, false);
      assert.equal(adapter.validatePayload({ body: 'x '.repeat(40_000) }).valid, false);
      assert.equal(adapter.validatePayload({ body: 'ok' }).valid, true);
    });
  });
});

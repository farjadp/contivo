/**
 * Regression tests for the Telegram security review (2026-11-22).
 *
 * P1-1  the code attempt counter never resets: 5 guesses per session in
 *       total, at most 3 chats parked per session, no @username while a code
 *       is pending, and a park whose code DM was not delivered fails.
 * P1-2  attempts are counted atomically (store.incr): 200 concurrent confirms
 *       evaluate at most 5 codes.
 * P2-1  @username lookups are bounded per session (5) and per user (20/h);
 *       a failed lookup never DMs the Telegram user.
 * P2-2  forged my_chat_member / migrate updates are re-checked with Telegram.
 * P2-3  a retry after the post was edited never skips a part that changed.
 * P3-2  only updates we act on claim their update_id.
 * P3-3  polling mode and TELEGRAM_API_BASE are refused in production.
 * P3-4  a lone ``` fence never renders as an empty <pre></pre>.
 * P3-1  "This wasn't me" callback kills the session.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import type { PublishContext } from '../src/modules/social/adapters/social-adapter.interface';
import { splitTelegramMessages } from '../src/modules/social/adapters/telegram-format';
import { TelegramAdapter, telegramPartHash } from '../src/modules/social/adapters/telegram.adapter';
import { memoryOAuthStore } from '../src/modules/social/oauth-store';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { TelegramBotClient, type TgUpdate } from '../src/modules/social/telegram/telegram-bot.client';
import { TelegramConnectService } from '../src/modules/social/telegram/telegram-connect.service';
import { pollingEnabled } from '../src/modules/social/telegram/telegram-polling.service';

import { fakePrisma } from './helpers/fake-prisma';
import { BOT_ID, BOT_USERNAME, fail, ok, startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram';

const ATTACKER = 'user-attacker';
const TG_VICTIM = 9001;
const VICTIM_CHANNEL = -1009999;

let seq = 50_000;
const privateMsg = (from: number, extra: Record<string, unknown>): TgUpdate => ({
  update_id: seq++,
  message: { message_id: seq, chat: { id: from, type: 'private' }, from: { id: from, language_code: 'en' }, date: 0, ...extra } as any,
});
const start = (from: number, nonce: string) => privateMsg(from, { text: `/start ${nonce}` });

function setup() {
  const prisma = fakePrisma({
    user: [{ id: ATTACKER, role: 'USER' }],
    workspace: [{ id: 'ws-att', userId: ATTACKER, name: 'Attacker Co' }],
  });
  const store = memoryOAuthStore();
  const service = new TelegramConnectService(prisma as any, new SocialConnectionsService(prisma as any), new TelegramBotClient(), store);
  return { prisma, store, service };
}

const codeOf = (e: any) => e?.getResponse?.().code;

/** The last 6-digit code the bot DMed to this Telegram user. */
function lastCode(tg: FakeTelegram, to: number): string | undefined {
  const msg = tg.callsOf('sendMessage').filter((c) => Number(c.body.chat_id) === to && /\d{6}/.test(c.body.text)).pop();
  return msg ? /(\d{6})/.exec(msg.body.text)![1] : undefined;
}
const wrongFor = (real: string | undefined) => (real === '000000' ? '111111' : '000000');

describe('Telegram security review', () => {
  let tg: FakeTelegram;
  const env = { ...process.env };
  before(async () => { tg = await startFakeTelegram(); });
  after(async () => { await tg.close(); });
  beforeEach(() => {
    Object.assign(process.env, {
      TELEGRAM_BOT_TOKEN: '1:t',
      TELEGRAM_BOT_USERNAME: BOT_USERNAME,
      TELEGRAM_API_BASE: tg.base,
      TELEGRAM_WEBHOOK_SECRET: 'x',
    });
    delete process.env.NODE_ENV;
    tg.calls.length = 0;
    tg.on('getChat', () => ok({ id: VICTIM_CHANNEL, type: 'channel', title: 'Victim channel', username: 'victimchan' }));
    tg.on('getChatMember', (c) => ok({ status: 'administrator', user: { id: Number(c.body.user_id) }, can_post_messages: true }));
    tg.on('sendMessage', (c) => ok({ message_id: seq++, chat: { id: Number(c.body.chat_id) }, date: 0, text: c.body.text }));
  });
  afterEach(() => { process.env = { ...env }; });

  async function victimStarted(s: ReturnType<typeof setup>) {
    const c = await s.service.createSession('ws-att', ATTACKER);
    await s.service.handleUpdate(start(TG_VICTIM, new URL(c.deepLink).searchParams.get('start')!));
    return c;
  }

  describe('memoryOAuthStore.incr', () => {
    it('counts atomically and expires', async () => {
      const store = memoryOAuthStore();
      const values = await Promise.all(Array.from({ length: 50 }, () => store.incr('k', 1000)));
      assert.deepEqual([...values].sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1));
      assert.equal(await store.incr('short', 1), 1);
      await new Promise((r) => setTimeout(r, 5));
      assert.equal(await store.incr('short', 1000), 1);
    });
  });

  describe('P1-1 attempt counter never resets', () => {
    it('PoC: re-parking via @username does not give more than 5 guesses (refused while pending)', async () => {
      const s = setup();
      const c = await victimStarted(s);
      await s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan');
      let evaluated = 0;
      for (let round = 0; round < 20; round++) {
        await s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan').catch((e) => {
          assert.ok(['already_pending', 'too_many_attempts', 'too_many_lookups', 'session_finished'].includes(codeOf(e)), codeOf(e));
        });
        for (let k = 0; k < 4; k++) {
          const e = await s.service.confirm(c.sessionId, ATTACKER, wrongFor(lastCode(tg, TG_VICTIM))).then(() => null, (x) => x);
          if (codeOf(e) === 'wrong_code') evaluated++;
        }
      }
      assert.ok(evaluated <= 4, `wrong codes evaluated: ${evaluated}`);
      const v = await s.service.getSession(c.sessionId, ATTACKER);
      assert.equal(v.status, 'failed');
      assert.equal(v.error, 'too_many_attempts');
      await assert.rejects(s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan'), (e: any) =>
        e.getStatus() === 409 && codeOf(e) === 'session_finished' && e.getResponse().error === 'too_many_attempts');
    });

    it('@username while a code is pending → 409 already_pending, no new code sent', async () => {
      const s = setup();
      const c = await victimStarted(s);
      await s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan');
      const codes = tg.callsOf('sendMessage').filter((x) => /\d{6}/.test(x.body.text)).length;
      await assert.rejects(s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan'), (e: any) =>
        e.getStatus() === 409 && codeOf(e) === 'already_pending');
      assert.equal(tg.callsOf('sendMessage').filter((x) => /\d{6}/.test(x.body.text)).length, codes);
    });

    it('attempts carry across parks: 3 wrong, re-pick in Telegram, 2 more wrong → failed', async () => {
      const s = setup();
      const c = await victimStarted(s);
      const ids = tg.callsOf('sendMessage').find((x) => x.body.reply_markup?.keyboard)!.body.reply_markup.keyboard.flat();
      const channelReq = ids.find((b: any) => b.request_chat.chat_is_channel).request_chat.request_id;
      const share = () => s.service.handleUpdate(privateMsg(TG_VICTIM, { chat_shared: { request_id: channelReq, chat_id: VICTIM_CHANNEL } }));
      await share();
      for (let i = 0; i < 3; i++) await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, wrongFor(lastCode(tg, TG_VICTIM))));
      await share(); // a second park in the same session
      assert.equal((await s.service.getSession(c.sessionId, ATTACKER)).attemptsLeft, 2);
      await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, wrongFor(lastCode(tg, TG_VICTIM))), (e: any) => codeOf(e) === 'wrong_code' && e.getResponse().attemptsLeft === 1);
      await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, wrongFor(lastCode(tg, TG_VICTIM))), (e: any) => codeOf(e) === 'too_many_attempts');
      assert.equal((await s.service.getSession(c.sessionId, ATTACKER)).status, 'failed');
    });

    it('at most 3 parks per session, then failed', async () => {
      const s = setup();
      const c = await victimStarted(s);
      const ids = tg.callsOf('sendMessage').find((x) => x.body.reply_markup?.keyboard)!.body.reply_markup.keyboard.flat();
      const channelReq = ids.find((b: any) => b.request_chat.chat_is_channel).request_chat.request_id;
      for (let i = 0; i < 3; i++) {
        await s.service.handleUpdate(privateMsg(TG_VICTIM, { chat_shared: { request_id: channelReq, chat_id: VICTIM_CHANNEL } }));
        assert.equal((await s.service.getSession(c.sessionId, ATTACKER)).status, 'pending_confirm');
      }
      const before = tg.callsOf('sendMessage').filter((x) => /\d{6}/.test(x.body.text)).length;
      await s.service.handleUpdate(privateMsg(TG_VICTIM, { chat_shared: { request_id: channelReq, chat_id: VICTIM_CHANNEL } }));
      const v = await s.service.getSession(c.sessionId, ATTACKER);
      assert.equal(v.status, 'failed');
      assert.equal(v.error, 'too_many_attempts');
      assert.equal(tg.callsOf('sendMessage').filter((x) => /\d{6}/.test(x.body.text)).length, before, 'no 4th code');
    });

    it('code DM not delivered → the park fails (no code stored), the session stays started', async () => {
      const s = setup();
      const c = await victimStarted(s);
      tg.on('sendMessage', (call) => (/\d{6}/.test(call.body.text)
        ? fail(403, 'Forbidden: bot was blocked by the user')
        : ok({ message_id: seq++, chat: { id: Number(call.body.chat_id) }, date: 0 })));
      await assert.rejects(s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan'), (e: any) =>
        codeOf(e) === 'telegram_unavailable');
      const v = await s.service.getSession(c.sessionId, ATTACKER);
      assert.equal(v.status, 'started');
      assert.equal(v.error, 'telegram_unavailable');
      await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, '123456'), (e: any) => codeOf(e) === 'not_pending');
    });
  });

  describe('P1-2 atomic attempts', () => {
    it('PoC: 200 concurrent confirms → at most 5 codes evaluated, the rest too_many_attempts', async () => {
      const s = setup();
      const c = await victimStarted(s);
      await s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan');
      const real = lastCode(tg, TG_VICTIM)!;
      const guesses = Array.from({ length: 200 }, (_, i) => String(i).padStart(6, '0')).map((g) => (g === real ? '999999' : g));
      const results = await Promise.allSettled(guesses.map((g) => s.service.confirm(c.sessionId, ATTACKER, g)));
      const counts: Record<string, number> = {};
      for (const r of results) {
        const k = r.status === 'fulfilled' ? 'OK' : codeOf(r.reason);
        counts[k] = (counts[k] ?? 0) + 1;
      }
      assert.equal(counts.OK, undefined);
      assert.ok((counts.wrong_code ?? 0) <= 4, JSON.stringify(counts));
      assert.equal((counts.wrong_code ?? 0) + (counts.too_many_attempts ?? 0), 200, JSON.stringify(counts));
      assert.equal((await s.service.getSession(c.sessionId, ATTACKER)).status, 'failed');
      // Even the right code is refused now.
      await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, real));
      assert.equal(s.prisma.socialConnection.rows.length, 0);
    });

    it('a concurrent stale save cannot revive a failed session: the counter is checked first', async () => {
      const s = setup();
      const c = await victimStarted(s);
      await s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan');
      const real = lastCode(tg, TG_VICTIM)!;
      for (let i = 0; i < 5; i++) await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, wrongFor(real)));
      // Simulate a stale writer putting the session back to pending_confirm.
      const key = s.store.keys().find((k) => k.startsWith('social:tg-session:'))!;
      const rec = JSON.parse((await s.store.get(key))!);
      await s.store.put(key, JSON.stringify({ ...rec, status: 'pending_confirm', pending: { chatId: String(VICTIM_CHANNEL), chatType: 'channel' }, codeHash: 'x' }), 60_000);
      await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, real), (e: any) => codeOf(e) === 'too_many_attempts');
      assert.equal(s.prisma.socialConnection.rows.length, 0);
    });
  });

  describe('P2-1 @username lookups are bounded', () => {
    it('per session: the 6th lookup → 429 too_many_lookups without calling Telegram', async () => {
      const s = setup();
      const c = await victimStarted(s);
      tg.on('getChat', () => fail(400, 'Bad Request: chat not found'));
      for (let i = 0; i < 5; i++) {
        await assert.rejects(s.service.connectByUsername(c.sessionId, ATTACKER, `@nochan_${i}x`), (e: any) => codeOf(e) === 'chat_not_found');
      }
      const calls = tg.callsOf('getChat').length;
      await assert.rejects(s.service.connectByUsername(c.sessionId, ATTACKER, '@nochan_9x'), (e: any) =>
        e.getStatus() === 429 && codeOf(e) === 'too_many_lookups');
      assert.equal(tg.callsOf('getChat').length, calls);
    });

    it('per user: 20 lookups an hour across sessions', async () => {
      const s = setup();
      tg.on('getChat', () => fail(400, 'Bad Request: chat not found'));
      let refused = 0;
      for (let n = 0; n < 5; n++) {
        const c = await victimStarted(s);
        for (let i = 0; i < 5; i++) {
          const e = await s.service.connectByUsername(c.sessionId, ATTACKER, `@nochan_${i}x`).then(() => null, (x) => x);
          if (codeOf(e) === 'too_many_lookups') refused++;
        }
      }
      assert.equal(tg.callsOf('getChat').length, 20);
      assert.equal(refused, 5);
    });

    it('a failed @username check never DMs the Telegram user', async () => {
      const s = setup();
      const c = await victimStarted(s);
      tg.calls.length = 0;
      tg.on('getChatMember', (call) => ok(call.body.user_id === BOT_ID
        ? { status: 'administrator', user: { id: BOT_ID }, can_post_messages: false }
        : { status: 'creator', user: { id: TG_VICTIM } }));
      await assert.rejects(s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan'), (e: any) => codeOf(e) === 'bot_not_admin');
      tg.on('getChatMember', (call) => ok(call.body.user_id === BOT_ID
        ? { status: 'administrator', user: { id: BOT_ID }, can_post_messages: true }
        : { status: 'member', user: { id: TG_VICTIM } }));
      await assert.rejects(s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan'), (e: any) => codeOf(e) === 'user_not_admin');
      assert.equal(tg.callsOf('sendMessage').length, 0);
    });
  });

  describe('P2-2 forged updates are re-checked', () => {
    const rows = (s: ReturnType<typeof setup>) => {
      s.prisma.socialConnection.rows.push(
        { id: 'a', workspaceId: 'ws-att', platform: 'TELEGRAM', accountIdentifier: '-55', status: 'CONNECTED', metaJson: { chatType: 'group' } },
        { id: 'b', workspaceId: 'ws-att', platform: 'TELEGRAM', accountIdentifier: '-55', status: 'REVOKED', metaJson: { chatType: 'group' } },
        { id: 'c', workspaceId: 'ws-att', platform: 'TELEGRAM', accountIdentifier: '-55', status: 'EXPIRED', metaJson: { chatType: 'group' } },
      );
    };
    const migrate = (from: number, to: number): TgUpdate =>
      ({ update_id: seq++, message: { message_id: 1, chat: { id: from, type: 'group' }, migrate_to_chat_id: to } as any });

    it('migrate: rewritten only when getChat(old) says it moved to that id; only CONNECTED/EXPIRED rows', async () => {
      const s = setup();
      rows(s);
      tg.queue('getChat', fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -100555 }));
      await s.service.handleUpdate(migrate(-55, -100555));
      assert.equal(tg.callsOf('getChat')[0].body.chat_id, -55);
      const ids = s.prisma.socialConnection.rows.map((r) => r.accountIdentifier);
      assert.deepEqual(ids, ['-100555', '-55', '-100555']);
    });

    it('forged migrate (Telegram says the group did not move, or moved elsewhere) → nothing rewritten', async () => {
      const s = setup();
      rows(s);
      tg.queue('getChat', ok({ id: -55, type: 'group', title: 'Still a group' }));
      await s.service.handleUpdate(migrate(-55, -100666));
      tg.queue('getChat', fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -100555 }));
      await s.service.handleUpdate(migrate(-55, -100666));
      assert.ok(s.prisma.socialConnection.rows.every((r) => r.accountIdentifier === '-55'));
    });

    const kicked = (chatId: number): TgUpdate => ({
      update_id: seq++,
      my_chat_member: {
        chat: { id: chatId, type: 'channel', title: 'X' },
        from: { id: 1 },
        date: 0,
        old_chat_member: { status: 'administrator', user: { id: BOT_ID }, can_post_messages: true },
        new_chat_member: { status: 'kicked', user: { id: BOT_ID } },
      },
    });

    it('forged "bot kicked" while Telegram says the bot can still post → nothing revoked', async () => {
      const s = setup();
      s.prisma.socialConnection.rows.push({ id: 'a', workspaceId: 'ws-att', platform: 'TELEGRAM', accountIdentifier: String(VICTIM_CHANNEL), status: 'CONNECTED', metaJson: { chatType: 'channel' } });
      await s.service.handleUpdate(kicked(VICTIM_CHANNEL));
      const check = tg.callsOf('getChatMember')[0];
      assert.equal(check.body.user_id, BOT_ID);
      assert.equal(s.prisma.socialConnection.rows[0].status, 'CONNECTED');
    });

    it('Telegram unreachable on the re-check → nothing revoked', async () => {
      const s = setup();
      s.prisma.socialConnection.rows.push({ id: 'a', workspaceId: 'ws-att', platform: 'TELEGRAM', accountIdentifier: String(VICTIM_CHANNEL), status: 'CONNECTED', metaJson: { chatType: 'channel' } });
      tg.queue('getChatMember', fail(502, 'Bad Gateway'));
      await s.service.handleUpdate(kicked(VICTIM_CHANNEL));
      assert.equal(s.prisma.socialConnection.rows[0].status, 'CONNECTED');
    });

    it('real removal (getChatMember 403) → REVOKED', async () => {
      const s = setup();
      s.prisma.socialConnection.rows.push({ id: 'a', workspaceId: 'ws-att', platform: 'TELEGRAM', accountIdentifier: String(VICTIM_CHANNEL), status: 'CONNECTED', metaJson: { chatType: 'channel' } });
      tg.queue('getChatMember', fail(403, 'Forbidden: bot is not a member of the channel chat'));
      await s.service.handleUpdate(kicked(VICTIM_CHANNEL));
      assert.equal(s.prisma.socialConnection.rows[0].status, 'REVOKED');
      assert.equal(s.prisma.socialConnection.rows[0].metaJson.revokedReason, 'BOT_REMOVED');
    });
  });

  describe('P3-2 dedupe only what we act on', () => {
    it('ignored updates do not write an update_id key', async () => {
      const s = setup();
      await s.service.handleUpdate({ update_id: seq++, message: { message_id: 1, chat: { id: -100555, type: 'supergroup' }, from: { id: 1 }, text: 'hi' } as any });
      await s.service.handleUpdate(privateMsg(TG_VICTIM, { text: 'hello there' }));
      await s.service.handleUpdate({ update_id: seq++ } as any);
      assert.deepEqual(s.store.keys().filter((k) => k.startsWith('social:tg-update:')), []);
      await s.service.handleUpdate(start(TG_VICTIM, 'AAAAAAAAAAAAAAAAAAAAAA'));
      assert.equal(s.store.keys().filter((k) => k.startsWith('social:tg-update:')).length, 1);
    });
  });

  describe('P3-1 "This wasn\'t me"', () => {
    const callback = (from: number, data: string): TgUpdate =>
      ({ update_id: seq++, callback_query: { id: `cb${seq}`, from: { id: from }, data } } as any);

    it('the Telegram user who started the session can kill it; the code stops working', async () => {
      const s = setup();
      const c = await victimStarted(s);
      await s.service.connectByUsername(c.sessionId, ATTACKER, '@victimchan');
      const real = lastCode(tg, TG_VICTIM)!;
      await s.service.handleUpdate(callback(TG_VICTIM, `deny:${c.sessionId}`));
      assert.equal(tg.callsOf('answerCallbackQuery').length, 1);
      const v = await s.service.getSession(c.sessionId, ATTACKER);
      assert.equal(v.status, 'failed');
      assert.equal(v.error, 'denied');
      await assert.rejects(s.service.confirm(c.sessionId, ATTACKER, real), (e: any) => e.getStatus() === 409);
      assert.equal(s.prisma.socialConnection.rows.length, 0);
    });

    it('someone else pressing it changes nothing', async () => {
      const s = setup();
      const c = await victimStarted(s);
      await s.service.handleUpdate(callback(4242, `deny:${c.sessionId}`));
      assert.equal((await s.service.getSession(c.sessionId, ATTACKER)).status, 'started');
    });
  });
});

describe('P2-3 retry after the post was edited', () => {
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

  const body = (word: string) => Array.from({ length: 6 }, (_, i) => `Para ${i} ${`${word} `.repeat(900)}`).join('\n\n');
  const adapter = () => {
    const a = new TelegramAdapter(new TelegramBotClient());
    a.pause = async () => {};
    return a;
  };
  const conn = { id: 'c1', platform: 'TELEGRAM' as const, accountIdentifier: '-1001234567', meta: { chatType: 'channel' } };

  it('records the sha256 of each part and skips only parts whose hash matches', async () => {
    const recorded: Array<[number, string, string | undefined]> = [];
    const parts = splitTelegramMessages(body('x'));
    const ctx: PublishContext = {
      sentParts: new Map([[0, { externalId: '501', contentHash: telegramPartHash({ kind: 'text', html: parts[0] }) }]]),
      async recordPart(i, id, hash) { recorded.push([i, id, hash]); },
      async updateAccountIdentifier() {},
    };
    const r = await adapter().publish(conn, { body: body('x') }, ctx);
    assert.equal(r.success, true);
    assert.equal(r.externalPostId, '-1001234567:501');
    assert.ok(!tg.callsOf('sendMessage').some((c) => c.body.text.startsWith('Para 0')));
    assert.ok(recorded.every(([, , h]) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)));
  });

  it('part changed since it was delivered → non-retryable INVALID_CONTENT, nothing sent', async () => {
    const parts = splitTelegramMessages(body('x'));
    const ctx: PublishContext = {
      sentParts: new Map([[0, { externalId: '501', contentHash: telegramPartHash({ kind: 'text', html: parts[0] }) }]]),
      async recordPart() {},
      async updateAccountIdentifier() {},
    };
    const r = await adapter().publish(conn, { body: body('y') }, ctx);
    assert.equal(r.success, false);
    assert.equal(r.retryable, false);
    assert.equal(r.failureCode, 'INVALID_CONTENT');
    assert.match(r.error!, /post changed after partial delivery/i);
    assert.equal(tg.callsOf('sendMessage').length, 0);
  });

  it('a delivered part recorded without a hash is treated as changed (fail closed)', async () => {
    const ctx: PublishContext = {
      sentParts: new Map([[0, { externalId: '501' }]]),
      async recordPart() {},
      async updateAccountIdentifier() {},
    };
    const r = await adapter().publish(conn, { body: body('x') }, ctx);
    assert.equal(r.failureCode, 'INVALID_CONTENT');
    assert.equal(tg.callsOf('sendMessage').length, 0);
  });
});

describe('P3-3 dev-only settings refused in production', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('pollingEnabled is false with NODE_ENV=production', () => {
    assert.equal(pollingEnabled({ TELEGRAM_UPDATES_MODE: 'polling', TELEGRAM_BOT_TOKEN: 'x', NODE_ENV: 'production' }), false);
  });

  it('production still needs the webhook secret even with TELEGRAM_UPDATES_MODE=polling', () => {
    process.env = { ...env, NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: '1:t', TELEGRAM_BOT_USERNAME: 'Bot', TELEGRAM_UPDATES_MODE: 'polling' };
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const svc = new TelegramConnectService(null as any, null as any, null as any, null as any);
    assert.deepEqual(svc.missingConfig(), ['TELEGRAM_WEBHOOK_SECRET']);
  });

  it('TELEGRAM_API_BASE is ignored in production', async () => {
    const urls: string[] = [];
    const client = new TelegramBotClient({
      env: { NODE_ENV: 'production', TELEGRAM_BOT_TOKEN: '1:t', TELEGRAM_API_BASE: 'http://evil.example' },
      fetchImpl: (async (url: string) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ ok: true, result: { id: 1 } }), { status: 200 });
      }) as any,
    });
    await client.getMe();
    assert.ok(urls[0].startsWith('https://api.telegram.org/'), urls[0]);
  });
});

describe('P3-4 lone code fence', () => {
  it('a lone ``` never produces an empty <pre></pre>', () => {
    for (const md of ['```', 'Hello\n\n```', '```\n```', 'Hello\n```\n\n```', 'Text\n```ts']) {
      const out = splitTelegramMessages(md).join('\n\n');
      assert.doesNotMatch(out, /<pre>(<code[^>]*>)?(<\/code>)?<\/pre>/, `${JSON.stringify(md)} → ${out}`);
    }
    assert.equal(splitTelegramMessages('Hello\n\n```').join(''), 'Hello');
  });

  it('an unclosed fence does not swallow the rest of the post into code', () => {
    assert.equal(splitTelegramMessages('```\n**bold** text').join(''), '<b>bold</b> text');
  });
});

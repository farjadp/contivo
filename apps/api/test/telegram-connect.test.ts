/**
 * Telegram connect flow (spec §3 option d + the OAuth rule from PR #20),
 * against the local fake Bot API and an in-memory store.
 *
 * The attack this must stop: an attacker creates a connect session in THEIR
 * workspace and sends the t.me deep link to a victim. The victim taps Start
 * and picks their own channel; Telegram makes the bot an admin there. If the
 * chat were saved on chat_shared — or on a confirm only the session creator
 * can call — it would land in the attacker's workspace, because the attacker
 * IS the session creator. So the chat is parked, the bot sends a one-time
 * code to the Telegram user who shared it, and only the web user who created
 * the session AND types that code saves it. The attacker never sees the code.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

process.env.SOCIAL_TOKEN_SECRET ??= 'test-only-secret-not-used-anywhere';

import { memoryOAuthStore } from '../src/modules/social/oauth-store';
import { SocialConnectionsService } from '../src/modules/social/social-connections.service';
import { TelegramBotClient, type TgUpdate } from '../src/modules/social/telegram/telegram-bot.client';
import { TelegramConnectService } from '../src/modules/social/telegram/telegram-connect.service';
import { TelegramController } from '../src/modules/social/telegram/telegram.controller';

import { fakePrisma } from './helpers/fake-prisma';
import { BOT_ID, BOT_USERNAME, fail, ok, startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram';

const OWNER = 'user-owner';
const OTHER = 'user-other';
const TG_OWNER = 5001;
const TG_STRANGER = 5002;
const CHANNEL = -1004444;

let updateSeq = 1;
const privateMsg = (from: number, extra: Record<string, unknown>): TgUpdate => ({
  update_id: updateSeq++,
  message: { message_id: updateSeq, chat: { id: from, type: 'private' }, from: { id: from, language_code: 'en' }, date: 0, ...extra } as any,
});
const start = (from: number, nonce: string) => privateMsg(from, { text: `/start ${nonce}` });
const shared = (from: number, requestId: number, chatId = CHANNEL) =>
  privateMsg(from, { chat_shared: { request_id: requestId, chat_id: chatId, title: 'My channel' } });

function setup() {
  const prisma = fakePrisma({
    user: [{ id: OWNER, role: 'USER' }, { id: OTHER, role: 'USER' }],
    workspace: [{ id: 'ws-owner', userId: OWNER, name: 'Owner Co' }, { id: 'ws-other', userId: OTHER, name: 'Other Co' }],
  });
  const store = memoryOAuthStore();
  const connections = new SocialConnectionsService(prisma as any);
  const service = new TelegramConnectService(prisma as any, connections, new TelegramBotClient(), store);
  return { prisma, store, service };
}

/** The request_chat button ids the bot sent in its last keyboard. */
function keyboardIds(tg: FakeTelegram) {
  const withKeyboard = tg.callsOf('sendMessage').filter((c) => c.body.reply_markup?.keyboard).pop();
  const buttons = withKeyboard!.body.reply_markup.keyboard.flat();
  const channel = buttons.find((b: any) => b.request_chat.chat_is_channel === true).request_chat;
  const group = buttons.find((b: any) => b.request_chat.chat_is_channel === false).request_chat;
  return { channel, group };
}

/** The code the bot sent to a Telegram user (Latin or Persian digits). */
function codeSentTo(tg: FakeTelegram, telegramUserId: number): string {
  const msg = tg.callsOf('sendMessage').filter((c) => Number(c.body.chat_id) === telegramUserId && /\d{6}|[۰-۹]{6}/.test(c.body.text)).pop();
  assert.ok(msg, 'a code was sent');
  const m = /(\d{6}|[۰-۹]{6})/.exec(msg!.body.text)!;
  return m[1];
}

async function startedSession(s: ReturnType<typeof setup>, tg: FakeTelegram, from = TG_OWNER) {
  const created = await s.service.createSession('ws-owner', OWNER);
  const nonce = new URL(created.deepLink).searchParams.get('start')!;
  await s.service.handleUpdate(start(from, nonce));
  return { ...created, nonce, ids: keyboardIds(tg) };
}

describe('TelegramConnectService', () => {
  let tg: FakeTelegram;
  const env = { ...process.env };
  before(async () => { tg = await startFakeTelegram(); });
  after(async () => { await tg.close(); });
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = '1:t';
    process.env.TELEGRAM_BOT_USERNAME = BOT_USERNAME;
    process.env.TELEGRAM_API_BASE = tg.base;
    process.env.TELEGRAM_WEBHOOK_SECRET = 'hook_secret-123';
    tg.calls.length = 0;
  });
  afterEach(() => { process.env = { ...env }; });

  describe('createSession', () => {
    it('returns a t.me deep link with a 16-byte nonce, bound to the user + workspace', async () => {
      const s = setup();
      const r = await s.service.createSession('ws-owner', OWNER);
      const url = new URL(r.deepLink);
      assert.equal(url.origin + url.pathname, `https://t.me/${BOT_USERNAME}`);
      const nonce = url.searchParams.get('start')!;
      assert.match(nonce, /^[A-Za-z0-9_-]{22}$/);
      assert.ok(r.sessionId && r.sessionId !== nonce);
      assert.ok(new Date(r.expiresAt).getTime() - Date.now() <= 10 * 60_000 + 1000);
      assert.equal((await s.service.getSession(r.sessionId, OWNER)).status, 'waiting');
    });

    it('refuses a workspace the user does not own', async () => {
      const s = setup();
      await assert.rejects(s.service.createSession('ws-other', OWNER), (e: any) => e.getStatus() === 403);
    });

    it('503 telegram_not_configured without token or bot username', async () => {
      delete process.env.TELEGRAM_BOT_USERNAME;
      const s = setup();
      await assert.rejects(s.service.createSession('ws-owner', OWNER), (e: any) =>
        e.getStatus() === 503 && e.getResponse().code === 'telegram_not_configured');
    });
  });

  describe('/start <nonce>', () => {
    it('binds the Telegram user and replies with channel + group request_chat buttons', async () => {
      const s = setup();
      const { sessionId, ids } = await startedSession(s, tg);
      assert.equal(ids.channel.bot_administrator_rights.can_post_messages, true);
      assert.equal(ids.channel.user_administrator_rights.can_post_messages, true);
      assert.equal(typeof ids.group.request_id, 'number');
      assert.notEqual(ids.channel.request_id, ids.group.request_id);
      const reply = tg.callsOf('sendMessage')[0];
      assert.equal(Number(reply.body.chat_id), TG_OWNER);
      assert.match(reply.body.text, /Owner Co/);
      const view = await s.service.getSession(sessionId, OWNER);
      assert.equal(view.status, 'started');
      assert.equal(view.telegramLinked, true);
    });

    it('a second Telegram user with the same link is refused; the session stays with the first', async () => {
      const s = setup();
      const { nonce, ids } = await startedSession(s, tg);
      tg.calls.length = 0;
      await s.service.handleUpdate(start(TG_STRANGER, nonce));
      assert.match(tg.callsOf('sendMessage')[0].body.text, /expired|already used/i);
      await s.service.handleUpdate(shared(TG_STRANGER, ids.channel.request_id));
      assert.equal(tg.callsOf('getChatMember').length, 0);
    });

    it('unknown nonce → expired message, nothing else', async () => {
      const s = setup();
      await s.service.handleUpdate(start(TG_OWNER, 'AAAAAAAAAAAAAAAAAAAAAA'));
      assert.match(tg.callsOf('sendMessage')[0].body.text, /expired|already used/i);
    });

    it('Persian-speaking user gets the Persian reply', async () => {
      const s = setup();
      const created = await s.service.createSession('ws-owner', OWNER);
      const nonce = new URL(created.deepLink).searchParams.get('start')!;
      const upd = start(TG_OWNER, nonce);
      upd.message!.from!.language_code = 'fa';
      await s.service.handleUpdate(upd);
      assert.match(tg.callsOf('sendMessage')[0].body.text, /کانال/);
    });
  });

  describe('chat_shared', () => {
    it('verifies bot + user rights, parks the chat, sends a code; saves NOTHING yet', async () => {
      const s = setup();
      const { sessionId, ids } = await startedSession(s, tg);
      await s.service.handleUpdate(shared(TG_OWNER, ids.channel.request_id));
      const members = tg.callsOf('getChatMember').map((c) => c.body.user_id);
      assert.deepEqual(members.sort(), [BOT_ID, TG_OWNER].sort());
      assert.equal(s.prisma.socialConnection.rows.length, 0);
      assert.equal((await s.service.getSession(sessionId, OWNER)).status, 'pending_confirm');
      assert.match(codeSentTo(tg, TG_OWNER), /^\d{6}$/);
    });

    it('bot without can_post_messages → stays started with bot_not_admin, no code', async () => {
      const s = setup();
      const { sessionId, ids } = await startedSession(s, tg);
      tg.on('getChatMember', (c) => ok(c.body.user_id === BOT_ID
        ? { status: 'administrator', user: { id: BOT_ID }, can_post_messages: false }
        : { status: 'creator', user: { id: TG_OWNER } }));
      try {
        await s.service.handleUpdate(shared(TG_OWNER, ids.channel.request_id));
      } finally {
        tg.on('getChatMember', (c) => ok({ status: 'administrator', user: { id: Number(c.body.user_id) }, can_post_messages: true }));
      }
      const view = await s.service.getSession(sessionId, OWNER);
      assert.equal(view.status, 'started');
      assert.equal(view.error, 'bot_not_admin');
    });

    it('sharer who is not an admin of the chat → user_not_admin', async () => {
      const s = setup();
      const { sessionId, ids } = await startedSession(s, tg);
      tg.on('getChatMember', (c) => ok(c.body.user_id === BOT_ID
        ? { status: 'administrator', user: { id: BOT_ID }, can_post_messages: true }
        : { status: 'member', user: { id: TG_OWNER } }));
      try {
        await s.service.handleUpdate(shared(TG_OWNER, ids.channel.request_id));
      } finally {
        tg.on('getChatMember', (c) => ok({ status: 'administrator', user: { id: Number(c.body.user_id) }, can_post_messages: true }));
      }
      assert.equal((await s.service.getSession(sessionId, OWNER)).error, 'user_not_admin');
    });

    it('a request_id that is not this session\'s is ignored', async () => {
      const s = setup();
      const { sessionId } = await startedSession(s, tg);
      await s.service.handleUpdate(shared(TG_OWNER, 12345));
      assert.equal((await s.service.getSession(sessionId, OWNER)).status, 'started');
      assert.equal(tg.callsOf('getChatMember').length, 0);
    });
  });

  describe('confirm', () => {
    it('only the creator can see or confirm the session (404 for anyone else)', async () => {
      const s = setup();
      const { sessionId } = await startedSession(s, tg);
      await assert.rejects(s.service.getSession(sessionId, OTHER), (e: any) => e.getStatus() === 404);
      await assert.rejects(s.service.confirm(sessionId, OTHER, '000000'), (e: any) => e.getStatus() === 404);
    });

    it('right code → connection saved (no token, telegram_bot, meta), default, bot says connected', async () => {
      const s = setup();
      const { sessionId, ids } = await startedSession(s, tg);
      tg.queue('getChat', ok({ id: CHANNEL, type: 'channel', title: 'My channel', username: 'mychan' }));
      await s.service.handleUpdate(shared(TG_OWNER, ids.channel.request_id));
      const code = codeSentTo(tg, TG_OWNER);
      const r = await s.service.confirm(sessionId, OWNER, code);
      assert.equal(r.status, 'connected');
      const row = s.prisma.socialConnection.rows[0];
      assert.equal(row.workspaceId, 'ws-owner');
      assert.equal(row.platform, 'TELEGRAM');
      assert.equal(row.accountIdentifier, String(CHANNEL));
      assert.equal(row.authProvider, 'telegram_bot');
      assert.equal(row.encryptedAccessTokenRef, null);
      assert.equal(row.isDefault, true);
      assert.deepEqual(row.metaJson, { chatType: 'channel', title: 'My channel', username: 'mychan', linkedByTelegramUserId: TG_OWNER });
      assert.equal(r.connection?.id, row.id);
      assert.match(tg.callsOf('sendMessage').pop()!.body.text, /Connected/);
      // Single use: a second confirm does nothing new.
      await assert.rejects(s.service.confirm(sessionId, OWNER, code), (e: any) => e.getStatus() === 409);
      assert.equal(s.prisma.socialConnection.rows.length, 1);
    });

    it('Persian digits in the typed code are accepted', async () => {
      const s = setup();
      const { sessionId, ids } = await startedSession(s, tg);
      await s.service.handleUpdate(shared(TG_OWNER, ids.channel.request_id));
      const code = codeSentTo(tg, TG_OWNER).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
      assert.equal((await s.service.confirm(sessionId, OWNER, ` ${code} `)).status, 'connected');
    });

    it('a second channel in the workspace is not made default', async () => {
      const s = setup();
      s.prisma.socialConnection.rows.push({ id: 'old', workspaceId: 'ws-owner', platform: 'TELEGRAM', accountIdentifier: '-100999', status: 'CONNECTED', isDefault: true, createdAt: new Date(0) });
      const { sessionId, ids } = await startedSession(s, tg);
      await s.service.handleUpdate(shared(TG_OWNER, ids.channel.request_id));
      await s.service.confirm(sessionId, OWNER, codeSentTo(tg, TG_OWNER));
      assert.equal(s.prisma.socialConnection.rows.find((r) => r.accountIdentifier === String(CHANNEL))!.isDefault, false);
    });

    it('confirm before a chat is shared → 409 not_pending', async () => {
      const s = setup();
      const { sessionId } = await startedSession(s, tg);
      await assert.rejects(s.service.confirm(sessionId, OWNER, '123456'), (e: any) =>
        e.getStatus() === 409 && e.getResponse().code === 'not_pending');
    });

    it('rights lost between share and confirm → 409 bot_not_admin, nothing saved', async () => {
      const s = setup();
      const { sessionId, ids } = await startedSession(s, tg);
      await s.service.handleUpdate(shared(TG_OWNER, ids.channel.request_id));
      tg.queue('getChatMember', ok({ status: 'left', user: { id: BOT_ID } }));
      await assert.rejects(s.service.confirm(sessionId, OWNER, codeSentTo(tg, TG_OWNER)), (e: any) =>
        e.getStatus() === 409 && e.getResponse().code === 'bot_not_admin');
      assert.equal(s.prisma.socialConnection.rows.length, 0);
    });
  });

  describe('the shared-link attack', () => {
    it('victim\'s channel cannot be saved into the attacker\'s workspace', async () => {
      const s = setup();
      // Attacker (OTHER) creates a session in their own workspace and sends the link.
      const created = await s.service.createSession('ws-other', OTHER);
      const nonce = new URL(created.deepLink).searchParams.get('start')!;
      // Victim taps it in Telegram and shares their channel.
      await s.service.handleUpdate(start(TG_OWNER, nonce));
      const { channel } = keyboardIds(tg);
      await s.service.handleUpdate(shared(TG_OWNER, channel.request_id));
      // The bot told the VICTIM which workspace this is for.
      assert.ok(tg.callsOf('sendMessage').some((c) => /Other Co/.test(c.body.text) && Number(c.body.chat_id) === TG_OWNER));
      // Attacker sees only "pending", no chat details, and does not have the code.
      const view = await s.service.getSession(created.sessionId, OTHER);
      assert.equal(view.status, 'pending_confirm');
      assert.equal(JSON.stringify(view).includes('My channel'), false);
      assert.equal(JSON.stringify(view).includes(String(CHANNEL)), false);
      // Guessing is capped at 5 attempts, then the session is dead.
      const real = codeSentTo(tg, TG_OWNER);
      const wrong = real === '000000' ? '111111' : '000000';
      for (let i = 0; i < 4; i++) {
        await assert.rejects(s.service.confirm(created.sessionId, OTHER, wrong), (e: any) =>
          e.getStatus() === 400 && e.getResponse().code === 'wrong_code' && e.getResponse().attemptsLeft === 4 - i);
      }
      await assert.rejects(s.service.confirm(created.sessionId, OTHER, wrong), (e: any) =>
        e.getStatus() === 429 && e.getResponse().code === 'too_many_attempts');
      await assert.rejects(s.service.confirm(created.sessionId, OTHER, real), (e: any) => e.getStatus() === 409);
      assert.equal(s.prisma.socialConnection.rows.length, 0);
      assert.equal((await s.service.getSession(created.sessionId, OTHER)).status, 'failed');
    });
  });

  describe('connect by @username (fallback)', () => {
    it('needs the bot started first (so we know who the Telegram user is)', async () => {
      const s = setup();
      const created = await s.service.createSession('ws-owner', OWNER);
      await assert.rejects(s.service.connectByUsername(created.sessionId, OWNER, '@mychan'), (e: any) =>
        e.getStatus() === 409 && e.getResponse().code === 'start_bot_first');
    });

    it('verifies the public chat like chat_shared and parks it for the code', async () => {
      const s = setup();
      const { sessionId } = await startedSession(s, tg);
      tg.queue('getChat', ok({ id: CHANNEL, type: 'channel', title: 'Pub', username: 'mychan' }));
      const view = await s.service.connectByUsername(sessionId, OWNER, 'https://t.me/mychan');
      assert.equal(view.status, 'pending_confirm');
      assert.equal(tg.callsOf('getChat')[0].body.chat_id, '@mychan');
      assert.match(codeSentTo(tg, TG_OWNER), /^\d{6}$/);
    });

    it('unknown username → 404 chat_not_found; invalid → 400', async () => {
      const s = setup();
      const { sessionId } = await startedSession(s, tg);
      tg.queue('getChat', fail(400, 'Bad Request: chat not found'));
      await assert.rejects(s.service.connectByUsername(sessionId, OWNER, '@nochan_x'), (e: any) =>
        e.getStatus() === 404 && e.getResponse().code === 'chat_not_found');
      await assert.rejects(s.service.connectByUsername(sessionId, OWNER, 'a b'), (e: any) =>
        e.getStatus() === 400 && e.getResponse().code === 'invalid_username');
    });
  });

  describe('my_chat_member and migrations', () => {
    const member = (chatId: number, status: string, extra: Record<string, unknown> = {}, type = 'channel'): TgUpdate => ({
      update_id: updateSeq++,
      my_chat_member: {
        chat: { id: chatId, type: type as any, title: 'X' },
        from: { id: TG_OWNER },
        date: 0,
        old_chat_member: { status: 'administrator', user: { id: BOT_ID }, can_post_messages: true },
        new_chat_member: { status: status as any, user: { id: BOT_ID }, ...extra },
      },
    });

    function withConnections(s: ReturnType<typeof setup>) {
      s.prisma.socialConnection.rows.push(
        { id: 'a', workspaceId: 'ws-owner', platform: 'TELEGRAM', accountIdentifier: String(CHANNEL), status: 'CONNECTED', isDefault: true, metaJson: { chatType: 'channel' } },
        { id: 'b', workspaceId: 'ws-other', platform: 'TELEGRAM', accountIdentifier: String(CHANNEL), status: 'CONNECTED', isDefault: true, metaJson: null },
        { id: 'c', workspaceId: 'ws-owner', platform: 'TELEGRAM', accountIdentifier: '-100777', status: 'CONNECTED', isDefault: false, metaJson: null },
      );
    }

    it('bot kicked → every connection for that chat REVOKED with a coded reason; others untouched', async () => {
      const s = setup();
      withConnections(s);
      await s.service.handleUpdate(member(CHANNEL, 'kicked'));
      const rows = s.prisma.socialConnection.rows;
      assert.deepEqual(rows.map((r) => r.status), ['REVOKED', 'REVOKED', 'CONNECTED']);
      assert.equal(rows[0].metaJson.revokedReason, 'BOT_REMOVED');
      assert.equal(rows[0].metaJson.chatType, 'channel');
      assert.equal(rows[1].metaJson.revokedReason, 'BOT_REMOVED');
    });

    it('rights lost (admin without can_post_messages) → REVOKED BOT_RIGHTS_LOST', async () => {
      const s = setup();
      withConnections(s);
      await s.service.handleUpdate(member(CHANNEL, 'administrator', { can_post_messages: false }));
      assert.equal(s.prisma.socialConnection.rows[0].metaJson.revokedReason, 'BOT_RIGHTS_LOST');
    });

    it('bot promoted / still can post → nothing changes; private-chat block → ignored', async () => {
      const s = setup();
      withConnections(s);
      await s.service.handleUpdate(member(CHANNEL, 'administrator', { can_post_messages: true }));
      await s.service.handleUpdate(member(TG_OWNER, 'kicked', {}, 'private'));
      assert.ok(s.prisma.socialConnection.rows.every((r) => r.status === 'CONNECTED'));
    });

    it('group upgraded to supergroup → connections move to the new id', async () => {
      const s = setup();
      s.prisma.socialConnection.rows.push({ id: 'g', workspaceId: 'ws-owner', platform: 'TELEGRAM', accountIdentifier: '-55', status: 'CONNECTED', metaJson: { chatType: 'group' } });
      await s.service.handleUpdate({ update_id: updateSeq++, message: { message_id: 1, chat: { id: -55, type: 'group' }, migrate_to_chat_id: -100555 } as any });
      assert.equal(s.prisma.socialConnection.rows[0].accountIdentifier, '-100555');
      assert.equal(s.prisma.socialConnection.rows[0].metaJson.chatType, 'supergroup');
    });

    it('messages in groups/channels are never read or answered', async () => {
      const s = setup();
      await s.service.handleUpdate({ update_id: updateSeq++, message: { message_id: 1, chat: { id: -100555, type: 'supergroup' }, from: { id: 1 }, text: '/start abc' } as any });
      assert.equal(tg.calls.length, 0);
    });

    it('the same update_id is handled once', async () => {
      const s = setup();
      withConnections(s);
      const u = member(CHANNEL, 'kicked');
      await s.service.handleUpdate(u);
      s.prisma.socialConnection.rows[0].status = 'CONNECTED';
      await s.service.handleUpdate(u);
      assert.equal(s.prisma.socialConnection.rows[0].status, 'CONNECTED');
    });
  });
});

describe('TelegramController webhook', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  function controller() {
    const handled: TgUpdate[] = [];
    const service = {
      checkWebhookSecret: (h?: string) => new TelegramConnectService(null as any, null as any, null as any, null as any).checkWebhookSecret(h),
      handleUpdate: async (u: TgUpdate) => { handled.push(u); },
    };
    return { c: new TelegramController(service as any), handled };
  }

  it('rejects a missing or wrong secret (401), accepts the right one (200 { ok: true })', async () => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'right_secret';
    const { c, handled } = controller();
    assert.throws(() => c.webhook(undefined, { update_id: 1 }), (e: any) => e.getStatus() === 401);
    assert.throws(() => c.webhook('wrong_secret', { update_id: 1 }), (e: any) => e.getStatus() === 401);
    assert.deepEqual(c.webhook('right_secret', { update_id: 2 }), { ok: true });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(handled.map((u) => u.update_id), [2]);
  });

  it('fails closed when TELEGRAM_WEBHOOK_SECRET is unset', () => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const { c } = controller();
    assert.throws(() => c.webhook('', { update_id: 1 }), (e: any) => e.getStatus() === 401);
    assert.throws(() => c.webhook(undefined, { update_id: 1 }), (e: any) => e.getStatus() === 401);
  });
});

describe('Connections config for the web', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });

  it('/social/oauth/config reports telegram true only when token, username and webhook secret are set', async () => {
    const { SocialOAuthController } = await import('../src/modules/social/social-oauth.controller');
    const s = setup();
    const c = new SocialOAuthController({ configuredPlatforms: () => ({ linkedin: true }) } as any, null as any, s.service);
    process.env.TELEGRAM_BOT_TOKEN = '1:t';
    process.env.TELEGRAM_BOT_USERNAME = 'Bot';
    process.env.TELEGRAM_WEBHOOK_SECRET = 'x';
    delete process.env.TELEGRAM_UPDATES_MODE;
    assert.deepEqual(c.platformConfig(), { platforms: { linkedin: true, telegram: true } });
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    assert.equal(c.platformConfig().platforms.telegram, false);
    process.env.TELEGRAM_UPDATES_MODE = 'polling'; // dev: no webhook secret needed
    assert.equal(c.platformConfig().platforms.telegram, true);
    delete process.env.TELEGRAM_BOT_USERNAME;
    assert.equal(c.platformConfig().platforms.telegram, false);
  });
});

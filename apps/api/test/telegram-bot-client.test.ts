/**
 * Telegram Bot API client against a local fake server.
 *
 * What matters: errors map to the publish vocabulary (revoked / rate limited /
 * migrated / transient), the token (which sits in the URL path) never shows up
 * in an error, and an unconfigured bot makes no request at all.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';

import { TelegramBotClient, classifyTelegramError } from '../src/modules/social/telegram/telegram-bot.client';

import { fail, ok, startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram';

const TOKEN = '123456:SECRET-token_value';

describe('TelegramBotClient', () => {
  let tg: FakeTelegram;
  const env = { ...process.env };

  before(async () => { tg = await startFakeTelegram(); });
  after(async () => { await tg.close(); });
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    process.env.TELEGRAM_API_BASE = tg.base;
    tg.calls.length = 0;
  });
  afterEach(() => { process.env = { ...env }; });

  it('calls /bot<token>/<method> with a JSON body and returns the result', async () => {
    const client = new TelegramBotClient();
    const res = await client.getChatMember('-1001234', 42);
    assert.equal(res.ok, true);
    assert.equal(tg.calls[0].token, TOKEN);
    assert.deepEqual(tg.calls[0].body, { chat_id: '-1001234', user_id: 42 });
  });

  it('caches getMe', async () => {
    const client = new TelegramBotClient();
    await client.getBotIdentity();
    await client.getBotIdentity();
    assert.equal(tg.callsOf('getMe').length, 1);
  });

  it('not configured: no request, kind not_configured', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const client = new TelegramBotClient();
    assert.equal(client.isConfigured(), false);
    const res = await client.getMe();
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.kind, 'not_configured');
    assert.equal(tg.calls.length, 0);
  });

  it('429 → rate_limited with retry_after', async () => {
    tg.queue('sendMessage', fail(429, 'Too Many Requests: retry after 7', { retry_after: 7 }));
    const res = await new TelegramBotClient().sendMessage({ chat_id: '1', text: 'x' });
    assert.ok(!res.ok);
    assert.equal(res.kind, 'rate_limited');
    assert.equal(res.retryAfterSec, 7);
  });

  it('403 → revoked', async () => {
    tg.queue('sendMessage', fail(403, 'Forbidden: bot was kicked from the channel chat'));
    const res = await new TelegramBotClient().sendMessage({ chat_id: '1', text: 'x' });
    assert.ok(!res.ok && res.kind === 'revoked');
  });

  it('400 chat not found / not enough rights → revoked', async () => {
    for (const d of ['Bad Request: chat not found', 'Bad Request: not enough rights to send text messages to the chat', 'Bad Request: need administrator rights in the channel chat', 'Bad Request: member list is inaccessible']) {
      tg.queue('sendMessage', fail(400, d));
      const res = await new TelegramBotClient().sendMessage({ chat_id: '1', text: 'x' });
      assert.ok(!res.ok && res.kind === 'revoked', d);
    }
  });

  it('400 with migrate_to_chat_id → migrated', async () => {
    tg.queue('sendMessage', fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: -1009876 }));
    const res = await new TelegramBotClient().sendMessage({ chat_id: '-55', text: 'x' });
    assert.ok(!res.ok && res.kind === 'migrated');
    assert.equal(!res.ok && res.migrateToChatId, -1009876);
  });

  it('other 400 → bad_request; 401 → unauthorized; 500 → server', async () => {
    tg.queue('sendMessage', fail(400, "Bad Request: can't parse entities"));
    tg.queue('sendMessage', fail(401, 'Unauthorized'));
    tg.queue('sendMessage', fail(502, 'Bad Gateway'));
    const c = new TelegramBotClient();
    const kinds = [];
    for (let i = 0; i < 3; i++) {
      const r = await c.sendMessage({ chat_id: '1', text: 'x' });
      kinds.push(!r.ok && r.kind);
    }
    assert.deepEqual(kinds, ['bad_request', 'unauthorized', 'server']);
  });

  it('connection refused → unreachable (pre-send), and the token is not in the error', async () => {
    const closed = await startFakeTelegram();
    await closed.close(); // a port that was just free: nothing listens there now
    process.env.TELEGRAM_API_BASE = closed.base;
    const res = await new TelegramBotClient().sendMessage({ chat_id: '1', text: 'x' });
    assert.ok(!res.ok);
    assert.equal(res.kind, 'unreachable');
    assert.ok(!res.description.includes(TOKEN), res.description);
    assert.ok(!res.description.includes('SECRET'), res.description);
  });

  it('timeout after the request left → ambiguous', async () => {
    tg.queue('sendMessage', { ...ok({ message_id: 1 }), delayMs: 400 });
    const res = await new TelegramBotClient({ timeoutMs: 100 }).sendMessage({ chat_id: '1', text: 'x' });
    assert.ok(!res.ok);
    assert.equal(res.kind, 'ambiguous');
    assert.ok(!res.description.includes(TOKEN));
  });

  it('a platform description that echoes the token is scrubbed', async () => {
    tg.queue('getMe', fail(400, `weird ${TOKEN} echo`));
    const res = await new TelegramBotClient().getMe();
    assert.ok(!res.ok && !res.description.includes(TOKEN));
  });

  it('sendPhoto uploads multipart with caption and parse_mode', async () => {
    const res = await new TelegramBotClient().sendPhoto({
      chat_id: '-100555',
      photo: { data: Buffer.from('png-bytes'), mimeType: 'image/png', filename: 'post.png' },
      caption: '<b>hi</b>',
      parse_mode: 'HTML',
    });
    assert.equal(res.ok, true);
    const call = tg.callsOf('sendPhoto')[0];
    assert.match(call.contentType, /^multipart\/form-data/);
    assert.equal(call.body.caption, '<b>hi</b>');
    assert.equal(call.body.parse_mode, 'HTML');
    assert.equal(call.body.chat_id, '-100555');
    assert.equal(call.files.photo.size, 9);
    assert.equal(call.files.photo.type, 'image/png');
  });
});

describe('classifyTelegramError', () => {
  it('uses error_code before the description text', () => {
    assert.equal(classifyTelegramError(403, { error_code: 403, description: 'anything' }).kind, 'revoked');
    assert.equal(classifyTelegramError(200, { error_code: 429, description: 'x', parameters: { retry_after: 3 } }).kind, 'rate_limited');
  });
});

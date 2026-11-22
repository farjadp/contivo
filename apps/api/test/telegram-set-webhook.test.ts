/**
 * The one-off setWebhook script: right URL, secret, allowed_updates and
 * drop_pending_updates; refuses bad config; prints nothing secret.
 *
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';

import { PRODUCTION_WEBHOOK_URL, runSetWebhook, webhookParams } from '../scripts/telegram-set-webhook';

import { ok, startFakeTelegram, type FakeTelegram } from './helpers/fake-telegram';

const TOKEN = '987:VERY_secret-token';
const SECRET = 'a'.repeat(64);

describe('webhookParams', () => {
  it('builds the production webhook call', () => {
    assert.deepEqual(webhookParams({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET }, []), {
      url: PRODUCTION_WEBHOOK_URL,
      secret_token: SECRET,
      allowed_updates: ['message', 'my_chat_member'],
      drop_pending_updates: true,
    });
    assert.equal(PRODUCTION_WEBHOOK_URL, 'https://contivo-api-production.up.railway.app/api/v1/social/telegram/webhook');
  });

  it('--url overrides for a staging API, https only', () => {
    const p = webhookParams({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET }, ['--url', 'https://staging.example/api/v1/social/telegram/webhook']);
    assert.equal(p.url, 'https://staging.example/api/v1/social/telegram/webhook');
    assert.throws(() => webhookParams({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET }, ['--url', 'http://x']), /https/);
  });

  it('refuses missing env and a secret Telegram would reject', () => {
    assert.throws(() => webhookParams({ TELEGRAM_WEBHOOK_SECRET: SECRET }, []), /TELEGRAM_BOT_TOKEN/);
    assert.throws(() => webhookParams({ TELEGRAM_BOT_TOKEN: TOKEN }, []), /TELEGRAM_WEBHOOK_SECRET/);
    assert.throws(() => webhookParams({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: 'has space' }, []), /A-Z/);
    assert.throws(() => webhookParams({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: 'x'.repeat(257) }, []), /256/);
  });
});

describe('runSetWebhook', () => {
  let tg: FakeTelegram;
  before(async () => { tg = await startFakeTelegram(); });
  after(async () => { await tg.close(); });

  it('calls setWebhook then getWebhookInfo and prints no token or secret', async () => {
    tg.queue('getWebhookInfo', ok({ url: PRODUCTION_WEBHOOK_URL, pending_update_count: 0, allowed_updates: ['message', 'my_chat_member'] }));
    const lines: string[] = [];
    const env = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_API_BASE: tg.base };
    const code = await runSetWebhook(env, [], (l) => lines.push(l));
    assert.equal(code, 0);
    const set = tg.callsOf('setWebhook')[0];
    assert.equal(set.body.secret_token, SECRET);
    assert.equal(set.body.drop_pending_updates, true);
    const out = lines.join('\n');
    assert.ok(!out.includes(TOKEN) && !out.includes('VERY_secret'), out);
    assert.ok(!out.includes(SECRET), out);
    assert.match(out, /setWebhook: ok/);
    assert.match(out, /pending_update_count: 0/);
  });
});

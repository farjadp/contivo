/**
 * telegram-set-webhook.ts
 *
 * Points the Contivo bot at the production webhook. Run ONCE after the bot
 * exists and the three env vars are set on contivo-api (and again only if the
 * URL or the secret changes).
 *
 *   cd apps/api
 *   railway run --service contivo-api pnpm exec ts-node scripts/telegram-set-webhook.ts
 *
 * Optional: --url https://<other-api>/api/v1/social/telegram/webhook (https only).
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from the env. Calls
 * setWebhook with allowed_updates ["message","my_chat_member"] (never
 * channel_post) and drop_pending_updates, then prints getWebhookInfo.
 * Never prints the token or the secret.
 */

import { TELEGRAM_ALLOWED_UPDATES, TelegramBotClient, type SetWebhookParams } from '../src/modules/social/telegram/telegram-bot.client';

export const PRODUCTION_WEBHOOK_URL = 'https://contivo-api-production.up.railway.app/api/v1/social/telegram/webhook';

export function webhookParams(env: NodeJS.ProcessEnv, argv: string[]): SetWebhookParams {
  const missing = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'].filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);
  const secret = env.TELEGRAM_WEBHOOK_SECRET!.trim();
  if (secret.length > 256) throw new Error('TELEGRAM_WEBHOOK_SECRET must be 1-256 characters.');
  if (!/^[A-Za-z0-9_-]+$/.test(secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET may only contain A-Z a-z 0-9 _ -');

  const i = argv.indexOf('--url');
  const url = i >= 0 ? argv[i + 1] : PRODUCTION_WEBHOOK_URL;
  if (!url || !/^https:\/\//.test(url)) throw new Error('--url must be an https:// URL (Telegram requires HTTPS).');

  return { url, secret_token: secret, allowed_updates: [...TELEGRAM_ALLOWED_UPDATES], drop_pending_updates: true };
}

export async function runSetWebhook(env: NodeJS.ProcessEnv, argv: string[], print: (line: string) => void): Promise<number> {
  let params: SetWebhookParams;
  try {
    params = webhookParams(env, argv);
  } catch (e) {
    print(`Refused: ${(e as Error).message}`);
    return 1;
  }
  const client = new TelegramBotClient({ env });
  print(`Setting webhook to ${params.url}`);
  print(`allowed_updates: ${params.allowed_updates.join(', ')}; drop_pending_updates: true`);

  const set = await client.setWebhook(params);
  if (!set.ok) {
    print(`setWebhook: FAILED (${set.kind}) ${set.description}`);
    return 1;
  }
  print('setWebhook: ok');

  const info = await client.getWebhookInfo();
  if (!info.ok) {
    print(`getWebhookInfo: FAILED (${info.kind}) ${info.description}`);
    return 1;
  }
  print(`webhook url: ${info.result.url}`);
  print(`pending_update_count: ${info.result.pending_update_count}`);
  print(`allowed_updates: ${(info.result.allowed_updates ?? []).join(', ') || '(default)'}`);
  if (info.result.last_error_message) print(`last_error_message: ${info.result.last_error_message}`);
  return info.result.url === params.url ? 0 : 1;
}

if (require.main === module) {
  runSetWebhook(process.env, process.argv.slice(2), (l) => console.log(l)).then((code) => process.exit(code));
}

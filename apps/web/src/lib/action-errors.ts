import { getTranslations } from 'next-intl/server';

/**
 * The user-facing error text a server action returns.
 *
 * Actions always run inside a request, so they can read the caller's locale.
 * The engines under `lib/` deliberately do NOT use this: `content-engine` and
 * the Autopilot runner are also called from the cron route with no request
 * behind them, and `getTranslations` throws there. Their error strings stay as
 * English identifiers and are translated at the boundary that displays them,
 * if at all — a crash in the unattended publisher is a worse outcome than an
 * untranslated line in a log.
 */
export async function actionError(key: string): Promise<string> {
  const t = await getTranslations('errors');
  return t(key);
}

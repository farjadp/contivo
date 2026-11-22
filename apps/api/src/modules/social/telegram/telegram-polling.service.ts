/**
 * telegram-polling.service.ts
 *
 * Local development only: when TELEGRAM_UPDATES_MODE=polling, long-poll
 * getUpdates and feed each update to the same handler the webhook uses.
 * Webhook and getUpdates are mutually exclusive in the Bot API, so:
 *   - never runs unless the env says so, and never in the worker process;
 *   - one poller at a time, by a Redis lock taken around each poll;
 *   - if the bot has a webhook set (409), it does NOT delete it — that would
 *     silently break production if a dev pointed at the real bot. Use a
 *     separate dev bot.
 */

import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

import { LOCK_STORE, type LockStore } from '../token-refresh.service';

import { TELEGRAM_ALLOWED_UPDATES, TelegramBotClient } from './telegram-bot.client';
import { TelegramConnectService } from './telegram-connect.service';

const LOCK_KEY = 'social:tg-polling';
const POLL_TIMEOUT_SEC = 20;
const ERROR_BACKOFF_MS = 5_000;
const CONFLICT_BACKOFF_MS = 60_000;

export function pollingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.TELEGRAM_UPDATES_MODE?.trim() === 'polling' && env.WORKER_MODE !== 'true' && !!env.TELEGRAM_BOT_TOKEN?.trim();
}

@Injectable()
export class TelegramPollingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);
  private offset: number | undefined;
  private running = false;
  private loop: Promise<void> | null = null;

  /** Overridable in tests. */
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly client: TelegramBotClient,
    private readonly connect: TelegramConnectService,
    @Inject(LOCK_STORE) private readonly locks: LockStore,
  ) {}

  onApplicationBootstrap() {
    if (!pollingEnabled()) return;
    this.logger.warn('TELEGRAM_UPDATES_MODE=polling: reading Telegram updates with getUpdates (dev only).');
    this.running = true;
    this.loop = this.run();
  }

  async onModuleDestroy() {
    this.running = false;
    await this.loop?.catch(() => undefined);
  }

  private async run() {
    while (this.running) {
      const pause = await this.pollOnce();
      if (pause && this.running) await this.wait(pause);
    }
  }

  /** One getUpdates round. Returns how long to wait before the next (0 = go on). */
  async pollOnce(timeoutSec = POLL_TIMEOUT_SEC): Promise<number> {
    let lock: string | null = null;
    try {
      lock = await this.locks.acquire(LOCK_KEY, (timeoutSec + 15) * 1000);
    } catch (e) {
      this.logger.warn(`Telegram polling lock unavailable: ${(e as Error).message}`);
      return ERROR_BACKOFF_MS;
    }
    if (!lock) return ERROR_BACKOFF_MS; // another process is polling

    try {
      const res = await this.client.getUpdates({
        offset: this.offset,
        timeout: timeoutSec,
        allowed_updates: [...TELEGRAM_ALLOWED_UPDATES],
      });
      if (!res.ok) {
        if (res.errorCode === 409) {
          this.logger.error('Telegram getUpdates conflict (409): this bot has a webhook set. Polling will not remove it; use a separate dev bot.');
          return CONFLICT_BACKOFF_MS;
        }
        this.logger.warn(`Telegram getUpdates failed: ${res.description}`);
        return ERROR_BACKOFF_MS;
      }
      for (const update of res.result) {
        this.offset = update.update_id + 1;
        await this.connect.handleUpdate(update);
      }
      return 0;
    } finally {
      await this.locks.release(LOCK_KEY, lock).catch(() => undefined);
    }
  }
}

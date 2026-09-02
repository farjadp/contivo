/**
 * web-cron.service.ts
 *
 * Runs the two scheduled jobs that live in the web app.
 *
 * Autopilot and website publishing are Next.js route handlers, not API
 * endpoints, because the whole Growth Engine lives in the web app. Vercel Cron
 * used to call them. Moving off Vercel means something else has to, and this
 * service is that something: the same two URLs, on the same cadence, with the
 * same `Authorization: Bearer <CRON_SECRET>` those routes already require.
 *
 * No logic moved. If these ever want to run somewhere else again, deleting
 * this file is the whole change.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class WebCronService {
  private readonly logger = new Logger(WebCronService.name);

  /** Overlap guards, per job: an Autopilot tick can outlast its interval. */
  private readonly running = new Set<string>();

  /**
   * Where the web app is. Deliberately no localhost fallback: firing
   * production's cron at a machine that is not there is worse than not firing
   * it, because it fails quietly and looks like nothing was due.
   */
  private get webAppUrl(): string | undefined {
    return (process.env.WEB_APP_URL || process.env.NEXT_PUBLIC_APP_URL)?.replace(/\/$/, '');
  }

  /** Every six hours: let each due Autopilot policy ideate, draft and schedule. */
  @Cron(CronExpression.EVERY_6_HOURS)
  async autopilotTick() {
    await this.call('autopilot', '/api/autopilot/tick?limit=3');
  }

  /** Every fifteen minutes: publish website content whose time has arrived. */
  @Cron('*/15 * * * *')
  async publishDueWebContent() {
    await this.call('publish-due', '/api/content/publish-due?limit=20');
  }

  private async call(job: string, path: string): Promise<void> {
    const base = this.webAppUrl;
    const secret = process.env.CRON_SECRET;

    // Both are required, and their absence is a configuration fault rather
    // than a quiet no-op: without them these jobs simply never run, which is
    // exactly the kind of silent nothing this codebase has been bitten by.
    if (!base) {
      this.logger.error(`Cannot run ${job}: WEB_APP_URL is not set.`);
      return;
    }
    if (!secret) {
      this.logger.error(`Cannot run ${job}: CRON_SECRET is not set.`);
      return;
    }

    if (this.running.has(job)) {
      this.logger.warn(`${job} is still running from the last tick — skipping this one.`);
      return;
    }
    this.running.add(job);

    const startedAt = Date.now();
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        // Long enough for an Autopilot tick, which makes several model calls
        // per post, and short enough that a wedged request cannot block the
        // next tick indefinitely.
        signal: AbortSignal.timeout(280_000),
      });

      const body = await res.text();
      const took = Date.now() - startedAt;

      if (!res.ok) {
        this.logger.error(`${job} failed: HTTP ${res.status} after ${took}ms — ${body.slice(0, 300)}`);
        return;
      }
      this.logger.log(`${job} ok in ${took}ms — ${body.slice(0, 300)}`);
    } catch (err) {
      this.logger.error(
        `${job} could not be reached after ${Date.now() - startedAt}ms: ${(err as Error).message}`,
      );
    } finally {
      this.running.delete(job);
    }
  }
}

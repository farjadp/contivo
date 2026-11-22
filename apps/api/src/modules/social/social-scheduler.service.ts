/**
 * social-scheduler.service.ts
 *
 * Cron-based scheduler that auto-publishes content items when their
 * scheduled time is due.
 *
 * Runs every minute. For each workspace:
 *   1. Finds content_items with status=SCHEDULED and scheduledAtUtc <= now()
 *   2. Finds the workspace's default social connection(s)
 *   3. Creates a SocialPublishJob and fires it asynchronously
 *   4. Updates content item status to PUBLISHING
 *
 * Production upgrade: replace @Cron with BullMQ delayed jobs for reliability
 * and horizontal scaling. The logic here stays the same — the queue worker
 * calls the same SocialPublishService.
 */

import { formatFailure, type PublishFailureCode } from '@contivo/types';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';


import { PrismaService } from '../../common/prisma/prisma.service';

import { channelToPlatform } from './platforms';
import { buildPublishPayload } from './publish-payload';
import { SocialPublishService } from './social-publish.service';

@Injectable()
export class SocialSchedulerService {
  private readonly logger = new Logger(SocialSchedulerService.name);
  private isRunning = false;   // Guard against overlapping runs

  constructor(
    private readonly prisma: PrismaService,
    private readonly publishService: SocialPublishService,
  ) {}

  /**
   * Every minute: pick up content items that are due for publishing.
   * We use EVERY_MINUTE for MVP. Switch to a queue for production.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleScheduledPublishing() {
    if (this.isRunning) {
      this.logger.warn('Scheduler already running — skipping tick');
      return;
    }

    this.isRunning = true;

    try {
      const now = new Date();

      // Find all content items due for publishing. `blog` is excluded: the
      // web Content-API publisher owns it, and reading it here every minute
      // only produced noise.
      const dueItems = await this.prisma.contentItem.findMany({
        where: {
          status:          'SCHEDULED',
          scheduledAtUtc:  { lte: now },
          channel:         { not: 'blog' },
        },
        select: {
          id:          true,
          workspaceId: true,
          userId:      true,
          channel:     true,
          topic:       true,
          content:     true,
          slug:        true,
        },
      });

      if (dueItems.length === 0) return;

      this.logger.log(`Scheduler: ${dueItems.length} item(s) due for publishing`);

      for (const item of dueItems) {
        await this.publishItem(item);
      }
    } catch (err) {
      this.logger.error(`Scheduler error: ${(err as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async publishItem(item: {
    id: string;
    workspaceId: string | null;
    userId: string;
    channel: string;
    topic: string;
    content: string | null;
    slug: string | null;
  }) {
    if (item.channel === 'blog') return; // web publisher's job

    const platform = channelToPlatform(item.channel);
    if (!platform) {
      // No social publisher for this channel (email today). Park it once with a
      // reason; leaving it SCHEDULED re-read it every minute forever.
      await this.failItem(item.id, 'NO_PUBLISHER', `No publisher for channel ${item.channel}`);
      this.logger.warn(`Scheduler: no publisher for channel=${item.channel}, item=${item.id} marked FAILED`);
      return;
    }

    if (!item.workspaceId) {
      await this.failItem(item.id, 'NO_CONNECTION', 'Content item has no workspace, so no connection can publish it.');
      return;
    }

    let payload;
    try {
      payload = buildPublishPayload(item);
    } catch (err) {
      await this.failItem(item.id, 'INVALID_CONTENT', (err as Error).message);
      return;
    }

    // Find the default connected account for this platform in the workspace
    const connection = await this.prisma.socialConnection.findFirst({
      where: {
        workspaceId: item.workspaceId,
        platform,
        status:      'CONNECTED',
        isDefault:   true,
      },
      select: { id: true },
    });

    if (!connection) {
      this.logger.warn(
        `Scheduler: no default ${platform} connection for workspace=${item.workspaceId}, skipping item=${item.id}`,
      );
      await this.failItem(
        item.id,
        'NO_CONNECTION',
        `No default ${platform} connection found. Please connect your account in the Connections page.`,
      );
      return;
    }

    // Claim the item (SCHEDULED → PUBLISHING) so an overlapping run cannot take it too.
    const { count } = await this.prisma.contentItem.updateMany({
      where: { id: item.id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHING' },
    });
    if (count === 0) return;

    try {
      const job = await this.publishService.createJob({
        workspaceId:        item.workspaceId,
        socialConnectionId: connection.id,
        contentItemId:      item.id,
        platform,
        ...payload,
      }, item.userId);

      this.logger.log(
        `Scheduler: created PublishJob id=${job.id} for ContentItem=${item.id} via ${platform}`,
      );
    } catch (err) {
      this.logger.error(`Scheduler: failed to create job for item=${item.id}: ${(err as Error).message}`);
      // createJob refusals carry { code } (NO_PUBLISHER / INVALID_CONTENT / NO_CONNECTION).
      const response = (err as { getResponse?: () => unknown }).getResponse?.() as
        | { code?: PublishFailureCode; message?: string }
        | undefined;
      await this.prisma.contentItem.update({
        where: { id: item.id },
        data: {
          status: 'FAILED',
          failedReason: formatFailure(response?.code ?? 'PLATFORM_ERROR', response?.message ?? (err as Error).message),
        },
      });
    }
  }

  /** SCHEDULED → FAILED with a coded reason, once. */
  private async failItem(id: string, code: PublishFailureCode, reason: string) {
    await this.prisma.contentItem.updateMany({
      where: { id, status: 'SCHEDULED' },
      data:  { status: 'FAILED', failedReason: formatFailure(code, reason) },
    });
  }
}

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

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
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

      // Find all content items due for publishing
      const dueItems = await (this.prisma as any).contentItem.findMany({
        where: {
          status:          'SCHEDULED',
          scheduledAtUtc:  { lte: now },
        },
        select: {
          id:          true,
          workspaceId: true,
          channel:     true,
          topic:       true,
          content:     true,
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
    workspaceId: string;
    channel: string;
    topic: string;
    content: string | null;
  }) {
    // Map content item channel to social platform
    const platform = this.channelToPlatform(item.channel);
    if (!platform) {
      this.logger.warn(`Scheduler: no platform mapping for channel=${item.channel}, skipping item=${item.id}`);
      return;
    }

    // Find the default connected account for this platform in the workspace
    const connection = await (this.prisma as any).socialConnection.findFirst({
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
      // Mark as failed so it doesn't keep looping
      await (this.prisma as any).contentItem.update({
        where: { id: item.id },
        data: {
          status:       'FAILED',
          failedReason: `No default ${platform} connection found. Please connect your account in the Connections page.`,
        },
      });
      return;
    }

    // Mark item as PUBLISHING to prevent duplicate processing
    await (this.prisma as any).contentItem.update({
      where: { id: item.id },
      data: { status: 'PUBLISHING' },
    });

    try {
      // Create a publish job and fire it — flat DTO fields match CreatePublishJobDto
      const job = await this.publishService.createJob({
        workspaceId:        item.workspaceId,
        socialConnectionId: connection.id,
        contentItemId:      item.id,
        platform:           platform as any,
        body:               item.content ?? item.topic,
        hashtags:           [],
      });

      this.logger.log(
        `Scheduler: created PublishJob id=${job.id} for ContentItem=${item.id} via ${platform}`,
      );
    } catch (err) {
      this.logger.error(`Scheduler: failed to create job for item=${item.id}: ${(err as Error).message}`);

      // Revert item status so operator can retry
      await (this.prisma as any).contentItem.update({
        where: { id: item.id },
        data: {
          status:       'FAILED',
          failedReason: (err as Error).message,
        },
      });
    }
  }

  /** Maps content pipeline channel names to social platform enum values. */
  private channelToPlatform(channel: string): string | null {
    const map: Record<string, string> = {
      LINKEDIN:  'LINKEDIN',
      TWITTER:   'X',
      X:         'X',
      FACEBOOK:  'FACEBOOK',
      INSTAGRAM: 'INSTAGRAM',
      // Friendly label variants
      LinkedIn:  'LINKEDIN',
      Twitter:   'X',
      Facebook:  'FACEBOOK',
      Instagram: 'INSTAGRAM',
    };
    return map[channel] ?? null;
  }
}

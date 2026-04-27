/**
 * social-publish.service.ts
 *
 * Orchestrates the creation of social publish jobs and coordinates
 * with the adapter layer and queue system.
 *
 * Flow:
 *   HTTP Request
 *     → validate DTO
 *     → validate platform payload (rules engine)
 *     → create DB record (status = PUBLISH_QUEUED or SCHEDULED)
 *     → [future] enqueue job via BullMQ
 *     → return job record immediately (non-blocking)
 *
 * For MVP: jobs are executed synchronously (no real queue yet).
 * The architecture is queue-ready — swap processJobNow() for a queue enqueue.
 *
 * Q: Why not execute in-request?
 * A: Social API calls can take 2–10 seconds. Doing this inside an HTTP request
 *    leads to timeouts and bad UX. Always queue and poll.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdapterFactory } from './adapters/adapter.factory';
import { SocialConnectionsService } from './social-connections.service';
import { CreatePublishJobDto } from './dto/create-publish-job.dto';
import type { PublishPayload } from './adapters/social-adapter.interface';
import { JobsService } from '../jobs/jobs.service';

// Use local string type — avoids @contivo/types circular dep before package build
type SocialPlatform = 'LINKEDIN' | 'X' | 'FACEBOOK' | 'INSTAGRAM';

@Injectable()
export class SocialPublishService {
  private readonly logger = new Logger(SocialPublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly connections: SocialConnectionsService,
    private readonly jobs: JobsService,
  ) {}

  // ─── Create publish job ────────────────────────────────────────────────────

  async createJob(dto: CreatePublishJobDto, userId: string) {
    await this.connections.validateWorkspaceAccess(dto.workspaceId, userId);
    const platform = dto.platform as SocialPlatform;

    // 1. Build payload for validation
    const payload: PublishPayload = {
      body:     dto.body,
      linkUrl:  dto.linkUrl,
      hashtags: dto.hashtags ?? [],
    };

    // 2. Run platform-specific validation rules BEFORE touching the DB
    const adapter = this.adapterFactory.getAdapter(platform);
    const validation = adapter.validatePayload(payload);
    if (!validation.valid) {
      throw new BadRequestException({
        message: 'Publish payload failed platform validation.',
        errors:  validation.errors,
      });
    }

    // 3. Determine initial status
    const isScheduled = !!dto.scheduledAtUtc;
    const initialStatus = isScheduled ? 'SCHEDULED' : 'PUBLISH_QUEUED';

    // 4. Create the DB record
    const job = await this.prisma.socialPublishJob.create({
      data: {
        workspaceId:       dto.workspaceId,
        contentItemId:     dto.contentItemId ?? null,
        socialConnectionId: dto.socialConnectionId,
        platform:          platform as any,
        scheduledAtUtc:    dto.scheduledAtUtc ? new Date(dto.scheduledAtUtc) : null,
        timezone:          dto.timezone ?? 'UTC',
        status:            initialStatus as any,
      },
    });

    // 5. Log the job creation event
    await this.appendLog(job.id, 'JOB_CREATED', 'SUCCESS', {
      platform,
      body: payload.body.slice(0, 200), // truncated for safety
      isScheduled,
    });

    this.logger.log(
      `Publish job created: id=${job.id} platform=${platform} workspace=${dto.workspaceId} scheduled=${isScheduled}`,
    );

    // 6. Enqueue via BullMQ. If scheduled, the scheduler service handles it separately.
    // Replace processJobAsync with genuine enqueuing
    if (!isScheduled) {
      await this.jobs.enqueuePublish({
        userId,
        workspaceId: dto.workspaceId,
        jobRecordId: job.id,
        traceId: job.id,
        metadata: payload,
      });
    }

    return this.findJobOrThrow(job.id);
  }

  // ─── List jobs ─────────────────────────────────────────────────────────────

  async listJobs(
    workspaceId: string,
    userId: string,
    options?: { status?: string; limit?: number },
  ) {
    await this.connections.validateWorkspaceAccess(workspaceId, userId);
    const where: Record<string, unknown> = { workspaceId };
    if (options?.status) where.status = options.status;

    const jobs = await this.prisma.socialPublishJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take:    Math.min(options?.limit ?? 50, 200),
    });

    return { jobs, total: jobs.length };
  }

  // ─── Get job detail + logs ─────────────────────────────────────────────────

  async getJobDetail(id: string, workspaceId: string, userId: string) {
    await this.connections.validateWorkspaceAccess(workspaceId, userId);
    const job = await this.prisma.socialPublishJob.findFirst({
      where: { id, workspaceId },
    });
    if (!job) throw new NotFoundException(`Publish job ${id} not found.`);

    const logs = await this.prisma.socialPublishLog.findMany({
      where: { publishJobId: id },
      orderBy: { createdAt: 'asc' },
    });

    return { job, logs };
  }

  // ─── Retry ────────────────────────────────────────────────────────────────

  async retry(id: string, workspaceId: string, userId: string) {
    await this.connections.validateWorkspaceAccess(workspaceId, userId);
    const job = await this.prisma.socialPublishJob.findFirst({
      where: { id, workspaceId, status: 'FAILED' },
    });

    if (!job) {
      throw new NotFoundException(
        `Publish job ${id} not found or is not in FAILED status.`,
      );
    }

    if (job.retryCount >= 5) {
      throw new BadRequestException(
        `Job ${id} has exceeded the maximum retry count (5). Cancel and create a new job.`,
      );
    }

    // Update to PUBLISH_QUEUED and increment retry count
    await this.prisma.socialPublishJob.update({
      where: { id },
      data:  { status: 'PUBLISH_QUEUED' as any, retryCount: { increment: 1 } },
    });

    await this.appendLog(id, 'RETRY_REQUESTED', 'SUCCESS', {
      retryCount: job.retryCount + 1,
    });

    const payload: PublishPayload = {
      body: job.lastError ? '' : '', // For now, re-use empty payload for retry. Phase 2: Attach content resolution.
    };

    await this.jobs.enqueuePublish({
      userId,
      workspaceId,
      jobRecordId: job.id,
      traceId: job.id,
      metadata: payload,
    });

    return this.findJobOrThrow(id);
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  async cancel(id: string, workspaceId: string, userId: string) {
    await this.connections.validateWorkspaceAccess(workspaceId, userId);
    const job = await this.prisma.socialPublishJob.findFirst({
      where: { id, workspaceId },
    });

    if (!job) throw new NotFoundException(`Publish job ${id} not found.`);

    if (job.status === 'PUBLISHED') {
      throw new BadRequestException('Cannot cancel a job that has already been published.');
    }

    await this.prisma.socialPublishJob.update({
      where: { id },
      data:  { status: 'CANCELLED' as any },
    });

    await this.appendLog(id, 'JOB_CANCELLED', 'SUCCESS');
    return this.findJobOrThrow(id);
  }

  // ─── Core publish executor ─────────────────────────────────────────────────

  /**
   * Internal async executor.
   * Called by the BullMQ processor worker in the background.
   */
  public async processJobAsync(
    jobId: string,
    connectionId: string,
    platform: SocialPlatform,
    payload: PublishPayload,
  ): Promise<void> {
    try {
      // Mark as PUBLISHING
      await this.prisma.socialPublishJob.update({
        where: { id: jobId },
        data:  { status: 'PUBLISHING' as any },
      });

      await this.appendLog(jobId, 'PUBLISH_ATTEMPT', 'SUCCESS', {
        platform,
        payloadLength: payload.body?.length ?? 0,
      });

      // Decrypt tokens for adapter
      const { accessToken, refreshToken } = await this.connections.getDecryptedTokens(connectionId);

      const connection = await this.prisma.socialConnection.findUnique({
        where: { id: connectionId },
        select: { accountIdentifier: true, platform: true },
      });

      if (!connection || !accessToken) {
        throw new Error('Social connection token unavailable. Reconnect the account.');
      }

      const adapter = this.adapterFactory.getAdapter(platform);

      // Validate live connection
      const isAlive = await adapter.validateConnection({
        id:                connectionId,
        platform,
        accountIdentifier: connection.accountIdentifier,
        accessToken,
        refreshToken:      refreshToken ?? undefined,
      });

      if (!isAlive) {
        throw new Error(
          `${platform} connection token is expired or invalid. Please reconnect the account.`,
        );
      }

      // Publish
      const result = await adapter.publish(
        {
          id:                connectionId,
          platform,
          accountIdentifier: connection.accountIdentifier,
          accessToken,
          refreshToken:      refreshToken ?? undefined,
        },
        payload,
      );

      if (result.success) {
        await this.prisma.socialPublishJob.update({
          where: { id: jobId },
          data:  {
            status:        'PUBLISHED',
            externalPostId:  result.externalPostId ?? null,
            externalPostUrl: result.externalPostUrl ?? null,
            publishedAtUtc:  new Date(),
            lastError:       null,
          },
        });

        await this.appendLog(jobId, 'PUBLISH_SUCCESS', 'SUCCESS', {
          externalPostId:  result.externalPostId,
          externalPostUrl: result.externalPostUrl,
        });

        this.logger.log(`Job ${jobId} published successfully on ${platform}`);
      } else {
        throw new Error(result.error ?? 'Unknown publish error');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      await this.prisma.socialPublishJob.update({
        where: { id: jobId },
        data:  { status: 'FAILED' as any, lastError: message },
      });

      await this.appendLog(jobId, 'PUBLISH_FAILURE', 'FAILURE', undefined, message);
      this.logger.error(`Job ${jobId} failed: ${message}`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async findJobOrThrow(id: string) {
    const job = await this.prisma.socialPublishJob.findUnique({ where: { id } });
    if (!job) throw new NotFoundException(`Publish job ${id} not found.`);
    return job;
  }

  private async appendLog(
    publishJobId: string,
    action: string,
    status: 'SUCCESS' | 'FAILURE' | 'SKIPPED',
    requestSummary?: object,
    errorMessage?: string,
  ) {
    await this.prisma.socialPublishLog.create({
      data: {
        publishJobId,
        action,
        status,
        requestSummary:  requestSummary ? JSON.stringify(requestSummary) : null,
        responseSummary: null,
        errorMessage:    errorMessage ?? null,
      },
    });
  }
}

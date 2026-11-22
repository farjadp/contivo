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
 * Execution happens in the BullMQ worker (publish.processor.ts →
 * publish-job-runner.ts → processJobAsync).
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
  ConflictException,
} from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';

import { formatFailure, type PublishFailureCode } from '@contivo/types';

import { PrismaService } from '../../common/prisma/prisma.service';
import { JobsService } from '../jobs/jobs.service';

import { AdapterFactory, UnsupportedPlatformError } from './adapters/adapter.factory';
import type { AdapterConnection, PublishPayload } from './adapters/social-adapter.interface';
import { CreatePublishJobDto } from './dto/create-publish-job.dto';
import { PermanentPublishError, TransientPublishError } from './publish-errors';
import { buildPublishPayload } from './publish-payload';
import { SocialConnectionsService } from './social-connections.service';
import { TokenRefreshService } from './token-refresh.service';

/** Where a BullMQ run is in its attempt budget. */
export interface AttemptInfo {
  /** Attempts already made before this one (BullMQ job.attemptsMade). */
  attemptsMade: number;
  /** job.opts.attempts. */
  maxAttempts: number;
}

/** A direct call (no queue) gets exactly one attempt. */
const SINGLE_ATTEMPT: AttemptInfo = { attemptsMade: 0, maxAttempts: 1 };

export type PublishOutcome = 'PUBLISHED' | 'FAILED' | 'CANCELLED';

/** Every status write below except PUBLISHED: a user's Cancel is final. */
const NOT_CANCELLED = { not: 'CANCELLED' as const };

/** Internal: the job was cancelled while this attempt ran. */
class JobCancelled extends Error {}

@Injectable()
export class SocialPublishService {
  private readonly logger = new Logger(SocialPublishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly connections: SocialConnectionsService,
    private readonly jobs: JobsService,
    private readonly tokenRefresh: TokenRefreshService,
  ) {}

  // ─── Create publish job ────────────────────────────────────────────────────

  async createJob(dto: CreatePublishJobDto, userId: string) {
    await this.connections.validateWorkspaceAccess(dto.workspaceId, userId);
    const platform: SocialPlatform = dto.platform;

    // 1. Build payload for validation
    const payload: PublishPayload = {
      body:     dto.body,
      linkUrl:  dto.linkUrl,
      hashtags: dto.hashtags ?? [],
      title:    dto.title,
      slug:     dto.slug,
      format:   dto.format,
    };

    // 2. Run platform-specific validation rules BEFORE touching the DB.
    // A platform without an adapter (TELEGRAM before its PR) throws
    // UnsupportedPlatformError here: a clear 400, not a crash.
    // `code` in the 400 body lets the scheduler store a coded failedReason.
    let adapter;
    try {
      adapter = this.adapterFactory.getAdapter(platform);
    } catch (err) {
      throw new BadRequestException({ message: (err as Error).message, code: 'NO_PUBLISHER' });
    }
    const validation = adapter.validatePayload(payload);
    if (!validation.valid) {
      throw new BadRequestException({
        message: `Publish payload failed platform validation. ${validation.errors.join(' ')}`.trim(),
        errors:  validation.errors,
        code:    'INVALID_CONTENT',
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
        platform,
        scheduledAtUtc:    dto.scheduledAtUtc ? new Date(dto.scheduledAtUtc) : null,
        timezone:          dto.timezone ?? 'UTC',
        status:            initialStatus,
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

  /**
   * Re-queues a FAILED job. The payload is rebuilt from the ContentItem with
   * the same builder the scheduler uses, so a retry posts the real body.
   *
   * The BullMQ job id must be new: BullMQ's add() returns the existing job
   * untouched when the id is already in Redis (addStandardJob-9.lua:90-91 →
   * handleDuplicatedJob, bullmq 5.71.0), and the first attempt is still there
   * (no removeOnComplete/removeOnFail). The id uses "-" not ":": a custom id
   * with a single ":" throws "Custom Id cannot contain :" (job.js:1036-1038).
   */
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

    if (!job.contentItemId) {
      throw new BadRequestException(
        `Job ${id} has no content item, so there is no body to publish again. Create a new job.`,
      );
    }
    const item = await this.prisma.contentItem.findUnique({
      where: { id: job.contentItemId },
      select: { id: true, topic: true, content: true, slug: true },
    });
    if (!item) {
      throw new BadRequestException(`The content item for job ${id} no longer exists.`);
    }

    let payload: PublishPayload;
    try {
      payload = buildPublishPayload(item);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    // Conditional update: a double click must not enqueue twice.
    const retryCount = job.retryCount + 1;
    const { count } = await this.prisma.socialPublishJob.updateMany({
      where: { id, status: 'FAILED', retryCount: job.retryCount },
      data:  { status: 'PUBLISH_QUEUED', retryCount, lastError: null },
    });
    if (count === 0) {
      throw new ConflictException(`Job ${id} is already being retried.`);
    }

    // Put the item back where the success/failure write-back looks for it.
    await this.prisma.contentItem.updateMany({
      where: { id: item.id, status: 'FAILED' },
      data:  { status: 'PUBLISHING', failedReason: null },
    });

    await this.appendLog(id, 'RETRY_REQUESTED', 'SUCCESS', { retryCount });

    await this.jobs.enqueuePublish(
      {
        userId,
        workspaceId,
        jobRecordId: job.id,
        traceId: job.id,
        retryCount,
        metadata: payload,
      },
      0,
      { jobId: `${job.id}-r${retryCount}` },
    );

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

    // Conditional: a publish that succeeds in the same instant wins, and the
    // user is told rather than shown a cancel that did not happen.
    const { count } = await this.prisma.socialPublishJob.updateMany({
      where: { id, workspaceId, status: { not: 'PUBLISHED' } },
      data:  { status: 'CANCELLED' },
    });
    if (count === 0) {
      throw new BadRequestException('Cannot cancel a job that has already been published.');
    }

    // The item was claimed (PUBLISHING) for this job; give it back to the user.
    if (job.contentItemId) {
      await this.prisma.contentItem.updateMany({
        where: { id: job.contentItemId, workspaceId, status: 'PUBLISHING' },
        data:  { status: 'READY' },
      });
    }

    await this.appendLog(id, 'JOB_CANCELLED', 'SUCCESS');
    return this.findJobOrThrow(id);
  }

  // ─── Core publish executor ─────────────────────────────────────────────────

  /**
   * Runs one publish attempt. Called by the BullMQ processor.
   *
   * - Success: job + ContentItem PUBLISHED, URL written back. Returns 'PUBLISHED'.
   * - Transient failure with attempts left: job back to PUBLISH_QUEUED with
   *   lastError, connection untouched, throws TransientPublishError so BullMQ
   *   retries.
   * - Permanent failure, or transient on the final attempt: job, ContentItem
   *   and log marked FAILED. Returns 'FAILED' (does not throw).
   */
  public async processJobAsync(
    jobId: string,
    connectionId: string,
    platform: SocialPlatform,
    payload: PublishPayload,
    attempt: AttemptInfo = SINGLE_ATTEMPT,
  ): Promise<PublishOutcome> {
    const attemptNo = attempt.attemptsMade + 1;
    const isFinalAttempt = attemptNo >= attempt.maxAttempts;

    try {
      const claimed = await this.prisma.socialPublishJob.updateMany({
        where: { id: jobId, status: NOT_CANCELLED },
        data:  { status: 'PUBLISHING' },
      });
      if (claimed.count === 0) throw new JobCancelled();

      await this.appendLog(jobId, 'PUBLISH_ATTEMPT', 'SUCCESS', {
        platform,
        attempt: attemptNo,
        maxAttempts: attempt.maxAttempts,
        payloadLength: payload.body?.length ?? 0,
      });

      if (!payload?.body?.trim()) {
        throw new PermanentPublishError('Nothing to publish: the job payload has no body.', 'INVALID_CONTENT');
      }

      let adapter;
      try {
        adapter = this.adapterFactory.getAdapter(platform);
      } catch (err) {
        if (err instanceof UnsupportedPlatformError) throw new PermanentPublishError(err.message, 'NO_PUBLISHER');
        throw new PermanentPublishError((err as Error).message, 'NO_PUBLISHER');
      }

      const row = await this.prisma.socialConnection.findUnique({
        where: { id: connectionId },
        select: { accountIdentifier: true, platform: true, status: true, metaJson: true },
      });
      if (!row) {
        throw new PermanentPublishError('Social connection no longer exists. Reconnect the account.', 'NO_CONNECTION');
      }
      if (row.status !== 'CONNECTED') {
        throw new PermanentPublishError(
          `${platform} connection is ${row.status}. Reconnect the account in Connections.`,
          row.status === 'REVOKED' ? 'CONNECTION_REVOKED' : 'CONNECTION_EXPIRED',
        );
      }

      // Token: only stored_token adapters need one (Telegram's bot token is env).
      // Refreshes first when the access token is about to expire.
      const tokens = await this.tokenRefresh.ensureFreshToken(connectionId, adapter);
      if (adapter.credential === 'stored_token' && !tokens.accessToken) {
        throw new PermanentPublishError('Social connection token unavailable. Reconnect the account.', 'CONNECTION_EXPIRED');
      }

      const connection: AdapterConnection = {
        id:                connectionId,
        platform,
        accountIdentifier: row.accountIdentifier,
        accessToken:       tokens.accessToken,
        refreshToken:      tokens.refreshToken,
        meta:              (row.metaJson as Record<string, unknown> | null) ?? undefined,
      };

      const enrichedPayload = await this.withArtwork(jobId, payload);

      const health = await adapter.validateConnection(connection);
      if (!health.ok) {
        if (health.reason === 'transient') {
          throw new TransientPublishError(
            health.detail,
            health.retryAfterSec,
            health.retryAfterSec !== undefined || /429/.test(health.detail) ? 'RATE_LIMITED' : 'UNREACHABLE',
          );
        }
        const status = health.reason === 'revoked' ? 'REVOKED' : 'EXPIRED';
        await this.connections.markUnusable(connectionId, status, health.detail);
        const hint = /reconnect/i.test(health.detail) ? '' : ' Reconnect the account in Connections.';
        throw new PermanentPublishError(
          `${platform} connection ${status.toLowerCase()}: ${health.detail}${hint}`,
          status === 'REVOKED' ? 'CONNECTION_REVOKED' : 'CONNECTION_EXPIRED',
        );
      }

      // Last point where Cancel can still stop the post from going out.
      const current = await this.prisma.socialPublishJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!current || current.status === 'CANCELLED') throw new JobCancelled();

      const result = await adapter.publish(connection, enrichedPayload);

      if (!result.success) {
        const message = result.error ?? 'Unknown publish error';
        const code = result.failureCode ?? 'PLATFORM_ERROR';
        if (result.retryable) throw new TransientPublishError(message, result.retryAfterSec, code);
        throw new PermanentPublishError(message, code);
      }

      const publishedAt = new Date();
      const published = await this.prisma.socialPublishJob.update({
        where: { id: jobId },
        data:  {
          status:          'PUBLISHED',
          externalPostId:  result.externalPostId ?? null,
          externalPostUrl: result.externalPostUrl ?? null,
          publishedAtUtc:  publishedAt,
          lastError:       null,
        },
      });

      // Close the loop on the content item. The scheduler moves it to
      // PUBLISHING before handing off; without this it stayed there forever.
      if (published.contentItemId) {
        await this.prisma.contentItem.updateMany({
          where: { id: published.contentItemId, status: { in: ['PUBLISHING', 'SCHEDULED'] } },
          data: { status: 'PUBLISHED', publishedAtUtc: publishedAt, failedReason: null },
        });
      }

      await this.appendLog(jobId, 'PUBLISH_SUCCESS', 'SUCCESS', {
        externalPostId:  result.externalPostId,
        externalPostUrl: result.externalPostUrl,
      });

      this.logger.log(`Job ${jobId} published successfully on ${platform}`);
      return 'PUBLISHED';
    } catch (err: unknown) {
      if (err instanceof JobCancelled) {
        this.logger.log(`Job ${jobId} was cancelled; attempt ${attemptNo} stopped before publishing.`);
        return 'CANCELLED';
      }
      const transient = err instanceof TransientPublishError;
      const code: PublishFailureCode =
        err instanceof TransientPublishError || err instanceof PermanentPublishError ? err.code : 'PLATFORM_ERROR';
      // Stored and shown: "[CODE] detail" so the UI can localise on the code.
      const message = formatFailure(code, err instanceof Error ? err.message : String(err));

      if (transient && !isFinalAttempt) {
        // Not the user's problem yet: keep the item PUBLISHING and the
        // connection as it is, record why, and let BullMQ try again.
        const requeued = await this.prisma.socialPublishJob.updateMany({
          where: { id: jobId, status: NOT_CANCELLED },
          data:  { status: 'PUBLISH_QUEUED', lastError: message },
        });
        if (requeued.count === 0) return 'CANCELLED'; // cancelled mid-attempt: no retry
        await this.appendLog(jobId, 'PUBLISH_RETRY_SCHEDULED', 'FAILURE', {
          attempt: attemptNo,
          maxAttempts: attempt.maxAttempts,
          retryAfterSec: (err as TransientPublishError).retryAfterSec,
        }, message);
        this.logger.warn(`Job ${jobId} attempt ${attemptNo}/${attempt.maxAttempts} failed (will retry): ${message}`);
        throw err;
      }

      if (!(await this.recordFailure(jobId, message))) return 'CANCELLED';
      this.logger.error(`Job ${jobId} failed${transient ? ' after the final attempt' : ''}: ${message}`);
      return 'FAILED';
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Job FAILED + ContentItem FAILED + failure log. Returns false (and writes
   * nothing) when the job was cancelled meanwhile.
   */
  private async recordFailure(jobId: string, message: string): Promise<boolean> {
    const { count } = await this.prisma.socialPublishJob.updateMany({
      where: { id: jobId, status: NOT_CANCELLED },
      data:  { status: 'FAILED', lastError: message },
    });
    if (count === 0) return false;
    const failed = await this.prisma.socialPublishJob.findUnique({
      where: { id: jobId },
      select: { contentItemId: true },
    });

    await this.appendLog(jobId, 'PUBLISH_FAILURE', 'FAILURE', undefined, message);

    // Release the content item too, otherwise it sits in PUBLISHING and is
    // invisible to both the scheduler and the user.
    if (failed?.contentItemId) {
      await this.prisma.contentItem.updateMany({
        where: { id: failed.contentItemId, status: 'PUBLISHING' },
        data: { status: 'FAILED', failedReason: message },
      });
    }
    return true;
  }

  /**
   * Artwork is loaded here rather than carried in the job payload: the
   * payload travels through the queue as JSON, and image bytes do not belong
   * in it. Never lets an artwork lookup stop a publish.
   */
  private async withArtwork(jobId: string, payload: PublishPayload): Promise<PublishPayload> {
    const enriched: PublishPayload = { ...payload };
    try {
      const job = await this.prisma.socialPublishJob.findUnique({
        where: { id: jobId },
        select: { contentItemId: true },
      });
      if (job?.contentItemId) {
        const image = await this.prisma.contentImage.findFirst({
          where: { contentItemId: job.contentItemId },
          orderBy: { createdAt: 'desc' },
        });
        if (image?.data) {
          enriched.image = {
            data: Buffer.from(image.data),
            mimeType: image.mimeType || 'image/png',
            altText: image.altText ?? undefined,
          };
        }
      }
    } catch (imageErr) {
      this.logger.warn(`Could not load artwork for job=${jobId}: ${(imageErr as Error).message}`);
    }
    return enriched;
  }

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

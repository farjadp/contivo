/**
 * publish-job-runner.ts
 *
 * The body of the BullMQ publish worker, kept free of the Redis connection so
 * it can be tested on its own.
 *
 * Retry rules (bullmq 5.71.0, job.js:484-488): a failed job is retried when
 * `attemptsMade + 1 < opts.attempts` and the error is not UnrecoverableError.
 * `attemptsMade` counts attempts finished before the current one, so the
 * current attempt is final when `attemptsMade + 1 >= attempts`.
 */

import { UnrecoverableError, type Job } from 'bullmq';

import type { BaseJobPayload } from '../jobs/jobs.constants';

import { TransientPublishError } from './publish-errors';
import type { SocialPublishService } from './social-publish.service';

/** Backoff type name used in JobsService.enqueuePublish. */
export const PUBLISH_BACKOFF = 'publish';
const BASE_DELAY_MS = 2000;

/**
 * Custom backoff: the platform's Retry-After when it sent one, else
 * exponential 2 s, 4 s, 8 s (what `{type:'exponential', delay:2000}` gave).
 */
export function publishBackoff(attemptsMade: number, _type: string | undefined, err: Error | undefined): number {
  if (err instanceof TransientPublishError && err.retryAfterSec && err.retryAfterSec > 0) {
    return err.retryAfterSec * 1000;
  }
  return Math.round(Math.pow(2, Math.max(0, attemptsMade - 1)) * BASE_DELAY_MS);
}

interface Deps {
  prisma: { socialPublishJob: { findUnique(args: { where: { id: string } }): Promise<any> } };
  publishService: Pick<SocialPublishService, 'processJobAsync'>;
}

export async function runPublishJob(job: Job<BaseJobPayload>, deps: Deps) {
  const record = await deps.prisma.socialPublishJob.findUnique({ where: { id: job.data.jobRecordId } });
  if (!record) {
    throw new UnrecoverableError(`Publish job record ${job.data.jobRecordId} not found in DB`);
  }

  if (record.status === 'PUBLISHED' || record.status === 'CANCELLED') {
    return { success: record.status === 'PUBLISHED', skipped: true };
  }

  // A missing body is recorded as a FAILED job by the service, not left queued.
  const payload = job.data.metadata ?? { body: '' };

  // Throws TransientPublishError when a retry is wanted; BullMQ handles it.
  const outcome = await deps.publishService.processJobAsync(
    record.id,
    record.socialConnectionId,
    record.platform,
    payload,
    { attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts ?? 1 },
  );

  if (outcome === 'CANCELLED') return { success: false, cancelled: true };

  if (outcome === 'FAILED') {
    // Already recorded in the DB. Fail the BullMQ job too (visible in Bull
    // Board) without burning the remaining attempts.
    const failed = await deps.prisma.socialPublishJob.findUnique({ where: { id: record.id } });
    throw new UnrecoverableError(failed?.lastError ?? 'Publish failed');
  }
  return { success: true };
}

import { Module } from '@nestjs/common';

/**
 * JobsModule
 *
 * Sets up BullMQ queues and registers worker processors.
 *
 * Queue definitions:
 *   - contivo:content:fast  (instant content — high priority)
 *   - contivo:crawl         (website crawl — medium priority)
 *   - contivo:analysis      (AI brand analysis — medium)
 *   - contivo:strategy      (full strategy generation — low)
 *
 * TODO:
 *   1. Install BullMQ: pnpm add bullmq ioredis
 *   2. Create queue tokens and inject via NestJS custom providers
 *   3. Create processor classes annotated with @Processor('queue-name')
 *   4. Register processors here as providers
 *
 * Pattern for queue injection:
 *   const queue = new Queue('contivo:content:fast', { connection: redisConnection });
 *   providers: [{ provide: CONTENT_FAST_QUEUE, useValue: queue }]
 *
 * All jobs must follow the BaseJobPayload shape:
 *   { userId, workspaceId?, jobRecordId, traceId }
 *
 * Pre-create a ContentJob DB record BEFORE enqueuing so clients can poll status.
 */
@Module({})
export class JobsModule {}

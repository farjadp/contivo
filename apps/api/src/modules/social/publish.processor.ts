import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';

import { PrismaService } from '../../common/prisma/prisma.service';
import { redisConnection } from '../jobs/bull-board.provider';
import { QUEUES, BaseJobPayload } from '../jobs/jobs.constants';

import { publishBackoff, runPublishJob } from './publish-job-runner';
import { SocialPublishService } from './social-publish.service';

@Injectable()
export class PublishProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublishProcessor.name);
  private worker!: Worker;

  constructor(
    private readonly publishService: SocialPublishService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUES.PUBLISH,
      async (job: Job<BaseJobPayload>) => {
        const traceId = job.data.traceId || job.data.jobRecordId;
        const attempts = job.opts.attempts ?? 1;
        this.logger.log(
          `[TraceID: ${traceId}] Publish job ${job.data.jobRecordId} attempt ${job.attemptsMade + 1}/${attempts} (bull id ${job.id})`,
        );
        const result = await runPublishJob(job, { prisma: this.prisma, publishService: this.publishService });
        this.logger.log(`[TraceID: ${traceId}] Publish job ${job.data.jobRecordId} done: ${JSON.stringify(result)}`);
        return result;
      },
      {
        connection: redisConnection,
        // Used by the 'publish' backoff type set in JobsService.enqueuePublish.
        settings: { backoffStrategy: publishBackoff },
      },
    );

    this.worker.on('failed', (job, err) => {
      const traceId = job?.data?.traceId || job?.data?.jobRecordId || 'unknown';
      this.logger.error(
        `[TraceID: ${traceId}] BullMQ job ${job?.id} attemptsMade=${job?.attemptsMade} failed: ${err.message}`,
      );
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}

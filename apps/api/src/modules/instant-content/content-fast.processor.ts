import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { QUEUES, BaseJobPayload } from '../jobs/jobs.constants';
import { redisConnection } from '../jobs/bull-board.provider';
import { InstantContentService } from './instant-content.service';

@Injectable()
export class ContentFastProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContentFastProcessor.name);
  private worker!: Worker;

  constructor(private readonly service: InstantContentService) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUES.CONTENT_FAST,
      async (job: Job<BaseJobPayload>) => {
        const traceId = job.data.traceId || job.data.jobRecordId;
        this.logger.log(`[TraceID: ${traceId}] Processing fast content job ${job.data.jobRecordId} for user ${job.data.userId}`);
        
        try {
          await this.service.executeJob(job.data.jobRecordId);
          this.logger.log(`[TraceID: ${traceId}] Completed fast content job ${job.data.jobRecordId}`);
          return { success: true };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.logger.error(`[TraceID: ${traceId}] Failed fast content job ${job.data.jobRecordId}: ${errMsg}`);
          throw error;
        }
      },
      { connection: redisConnection },
    );

    this.worker.on('failed', (job, err) => {
      const traceId = job?.data?.traceId || job?.data?.jobRecordId || 'unknown';
      this.logger.error(`[TraceID: ${traceId}] BullMQ Job ${job?.id} failed with error: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}

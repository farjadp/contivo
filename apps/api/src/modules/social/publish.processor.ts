import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { QUEUES, BaseJobPayload } from '../jobs/jobs.constants';
import { redisConnection } from '../jobs/bull-board.provider';
import { SocialPublishService } from './social-publish.service';
import { PrismaService } from '../../common/prisma/prisma.service';

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
        this.logger.log(`[TraceID: ${traceId}] Started publish job for ${job.data.jobRecordId} (User: ${job.data.userId})`);
        
        // 1. Fetch job record from DB
        const record = await this.prisma.socialPublishJob.findUnique({
          where: { id: job.data.jobRecordId },
        });

        if (!record) {
          this.logger.error(`[TraceID: ${traceId}] Publish job record ${job.data.jobRecordId} not found.`);
          throw new Error('Publish job record not found in DB');
        }

        if (record.status === 'PUBLISHED') {
          this.logger.log(`[TraceID: ${traceId}] Publish job ${job.data.jobRecordId} is already PUBLISHED. Skipping.`);
          return { success: true, skipped: true };
        }

        // 2. Call the publish service
        try {
          // payload should be passed down via metadata
          const payload = job.data.metadata || { body: '' };
          await this.publishService.processJobAsync(record.id, record.socialConnectionId, record.platform as any, payload);
          this.logger.log(`[TraceID: ${traceId}] Succeeded publish job ${job.data.jobRecordId}`);
          return { success: true };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.logger.error(`[TraceID: ${traceId}] Failed publish job ${job.data.jobRecordId}: ${errMsg}`);
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

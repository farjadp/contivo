import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { QUEUES, BaseJobPayload } from '../jobs/jobs.constants';
import { redisConnection } from '../jobs/bull-board.provider';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class CrawlProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrawlProcessor.name);
  private worker!: Worker;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.worker = new Worker(
      QUEUES.CRAWL,
      async (job: Job<BaseJobPayload>) => {
        const traceId = job.data.traceId || job.data.jobRecordId;
        const workspaceId = job.data.jobRecordId;
        
        this.logger.log(`[TraceID: ${traceId}] Started crawl job for workspace ${workspaceId} (User: ${job.data.userId})`);

        try {
          const workspace = await this.prisma.workspace.findUnique({
            where: { id: workspaceId },
          });

          if (!workspace) {
            throw new Error(`Workspace ${workspaceId} not found`);
          }

          // Mark as crawling if it's currently PENDING
          if (workspace.status === 'PENDING') {
            await this.prisma.workspace.update({
              where: { id: workspaceId },
              data: { status: 'CRAWLING' },
            });
          }

          // STUB: Simulate deep crawling logic
          this.logger.log(`[TraceID: ${traceId}] Crawling website ${workspace.websiteUrl || 'unknown'}...`);
          await new Promise((resolve) => setTimeout(resolve, 5000));

          // Mark as READY
          await this.prisma.workspace.update({
            where: { id: workspaceId },
            data: { status: 'READY' },
          });

          this.logger.log(`[TraceID: ${traceId}] Succeeded crawl job for workspace ${workspaceId}`);
          return { success: true };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          this.logger.error(`[TraceID: ${traceId}] Failed crawl job for workspace ${workspaceId}: ${errMsg}`);
          
          await this.prisma.workspace.update({
            where: { id: workspaceId },
            data: { status: 'ERROR' },
          }).catch(e => this.logger.error(`Failed to update workspace status to ERROR: ${e}`));
          
          throw error; // Let BullMQ handle retries
        }
      },
      { connection: redisConnection as any },
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

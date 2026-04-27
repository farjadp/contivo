import { Injectable, Logger, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUES, BaseJobPayload } from './jobs.constants';

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @Inject(QUEUES.CONTENT_FAST) private readonly contentFastQueue: Queue,
    @Inject(QUEUES.CRAWL) private readonly crawlQueue: Queue,
    @Inject(QUEUES.ANALYSIS) private readonly analysisQueue: Queue,
    @Inject(QUEUES.STRATEGY) private readonly strategyQueue: Queue,
    @Inject(QUEUES.PUBLISH) private readonly publishQueue: Queue,
    @Inject(QUEUES.BILLING) private readonly billingQueue: Queue,
  ) {}

  async enqueueContentFast(payload: BaseJobPayload) {
    this.logger.log(`Enqueueing fast content job for ${payload.jobRecordId}`);
    return this.contentFastQueue.add('generate', payload, {
      jobId: payload.jobRecordId, // guarantees uniqueness/idempotency per job record
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }

  async enqueueCrawl(payload: BaseJobPayload) {
    this.logger.log(`Enqueueing crawl job for ${payload.jobRecordId}`);
    return this.crawlQueue.add('crawl', payload, {
      jobId: payload.jobRecordId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
    });
  }

  async enqueuePublish(payload: BaseJobPayload, delayMs = 0) {
    this.logger.log(`Enqueueing publish job for ${payload.jobRecordId}`);
    return this.publishQueue.add('publish', payload, {
      jobId: payload.jobRecordId,
      delay: delayMs,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  async enqueueAnalysis(payload: BaseJobPayload) {
    this.logger.log(`Enqueueing analysis job for ${payload.jobRecordId}`);
    return this.analysisQueue.add('analyze', payload, {
      jobId: payload.jobRecordId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  async enqueueStrategy(payload: BaseJobPayload) {
    this.logger.log(`Enqueueing strategy job for ${payload.jobRecordId}`);
    return this.strategyQueue.add('strategy', payload, {
      jobId: payload.jobRecordId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }

  async enqueueBilling(payload: BaseJobPayload) {
    this.logger.log(`Enqueueing billing job for ${payload.jobRecordId}`);
    return this.billingQueue.add('bill', payload, {
      jobId: payload.jobRecordId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  }
}

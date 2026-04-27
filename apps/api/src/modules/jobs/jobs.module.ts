import { Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUES } from './jobs.constants';
import { redisConnection } from './bull-board.provider';
import { JobsService } from './jobs.service';

// Provide queue abstractions directly so they can be injected by controllers/services
const queueProviders = Object.values(QUEUES).map((queueName) => ({
  provide: queueName,
  useValue: new Queue(queueName, { connection: redisConnection }),
}));

@Module({
  providers: [
    ...queueProviders,
    JobsService,
    // Add additional processors here
  ],
  exports: [JobsService, ...queueProviders.map((q) => q.provide)],
})
export class JobsModule {}

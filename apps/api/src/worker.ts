/**
 * Worker entry point.
 *
 * Bootstraps the NestJS application in worker-only mode:
 * - No HTTP listener
 * - Only registers modules needed for background job processing
 *
 * Run via: WORKER_MODE=true node dist/worker
 * Or:       pnpm start:worker
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  await app.init();
  Logger.log('⚙️  Contivo Worker running — listening for jobs', 'Worker');

  // Worker stays alive indefinitely (process kept running by BullMQ connections)
}

bootstrap();

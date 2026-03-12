import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug'],
    // Required for Stripe webhook signature verification (raw body needed)
    rawBody: true,
  });

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: [
      process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    ],
    credentials: true,
  });

  const port = Number(process.env.API_PORT || process.env.PORT || 3001);
  await app.listen(port);

  Logger.log(`🚀 API running → http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`📋 Health       → http://localhost:${port}/api/v1/health`, 'Bootstrap');
}

bootstrap();

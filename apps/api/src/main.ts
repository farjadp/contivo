// Must be first: the SDK patches the runtime before anything else loads.
// `import/order` wants this below ./app.module, which would import the app —
// and every library it pulls in — before Sentry has patched anything, leaving
// instrumentation silently attached to nothing. The rule is wrong here, so it
// is disabled for this line rather than obeyed.
// eslint-disable-next-line import/order
import { sentryEnabled } from './instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

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
  Logger.log(
    sentryEnabled
      ? 'Error reporting is on.'
      : 'Error reporting is OFF — SENTRY_DSN is unset or still a placeholder.',
    'Bootstrap',
  );
  Logger.log(`📋 Health       → http://localhost:${port}/api/v1/health`, 'Bootstrap');
}

bootstrap();

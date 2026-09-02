import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './common/prisma/prisma.module';
import { AIModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CreditsModule } from './modules/credits/credits.module';
import { CronModule } from './modules/cron/cron.module';
import { HealthModule } from './modules/health/health.module';
import { InstantContentModule } from './modules/instant-content/instant-content.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { SocialModule } from './modules/social/social.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

@Module({
  imports: [
    // Config — loads .env, validates at startup
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Infrastructure
    PrismaModule,
    JobsModule,
    AIModule,
    CreditsModule,
    CronModule,

    // Auth
    AuthModule,

    // Domain modules
    HealthModule,
    UsersModule,
    WorkspacesModule,
    InstantContentModule,
    BillingModule,
    SocialModule,
  ],
})
export class AppModule {}

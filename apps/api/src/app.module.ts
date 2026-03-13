import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { PrismaModule } from './common/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { InstantContentModule } from './modules/instant-content/instant-content.module';
import { AIModule } from './modules/ai/ai.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { BillingModule } from './modules/billing/billing.module';
import { CreditsModule } from './modules/credits/credits.module';
import { SocialModule } from './modules/social/social.module';

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

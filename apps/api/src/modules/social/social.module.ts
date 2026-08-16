/**
 * social.module.ts
 *
 * NestJS module that bundles all social publishing functionality:
 *   - Platform adapters (LinkedIn, X, Facebook, Instagram)
 *   - AdapterFactory for platform → adapter resolution
 *   - SocialConnectionsService (CRUD + token encryption)
 *   - SocialPublishService (job orchestration + async execution)
 *   - SocialOAuthService / SocialOAuthController (OAuth 2.0 flow)
 *   - REST controllers
 */

import { Module } from '@nestjs/common';

import { PrismaModule } from '../../common/prisma/prisma.module';
import { JobsModule } from '../jobs/jobs.module';

// Controllers
import { AdapterFactory } from './adapters/adapter.factory';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { LinkedInAdapter } from './adapters/linkedin.adapter';
import { TikTokAdapter } from './adapters/tiktok.adapter';
import { XAdapter } from './adapters/x.adapter';
import { PublishProcessor } from './publish.processor';
import { SocialConnectionsController } from './social-connections.controller';
import { SocialConnectionsService } from './social-connections.service';
import { SocialOAuthController } from './social-oauth.controller';
import { SocialOAuthService } from './social-oauth.service';
import { SocialPublishController } from './social-publish.controller';
import { SocialPublishService } from './social-publish.service';
import { SocialSchedulerService } from './social-scheduler.service';

@Module({
  imports: [PrismaModule, JobsModule],
  controllers: [
    SocialConnectionsController,
    SocialPublishController,
    SocialOAuthController,
  ],
  providers: [
    // Services
    SocialConnectionsService,
    SocialPublishService,
    SocialOAuthService,
    SocialSchedulerService,

    // Processors
    PublishProcessor,

    // Adapters (all injectable singletons)
    LinkedInAdapter,
    XAdapter,
    FacebookAdapter,
    InstagramAdapter,
    TikTokAdapter,
    AdapterFactory,
  ],
  exports: [
    SocialConnectionsService,
    SocialPublishService,
    SocialOAuthService,
  ],
})
export class SocialModule {}


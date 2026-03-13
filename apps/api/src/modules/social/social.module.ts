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

// Controllers
import { SocialConnectionsController } from './social-connections.controller';
import { SocialPublishController } from './social-publish.controller';
import { SocialOAuthController } from './social-oauth.controller';

// Services
import { SocialConnectionsService } from './social-connections.service';
import { SocialPublishService } from './social-publish.service';
import { SocialOAuthService } from './social-oauth.service';
import { SocialSchedulerService } from './social-scheduler.service';

// Adapters
import { LinkedInAdapter } from './adapters/linkedin.adapter';
import { XAdapter } from './adapters/x.adapter';
import { FacebookAdapter } from './adapters/facebook.adapter';
import { InstagramAdapter } from './adapters/instagram.adapter';
import { TikTokAdapter } from './adapters/tiktok.adapter';
import { AdapterFactory } from './adapters/adapter.factory';

@Module({
  imports: [PrismaModule],
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


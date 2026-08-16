import { Module } from '@nestjs/common';

import { AIModule } from '../ai/ai.module';
import { CreditsModule } from '../credits/credits.module';

import { ContentFastProcessor } from './content-fast.processor';
import { InstantContentController } from './instant-content.controller';
import { InstantContentService } from './instant-content.service';

@Module({
  imports: [AIModule, CreditsModule],
  controllers: [InstantContentController],
  providers: [InstantContentService, ContentFastProcessor],
})
export class InstantContentModule {}

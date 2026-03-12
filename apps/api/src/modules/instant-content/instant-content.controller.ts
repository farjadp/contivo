import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { GenerateInstantContentRequest } from '@contivo/types';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InstantContentService } from './instant-content.service';

@Controller('instant-content')
export class InstantContentController {
  constructor(private readonly service: InstantContentService) {}

  /**
   * POST /api/v1/instant-content/generate
   *
   * Body is validated against the shared Zod schema.
   * userId is hardcoded to the seeded dev user for this slice.
   * Replace with @CurrentUser() decorator once ClerkAuthGuard is wired.
   */
  @Post('generate')
  generate(
    @Body(new ZodValidationPipe(GenerateInstantContentRequest))
    body: GenerateInstantContentRequest,
  ) {
    // TODO: replace with real userId from Clerk JWT once AuthModule guard is active
    const userId = process.env.DEV_USER_ID ?? 'seed-dev-user';
    return this.service.generate(userId, body);
  }

  /**
   * GET /api/v1/instant-content/history
   * Returns the most recent generated content items for the dev user.
   */
  @Get('history')
  history(@Query('limit') limit?: string) {
    const userId = process.env.DEV_USER_ID ?? 'seed-dev-user';
    return this.service.getHistory(userId, parseInt(limit ?? '20', 10));
  }
}

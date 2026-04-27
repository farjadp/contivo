import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { GenerateInstantContentRequest } from '@contivo/types';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { InstantContentService } from './instant-content.service';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('instant-content')
export class InstantContentController {
  constructor(private readonly service: InstantContentService) {}

  /**
   * POST /api/v1/instant-content/generate
   *
   * Body is validated against the shared Zod schema.
   */
  @Post('generate')
  generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(GenerateInstantContentRequest))
    body: GenerateInstantContentRequest,
  ) {
    return this.service.generate(user.id, body);
  }

  /**
   * GET /api/v1/instant-content/history
   * Returns the most recent generated content items for the current user.
   */
  @Get('history')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ) {
    return this.service.getHistory(user.id, parseInt(limit ?? '20', 10));
  }
}

import { Controller, Get } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { GetBalanceResponse } from '@contivo/types';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@Controller('credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('balance')
  async getBalance(@CurrentUser() user: AuthenticatedUser): Promise<GetBalanceResponse> {
    const balance = await this.creditsService.getBalance(user.id);
    return { balance };
  }
}

import { Controller, Get } from '@nestjs/common';
import { CreditsService } from './credits.service';
import { GetBalanceResponse } from '@contivo/types';

@Controller('credits')
export class CreditsController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('balance')
  async getBalance(): Promise<GetBalanceResponse> {
    // Note: Use proper Clerk auth guards in production.
    // Defaulting to seeded user if auth token is not supplied contextually.
    const userId = 'local-dev-id'; 
    const balance = await this.creditsService.getBalance(userId);
    return { balance };
  }
}

import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

type CreditFeature =
  | 'INSTANT_CONTENT'
  | 'STRATEGY_RUN'
  | 'ARTICLE_DRAFT'
  | 'WEBSITE_CRAWL'
  | 'ALLOCATION'
  | 'TOP_UP'
  | 'REFUND';

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return the current credit balance for a user.
   * Balance = SUM of all ledger rows (positive = credits in, negative = credits out).
   */
  async getBalance(userId: string): Promise<number> {
    const result = await this.prisma.creditLedger.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  /**
   * Check that a user has sufficient credits.
   * Throws 402 Payment Required if insufficient.
   */
  async checkBalance(userId: string, required: number): Promise<void> {
    const balance = await this.getBalance(userId);
    if (balance < required) {
      throw new HttpException(
        {
          code: 'INSUFFICIENT_CREDITS',
          message: `Insufficient credits. You have ${balance} credits but this action requires ${required}.`,
          balance,
          required,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Deduct credits from user's balance via an append-only ledger row.
   * Returns the new balance after deduction.
   */
  async deduct(userId: string, amount: number, feature: CreditFeature, jobId?: string): Promise<number> {
    const currentBalance = await this.getBalance(userId);
    const balanceAfter = currentBalance - amount;

    await this.prisma.creditLedger.create({
      data: {
        userId,
        type: 'CONSUMPTION',
        feature,
        amount: -amount,          // negative = consumption
        balanceAfter,
        jobId: jobId ?? null,
      },
    });

    this.logger.log(`Deducted ${amount} credits from user ${userId} for ${feature}. Balance: ${balanceAfter}`);
    return balanceAfter;
  }

  /**
   * Allocate credits to a user (monthly allocation, top-up, or refund).
   * Returns the new balance after allocation.
   */
  async allocate(
    userId: string,
    amount: number,
    type: 'ALLOCATION' | 'TOP_UP' | 'REFUND',
  ): Promise<number> {
    const currentBalance = await this.getBalance(userId);
    const balanceAfter = currentBalance + amount;

    await this.prisma.creditLedger.create({
      data: {
        userId,
        type,
        feature: type,
        amount,                   // positive = credit in
        balanceAfter,
        jobId: null,
      },
    });

    this.logger.log(`Allocated ${amount} credits to user ${userId} (${type}). Balance: ${balanceAfter}`);
    return balanceAfter;
  }
}

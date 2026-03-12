import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  type GenerateInstantContentRequest,
  type GenerateInstantContentResponse,
} from '@contivo/types';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AIService } from '../ai/ai.service';
import { CreditsService } from '../credits/credits.service';

// Channel → ContentType mapping
const CHANNEL_TYPE_MAP: Record<string, string> = {
  linkedin: 'POST',
  twitter: 'THREAD',
  instagram: 'CAPTION',
  email: 'EMAIL',
  blog: 'OUTLINE',
};

@Injectable()
export class InstantContentService {
  private readonly logger = new Logger(InstantContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AIService,
    private readonly credits: CreditsService,
  ) {}

  async generate(
    userId: string,
    input: GenerateInstantContentRequest,
  ): Promise<GenerateInstantContentResponse> {
    // 1. Ensure user exists in DB (resolve seeded dev user by clerkId fallback)
    const user = await this.resolveUser(userId);

    // 2. Check credits (cost is 5 per instant generation)
    const requiredCredits = 5;
    await this.credits.checkBalance(user.id, requiredCredits);

    // 2. Pre-create a ContentJob record so status is trackable
    const job = await this.prisma.contentJob.create({
      data: {
        userId: user.id,
        type: 'INSTANT_CONTENT',
        status: 'RUNNING',
        inputPayload: { topic: input.topic, channel: input.channel, tone: input.tone ?? null },
        creditsCost: 0, // updated after AI call
      },
    });

    try {
      // 3. Call AI service (mock for now, real OpenAI drop-in ready)
      const aiResult = await this.ai.generateInstantContent(input);

      // 4. Persist the generated ContentItem
      const contentItem = await this.prisma.contentItem.create({
        data: {
          userId: user.id,
          type: CHANNEL_TYPE_MAP[input.channel] as any,
          channel: input.channel as any,
          tone: (input.tone ?? null) as any,
          topic: input.topic,
          content: aiResult.content,
          status: 'GENERATED',
          creditsCost: aiResult.creditsCost,
          jobId: job.id,
        },
      });

      // 5. Mark the job as completed
      await this.prisma.contentJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          outputPayload: { contentItemId: contentItem.id, model: aiResult.model },
          creditsCost: aiResult.creditsCost,
          completedAt: new Date(),
        },
      });

      this.logger.log(
        `InstantContent generated: user=${user.id} channel=${input.channel} credits=${aiResult.creditsCost}`,
      );

      // 6. Deduct credits
      const balanceAfter = await this.credits.deduct(
        user.id,
        requiredCredits,
        'INSTANT_CONTENT',
        job.id,
      );

      // 7. Return typed response
      return {
        contentItem: {
          id: contentItem.id,
          userId: contentItem.userId,
          workspaceId: contentItem.workspaceId,
          type: contentItem.type as any,
          channel: contentItem.channel as any,
          tone: (contentItem.tone ?? null) as any,
          topic: contentItem.topic,
          content: contentItem.content,
          status: contentItem.status as any,
          creditsCost: requiredCredits,
          jobId: contentItem.jobId,
          createdAt: contentItem.createdAt,
          updatedAt: contentItem.updatedAt,
        },
        creditsUsed: requiredCredits,
        creditsRemaining: balanceAfter,
      };
    } catch (err) {
      // Mark job as failed and rethrow
      await this.prisma.contentJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: err instanceof Error ? err.message : 'Unknown error',
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  async getHistory(userId: string, limit = 20) {
    const user = await this.resolveUser(userId);

    const items = await this.prisma.contentItem.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
    });

    return { items, total: items.length };
  }

  /**
   * Resolve user by clerkId or raw cuid.
   * Falls back to the seeded dev user for local development.
   */
  private async resolveUser(userId: string) {
    // Try clerkId first, then direct id
    let user = await this.prisma.user.findFirst({
      where: { OR: [{ clerkId: userId }, { id: userId }] },
    });

    // In local dev with no auth, fall back to the seeded dev user
    if (!user) {
      user = await this.prisma.user.findUnique({ where: { email: 'dev@contivo.app' } });
    }

    if (!user) {
      throw new NotFoundException(
        `User not found. Make sure you have run: pnpm db:seed`,
      );
    }

    return user;
  }
}

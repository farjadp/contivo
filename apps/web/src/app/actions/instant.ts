'use server';

/**
 * Instant Content — the "Fast Track" branch of onboarding.
 *
 * This used to run in the browser: `instant-form.tsx` called the Nest API
 * directly with `token = undefined`, so every request hit the Clerk guard and
 * came back 401 — verified against production. The user only ever saw
 * "Something went wrong. Please try again." On top of that the API's
 * `AIService` is a deterministic mock, so even an authenticated call would
 * have returned placeholder text rather than a generated post.
 *
 * It now runs here, as a server action: the session is already known, and the
 * generation goes through the same real Gemini/OpenAI path as the rest of the
 * product.
 */

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { generateInstantDraft } from '@/lib/gemini';
import {
  INSTANT_CONTENT_COST,
  InsufficientCreditsError,
  assertCredits,
  deductCredits,
  ensureWelcomeCredits,
  getCreditBalance,
} from '@/lib/credits';
import { writeActivityLog } from '@/lib/activity-log';

const CHANNEL_TYPE: Record<string, 'POST' | 'THREAD' | 'CAPTION' | 'EMAIL' | 'OUTLINE'> = {
  linkedin: 'POST',
  twitter: 'THREAD',
  instagram: 'CAPTION',
  email: 'EMAIL',
  blog: 'OUTLINE',
};

const TONES = ['professional', 'friendly', 'bold', 'educational', 'persuasive'] as const;

export type InstantContentResult =
  | {
      ok: true;
      item: { id: string; topic: string; channel: string; content: string; createdAt: string };
      creditsRemaining: number;
    }
  | { ok: false; error: string; code?: 'INSUFFICIENT_CREDITS' | 'PROVIDER_UNAVAILABLE' };

export async function generateInstantContentAction(input: {
  topic: string;
  channel: string;
  tone?: string;
}): Promise<InstantContentResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Your session has expired. Please sign in again.' };

  const userId = session.userId as string;
  const topic = String(input.topic ?? '').trim();
  const channel = String(input.channel ?? '').toLowerCase();
  const tone = TONES.includes(input.tone as never) ? (input.tone as string) : 'professional';

  if (topic.length < 3) return { ok: false, error: 'Give the topic a bit more to work with.' };
  if (topic.length > 500) return { ok: false, error: 'That topic is too long — keep it under 500 characters.' };
  if (!(channel in CHANNEL_TYPE)) return { ok: false, error: `Unsupported channel: ${input.channel}` };

  const cost = INSTANT_CONTENT_COST[channel] ?? 5;

  await ensureWelcomeCredits(userId);
  try {
    await assertCredits(userId, cost);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return {
        ok: false,
        code: 'INSUFFICIENT_CREDITS',
        error: `You have ${err.balance} credits left and this needs ${err.required}.`,
      };
    }
    throw err;
  }

  const job = await prisma.contentJob.create({
    data: {
      userId,
      type: 'INSTANT_CONTENT',
      status: 'RUNNING',
      inputPayload: { topic, channel, tone },
      creditsCost: 0,
    },
  });

  const draft = await generateInstantDraft({ topic, channel, tone });

  // Both providers failed. Fail loudly and do not charge — the previous
  // behaviour elsewhere in the codebase was to write heuristic filler and
  // bill for it as if it were generated.
  if (!draft) {
    await prisma.contentJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', errorMessage: 'No AI provider returned content', completedAt: new Date() },
    });
    return {
      ok: false,
      code: 'PROVIDER_UNAVAILABLE',
      error: 'Both AI providers are unavailable right now. Nothing was charged — try again in a minute.',
    };
  }

  const item = await prisma.contentItem.create({
    data: {
      userId,
      type: CHANNEL_TYPE[channel],
      channel: channel as never,
      tone: tone as never,
      topic,
      content: draft.content,
      status: 'GENERATED',
      creditsCost: cost,
      jobId: job.id,
    },
  });

  const creditsRemaining = await deductCredits(userId, cost, 'INSTANT_CONTENT', job.id);

  await prisma.contentJob.update({
    where: { id: job.id },
    data: {
      status: 'COMPLETED',
      outputPayload: { contentItemId: item.id, provider: draft.provider },
      creditsCost: cost,
      completedAt: new Date(),
    },
  });

  await writeActivityLog({
    userId,
    workspaceId: null,
    action: 'INSTANT_CONTENT_GENERATED',
    detail: { contentItemId: item.id, channel, tone, provider: draft.provider, creditsCost: cost },
  });

  return {
    ok: true,
    item: {
      id: item.id,
      topic: item.topic,
      channel: String(item.channel),
      content: item.content,
      createdAt: item.createdAt.toISOString(),
    },
    creditsRemaining,
  };
}

/** Balance for the header widget. Grants the welcome credits on first read. */
export async function getCreditBalanceAction(): Promise<{ balance: number } | { error: string }> {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  const userId = session.userId as string;
  await ensureWelcomeCredits(userId);
  return { balance: await getCreditBalance(userId) };
}

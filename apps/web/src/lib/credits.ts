/**
 * credits.ts — credit balance and ledger, read and written from the web app.
 *
 * The Nest `CreditsService` does the same thing, but every browser call to it
 * 401'd (the API sits behind a Clerk guard the cookie session cannot satisfy),
 * so the balance widget silently rendered nothing and Instant Content could
 * never spend. Following the same decision as `social-data.ts`: the web app
 * owns this, straight from Prisma.
 *
 * The ledger is append-only. Balance is the sum of every row: positive rows
 * are credits in, negative rows are consumption.
 */

import { prisma } from '@/lib/db';

/** Credits given to a new account so it can try the product once. */
export const WELCOME_CREDIT_GRANT = 100;

/**
 * What each unattended AI operation costs.
 *
 * Only Instant Content ever spent credits. Autopilot — which runs on a cron
 * with nobody watching and makes roughly five model calls per post, twice that
 * when the quality gate rejects a draft — spent nothing, so the balance was
 * decorative and there was no ceiling on what a workspace could cost.
 *
 * Two operations rather than five, because the run cannot usefully stop
 * halfway through drafting one post: ideation is charged once per channel, and
 * everything that turns one idea into a reviewed draft (draft, humanize pass,
 * image, quality gate) is charged as a single attempt. A rejected draft is
 * charged too — the model calls happened either way, and not charging for them
 * would leave the exact hole this closes.
 */
export const AI_OPERATION_COST = {
  AUTOPILOT_IDEATION: 2,
  AUTOPILOT_DRAFT_ATTEMPT: 7,
} as const;

export type AiOperation = keyof typeof AI_OPERATION_COST;

/** Cost per Instant Content generation, by channel. Mirrors the API's table. */
export const INSTANT_CONTENT_COST: Record<string, number> = {
  linkedin: 5,
  twitter: 5,
  instagram: 4,
  email: 6,
  blog: 5,
};

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly balance: number,
    public readonly required: number,
  ) {
    super(`Insufficient credits. You have ${balance} but this needs ${required}.`);
    this.name = 'InsufficientCreditsError';
  }
}

export async function getCreditBalance(userId: string): Promise<number> {
  const result = await prisma.creditLedger.aggregate({
    where: { userId },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0;
}

/**
 * Gives a new account its welcome credits, once.
 *
 * Nothing ever wrote an ALLOCATION row outside the admin console, so every
 * account — including the live production one — sat at a zero balance and any
 * paid action would have been refused. This is idempotent: it is keyed on the
 * account having no ledger history at all, so it cannot top anyone up twice.
 */
export async function ensureWelcomeCredits(userId: string): Promise<number> {
  const existing = await prisma.creditLedger.count({ where: { userId } });
  if (existing > 0) return getCreditBalance(userId);

  await prisma.creditLedger.create({
    data: {
      userId,
      type: 'ALLOCATION',
      feature: 'ALLOCATION',
      amount: WELCOME_CREDIT_GRANT,
      balanceAfter: WELCOME_CREDIT_GRANT,
    },
  });

  return WELCOME_CREDIT_GRANT;
}

/** Throws `InsufficientCreditsError` when the balance will not cover `required`. */
export async function assertCredits(userId: string, required: number): Promise<number> {
  const balance = await getCreditBalance(userId);
  if (balance < required) throw new InsufficientCreditsError(balance, required);
  return balance;
}

/** Writes a consumption row. Returns the balance after the deduction. */
export async function deductCredits(
  userId: string,
  amount: number,
  feature: string,
  jobId?: string,
): Promise<number> {
  const balanceAfter = (await getCreditBalance(userId)) - amount;

  await prisma.creditLedger.create({
    data: {
      userId,
      type: 'CONSUMPTION',
      feature,
      amount: -amount,
      balanceAfter,
      jobId: jobId ?? null,
    },
  });

  return balanceAfter;
}

/**
 * Charge for one AI operation, refusing when the balance will not cover it.
 *
 * Throws `InsufficientCreditsError`, which callers on an unattended path
 * (Autopilot) should catch and use to stop the run rather than to fail it: an
 * account running out of credits is a normal state, not an error.
 */
export async function chargeCredits(
  userId: string,
  operation: AiOperation,
  jobId?: string,
): Promise<number> {
  const cost = AI_OPERATION_COST[operation];
  await assertCredits(userId, cost);
  return deductCredits(userId, cost, operation, jobId);
}

/** Whether the account could pay for `operation` right now. */
export async function canAfford(userId: string, operation: AiOperation): Promise<boolean> {
  return (await getCreditBalance(userId)) >= AI_OPERATION_COST[operation];
}

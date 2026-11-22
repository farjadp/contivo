/**
 * credit-costs.ts — what AI operations cost, with no database import.
 *
 * Split out of credits.ts so client components (the balance panel's
 * low-balance state) can read the same numbers the runner charges without
 * pulling Prisma into the browser bundle. credits.ts re-exports all of it.
 */

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

/**
 * The least an Autopilot run needs to produce one post: one ideation plus one
 * draft attempt. The runner refuses to start below this, so it is also the
 * line under which the app shows the balance as low.
 */
export const AUTOPILOT_RUN_COST =
  AI_OPERATION_COST.AUTOPILOT_IDEATION + AI_OPERATION_COST.AUTOPILOT_DRAFT_ATTEMPT;

/** True when the balance cannot pay for one Autopilot post. */
export function isLowBalance(balance: number): boolean {
  return balance < AUTOPILOT_RUN_COST;
}

/** One "request more credits" per user per this many hours; later clicks see "already requested". */
export const CREDIT_REQUEST_WINDOW_HOURS = 24;

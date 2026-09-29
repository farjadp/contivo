import type { Prisma } from '@prisma/client';

/**
 * Which competitor rows count toward the competitor totals users and admins
 * see. "Remove from list" sets a row to REJECTED instead of deleting it (so
 * its domain stays excluded from later discovery runs), which means a raw
 * row count would never go down when a user removes a competitor. Totals
 * therefore count every row except REJECTED ones: ACCEPTED, PENDING and
 * undecided (null) rows all count.
 */
export function countsTowardCompetitorTotal(competitor: { userDecision?: string | null }): boolean {
  return competitor.userDecision !== 'REJECTED';
}

export function countCompetitors(competitors: Array<{ userDecision?: string | null }>): number {
  return competitors.filter(countsTowardCompetitorTotal).length;
}

/**
 * The same rule as a Prisma filter, for `_count` selects. Spelled as an OR
 * because `{ not: 'REJECTED' }` alone compiles to `<> 'REJECTED'`, which SQL
 * evaluates as unknown for NULL, silently dropping undecided rows.
 */
export const COUNTED_COMPETITOR_WHERE = {
  OR: [{ userDecision: null }, { userDecision: { not: 'REJECTED' } }],
} satisfies Prisma.CompetitorWhereInput;

/**
 * Which competitor rows still need a user decision. Same rule as the review
 * queue's `normalizeStoredDecision` (growth-competitors.ts): anything that
 * isn't ACCEPTED or REJECTED is PENDING, regardless of where the row came
 * from (AI, ONBOARDING_GUESS, MANUAL, ...). Filtering by `source === 'AI'`
 * used to hide onboarding-seeded guesses once they were marked
 * ONBOARDING_GUESS instead of AI — this counts every origin.
 */
export function countsAsPendingCompetitor(competitor: { userDecision?: string | null }): boolean {
  return competitor.userDecision !== 'ACCEPTED' && competitor.userDecision !== 'REJECTED';
}

export function countPendingCompetitors(competitors: Array<{ userDecision?: string | null }>): number {
  return competitors.filter(countsAsPendingCompetitor).length;
}

import { describe, expect, it } from 'vitest';

import {
  COUNTED_COMPETITOR_WHERE,
  countCompetitors,
  countPendingCompetitors,
  countsAsPendingCompetitor,
  countsTowardCompetitorTotal,
} from './competitor-counts';

describe('competitor totals', () => {
  it('count every row except REJECTED, including undecided (null) rows', () => {
    expect(countsTowardCompetitorTotal({ userDecision: 'ACCEPTED' })).toBe(true);
    expect(countsTowardCompetitorTotal({ userDecision: 'PENDING' })).toBe(true);
    expect(countsTowardCompetitorTotal({ userDecision: null })).toBe(true);
    expect(countsTowardCompetitorTotal({ userDecision: 'REJECTED' })).toBe(false);
    expect(
      countCompetitors([
        { userDecision: 'ACCEPTED' },
        { userDecision: 'REJECTED' },
        { userDecision: null },
        { userDecision: 'PENDING' },
      ]),
    ).toBe(3);
  });

  it('the Prisma filter keeps NULL decisions explicitly instead of relying on <>', () => {
    expect(COUNTED_COMPETITOR_WHERE).toEqual({
      OR: [{ userDecision: null }, { userDecision: { not: 'REJECTED' } }],
    });
  });
});

describe('pending competitors', () => {
  it('count every undecided row regardless of source, not just source === AI', () => {
    // Onboarding-seeded rows are now marked ONBOARDING_GUESS (not AI) and
    // still need review, so the dashboard nudge must not drop them.
    expect(countsAsPendingCompetitor({ userDecision: null, source: 'ONBOARDING_GUESS' } as any)).toBe(true);
    expect(countsAsPendingCompetitor({ userDecision: 'PENDING', source: 'AI' } as any)).toBe(true);
    expect(countsAsPendingCompetitor({ userDecision: null, source: 'MANUAL' } as any)).toBe(true);
    expect(countsAsPendingCompetitor({ userDecision: 'ACCEPTED', source: 'ONBOARDING_GUESS' } as any)).toBe(false);
    expect(countsAsPendingCompetitor({ userDecision: 'REJECTED', source: 'AI' } as any)).toBe(false);

    expect(
      countPendingCompetitors([
        { userDecision: null, source: 'ONBOARDING_GUESS' } as any,
        { userDecision: 'ACCEPTED', source: 'AI' } as any,
        { userDecision: 'REJECTED', source: 'MANUAL' } as any,
        { userDecision: 'PENDING', source: 'AI' } as any,
      ]),
    ).toBe(2);
  });
});

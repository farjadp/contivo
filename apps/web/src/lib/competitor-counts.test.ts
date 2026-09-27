import { describe, expect, it } from 'vitest';

import { COUNTED_COMPETITOR_WHERE, countCompetitors, countsTowardCompetitorTotal } from './competitor-counts';

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

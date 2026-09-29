import { describe, expect, it } from 'vitest';

import { MAX_SNAPSHOT, countSkipped, parseRunCompetitorIds, snapshotCompetitorIds, snapshotCompetitors } from './competitor-set';

const ids = (n: number) => Array.from({ length: n }, (_, i) => `c${String(i + 1).padStart(2, '0')}`);

describe('the run competitor set', () => {
  it('caps at 12', () => {
    expect(MAX_SNAPSHOT).toBe(12);
    expect(snapshotCompetitorIds(ids(13))).toEqual(ids(12));
  });

  it('picks the same competitors whatever order the rows arrive in', () => {
    const shuffled = [...ids(13)].reverse();
    expect(snapshotCompetitorIds(shuffled)).toEqual(ids(12));
    expect(snapshotCompetitors(shuffled.map((id) => ({ id, domain: `${id}.com` }))).map((c) => c.id)).toEqual(ids(12));
  });

  it('reads competitor ids back out of a stored snapshot, skipping junk', () => {
    expect(parseRunCompetitorIds([{ competitorId: 'a' }, { competitorId: '' }, null, 'x', { competitorId: 'b' }])).toEqual(['a', 'b']);
    expect(parseRunCompetitorIds('garbage')).toEqual([]);
  });

  it('keeps skipped competitors in the ids, so leaving one out never makes the run stale (spec §15 E2)', () => {
    const stored = [{ competitorId: 'a' }, { competitorId: 'b', skipped: true }];
    expect(parseRunCompetitorIds(stored)).toEqual(['a', 'b']);
  });

  it('counts the entries marked skipped, and nothing else', () => {
    expect(
      countSkipped([
        { competitorId: 'a', skipped: true },
        { competitorId: 'b', skipped: false },
        { competitorId: 'c', skipped: 'yes' },
        { skipped: true },
        { competitorId: 'd', skipped: true },
      ]),
    ).toBe(2);
    expect(countSkipped(null)).toBe(0);
  });
});

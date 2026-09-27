import { describe, expect, it } from 'vitest';

import { MIN_OPEN_DISTANCE, findWhiteSpace } from './white-space';
import type { CompanyType, MatrixScore } from './types';

function point(name: string, x: number, y: number, type: CompanyType = 'DIRECT'): MatrixScore {
  return {
    competitorId: type === 'TARGET' ? null : name,
    name,
    domain: `${name}.example.com`,
    type,
    xScore: x,
    yScore: y,
    confidence: 0.9,
    estimated: false,
  };
}

describe('findWhiteSpace', () => {
  it('returns null when there is nobody to compare against', () => {
    expect(findWhiteSpace([point('us', 5, 5, 'TARGET')])).toBeNull();
  });

  it('returns null when there is no target on the chart', () => {
    expect(findWhiteSpace([point('a', 2, 2), point('b', 9, 9)])).toBeNull();
  });

  it('finds the open corner next to the target', () => {
    // Everyone crowds the low-left; the target sits mid-chart.
    const gap = findWhiteSpace([
      point('us', 6, 6, 'TARGET'),
      point('a', 2, 2),
      point('b', 3, 2),
      point('c', 2, 3),
      point('d', 3, 3),
    ]);
    expect(gap).not.toBeNull();
    expect(gap!.xBand).toBe(2);
    expect(gap!.yBand).toBe(2);
    expect(gap!.nearestCompetitorDistance).toBeGreaterThanOrEqual(MIN_OPEN_DISTANCE);
  });

  it('ignores a gap the target cannot reach', () => {
    // The far corner (high, high) is empty, but the target is pinned low-left,
    // so that gap is two cells away and belongs to nobody in particular.
    const gap = findWhiteSpace([
      point('us', 1, 1, 'TARGET'),
      point('a', 6, 1),
      point('b', 1, 6),
      point('c', 6, 6),
    ]);
    if (gap) {
      expect(Math.abs(gap.xBand - 0)).toBeLessThanOrEqual(1);
      expect(Math.abs(gap.yBand - 0)).toBeLessThanOrEqual(1);
    }
  });

  it('returns null when every reachable cell is crowded', () => {
    const gap = findWhiteSpace([
      point('us', 6, 6, 'TARGET'),
      point('a', 2, 2),
      point('b', 6, 2),
      point('c', 9, 2),
      point('d', 2, 6),
      point('e', 6, 6),
      point('f', 9, 6),
      point('g', 2, 9),
      point('h', 6, 9),
      point('i', 9, 9),
    ]);
    expect(gap).toBeNull();
  });

  it('prefers the ground the target already stands on when distances tie', () => {
    // Two equally empty cells, one of them the target's own.
    const gap = findWhiteSpace([
      point('us', 2, 2, 'TARGET'),
      point('far', 10, 10),
    ]);
    expect(gap).not.toBeNull();
    expect(gap!.xBand).toBe(0);
    expect(gap!.yBand).toBe(0);
  });

  it('does not count the target itself as occupying the gap', () => {
    // The only other point is far away, so the target's own cell stays open
    // even though the target is standing in it.
    const gap = findWhiteSpace([point('us', 9, 9, 'TARGET'), point('a', 1, 1)]);
    expect(gap).not.toBeNull();
    expect(gap!.xBand).toBe(2);
    expect(gap!.yBand).toBe(2);
  });

  it('is deterministic for the same input', () => {
    const scores = [
      point('us', 5, 5, 'TARGET'),
      point('a', 1, 9),
      point('b', 9, 1),
      point('c', 2, 2),
    ];
    const first = findWhiteSpace(scores);
    const second = findWhiteSpace([...scores]);
    expect(first).toEqual(second);
  });
});

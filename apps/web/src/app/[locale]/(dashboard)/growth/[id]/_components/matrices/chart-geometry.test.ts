import { describe, expect, it } from 'vitest';

import { axisThird } from '@/lib/matrices/scoring';
import { bandRect, cornerLabels, scoreToPercent } from './chart-geometry';

describe('scoreToPercent', () => {
  it('keeps the existing plot formula: 1 -> 10%, 10 -> 90%', () => {
    expect(scoreToPercent(1)).toBe(10);
    expect(scoreToPercent(10)).toBe(90);
    expect(scoreToPercent(5.5)).toBeCloseTo(50, 5);
  });

  it('clamps scores outside 1-10 instead of drawing off the plot', () => {
    expect(scoreToPercent(-3)).toBe(10);
    expect(scoreToPercent(42)).toBe(90);
  });

  it('treats a non-number as the bottom of the axis', () => {
    expect(scoreToPercent(Number.NaN)).toBe(10);
  });
});

describe('bandRect', () => {
  it('draws every score inside the cell axisThird files it under', () => {
    // The white-space claim and the picture must agree: a rival at score 4
    // is in the low third, so its dot must sit inside the low cell.
    for (let score = 1; score <= 10; score += 1) {
      const rect = bandRect(axisThird(score));
      const at = scoreToPercent(score);
      expect(at).toBeGreaterThanOrEqual(rect.start);
      expect(at).toBeLessThanOrEqual(rect.start + rect.size);
    }
  });

  it('tiles the whole plot with no gap and no overlap', () => {
    const [a, b, c] = [bandRect(0), bandRect(1), bandRect(2)];
    expect(a.start).toBe(0);
    expect(a.start + a.size).toBeCloseTo(b.start, 5);
    expect(b.start + b.size).toBeCloseTo(c.start, 5);
    expect(c.start + c.size).toBeCloseTo(100, 5);
  });
});

describe('cornerLabels', () => {
  const axis = { x: { low: 'One thing', high: 'Full suite' }, y: { low: 'Generalist', high: 'Niche expert' } };

  it('puts x low/high on the left/right and y low/high on the bottom/top', () => {
    expect(cornerLabels(axis)).toEqual({
      topLeft: { x: 'One thing', y: 'Niche expert' },
      topRight: { x: 'Full suite', y: 'Niche expert' },
      bottomLeft: { x: 'One thing', y: 'Generalist' },
      bottomRight: { x: 'Full suite', y: 'Generalist' },
    });
  });
});

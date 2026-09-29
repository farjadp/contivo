import { describe, expect, it } from 'vitest';

import {
  axisThird,
  certaintyFloor,
  confidenceBand,
  finalConfidence,
  isEstimated,
  normalizeCertainty,
} from './scoring';
import type { Certainty } from './types';

describe('finalConfidence', () => {
  it('never lets a lower certainty overtake a higher one', () => {
    const bestLikely = finalConfidence({ certainty: 'likely', evidenceCount: 99, coreChartsAgree: true });
    const worstCertain = finalConfidence({ certainty: 'certain', evidenceCount: 1 });
    expect(bestLikely).toBeLessThan(worstCertain);

    const bestUnsure = finalConfidence({ certainty: 'unsure', evidenceCount: 99, coreChartsAgree: true });
    const worstLikely = finalConfidence({ certainty: 'likely', evidenceCount: 1 });
    expect(bestUnsure).toBeLessThan(worstLikely);
  });

  it('never reaches 1', () => {
    for (const certainty of ['certain', 'likely', 'unsure'] as Certainty[]) {
      const best = finalConfidence({ certainty, evidenceCount: 1000, coreChartsAgree: true });
      expect(best).toBeLessThan(1);
    }
  });

  it('caps a score with no evidence at 0.5 however sure the scorer sounds', () => {
    expect(finalConfidence({ certainty: 'certain', evidenceCount: 0, coreChartsAgree: true })).toBe(0.5);
    expect(finalConfidence({ certainty: 'unsure', evidenceCount: 0 })).toBe(0.5);
  });

  it('rewards corroboration inside the band, monotonically', () => {
    const one = finalConfidence({ certainty: 'certain', evidenceCount: 1 });
    const two = finalConfidence({ certainty: 'certain', evidenceCount: 2 });
    const three = finalConfidence({ certainty: 'certain', evidenceCount: 3 });
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
  });

  it('stops counting evidence past saturation', () => {
    const three = finalConfidence({ certainty: 'likely', evidenceCount: 3 });
    const thirty = finalConfidence({ certainty: 'likely', evidenceCount: 30 });
    expect(thirty).toBe(three);
  });

  it('treats core-chart agreement as corroboration', () => {
    const alone = finalConfidence({ certainty: 'likely', evidenceCount: 2 });
    const agreeing = finalConfidence({ certainty: 'likely', evidenceCount: 2, coreChartsAgree: true });
    expect(agreeing).toBeGreaterThan(alone);
  });

  it('never drops below its own floor', () => {
    for (const certainty of ['certain', 'likely', 'unsure'] as Certainty[]) {
      const bare = finalConfidence({ certainty, evidenceCount: 1 });
      if (certainty === 'unsure') continue; // the floor is the cap here
      expect(bare).toBeGreaterThanOrEqual(certaintyFloor(certainty));
    }
  });

  it('survives rubbish input rather than producing a wild number', () => {
    const junk = finalConfidence({
      certainty: 'wildly sure' as unknown as Certainty,
      evidenceCount: Number.NaN,
    });
    expect(junk).toBe(0.5);
    expect(finalConfidence({ certainty: 'likely', evidenceCount: -4 })).toBe(0.5);
  });
});

describe('normalizeCertainty', () => {
  it('accepts only the three words', () => {
    expect(normalizeCertainty('certain')).toBe('certain');
    expect(normalizeCertainty('likely')).toBe('likely');
    expect(normalizeCertainty('unsure')).toBe('unsure');
  });

  it('treats anything else as the weakest', () => {
    expect(normalizeCertainty(0.99)).toBe('unsure');
    expect(normalizeCertainty('CERTAIN')).toBe('unsure');
    expect(normalizeCertainty(null)).toBe('unsure');
    expect(normalizeCertainty(undefined)).toBe('unsure');
  });
});

describe('confidenceBand', () => {
  it('uses the same thresholds as competitor discovery', () => {
    expect(confidenceBand(0.8)).toBe('high');
    expect(confidenceBand(0.79)).toBe('medium');
    expect(confidenceBand(0.6)).toBe('medium');
    expect(confidenceBand(0.59)).toBe('low');
  });

  it('calls a missing confidence low rather than assuming', () => {
    expect(confidenceBand(null)).toBe('low');
    expect(confidenceBand(undefined)).toBe('low');
    expect(confidenceBand(Number.NaN)).toBe('low');
  });

  it('maps each certainty band to the word a reader expects', () => {
    expect(confidenceBand(finalConfidence({ certainty: 'certain', evidenceCount: 1 }))).toBe('high');
    expect(confidenceBand(finalConfidence({ certainty: 'likely', evidenceCount: 3 }))).toBe('medium');
    expect(confidenceBand(finalConfidence({ certainty: 'unsure', evidenceCount: 3 }))).toBe('low');
  });
});

describe('isEstimated', () => {
  it('is true only with no evidence at all', () => {
    expect(isEstimated(0)).toBe(true);
    expect(isEstimated(Number.NaN)).toBe(true);
    expect(isEstimated(1)).toBe(false);
  });
});

describe('axisThird', () => {
  it('splits 1-10 into three bands', () => {
    expect(axisThird(1)).toBe(0);
    expect(axisThird(4)).toBe(0);
    expect(axisThird(5)).toBe(1);
    expect(axisThird(7)).toBe(1);
    expect(axisThird(8)).toBe(2);
    expect(axisThird(10)).toBe(2);
  });

  it('clamps rather than throwing on an out-of-range score', () => {
    expect(axisThird(-3)).toBe(0);
    expect(axisThird(99)).toBe(2);
    expect(axisThird(Number.NaN)).toBe(0);
  });
});

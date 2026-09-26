import { describe, expect, it } from 'vitest';
import type { JudgedCandidate, TargetMarket } from './types';
import { confidenceBand, rankAndKeep, scoreCandidate, MAX_SAVED_PER_RUN } from './scoring';

const IR: TargetMarket = { country: 'IR', language: 'fa' };

function candidate(over: Partial<JudgedCandidate> = {}): JudgedCandidate {
  return {
    domain: 'example.com',
    frequency: 1,
    sources: ['WEB_SEARCH'],
    evidence: [],
    siteTitle: 'Example',
    siteEvidence: 'some text',
    pageLanguage: 'en',
    name: 'Example',
    isCompetitor: true,
    labels: ['BUSINESS'],
    type: 'DIRECT',
    scaleMatch: true,
    judgeConfidence: 0.7,
    reason: 'overlaps',
    positioning: null,
    keyFeatures: [],
    description: 'desc',
    ...over,
  };
}

describe('scoreCandidate', () => {
  it('starts from the judge confidence', () => {
    expect(scoreCandidate(candidate({ frequency: 1, pageLanguage: 'en' }), { country: null, language: 'en' }))
      .toBeCloseTo(0.75, 2); // 0.70 + 0.05 language match
  });

  it('rewards appearing in more queries, with a cap', () => {
    const one = scoreCandidate(candidate({ frequency: 1 }), IR);
    const three = scoreCandidate(candidate({ frequency: 3 }), IR);
    const ten = scoreCandidate(candidate({ frequency: 10 }), IR);
    expect(three).toBeGreaterThan(one);
    expect(ten).toBeCloseTo(three + 0.0, 2); // capped at 3 queries
  });

  it('rewards agreement between sources', () => {
    const single = scoreCandidate(candidate({ sources: ['WEB_SEARCH'] }), IR);
    const both = scoreCandidate(candidate({ sources: ['WEB_SEARCH', 'SERP'] }), IR);
    expect(both - single).toBeCloseTo(0.1, 2);
  });

  it('rewards a page language matching the target market', () => {
    const fa = scoreCandidate(candidate({ pageLanguage: 'fa' }), IR);
    const en = scoreCandidate(candidate({ pageLanguage: 'en' }), IR);
    expect(fa - en).toBeCloseTo(0.05, 2);
  });

  it('never leaves the 0..1 range', () => {
    const high = scoreCandidate(candidate({ judgeConfidence: 0.99, frequency: 9, sources: ['WEB_SEARCH', 'SERP'], pageLanguage: 'fa' }), IR);
    expect(high).toBeLessThanOrEqual(1);
    const low = scoreCandidate(candidate({ judgeConfidence: 0 }), IR);
    expect(low).toBeGreaterThanOrEqual(0);
  });
});

describe('confidenceBand', () => {
  it('bands by the agreed thresholds', () => {
    expect(confidenceBand(0.81)).toBe('high');
    expect(confidenceBand(0.8)).toBe('high');
    expect(confidenceBand(0.6)).toBe('medium');
    expect(confidenceBand(0.59)).toBe('low');
    expect(confidenceBand(null)).toBe('unknown');
  });
});

describe('rankAndKeep', () => {
  it('drops non-competitors and anything under the threshold', () => {
    const kept = rankAndKeep(
      [
        candidate({ domain: 'a.com', isCompetitor: false, judgeConfidence: 0.95 }),
        candidate({ domain: 'b.com', judgeConfidence: 0.2 }),
        candidate({ domain: 'c.com', judgeConfidence: 0.9 }),
      ],
      IR,
    );
    expect(kept.map((k) => k.domain)).toEqual(['c.com']);
  });

  it('sorts by final confidence, highest first', () => {
    const kept = rankAndKeep(
      [candidate({ domain: 'low.com', judgeConfidence: 0.65 }), candidate({ domain: 'high.com', judgeConfidence: 0.95 })],
      IR,
    );
    expect(kept.map((k) => k.domain)).toEqual(['high.com', 'low.com']);
  });

  it('caps the result at MAX_SAVED_PER_RUN', () => {
    const many = Array.from({ length: 25 }, (_, i) => candidate({ domain: `d${i}.com`, judgeConfidence: 0.9 }));
    expect(rankAndKeep(many, IR)).toHaveLength(MAX_SAVED_PER_RUN);
  });
});

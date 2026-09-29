import { describe, expect, it } from 'vitest';

// Recognises results only the removed fallbacks could have produced, so the
// cleanup script deletes those and nothing else (spec 2026-09-29, D4).
import { planCleanup, withoutKeys } from './fabricated.mjs';

const fabricatedKeywords = {
  competitors: [
    {
      domain: 'alpha.com',
      keyword_clusters: [{ cluster: 'Estimated Theme', keywords: ['alpha'] }],
      data_quality_notes: ['score estimated from limited evidence', 'inferred from messaging, not explicit proof'],
    },
  ],
  content_gaps: [{ topic: 'Strategic content planning for teams' }],
};

const realKeywords = {
  competitors: [
    {
      domain: 'alpha.com',
      keyword_clusters: [{ cluster: 'Content calendars', keywords: ['content calendar'] }],
      data_quality_notes: ['inferred from messaging, not explicit proof'],
    },
  ],
};

const emptyOfferings = {
  client_offerings: { offerings: [], summary: { main_offering_focus: 'Insufficient public evidence' } },
  competitor_offerings: [{ offerings: [], summary: { main_offering_focus: 'Insufficient public evidence' } }],
};

const realOfferings = {
  client_offerings: { offerings: [{ name: 'Planner' }], summary: { main_offering_focus: 'Planning' } },
  competitor_offerings: [{ offerings: [], summary: { main_offering_focus: 'Insufficient public evidence' } }],
};

describe('planCleanup', () => {
  it('flags both fallback shapes', () => {
    expect(planCleanup({ competitorKeywordsIntel: fabricatedKeywords, productsServicesIntel: emptyOfferings })).toEqual([
      'competitorKeywordsIntel',
      'productsServicesIntel',
    ]);
  });

  it('leaves real results alone', () => {
    expect(planCleanup({ competitorKeywordsIntel: realKeywords, productsServicesIntel: realOfferings })).toEqual([]);
  });

  it('does not flag a keyword result that only shares the cluster name', () => {
    const lookalike = {
      competitors: [{ keyword_clusters: [{ cluster: 'Estimated Theme' }], data_quality_notes: [] }],
    };
    expect(planCleanup({ competitorKeywordsIntel: lookalike })).toEqual([]);
  });

  it('handles an empty or missing audienceInsights', () => {
    expect(planCleanup(null)).toEqual([]);
    expect(planCleanup({})).toEqual([]);
    expect(planCleanup('not an object')).toEqual([]);
  });
});

describe('withoutKeys', () => {
  it('removes only the named keys', () => {
    const insights = { competitorKeywordsIntel: fabricatedKeywords, competitiveMatrices: { charts: [] }, other: 1 };
    expect(withoutKeys(insights, ['competitorKeywordsIntel'])).toEqual({ competitiveMatrices: { charts: [] }, other: 1 });
    expect(insights).toHaveProperty('competitorKeywordsIntel');
  });
});

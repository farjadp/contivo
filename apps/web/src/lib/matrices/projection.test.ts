import { describe, expect, it } from 'vitest';

import { buildProjection, isStale, type ProjectionInput } from './projection';
import type { MatrixOverride } from './types';

function score(name: string, x: number, y: number, extra: Partial<{ competitorId: string | null; type: any; confidence: number; estimated: boolean; evidenceRefs: string[] }> = {}) {
  return {
    competitorId: extra.competitorId === undefined ? name : extra.competitorId,
    name,
    domain: `${name}.example.com`,
    type: extra.type ?? 'DIRECT',
    xScore: x,
    yScore: y,
    xReason: `${name} x reason`,
    yReason: `${name} y reason`,
    confidence: extra.confidence ?? 0.93,
    estimated: extra.estimated ?? false,
    evidenceRefs: extra.evidenceRefs ?? [],
  };
}

function input(overrides: MatrixOverride[] = [], liveIds = ['rival-a', 'rival-b']): ProjectionInput {
  return {
    runId: 'run_1',
    generatedAt: '2026-09-27T10:00:00.000Z',
    competitorBasis: 'ACCEPTED',
    language: 'fa',
    charts: [
      {
        key: 'offer_breadth_specialization',
        kind: 'CORE',
        name: 'Offer breadth vs Specialization',
        xLabel: 'Breadth',
        yLabel: 'Specialization',
        marketPattern: 'Everyone sells the full suite.',
        opportunity: 'The specialist corner is empty.',
        contentAngles: [{ angle: 'One job, done properly', audienceSegment: 'small agencies' }],
        scores: [
          { ...score('us', 5, 5, { competitorId: null, type: 'TARGET' }) },
          { ...score('rival-a', 2, 2) },
          { ...score('rival-b', 3, 2) },
        ],
      },
    ],
    overrides,
    evidenceById: {},
    liveCompetitorIds: liveIds,
    runCompetitorIds: ['rival-a', 'rival-b'],
    crossChartSummary: 'summary',
    strongestDifferentiation: 'differentiation',
    targetAudienceSegment: 'small agencies',
    tokensUsed: 1234,
  };
}

describe('buildProjection', () => {
  it('carries the run token count', () => {
    expect(buildProjection(input()).tokens_used).toBe(1234);
  });

  it('keeps the payload shape the existing readers expect', () => {
    const p = buildProjection(input());
    expect(Array.isArray(p.charts)).toBe(true);
    const chart = p.charts[0];
    expect(chart.chart_key).toBe('offer_breadth_specialization');
    expect(chart.axes).toEqual({ x: 'Breadth', y: 'Specialization' });
    expect(chart.companies[0]).toMatchObject({ name: 'us', type: 'TARGET', x_score: 5, y_score: 5 });
    expect(chart.summary.positioning_opportunity).toBe('The specialist corner is empty.');
  });

  it('applies an override and keeps the AI position beside it', () => {
    const p = buildProjection(
      input([{ chartKey: 'offer_breadth_specialization', competitorId: 'rival-a', xScore: 9, yScore: null, note: 'they sell one thing' }]),
    );
    const rival = p.charts[0].companies.find((c) => c.name === 'rival-a')!;
    expect(rival.x_score).toBe(9);
    expect(rival.y_score).toBe(2); // untouched axis keeps the model's number
    expect(rival.override).toEqual({ ai_x_score: 2, ai_y_score: 2, note: 'they sell one thing' });
  });

  it('can override the target itself', () => {
    const p = buildProjection(
      input([{ chartKey: 'offer_breadth_specialization', competitorId: null, xScore: 1, yScore: 10, note: null }]),
    );
    const us = p.charts[0].companies.find((c) => c.name === 'us')!;
    expect([us.x_score, us.y_score]).toEqual([1, 10]);
    expect(us.override?.ai_x_score).toBe(5);
  });

  it('ignores an override whose competitor no longer exists', () => {
    const p = buildProjection(
      input(
        [{ chartKey: 'offer_breadth_specialization', competitorId: 'deleted-rival', xScore: 10, yScore: 10, note: null }],
        ['rival-a', 'rival-b'],
      ),
    );
    expect(p.charts[0].companies.some((c) => c.x_score === 10 && c.y_score === 10)).toBe(false);
  });

  it('does not mark a point as overridden when the override matches the model', () => {
    const p = buildProjection(
      input([{ chartKey: 'offer_breadth_specialization', competitorId: 'rival-a', xScore: 2, yScore: 2, note: null }]),
    );
    expect(p.charts[0].companies.find((c) => c.name === 'rival-a')!.override).toBeUndefined();
  });

  it('ignores an override aimed at a chart that is not in this run', () => {
    const p = buildProjection(
      input([{ chartKey: 'some_old_chart', competitorId: 'rival-a', xScore: 10, yScore: 10, note: null }]),
    );
    expect(p.charts[0].companies.find((c) => c.name === 'rival-a')!.x_score).toBe(2);
  });

  it('clamps a nonsense override instead of drawing off the chart', () => {
    const p = buildProjection(
      input([{ chartKey: 'offer_breadth_specialization', competitorId: 'rival-b', xScore: 99, yScore: -5, note: null }]),
    );
    const rival = p.charts[0].companies.find((c) => c.name === 'rival-b')!;
    expect(rival.x_score).toBe(10);
    expect(rival.y_score).toBe(1);
  });

  it('recomputes the white space from the positions actually shown', () => {
    // Mid-chart, everything is within reach, so the emptiest corner wins.
    const before = buildProjection(input());
    expect(before.charts[0].white_space).toMatchObject({ xBand: 2, yBand: 2 });

    // Pinning the target into the crowded corner shrinks what it can reach,
    // and the answer has to change with it rather than stay a stale claim.
    const after = buildProjection(
      input([{ chartKey: 'offer_breadth_specialization', competitorId: null, xScore: 1, yScore: 1, note: null }]),
    );
    expect(after.charts[0].white_space).not.toEqual(before.charts[0].white_space);
    expect(after.charts[0].white_space).toMatchObject({ xBand: 1, yBand: 1 });
  });

  it('carries the basis and the confidence word', () => {
    const p = buildProjection(input());
    expect(p.competitor_basis).toBe('ACCEPTED');
    expect(p.charts[0].companies[0].confidence_band).toBe('high');
  });

  it('flags staleness when the competitor set has moved', () => {
    const p = buildProjection(input([], ['rival-a', 'rival-b', 'rival-c']));
    expect(p.stale).toBe(true);
    expect(p.charts[0].companies.length).toBe(3); // still usable
  });
});

describe('isStale', () => {
  it('is false for the same set in any order', () => {
    expect(isStale(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('is true when one is added or removed', () => {
    expect(isStale(['a', 'b'], ['a'])).toBe(true);
    expect(isStale(['a'], ['a', 'b'])).toBe(true);
    expect(isStale(['a', 'b'], ['a', 'c'])).toBe(true);
  });
});

describe('evidence resolution', () => {
  const ev = (id: string) => ({ id, url: `https://x.com/${id}`, title: `t-${id}` });

  function withEvidence(refs: Record<string, string[]>, evidenceById: Record<string, Array<{ id: string; url: string; title: string }>>, estimated = false) {
    const base = input();
    for (const s of base.charts[0].scores) {
      s.evidenceRefs = refs[s.competitorId ?? 'TARGET'] ?? [];
      s.estimated = estimated;
    }
    base.evidenceById = evidenceById;
    return buildProjection(base).charts[0].companies;
  }

  it('resolves every cited id, in cited order', () => {
    const [, a] = withEvidence({ 'rival-a': ['e2', 'e1'] }, { 'rival-a': [ev('e1'), ev('e2')] });
    expect(a.evidence.map((e) => e.id)).toEqual(['e2', 'e1']);
    expect(a.evidence_missing).toBe(false);
    expect(a.estimated).toBe(false);
  });

  it('drops only the unresolved ids when some resolve', () => {
    const [, a] = withEvidence({ 'rival-a': ['e1', 'gone'] }, { 'rival-a': [ev('e1')] });
    expect(a.evidence.map((e) => e.id)).toEqual(['e1']);
    expect(a.evidence_missing).toBe(false);
    expect(a.estimated).toBe(false);
  });

  it('forces estimated and flags the point when none resolve', () => {
    const [, a] = withEvidence({ 'rival-a': ['gone'] }, { 'rival-a': [ev('e1')] });
    expect(a.evidence).toEqual([]);
    expect(a.evidence_missing).toBe(true);
    expect(a.estimated).toBe(true);
  });

  it('leaves a point with no refs untouched', () => {
    const [, a] = withEvidence({}, {}, false);
    expect(a.evidence_missing).toBe(false);
    expect(a.estimated).toBe(false);
    const [, b] = withEvidence({}, {}, true);
    expect(b.estimated).toBe(true);
    expect(b.evidence_missing).toBe(false);
  });

  it('resolves the target own: ids from the TARGET key', () => {
    const [us] = withEvidence({ TARGET: ['own:tagline'] }, { TARGET: [{ id: 'own:tagline', url: '', title: 'We sell x' }] });
    expect(us.evidence).toEqual([{ id: 'own:tagline', url: '', title: 'We sell x' }]);
    expect(us.evidence_missing).toBe(false);
  });

  it('does not resolve old refs for a competitor deleted and rediscovered under a new id', () => {
    // The run cited rival-a's evidence e1; the rediscovered row is a different id with new evidence.
    const [, a] = withEvidence({ 'rival-a': ['e1'] }, { 'rival-a-new': [ev('e1')], 'rival-a': [ev('n1')] });
    expect(a.evidence).toEqual([]);
    expect(a.evidence_missing).toBe(true);
  });
});

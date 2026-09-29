import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxisDefinition } from './axes';
import { callStructured } from './openai';
import type { ScoredCompany } from './score-chart';
import {
  CHART_SUMMARY_SCHEMA,
  CROSS_CHART_SCHEMA,
  describeWhiteSpace,
  summariseAcrossCharts,
  summariseChart,
  type ChartSummary,
} from './summarise';

vi.mock('./openai', async () => {
  class MatrixAiError extends Error {
    readonly tokens: number | null;
    constructor(message: string, tokens: number | null = null) {
      super(message);
      this.name = 'MatrixAiError';
      this.tokens = tokens;
    }
  }
  return { MatrixAiError, callStructured: vi.fn() };
});

const mocked = vi.mocked(callStructured);

const axis: AxisDefinition = {
  key: 'offer_breadth_specialization',
  kind: 'CORE',
  name: 'Offer',
  x: { label: 'Breadth of offer', low: 'One thing', high: 'Everything' },
  y: { label: 'Specialisation', low: 'Generalist', high: 'Niche expert' },
};

const sc = (name: string, type: string, x: number, y: number): ScoredCompany => ({
  competitorId: type === 'TARGET' ? null : name,
  name,
  domain: `${name}.com`,
  type: type as ScoredCompany['type'],
  xScore: x,
  yScore: y,
  confidence: 0.7,
  estimated: false,
  xReason: `${name} x reason`,
  yReason: `${name} y reason`,
  evidenceRefs: [],
  certainty: 'likely',
});

const scores = [sc('Acme', 'TARGET', 3, 3), sc('Rival', 'DIRECT', 8, 8)];

const chartReply = (over: Record<string, unknown> = {}) =>
  mocked.mockResolvedValueOnce({
    data: {
      market_pattern: 'Most rivals cluster high.',
      opportunity: 'One thing-side, niche expert.',
      content_angles: [{ angle: 'a1', audience_segment: 's1' }],
      ...over,
    },
    tokens: 11,
  });

describe('describeWhiteSpace', () => {
  it('names the cell with describeBand on each axis', () => {
    expect(describeWhiteSpace(axis, { xBand: 0, yBand: 2, nearestCompetitorDistance: 5 })).toBe(
      'Breadth of offer: low One thing; Specialisation: high Niche expert',
    );
  });
  it('is null without white space', () => {
    expect(describeWhiteSpace(axis, null)).toBeNull();
  });
});

describe('summariseChart', () => {
  beforeEach(() => mocked.mockReset());

  it('puts the white-space description and every company score in the prompt', async () => {
    chartReply();
    const ws = { xBand: 0 as const, yBand: 2 as const, nearestCompetitorDistance: 5 };
    const out = await summariseChart(axis, scores, ws, 'en');
    const { system, user } = mocked.mock.calls[0][0];
    const all = `${system}\n${user}`;
    expect(all).toContain('Breadth of offer: low One thing; Specialisation: high Niche expert');
    expect(user).toContain('Acme');
    expect(user).toContain('TARGET');
    expect(user).toContain('Rival');
    expect(user).toContain('DIRECT');
    expect(user).toContain('Rival x reason');
    expect(user).toMatch(/x=8/);
    expect(user).toMatch(/y=8/);
    expect(out.tokens).toBe(11);
    expect(out.summary.contentAngles).toEqual([{ angle: 'a1', audienceSegment: 's1' }]);
  });

  it('asks for a plain no-clear-gap statement when there is no white space', async () => {
    chartReply();
    await summariseChart(axis, scores, null, 'en');
    const { system, user } = mocked.mock.calls[0][0];
    expect(`${system}\n${user}`).toMatch(/no clear gap/i);
  });

  it('writes in Persian for fa', async () => {
    chartReply();
    await summariseChart(axis, scores, null, 'fa');
    expect(mocked.mock.calls[0][0].system).toContain('Persian');
  });

  it('cuts angles to 3 and drops empty ones', async () => {
    chartReply({
      content_angles: [
        { angle: 'a1', audience_segment: 's1' },
        { angle: '  ', audience_segment: 's2' },
        { angle: 'a3', audience_segment: '' },
        { angle: 'a4', audience_segment: 's4' },
        { angle: 'a5', audience_segment: 's5' },
        { angle: 'a6', audience_segment: 's6' },
      ],
    });
    const out = await summariseChart(axis, scores, null, 'en');
    expect(out.summary.contentAngles.map((a) => a.angle)).toEqual(['a1', 'a4', 'a5']);
  });

  it('throws with tokens when opportunity is empty', async () => {
    chartReply({ opportunity: '   ' });
    await expect(summariseChart(axis, scores, null, 'en')).rejects.toMatchObject({ name: 'MatrixAiError', tokens: 11 });
  });

  it('throws with tokens when marketPattern is empty', async () => {
    chartReply({ market_pattern: '' });
    await expect(summariseChart(axis, scores, null, 'en')).rejects.toMatchObject({ name: 'MatrixAiError', tokens: 11 });
  });
});

describe('summariseAcrossCharts', () => {
  beforeEach(() => mocked.mockReset());
  const summary: ChartSummary = { marketPattern: 'mp', opportunity: 'op', contentAngles: [{ angle: 'a', audienceSegment: 's' }] };

  it('returns the three fields', async () => {
    mocked.mockResolvedValueOnce({
      data: { cross_chart_summary: 'c', strongest_differentiation: 'd', target_audience_segment: 't' },
      tokens: 4,
    });
    const out = await summariseAcrossCharts([{ axis, summary }], 'en');
    expect(out).toEqual({
      summary: { crossChartSummary: 'c', strongestDifferentiation: 'd', targetAudienceSegment: 't' },
      tokens: 4,
    });
    expect(mocked.mock.calls[0][0].user).toContain('op');
  });

  it('throws with tokens when any field is empty', async () => {
    mocked.mockResolvedValueOnce({
      data: { cross_chart_summary: 'c', strongest_differentiation: ' ', target_audience_segment: 't' },
      tokens: 4,
    });
    await expect(summariseAcrossCharts([{ axis, summary }], 'en')).rejects.toMatchObject({ name: 'MatrixAiError', tokens: 4 });
  });
});

describe('schemas', () => {
  it('are strict at every object level', () => {
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const n = node as Record<string, unknown>;
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false);
        expect([...(n.required as string[])].sort()).toEqual(Object.keys(n.properties as object).sort());
      }
      Object.values(n).forEach(walk);
    };
    walk(CHART_SUMMARY_SCHEMA);
    walk(CROSS_CHART_SCHEMA);
    expect(CHART_SUMMARY_SCHEMA.properties.content_angles.maxItems).toBe(3);
  });
});

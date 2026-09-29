import { describe, expect, it } from 'vitest';
import { summarizeMarketMetricContext } from './gemini';

const chart = {
  chart_name: 'Price vs breadth',
  axes: { x: 'Price', y: 'Breadth' },
  companies: [],
  summary: { market_pattern: 'p', positioning_opportunity: 'o' },
  content_angles: [{ angle: 'Own the mid-market', audience_segment: 'SMB owners' }],
  white_space: { xBand: 1, yBand: 2, nearestCompetitorDistance: 2.5 },
};

describe('summarizeMarketMetricContext', () => {
  it('includes content angles and a white-space note when present', () => {
    const out = JSON.parse(summarizeMarketMetricContext({ charts: [chart] }));
    expect(out.charts[0].content_angles).toEqual([
      { angle: 'Own the mid-market', audience_segment: 'SMB owners' },
    ]);
    expect(out.charts[0].white_space_note).toMatch(/mid/);
    expect(out.charts[0].white_space_note).toMatch(/high/);
    expect(out.charts[0].white_space_note).toMatch(/2\.5/);
  });
  it('omits both for legacy charts', () => {
    const legacy = { ...chart, content_angles: undefined, white_space: undefined };
    const out = JSON.parse(summarizeMarketMetricContext({ charts: [legacy] }));
    expect(out.charts[0]).not.toHaveProperty('content_angles');
    expect(out.charts[0]).not.toHaveProperty('white_space_note');
  });
  it('states the competitor-set caveat by basis', () => {
    const c = (b: any) => JSON.parse(summarizeMarketMetricContext({ charts: [] }, b));
    expect(c('ACCEPTED')).not.toHaveProperty('competitor_set_note');
    expect(c('UNCONFIRMED_HIGH').competitor_set_note).toMatch(/unconfirmed/i);
    expect(c('UNKNOWN').competitor_set_note).toMatch(/predate/i);
  });
});

import { describe, expect, it } from 'vitest';
import { axesForRun, coreAxes, languageFromContent, parseStoredMarketAxes } from './axes';

const market = {
  key: 'Compliance Depth!',
  x: { label: 'Compliance depth', low: 'Basic', high: 'Audit-ready' },
  y: { label: 'Ease of use', low: 'Expert tool', high: 'Anyone can use it' },
  rationale: 'Buyers compare on both.',
};

describe('axes', () => {
  it('maps content language', () => {
    expect(languageFromContent('FA')).toBe('fa');
    expect(languageFromContent('EN')).toBe('en');
    expect(languageFromContent(null)).toBe('en');
  });

  it('reads core labels from the messages, per language', () => {
    expect(coreAxes('en').map((a) => a.key)).toEqual(['offer_breadth_specialization', 'content_presence_focus']);
    expect(coreAxes('fa')[0].x.label).toBe('گسترهٔ پیشنهاد');
    expect(coreAxes('en').every((a) => a.kind === 'CORE')).toBe(true);
  });

  it('slugifies, caps at three and refuses a core key', () => {
    const parsed = parseStoredMarketAxes([market, market, market, market, { ...market, key: 'content_presence_focus' }, { nope: 1 }]);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].key).toBe('compliance_depth');
  });

  it('suffixes keys that slugify to the same value', () => {
    const parsed = parseStoredMarketAxes([market, market]);
    expect(parsed.map((a) => a.key)).toEqual(['compliance_depth', 'compliance_depth_2']);
  });

  it('returns nothing for a non-array', () => {
    expect(parseStoredMarketAxes(null)).toEqual([]);
    expect(parseStoredMarketAxes({})).toEqual([]);
  });

  it('puts core first, then market', () => {
    const axes = axesForRun('en', parseStoredMarketAxes([market]));
    expect(axes.map((a) => a.kind)).toEqual(['CORE', 'CORE', 'MARKET']);
    expect(axes[2].name).toBe('Compliance depth / Ease of use');
  });
});

import { describe, expect, it } from 'vitest';
import { axesForRun, coreAxes, languageFromContent, normaliseMarketAxes, parseStoredMarketAxes } from './axes';

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

  it('caps label, low and high at 60 characters and the rationale at 300, after trimming', () => {
    const long = {
      key: 'long',
      x: { label: `  ${'a'.repeat(80)}  `, low: 'b'.repeat(70), high: `${'c'.repeat(60)}   ` },
      y: { label: 'Y', low: 'l', high: 'h' },
      rationale: `  ${'r'.repeat(400)}`,
    };
    const [parsed] = normaliseMarketAxes([long], 4);
    expect(parsed.x).toEqual({ label: 'a'.repeat(60), low: 'b'.repeat(60), high: 'c'.repeat(60) });
    expect(parsed.y).toEqual({ label: 'Y', low: 'l', high: 'h' });
    expect(parsed.rationale).toBe('r'.repeat(300));
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

  it('drops a market axis whose x or y label names a banned abstraction (en and fa), keeping the rest', () => {
    const banned = (key: string, xLabel: string, yLabel = 'Ease of use') => ({
      ...market,
      key,
      x: { ...market.x, label: xLabel },
      y: { ...market.y, label: yLabel },
    });
    const parsed = normaliseMarketAxes(
      [
        banned('s', 'Content Strategy'),
        banned('e', 'Speed', 'Execution quality'),
        banned('c', 'CREATIVITY'),
        banned('st', 'Site structure'),
        banned('f1', 'استراتژی محتوا'),
        banned('f2', 'کیفیت', 'سرعت اجرا'),
        banned('f3', 'خلاقیت'),
        banned('f4', 'ساختار سایت'),
        banned('ok', 'Compliance depth'),
      ],
      4,
    );
    expect(parsed.map((a) => a.key)).toEqual(['ok']);
  });

  it('judges only the labels: a banned word at an axis end does not drop it', () => {
    const parsed = normaliseMarketAxes([{ ...market, x: { ...market.x, low: 'No strategy' } }], 4);
    expect(parsed).toHaveLength(1);
  });

  it('leaves the core axes alone', () => {
    expect(axesForRun('fa', []).map((a) => a.key)).toEqual(['offer_breadth_specialization', 'content_presence_focus']);
  });
});

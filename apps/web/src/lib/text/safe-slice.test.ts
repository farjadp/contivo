import { describe, expect, it } from 'vitest';

import { safeSlice } from './safe-slice';

const isWellFormed = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe('safeSlice', () => {
  it('never leaves a lone high surrogate when the cut lands inside a pair', () => {
    const title = `${'a'.repeat(119)}🇨🇦 Detour`;
    const out = safeSlice(title, 120);
    expect(out).toBe('a'.repeat(119));
    expect(isWellFormed(out)).toBe(true);
    expect(() => JSON.parse(JSON.stringify({ t: out }))).not.toThrow();
  });

  it('keeps a whole pair that fits', () => {
    expect(safeSlice(`${'a'.repeat(118)}🇨🇦`, 120)).toBe(`${'a'.repeat(118)}🇨`);
    expect(safeSlice(`${'a'.repeat(116)}🇨🇦`, 120)).toBe(`${'a'.repeat(116)}🇨🇦`);
  });

  it('is a plain slice for ASCII and for text shorter than the limit', () => {
    expect(safeSlice('hello world', 5)).toBe('hello');
    expect(safeSlice('hi', 5)).toBe('hi');
    expect(safeSlice('سلام دنیا', 4)).toBe('سلام');
  });
});

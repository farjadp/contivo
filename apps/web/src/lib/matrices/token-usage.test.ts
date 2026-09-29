import { describe, expect, it } from 'vitest';

import { matricesTokenUsage } from './token-usage';

describe('matricesTokenUsage', () => {
  it('sums the workspace runs rather than presenting one run as the lifetime total', () => {
    expect(matricesTokenUsage({ runs: 3, tokens: 9000 }, { tokens_used: 2500 })).toEqual({
      runs: 3,
      lifetime_total_tokens: 9000,
    });
  });

  it('uses the legacy lifetime object when no run has spent tokens yet', () => {
    const legacy = { runs: 4, lifetime_total_tokens: 12000, last_run: { model: 'gpt-4.1' } };
    expect(matricesTokenUsage({ runs: 0, tokens: 0 }, { token_usage: legacy })).toBe(legacy);
  });

  it('is null with neither', () => {
    expect(matricesTokenUsage({ runs: 0, tokens: 0 }, null)).toBeNull();
    expect(matricesTokenUsage({ runs: 0, tokens: 0 }, { tokens_used: 2500 })).toBeNull();
  });
});

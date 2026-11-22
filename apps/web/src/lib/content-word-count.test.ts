import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONTENT_WORD_COUNT_LIMITS,
  normalizeWordCountLimits,
  resolveWordCountPlatformKey,
} from './content-word-count';

describe('telegram word counts', () => {
  it('a telegram item gets its own range, not LinkedIn’s', () => {
    expect(resolveWordCountPlatformKey('telegram')).toBe('telegram');
    expect(resolveWordCountPlatformKey('linkedin')).toBe('linkedin');
    expect(resolveWordCountPlatformKey('twitter')).toBe('twitter');
  });

  it('settings saved before telegram existed fall back to its default', () => {
    const limits = normalizeWordCountLimits({ linkedin: { min: 300, max: 400 } });
    expect(limits.telegram).toEqual(DEFAULT_CONTENT_WORD_COUNT_LIMITS.telegram);
    expect(limits.linkedin).toEqual({ min: 300, max: 400 });
  });
});

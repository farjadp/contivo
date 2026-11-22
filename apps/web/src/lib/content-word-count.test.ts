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

describe('resolveWordCountPlatformKey', () => {
  // The old rule was includes('x'): "text post" and "example" got Twitter's word range.
  it.each([
    ['linkedin', 'linkedin'],
    ['LinkedIn text post (strong opinion, reason, example)', 'linkedin'],
    ['explainer', 'linkedin'],
    ['x', 'twitter'],
    ['twitter', 'twitter'],
    ['X / Twitter thread', 'twitter'],
    ['thread', 'twitter'],
    ['twitter_thread', 'twitter'],
    ['blog', 'blog'],
    ['blog_article', 'blog'],
    ['Long-form article', 'blog'],
    ['email', 'email'],
    ['Email newsletter', 'email'],
    ['instagram', 'instagram'],
    ['insta caption', 'instagram'],
    ['', 'linkedin'],
    [null, 'linkedin'],
  ])('%s → %s', (value, platform) => {
    expect(resolveWordCountPlatformKey(value)).toBe(platform);
  });
});

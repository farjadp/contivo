import { describe, expect, it } from 'vitest';
import { resolveWordCountPlatformKey } from './content-word-count';

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

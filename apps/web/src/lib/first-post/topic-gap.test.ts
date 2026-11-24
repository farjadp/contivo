import { describe, expect, it } from 'vitest';

import { matchTopicGap } from './topic-gap';

const GAPS = ['Artisan Baking Education', 'Seasonal menu stories', 'Wholesale for cafés'];

describe('matchTopicGap', () => {
  it('finds the gap a draft topic is about, ignoring case and punctuation', () => {
    expect(matchTopicGap(GAPS, 'Artisan baking education: why we teach')).toBe('Artisan Baking Education');
    expect(matchTopicGap(GAPS, 'Our seasonal-menu stories, told by the bakers')).toBe('Seasonal menu stories');
  });

  it('matches on most of the gap words, not only an exact phrase', () => {
    expect(matchTopicGap(GAPS, 'What baking education gives an artisan')).toBe('Artisan Baking Education');
  });

  it('returns null for a draft about something else (no stale top gap)', () => {
    expect(matchTopicGap(GAPS, 'How we source our flour')).toBeNull();
    expect(matchTopicGap(GAPS, '')).toBeNull();
    expect(matchTopicGap([], 'Artisan Baking Education')).toBeNull();
  });

  it('works for Persian text', () => {
    expect(matchTopicGap(['آموزش نان‌پزی', 'منوی فصلی'], 'چرا آموزش نان‌پزی برای ما مهم است')).toBe('آموزش نان‌پزی');
  });
});

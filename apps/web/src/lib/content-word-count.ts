export type WordCountPlatform = 'blog' | 'linkedin' | 'twitter' | 'email' | 'instagram';

export type WordCountRange = {
  min: number;
  max: number;
};

export type ContentWordCountLimits = Record<WordCountPlatform, WordCountRange>;

export const WORD_COUNT_LIMIT_ABSOLUTE_MIN = 10;
export const WORD_COUNT_LIMIT_ABSOLUTE_MAX = 5000;

export const WORD_COUNT_PLATFORM_LABELS: Record<WordCountPlatform, string> = {
  blog: 'Blog / Article',
  linkedin: 'LinkedIn',
  twitter: 'Twitter / X',
  email: 'Email',
  instagram: 'Instagram',
};

export const WORD_COUNT_PLATFORMS: WordCountPlatform[] = [
  'blog',
  'linkedin',
  'twitter',
  'email',
  'instagram',
];

export const DEFAULT_CONTENT_WORD_COUNT_LIMITS: ContentWordCountLimits = {
  blog: { min: 600, max: 2200 },
  linkedin: { min: 80, max: 450 },
  twitter: { min: 20, max: 280 },
  email: { min: 120, max: 1200 },
  instagram: { min: 30, max: 220 },
};

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

export function normalizeWordCountRange(
  range: Partial<WordCountRange> | null | undefined,
  fallback: WordCountRange,
): WordCountRange {
  const fallbackMin = Math.max(
    WORD_COUNT_LIMIT_ABSOLUTE_MIN,
    Math.min(WORD_COUNT_LIMIT_ABSOLUTE_MAX, fallback.min),
  );
  const fallbackMax = Math.max(
    fallbackMin,
    Math.max(WORD_COUNT_LIMIT_ABSOLUTE_MIN, Math.min(WORD_COUNT_LIMIT_ABSOLUTE_MAX, fallback.max)),
  );

  const rawMin = toInt(range?.min);
  const rawMax = toInt(range?.max);

  const min = rawMin == null
    ? fallbackMin
    : Math.max(WORD_COUNT_LIMIT_ABSOLUTE_MIN, Math.min(WORD_COUNT_LIMIT_ABSOLUTE_MAX, rawMin));
  const maxSeed = rawMax == null
    ? fallbackMax
    : Math.max(WORD_COUNT_LIMIT_ABSOLUTE_MIN, Math.min(WORD_COUNT_LIMIT_ABSOLUTE_MAX, rawMax));
  const max = Math.max(min, maxSeed);

  return { min, max };
}

export function normalizeWordCountLimits(raw: unknown): ContentWordCountLimits {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const next = {} as ContentWordCountLimits;

  for (const platform of WORD_COUNT_PLATFORMS) {
    next[platform] = normalizeWordCountRange(
      source[platform] as Partial<WordCountRange> | null | undefined,
      DEFAULT_CONTENT_WORD_COUNT_LIMITS[platform],
    );
  }

  return next;
}

export function resolveWordCountPlatformKey(value: unknown): WordCountPlatform {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'linkedin';

  if (
    normalized.includes('blog') ||
    normalized.includes('article') ||
    normalized.includes('blog_article')
  ) {
    return 'blog';
  }

  if (
    normalized.includes('twitter') ||
    normalized.includes('x') ||
    normalized.includes('thread') ||
    normalized.includes('twitter_thread')
  ) {
    return 'twitter';
  }

  if (normalized.includes('email') || normalized.includes('newsletter')) {
    return 'email';
  }

  if (normalized.includes('instagram') || normalized.includes('insta')) {
    return 'instagram';
  }

  return 'linkedin';
}

export function midpointWordCount(range: WordCountRange): number {
  return Math.round((range.min + range.max) / 2);
}

export function clampWordCount(
  value: unknown,
  range: WordCountRange,
  fallback?: number,
): number {
  const parsed = toInt(value);
  const fallbackValue = fallback ?? midpointWordCount(range);
  if (parsed == null) {
    return Math.max(range.min, Math.min(range.max, fallbackValue));
  }
  return Math.max(range.min, Math.min(range.max, parsed));
}

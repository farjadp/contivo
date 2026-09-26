import { describe, expect, it } from 'vitest';
import {
  MAX_ENRICHED,
  buildEnrichedCandidate,
  detectPageLanguage,
  extractHtmlLangAttr,
  extractTitle,
  forceIsCompetitorFalseWhenLabelsEmpty,
  mapCertaintyToConfidence,
  normalizeJudgedType,
  normalizeLabels,
  pickTopCandidates,
} from './judge';
import type { Candidate } from './types';

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    domain: 'example.com',
    frequency: 1,
    sources: ['WEB_SEARCH'],
    evidence: [],
    ...overrides,
  };
}

describe('extractHtmlLangAttr', () => {
  it('reads the lang attribute off <html>', () => {
    expect(extractHtmlLangAttr('<html lang="fa-IR"><head></head></html>')).toBe('fa-ir');
  });

  it('returns null when there is no lang attribute', () => {
    expect(extractHtmlLangAttr('<html><head></head></html>')).toBeNull();
  });
});

describe('extractTitle', () => {
  it('reads and decodes the first <title>', () => {
    expect(extractTitle('<title>Sazito &amp; Co</title>')).toBe('Sazito & Co');
  });

  it('returns null when there is no title tag', () => {
    expect(extractTitle('<html><body>hi</body></html>')).toBeNull();
  });
});

describe('detectPageLanguage', () => {
  it('uses the html lang attribute when present, reduced to its primary subtag', () => {
    expect(detectPageLanguage('fa-IR', 'anything, ignored when lang is present')).toBe('fa');
    expect(detectPageLanguage('en-US', 'irrelevant text')).toBe('en');
  });

  it('falls back to the Arabic-block heuristic when lang is absent: >30% Arabic-block chars means fa', () => {
    const mostlyPersian = 'سلام این یک متن فارسی است برای آزمایش تشخیص زبان صفحه در نبود ویژگی زبان';
    expect(detectPageLanguage(null, mostlyPersian)).toBe('fa');
  });

  it('falls back to en when Arabic-block chars are 30% or less of the text', () => {
    const mostlyEnglish = 'This is an English marketing page about accounting software with a tiny bit of فارسی mixed in.';
    expect(detectPageLanguage(null, mostlyEnglish)).toBe('en');
  });

  it('treats empty evidence text as en rather than dividing by zero', () => {
    expect(detectPageLanguage(null, '')).toBe('en');
  });
});

describe('pickTopCandidates', () => {
  it('sorts by frequency descending and caps at max', () => {
    const candidates = [
      makeCandidate({ domain: 'low.com', frequency: 1 }),
      makeCandidate({ domain: 'high.com', frequency: 5 }),
      makeCandidate({ domain: 'mid.com', frequency: 3 }),
    ];

    const picked = pickTopCandidates(candidates, 2);

    expect(picked.map((c) => c.domain)).toEqual(['high.com', 'mid.com']);
  });

  it('applies the MAX_ENRICHED constant as the real cut in production use', () => {
    const candidates = Array.from({ length: 25 }, (_, i) =>
      makeCandidate({ domain: `d${i}.com`, frequency: i }),
    );

    const picked = pickTopCandidates(candidates, MAX_ENRICHED);

    expect(picked).toHaveLength(MAX_ENRICHED);
    expect(picked[0].domain).toBe('d24.com'); // highest frequency first
  });

  it('does not mutate the input array', () => {
    const candidates = [makeCandidate({ domain: 'a.com', frequency: 1 }), makeCandidate({ domain: 'b.com', frequency: 9 })];
    const original = [...candidates];

    pickTopCandidates(candidates, 10);

    expect(candidates).toEqual(original);
  });
});

describe('buildEnrichedCandidate', () => {
  it('drops a candidate with no scanned pages (unreachable site)', () => {
    const candidate = makeCandidate();
    const result = buildEnrichedCandidate(candidate, { pages: [], evidence: '', htmlLang: null });
    expect(result).toBeNull();
  });

  it('caps appended site evidence items at 3 even when more pages were scanned', () => {
    const candidate = makeCandidate({ evidence: [] });
    const site = {
      pages: [
        { url: 'https://example.com/', title: 'Home' },
        { url: 'https://example.com/about', title: 'About' },
        { url: 'https://example.com/pricing', title: 'Pricing' },
        { url: 'https://example.com/blog', title: 'Blog' },
        { url: 'https://example.com/products', title: 'Products' },
      ],
      evidence: 'some evidence text',
      htmlLang: 'en',
    };

    const result = buildEnrichedCandidate(candidate, site);

    expect(result).not.toBeNull();
    const siteItems = result!.evidence.filter((item) => item.kind === 'site');
    expect(siteItems).toHaveLength(3);
    expect(siteItems.map((item) => item.url)).toEqual([
      'https://example.com/',
      'https://example.com/about',
      'https://example.com/pricing',
    ]);
  });

  it('sets siteTitle from the first scanned page title, siteEvidence from the evidence text, and pageLanguage from detection', () => {
    const candidate = makeCandidate();
    const site = {
      pages: [{ url: 'https://example.com/', title: 'Example Home' }],
      evidence: 'English marketing copy',
      htmlLang: 'en',
    };

    const result = buildEnrichedCandidate(candidate, site);

    expect(result?.siteTitle).toBe('Example Home');
    expect(result?.siteEvidence).toBe('English marketing copy');
    expect(result?.pageLanguage).toBe('en');
  });

  it('preserves the candidate\'s existing evidence and appends site evidence after it', () => {
    const candidate = makeCandidate({
      evidence: [{ id: 'abcd1234', kind: 'citation', url: 'https://example.com/x' }],
    });
    const site = {
      pages: [{ url: 'https://example.com/', title: 'Home' }],
      evidence: 'text',
      htmlLang: 'en',
    };

    const result = buildEnrichedCandidate(candidate, site);

    expect(result?.evidence).toHaveLength(2);
    expect(result?.evidence[0].kind).toBe('citation');
    expect(result?.evidence[1].kind).toBe('site');
  });
});

describe('normalizeLabels', () => {
  it('keeps only SEO and BUSINESS, dropping anything else', () => {
    expect(normalizeLabels(['SEO', 'BUSINESS', 'nonsense', 42, null])).toEqual(['SEO', 'BUSINESS']);
  });

  it('returns an empty array for non-array input', () => {
    expect(normalizeLabels(undefined)).toEqual([]);
    expect(normalizeLabels('SEO')).toEqual([]);
  });
});

describe('normalizeJudgedType', () => {
  it('recognizes INDIRECT and ASPIRATIONAL, defaulting anything else to DIRECT', () => {
    expect(normalizeJudgedType('INDIRECT')).toBe('INDIRECT');
    expect(normalizeJudgedType('ASPIRATIONAL')).toBe('ASPIRATIONAL');
    expect(normalizeJudgedType('DIRECT')).toBe('DIRECT');
    expect(normalizeJudgedType('garbage')).toBe('DIRECT');
    expect(normalizeJudgedType(undefined)).toBe('DIRECT');
  });
});

describe('mapCertaintyToConfidence', () => {
  it('maps each of the three recognised buckets to its fixed number', () => {
    expect(mapCertaintyToConfidence('certain')).toBe(0.9);
    expect(mapCertaintyToConfidence('likely')).toBe(0.7);
    expect(mapCertaintyToConfidence('unsure')).toBe(0.5);
  });

  it('rejects an unrecognised value rather than defaulting to a passing number', () => {
    expect(mapCertaintyToConfidence('very certain')).toBeNull();
    expect(mapCertaintyToConfidence('CERTAIN')).toBeNull();
    expect(mapCertaintyToConfidence(1)).toBeNull();
    expect(mapCertaintyToConfidence(undefined)).toBeNull();
    expect(mapCertaintyToConfidence(null)).toBeNull();
  });
});

describe('forceIsCompetitorFalseWhenLabelsEmpty', () => {
  it('forces isCompetitor to false when labels is empty, even if the model said true', () => {
    expect(forceIsCompetitorFalseWhenLabelsEmpty(true, [])).toBe(false);
  });

  it('leaves isCompetitor as-is when labels is non-empty', () => {
    expect(forceIsCompetitorFalseWhenLabelsEmpty(true, ['SEO'])).toBe(true);
    expect(forceIsCompetitorFalseWhenLabelsEmpty(false, ['BUSINESS'])).toBe(false);
  });
});

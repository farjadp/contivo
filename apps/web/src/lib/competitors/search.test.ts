import { describe, expect, it } from 'vitest';
import { mergeQueryResults, type QueryHarvestResult } from './search';

describe('mergeQueryResults', () => {
  it('gives frequency 2 to a domain cited by two different queries', () => {
    const results: QueryHarvestResult[] = [
      {
        query: 'store builder iran',
        citations: [{ url: 'https://sazito.com/pricing', title: 'Sazito' }],
        sourceUrls: [],
      },
      {
        query: 'shopify alternative iran',
        citations: [{ url: 'https://sazito.com/features', title: 'Sazito features' }],
        sourceUrls: [],
      },
    ];

    const candidates = mergeQueryResults(results, new Set());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].domain).toBe('sazito.com');
    expect(candidates[0].frequency).toBe(2);
    expect(candidates[0].sources).toEqual(['WEB_SEARCH']);
  });

  it('never creates a candidate from a domain seen only in sources', () => {
    const results: QueryHarvestResult[] = [
      {
        query: 'store builder iran',
        citations: [{ url: 'https://sazito.com/pricing' }],
        sourceUrls: ['https://noise-mirror.example.com', 'https://hesabshop.com'],
      },
    ];

    const candidates = mergeQueryResults(results, new Set());

    expect(candidates.map((c) => c.domain)).toEqual(['sazito.com']);
    expect(candidates.find((c) => c.domain === 'hesabshop.com')).toBeUndefined();
  });

  it('lets a source-only appearance raise the frequency of a domain an annotation already produced', () => {
    const results: QueryHarvestResult[] = [
      {
        query: 'store builder iran',
        citations: [{ url: 'https://sazito.com/pricing' }],
        sourceUrls: [],
      },
      {
        query: 'shopify alternative iran',
        citations: [],
        sourceUrls: ['https://sazito.com'],
      },
    ];

    const candidates = mergeQueryResults(results, new Set());

    expect(candidates).toHaveLength(1);
    expect(candidates[0].domain).toBe('sazito.com');
    expect(candidates[0].frequency).toBe(2);
  });

  it('never lets a domain in the exclude set appear', () => {
    const results: QueryHarvestResult[] = [
      {
        query: 'store builder iran',
        citations: [{ url: 'https://sazito.com/pricing' }, { url: 'https://hesabshop.com' }],
        sourceUrls: [],
      },
    ];

    const candidates = mergeQueryResults(results, new Set(['sazito.com']));

    expect(candidates.map((c) => c.domain)).toEqual(['hesabshop.com']);
  });

  it('caps evidence at 6 items per domain even with more citations', () => {
    const citations = Array.from({ length: 9 }, (_, i) => ({ url: `https://sazito.com/page-${i}` }));
    const results: QueryHarvestResult[] = [
      { query: 'q1', citations, sourceUrls: [] },
    ];

    const candidates = mergeQueryResults(results, new Set());

    expect(candidates[0].evidence).toHaveLength(6);
  });

  it('drops URLs that normalize to null (excluded or unusable) without crashing', () => {
    const results: QueryHarvestResult[] = [
      {
        query: 'q1',
        citations: [{ url: 'https://t.me/somechannel' }, { url: 'https://sazito.com' }],
        sourceUrls: [],
      },
    ];

    const candidates = mergeQueryResults(results, new Set());

    expect(candidates.map((c) => c.domain)).toEqual(['sazito.com']);
  });
});

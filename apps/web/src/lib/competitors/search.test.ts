import { afterEach, describe, expect, it, vi } from 'vitest';
import { harvestFromWebSearch, mergeQueryResults, type QueryHarvestResult } from './search';

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

  it('counts a source-only appearance in an EARLIER query toward a domain cited only in a LATER query', () => {
    // Regression for order-dependent undercounting: query order is
    // LLM-generated and arbitrary, so the source-only occurrence must count
    // even when it comes before the citation that legitimizes the domain.
    const results: QueryHarvestResult[] = [
      {
        query: 'shopify alternative iran',
        citations: [],
        sourceUrls: ['https://sazito.com'],
      },
      {
        query: 'store builder iran',
        citations: [{ url: 'https://sazito.com/pricing' }],
        sourceUrls: [],
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

describe('harvestFromWebSearch error handling', () => {
  const ORIGINAL_KEY = process.env.OPENAI_API_KEY;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_KEY === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    }
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      harvestFromWebSearch(['some query'], { country: null, language: 'en' }, new Set()),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('pushes a non-200 response to errors without aborting the harvest', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const isFailingQuery = body.input.includes('failing query');

      if (isFailingQuery) {
        return {
          ok: false,
          status: 500,
          text: async () => 'internal server error',
        } as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          output: [
            {
              type: 'message',
              content: [
                {
                  annotations: [{ url: 'https://example-competitor.com/pricing', title: 'Example Competitor' }],
                },
              ],
            },
            {
              type: 'web_search_call',
              action: { sources: [{ url: 'https://noise.example.com' }] },
            },
          ],
          usage: { total_tokens: 42 },
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const { candidates, errors, tokens } = await harvestFromWebSearch(
      ['failing query', 'working query'],
      { country: null, language: 'en' },
      new Set(),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/failing query/);
    expect(errors[0]).toMatch(/500/);

    expect(candidates.map((c) => c.domain)).toEqual(['example-competitor.com']);
    expect(tokens).toBe(42);
  });
});

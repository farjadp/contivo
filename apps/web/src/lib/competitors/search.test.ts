import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Usage logging is exercised in ai-usage.test.ts; here it must not reach a database.
// The failover layer is mocked: no network.
const { recordAiUsageMock, runAiTaskMock } = vi.hoisted(() => ({
  recordAiUsageMock: vi.fn(async () => {}),
  runAiTaskMock: vi.fn(),
}));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-usage')>()),
  recordAiUsage: recordAiUsageMock,
}));
import { harvestFromSerp, harvestFromWebSearch, mergeQueryResults, type QueryHarvestResult } from './search';

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
  beforeEach(() => {
    runAiTaskMock.mockReset();
  });

  function searchSuccess(provider: 'openai' | 'anthropic' | 'gemini', webSearch: unknown) {
    return {
      ok: true,
      provider,
      model: provider === 'anthropic' ? 'claude-sonnet-5-5' : 'gpt-5-mini',
      text: 'answer',
      usage: { promptTokens: 20, completionTokens: 22, totalTokens: 42 },
      failedOver: [],
      webSearch,
    };
  }

  it('needs no OPENAI_API_KEY of its own: the layer skips unconfigured providers', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    runAiTaskMock.mockResolvedValue(searchSuccess('anthropic', { query: '', citations: [{ url: 'https://rival.example.com/', title: 'Rival' }], sourceUrls: [] }));

    await expect(
      harvestFromWebSearch(['some query'], { country: null, language: 'en' }, new Set()),
    ).resolves.toMatchObject({ errors: [] });
    vi.unstubAllEnvs();
  });

  it('pushes a failed chain to errors without aborting the harvest', async () => {
    runAiTaskMock.mockImplementation(async (_task: string, request: { prompt: string }) => {
      if (request.prompt.includes('failing query')) {
        return {
          ok: false,
          kind: 'all_unavailable',
          attempts: [
            { provider: 'openai', errorClass: 'server', status: 500, message: 'internal server error' },
            { provider: 'anthropic', errorClass: 'overloaded', status: 529, message: 'overloaded' },
          ],
          firstErrorClass: 'server',
          allRateLimited: false,
        };
      }
      return searchSuccess('openai', {
        query: 'provider wording',
        citations: [{ url: 'https://example-competitor.com/pricing', title: 'Example Competitor' }],
        sourceUrls: ['https://noise.example.com'],
      });
    });

    const { candidates, errors, tokens } = await harvestFromWebSearch(
      ['failing query', 'working query'],
      { country: null, language: 'en' },
      new Set(),
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/failing query/);
    expect(errors[0]).toMatch(/500/);
    expect(errors[0]).not.toContain('internal server error');

    expect(candidates.map((c) => c.domain)).toEqual(['example-competitor.com']);
    // Our query label, not the provider's wording.
    expect(candidates[0].evidence[0].query).toBe('working query');
    expect(tokens).toBe(42);
  });

  it('a Claude-shaped web search result flows into the same candidates as an OpenAI one', async () => {
    const webSearch = {
      query: '',
      citations: [
        { url: 'https://www.rival-one.com/pricing', title: 'Rival One' },
        { url: 'https://rival-two.ir/', title: 'Rival Two' },
      ],
      sourceUrls: ['https://rival-two.ir/about', 'https://noise.example.com'],
    };
    runAiTaskMock.mockResolvedValueOnce(searchSuccess('openai', webSearch));
    const fromOpenAi = await harvestFromWebSearch(['q'], { country: 'IR', language: 'fa' }, new Set());
    runAiTaskMock.mockResolvedValueOnce(searchSuccess('anthropic', webSearch));
    const fromClaude = await harvestFromWebSearch(['q'], { country: 'IR', language: 'fa' }, new Set());

    const shape = (r: typeof fromOpenAi) =>
      r.candidates.map((c) => ({ domain: c.domain, frequency: c.frequency, urls: c.evidence.map((e) => e.url), q: c.evidence[0].query }));
    expect(shape(fromClaude)).toEqual(shape(fromOpenAi));
    expect(shape(fromClaude)).toEqual([
      { domain: 'rival-one.com', frequency: 1, urls: ['https://www.rival-one.com/pricing'], q: 'q' },
      { domain: 'rival-two.ir', frequency: 1, urls: ['https://rival-two.ir/'], q: 'q' },
    ]);
    expect(fromClaude.errors).toEqual([]);
  });

  it('an answer without web search data is an error, not an empty result', async () => {
    runAiTaskMock.mockResolvedValue(searchSuccess('gemini', undefined));

    const { candidates, errors } = await harvestFromWebSearch(['q'], { country: null, language: 'en' }, new Set());

    expect(candidates).toEqual([]);
    expect(errors).toEqual(['Search query for "q" returned no web search results (gemini)']);
  });

  it('a search that cites nothing is an error, not an empty market', async () => {
    // Live 22 Nov: Claude searched (9 sources) but wrote the companies'
    // homepages itself and cited none. Citations are the only thing that may
    // create a candidate, so this used to end the run EMPTY ("no competitors")
    // when the real cause was the provider.
    runAiTaskMock.mockResolvedValue(
      searchSuccess('anthropic', { query: 'q', citations: [], sourceUrls: ['https://listicle.example.com/best-tools'] }),
    );

    const { candidates, errors } = await harvestFromWebSearch(['q'], { country: null, language: 'en' }, new Set());

    expect(candidates).toEqual([]);
    expect(errors).toEqual(['Search query for "q" returned no citations (anthropic, 1 sources)']);
  });

  it('a provider that reports no usage gives tokens null, not 0', async () => {
    runAiTaskMock.mockResolvedValue({
      ...searchSuccess('anthropic', { query: '', citations: [{ url: 'https://rival.example.com/', title: 'Rival' }], sourceUrls: [] }),
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });

    const { tokens } = await harvestFromWebSearch(['q'], { country: null, language: 'en' }, new Set());

    expect(tokens).toBeNull();
  });
});

describe('harvestFromSerp (unbuilt source)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports no error when DataForSEO credentials exist: an unbuilt source is off, not failed', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', 'login');
    vi.stubEnv('DATAFORSEO_PASSWORD', 'password');

    const result = await harvestFromSerp(['q'], { country: 'IR', language: 'fa' }, new Set());

    expect(result).toEqual({ candidates: [], tokens: 0, errors: [] });
  });

  it('reports no error without credentials either', async () => {
    vi.stubEnv('DATAFORSEO_LOGIN', '');
    vi.stubEnv('DATAFORSEO_PASSWORD', '');

    const result = await harvestFromSerp(['q'], { country: null, language: 'en' }, new Set());

    expect(result.errors).toEqual([]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JUDGE_KEY_FEATURE_MAX_CHARS,
  JUDGE_MAX_KEY_FEATURES,
  JUDGE_NAME_MAX_CHARS,
  JUDGE_POSITIONING_MAX_CHARS,
  judgeCandidates,
} from './judge';
import { generateQueries, type BrandBrief } from './queries';
import { harvestFromWebSearch } from './search';
import type { EnrichedCandidate } from './types';

// Every OpenAI call the discovery pipeline makes must carry an AbortSignal,
// so a hung call ends on its own deadline instead of undici's 300 s default
// (Railway kills nothing). No real network: fetch is stubbed.

function brief(): BrandBrief {
  return {
    companyName: 'Acme',
    ownDomain: 'acme.com',
    summary: 'Acme sells rockets.',
    valueProposition: 'Cheap rockets.',
    industry: 'Aerospace',
    audience: 'Operators',
    market: { country: null, language: 'en' },
    acceptedCompetitors: [],
    rejectedCompetitors: [],
    knownDomains: [],
  };
}

function enriched(domain: string): EnrichedCandidate {
  return {
    domain,
    frequency: 1,
    sources: ['WEB_SEARCH'],
    evidence: [],
    siteTitle: 'Rival',
    siteEvidence: 'We sell rockets.',
    pageLanguage: 'en',
  };
}

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test-not-real');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('OpenAI calls carry a timeout signal', () => {
  it('generateQueries', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '{"queries":["a","b"]}' } }], usage: { total_tokens: 1 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await generateQueries(brief()).catch(() => undefined);

    expect(fetchMock).toHaveBeenCalled();
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('harvestFromWebSearch', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ output: [], usage: { total_tokens: 1 } }));
    vi.stubGlobal('fetch', fetchMock);

    await harvestFromWebSearch(['q'], { country: null, language: 'en' }, new Set());

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('judgeCandidates', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: '{"results":[]}' } }], usage: { total_tokens: 1 } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await judgeCandidates(brief(), [enriched('rival.com')]);

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('judgeCandidates reports batch failures instead of hiding them', () => {
  it('returns every error and failedBatches === batches when every batch fails (e.g. a 429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, text: async () => 'Rate limit reached' }) as Response),
    );

    // 7 candidates at 5 per batch = 2 batches.
    const candidates = Array.from({ length: 7 }, (_, i) => enriched(`rival-${i}.com`));
    const result = await judgeCandidates(brief(), candidates);

    expect(result.judged).toEqual([]);
    expect(result.batches).toBe(2);
    expect(result.failedBatches).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('429');
  });

  it('counts a partial failure: one batch fails, one succeeds', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) return { ok: false, status: 500, text: async () => 'boom' } as Response;
        return jsonResponse({ choices: [{ message: { content: '{"results":[]}' } }], usage: { total_tokens: 3 } });
      }),
    );

    const candidates = Array.from({ length: 7 }, (_, i) => enriched(`rival-${i}.com`));
    const result = await judgeCandidates(brief(), candidates);

    expect(result.batches).toBe(2);
    expect(result.failedBatches).toBe(1);
    expect(result.errors).toHaveLength(1);
  });
});

describe('judge free text is length-capped on parse', () => {
  it('truncates name, positioning and key features, and caps the feature count', async () => {
    const long = 'x'.repeat(5000);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  results: [
                    {
                      domain: 'rival.com',
                      name: long,
                      isCompetitor: true,
                      labels: ['BUSINESS'],
                      type: 'DIRECT',
                      scaleMatch: true,
                      certainty: 'certain',
                      reason: long,
                      positioning: long,
                      keyFeatures: Array.from({ length: 50 }, () => long),
                      description: long,
                    },
                  ],
                }),
              },
            },
          ],
          usage: { total_tokens: 1 },
        }),
      ),
    );

    const { judged } = await judgeCandidates(brief(), [enriched('rival.com')]);

    expect(judged).toHaveLength(1);
    expect(judged[0].name.length).toBe(JUDGE_NAME_MAX_CHARS);
    expect(judged[0].positioning?.length).toBe(JUDGE_POSITIONING_MAX_CHARS);
    expect(judged[0].keyFeatures).toHaveLength(JUDGE_MAX_KEY_FEATURES);
    expect(judged[0].keyFeatures.every((f) => f.length === JUDGE_KEY_FEATURE_MAX_CHARS)).toBe(true);
    expect(judged[0].description.length).toBeLessThan(long.length);
    expect(judged[0].reason.length).toBeLessThan(long.length);
  });
});

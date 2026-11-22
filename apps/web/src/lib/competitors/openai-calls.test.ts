import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiFailure, AiSuccess } from '@/lib/ai';

// Every discovery AI call goes through the failover layer (lib/ai), which
// records usage itself. No real network: runAiTask is mocked.
const { runAiTaskMock, recordAiUsageMock } = vi.hoisted(() => ({
  runAiTaskMock: vi.fn(),
  recordAiUsageMock: vi.fn(async () => {}),
}));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-usage')>()),
  recordAiUsage: recordAiUsageMock,
}));

import {
  JUDGE_KEY_FEATURE_MAX_CHARS,
  JUDGE_MAX_KEY_FEATURES,
  JUDGE_NAME_MAX_CHARS,
  JUDGE_POSITIONING_MAX_CHARS,
  JUDGE_REQUEST_TIMEOUT_MS,
  judgeCandidates,
} from './judge';
import { generateQueries, QUERY_REQUEST_TIMEOUT_MS, type BrandBrief } from './queries';
import { classifyRunError, RUN_ERROR, withRunErrorCode } from './run-errors';
import { harvestFromWebSearch, SEARCH_REQUEST_TIMEOUT_MS } from './search';
import type { EnrichedCandidate } from './types';

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

function ok(json: unknown, overrides: Partial<AiSuccess> = {}): AiSuccess {
  return {
    ok: true,
    provider: 'openai',
    model: 'gpt-4.1',
    text: JSON.stringify(json),
    json,
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    failedOver: [],
    ...overrides,
  };
}

const billingOutage: AiFailure = {
  ok: false,
  kind: 'all_unavailable',
  attempts: [
    { provider: 'openai', errorClass: 'billing', status: 429, message: 'insufficient_quota' },
    { provider: 'anthropic', errorClass: 'not_configured', message: 'skipped' },
    { provider: 'gemini', errorClass: 'not_configured', message: 'skipped' },
  ],
  firstErrorClass: 'billing',
  allRateLimited: false,
};

const allRateLimited: AiFailure = {
  ok: false,
  kind: 'all_unavailable',
  attempts: [
    { provider: 'openai', errorClass: 'rate_limit', status: 429, message: 'Rate limit reached' },
    { provider: 'anthropic', errorClass: 'rate_limit', status: 429, message: 'rate_limit_error' },
  ],
  firstErrorClass: 'rate_limit',
  allRateLimited: true,
};

beforeEach(() => {
  runAiTaskMock.mockReset();
  recordAiUsageMock.mockClear();
});

describe('discovery AI calls use the failover layer with the right task and timeout', () => {
  it('generateQueries: competitor_queries, json_object, 60 s, ctx passed through', async () => {
    runAiTaskMock.mockResolvedValue(ok({ queries: ['a', 'b', 'a'] }));
    const ctx = { workspaceId: 'ws1', userId: 'u1' };

    const result = await generateQueries(brief(), ctx);

    expect(result).toEqual({ queries: ['a', 'b'], tokens: 3 });
    const [task, request, passedCtx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('competitor_queries');
    expect(request.output).toEqual({ kind: 'json_object' });
    expect(request.timeoutMs).toBe(QUERY_REQUEST_TIMEOUT_MS);
    expect(request.prompt).toContain('web search queries');
    expect(passedCtx).toEqual(ctx);
    // The layer records usage; the call site must not double count.
    expect(recordAiUsageMock).not.toHaveBeenCalled();
  });

  it('harvestFromWebSearch: competitor_web_search, webSearch with country, 150 s, no hardcoded model', async () => {
    runAiTaskMock.mockResolvedValue(
      ok(undefined, { text: 'answer', json: undefined, webSearch: { query: '', citations: [], sourceUrls: [] } }),
    );

    await harvestFromWebSearch(['q'], { country: 'IR', language: 'fa' }, new Set());

    const [task, request] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('competitor_web_search');
    expect(request.webSearch).toEqual({ country: 'IR' });
    expect(request.timeoutMs).toBe(SEARCH_REQUEST_TIMEOUT_MS);
    expect(SEARCH_REQUEST_TIMEOUT_MS).toBe(150_000);
    expect(request.modelOverride).toBeUndefined();
    expect(request.output).toEqual({ kind: 'text' });
    expect(recordAiUsageMock).not.toHaveBeenCalled();
  });

  it('judgeCandidates: competitor_judge, strict json_schema, 90 s', async () => {
    runAiTaskMock.mockResolvedValue(ok({ results: [] }));

    await judgeCandidates(brief(), [enriched('rival.com')]);

    const [task, request] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('competitor_judge');
    expect(request.output.kind).toBe('json_schema');
    expect(request.output.name).toBe('competitor_judgments');
    expect(request.output.schema).toMatchObject({ type: 'object', required: ['results'] });
    expect(request.timeoutMs).toBe(JUDGE_REQUEST_TIMEOUT_MS);
    expect(JUDGE_REQUEST_TIMEOUT_MS).toBe(90_000);
    expect(recordAiUsageMock).not.toHaveBeenCalled();
  });
});

describe('a failed chain maps to the honest run error', () => {
  it('generateQueries throws AI_UNAVAILABLE on a billing outage, never a rate-limit message', async () => {
    runAiTaskMock.mockResolvedValue(billingOutage);

    const error = await generateQueries(brief()).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^AI_UNAVAILABLE: Query generation failed/);
    expect(classifyRunError((error as Error).message)).toBe('aiUnavailable');
  });

  it('generateQueries: every provider rate limited -> rateLimited', async () => {
    runAiTaskMock.mockResolvedValue(allRateLimited);

    const error = (await generateQueries(brief()).catch((e: Error) => e)) as Error;

    expect(classifyRunError(error.message)).toBe('rateLimited');
  });

  it('search: a billing outage on every query yields AI_UNAVAILABLE errors', async () => {
    runAiTaskMock.mockResolvedValue(billingOutage);

    const result = await harvestFromWebSearch(['q1', 'q2'], { country: null, language: 'en' }, new Set());

    expect(result.candidates).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatch(/^AI_UNAVAILABLE: Search query failed for "q1"/);
  });
});

describe('judgeCandidates reports batch failures instead of hiding them', () => {
  it('returns every error and failedBatches === batches when every batch fails (e.g. a 429)', async () => {
    runAiTaskMock.mockResolvedValue(allRateLimited);

    // 7 candidates at 5 per batch = 2 batches.
    const candidates = Array.from({ length: 7 }, (_, i) => enriched(`rival-${i}.com`));
    const result = await judgeCandidates(brief(), candidates);

    expect(result.judged).toEqual([]);
    expect(result.batches).toBe(2);
    expect(result.failedBatches).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain('429');
    expect(classifyRunError(withRunErrorCode(RUN_ERROR.JUDGE_UNAVAILABLE, result.errors[0]))).toBe('rateLimited');
  });

  it('a billing outage makes every batch error AI_UNAVAILABLE', async () => {
    runAiTaskMock.mockResolvedValue(billingOutage);

    const result = await judgeCandidates(brief(), [enriched('rival.com')]);

    expect(result.failedBatches).toBe(1);
    expect(result.errors[0]).toMatch(/^AI_UNAVAILABLE: Judge batch failed/);
    expect(result.errors[0]).not.toContain('insufficient_quota');
  });

  it('counts a partial failure: one batch fails, one succeeds, and records who judged', async () => {
    runAiTaskMock
      .mockResolvedValueOnce({ ...billingOutage, kind: 'bad_request', firstErrorClass: 'bad_request', attempts: [] })
      .mockResolvedValueOnce(ok({ results: [] }, { provider: 'anthropic', model: 'claude-opus-5-5' }));

    const candidates = Array.from({ length: 7 }, (_, i) => enriched(`rival-${i}.com`));
    const result = await judgeCandidates(brief(), candidates);

    expect(result.batches).toBe(2);
    expect(result.failedBatches).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.judges).toEqual([{ provider: 'anthropic', model: 'claude-opus-5-5' }]);
  });

  it('records each distinct judge once when batches mix providers', async () => {
    runAiTaskMock
      .mockResolvedValueOnce(ok({ results: [] }))
      .mockResolvedValueOnce(ok({ results: [] }, { provider: 'anthropic', model: 'claude-opus-5-5' }))
      .mockResolvedValueOnce(ok({ results: [] }));

    const candidates = Array.from({ length: 12 }, (_, i) => enriched(`rival-${i}.com`));
    const result = await judgeCandidates(brief(), candidates);

    expect(result.judges).toEqual([
      { provider: 'openai', model: 'gpt-4.1' },
      { provider: 'anthropic', model: 'claude-opus-5-5' },
    ]);
  });

  it('a batch whose answer lacks "results" is dropped as an error, never approved', async () => {
    runAiTaskMock.mockResolvedValue(ok({ nope: [] }));

    const result = await judgeCandidates(brief(), [enriched('rival.com')]);

    expect(result.judged).toEqual([]);
    expect(result.errors[0]).toMatch(/missing a "results" array/);
  });
});

describe('judge free text is length-capped on parse', () => {
  it('truncates name, positioning and key features, and caps the feature count', async () => {
    const long = 'x'.repeat(5000);
    runAiTaskMock.mockResolvedValue(
      ok({
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

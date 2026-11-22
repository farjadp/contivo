import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// One ai_usage_logs row per model call, and the logging can never break the
// call. No database: prisma and the session are mocked.

const { createMock, getSessionMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: { aiUsageLog: { create: createMock } } }));
vi.mock('@/lib/auth', () => ({ getSession: getSessionMock }));

import {
  estimateCostUsd,
  parseGeminiUsage,
  parseOpenAiChatUsage,
  parseOpenAiImageUsage,
  parseOpenAiResponsesUsage,
  priceKeyFor,
  recordAiUsage,
  resolveResponseModel,
  runWithAiContext,
  setAiContext,
} from './ai-usage';
import {
  DEFAULT_ANTHROPIC_JUDGE_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_SEARCH_MODEL,
} from './ai/models';

const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };

beforeEach(() => {
  vi.clearAllMocks();
  createMock.mockResolvedValue({ id: 'row-1' });
  getSessionMock.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('usage parsers', () => {
  it('reads OpenAI chat completions usage', () => {
    expect(
      parseOpenAiChatUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    ).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
  });

  it('reads OpenAI Responses API usage and counts web search calls', () => {
    expect(
      parseOpenAiResponsesUsage({
        usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
        output: [{ type: 'web_search_call' }, { type: 'message' }, { type: 'web_search_call' }],
      }),
    ).toEqual({ promptTokens: 20, completionTokens: 7, totalTokens: 27, webSearchCalls: 2 });
  });

  it('reads Gemini usageMetadata and bills thinking tokens as output', () => {
    expect(
      parseGeminiUsage({
        usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 9, thoughtsTokenCount: 4, totalTokenCount: 43 },
      }),
    ).toEqual({ promptTokens: 30, completionTokens: 13, totalTokens: 43 });
  });

  it('reads OpenAI image usage and counts images', () => {
    expect(
      parseOpenAiImageUsage({
        data: [{ b64_json: 'x' }],
        usage: { input_tokens: 50, output_tokens: 4160, total_tokens: 4210 },
      }),
    ).toEqual({ promptTokens: 50, completionTokens: 4160, totalTokens: 4210, images: 1 });
    expect(parseOpenAiImageUsage({ data: [{ b64_json: 'x' }] })).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      images: 1,
    });
  });

  it('turns missing or malformed fields into 0, never NaN', () => {
    const zero = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    expect(parseOpenAiChatUsage(undefined)).toEqual(zero);
    expect(parseOpenAiChatUsage({ usage: { prompt_tokens: 'x', completion_tokens: NaN } })).toEqual(zero);
    expect(parseGeminiUsage(null)).toEqual(zero);
    expect(parseOpenAiResponsesUsage('nope')).toEqual({ ...zero, webSearchCalls: 0 });
  });

  it('derives the total when the provider omits it', () => {
    expect(parseOpenAiChatUsage({ usage: { prompt_tokens: 3, completion_tokens: 4 } })).toEqual({
      promptTokens: 3,
      completionTokens: 4,
      totalTokens: 7,
    });
  });

  it('prefers the model the provider reports over the one requested', () => {
    expect(resolveResponseModel({ model: 'gpt-4.1-2025-04-14' }, 'gpt-4.1')).toBe('gpt-4.1-2025-04-14');
    expect(resolveResponseModel({ modelVersion: 'gemini-3.8-flash' }, 'gemini-2.5-pro')).toBe('gemini-3.8-flash');
    expect(resolveResponseModel({}, 'gpt-4.1')).toBe('gpt-4.1');
    expect(resolveResponseModel(null, 'gpt-4.1')).toBe('gpt-4.1');
  });
});

describe('pricing', () => {
  it('matches a bare model or the same model with a date suffix, nothing looser', () => {
    expect(priceKeyFor('gpt-4.1')).toBe('gpt-4.1');
    expect(priceKeyFor('gpt-4.1-2025-04-14')).toBe('gpt-4.1');
    expect(priceKeyFor('models/gemini-2.5-pro')).toBe('gemini-2.5-pro');
    // A different model that shares a prefix is not the same price.
    expect(priceKeyFor('gpt-4.1-mini')).toBeNull();
    expect(priceKeyFor('gpt-4.1-mini-2025-04-14')).toBeNull();
    expect(priceKeyFor('gpt-image-1.5')).toBeNull();
    expect(priceKeyFor('gemini-3.7-flash')).toBeNull();
  });

  it('prices gpt-4.1 at $2 in / $8 out per 1M tokens', () => {
    expect(estimateCostUsd('gpt-4.1', usage)).toBeCloseTo(0.006, 9);
  });

  it('adds $0.01 per web search call on gpt-5-mini', () => {
    expect(
      estimateCostUsd('gpt-5-mini', { ...usage, webSearchCalls: 2 }),
    ).toBeCloseTo((1000 * 0.25 + 500 * 2) / 1e6 + 0.02, 9);
  });

  it('uses the long-context rate for gemini-2.5-pro above 200k prompt tokens', () => {
    const at = new Date('2026-11-21T12:00:00Z');
    expect(estimateCostUsd('gemini-2.5-pro', usage, at)).toBeCloseTo((1000 * 1.25 + 500 * 10) / 1e6, 9);
    expect(
      estimateCostUsd('gemini-2.5-pro', { promptTokens: 200_001, completionTokens: 0, totalTokens: 200_001 }, at),
    ).toBeCloseTo((200_001 * 2.5) / 1e6, 9);
  });

  it('switches price periods by date', () => {
    const before = new Date('2026-12-31T23:59:59Z');
    const after = new Date('2027-01-01T00:00:00Z');
    expect(estimateCostUsd('gemini-3.8-flash', usage, before)).toBeCloseTo((1000 * 0.75 + 500 * 3.75) / 1e6, 9);
    expect(estimateCostUsd('gemini-3.8-flash', usage, after)).toBeCloseTo((1000 * 1.5 + 500 * 7.5) / 1e6, 9);
  });

  it('prices Claude: Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20, web search $0.01 per call', () => {
    expect(estimateCostUsd('claude-sonnet-5-5', usage)).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6, 9);
    expect(estimateCostUsd('claude-opus-5-5', usage)).toBeCloseTo((1000 * 4 + 500 * 20) / 1e6, 9);
    expect(estimateCostUsd('claude-sonnet-5-5', { ...usage, webSearchCalls: 3 })).toBeCloseTo(
      (1000 * 2 + 500 * 10) / 1e6 + 0.03,
      9,
    );
  });

  // Production on 22 Nov: 24 anthropic rows, cost null on every one, because
  // no Claude model was in the price table. Every model the layer uses by
  // default must have a price, or the cost card under-reports silently.
  it.each([
    ['openai', DEFAULT_OPENAI_MODEL],
    ['openai search', DEFAULT_OPENAI_SEARCH_MODEL],
    ['anthropic', DEFAULT_ANTHROPIC_MODEL],
    ['anthropic judge', DEFAULT_ANTHROPIC_JUDGE_MODEL],
    // gemini-3.7-flash is routed by Google and reports gemini-3.8-flash.
    ['gemini (as reported)', 'gemini-3.8-flash'],
  ])('a non-empty %s call (%s) gets a cost above zero', (_label, model) => {
    const cost = estimateCostUsd(model, usage);
    expect(cost).not.toBeNull();
    expect(cost!).toBeGreaterThan(0);
  });

  it('the anthropic backfill script prices every Claude model exactly like the app', async () => {
    const { CLAUDE_PRICES, claudeCostUsd } = await import('../../../api/scripts/backfill-anthropic-cost');
    for (const model of Object.keys(CLAUDE_PRICES)) {
      expect(claudeCostUsd(model, 1000, 500)).toBeCloseTo(estimateCostUsd(model, usage)!, 9);
    }
    expect(Object.keys(CLAUDE_PRICES).sort()).toEqual([DEFAULT_ANTHROPIC_JUDGE_MODEL, DEFAULT_ANTHROPIC_MODEL].sort());
  });

  it('returns null for a model it has no verified price for, and warns once per model', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(estimateCostUsd('gpt-image-1', { ...usage, images: 1 })).toBeNull();
    expect(estimateCostUsd('gpt-image-1', usage)).toBeNull();
    expect(estimateCostUsd('some-new-model-xyz', usage)).toBeNull();
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes('gpt-image-1'))).toHaveLength(1);
    expect(messages.filter((m) => m.includes('some-new-model-xyz'))).toHaveLength(1);
  });
});

describe('recordAiUsage', () => {
  const base = { provider: 'openai', model: 'gpt-4.1', feature: 'test_feature', usage };

  it('writes one row with tokens and estimated cost', async () => {
    await recordAiUsage({ ...base, userId: 'u-1', workspaceId: 'ws-1', jobId: 'job-1' });
    expect(createMock).toHaveBeenCalledTimes(1);
    const data = createMock.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: 'u-1',
      workspaceId: 'ws-1',
      jobId: 'job-1',
      provider: 'openai',
      model: 'gpt-4.1',
      feature: 'test_feature',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });
    expect(Number(data.estimatedCostUsd)).toBeCloseTo(0.006, 6);
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('writes a null cost for an unpriced model', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await recordAiUsage({ ...base, model: 'unpriced-model-abc', userId: 'u-1' });
    expect(createMock.mock.calls[0][0].data.estimatedCostUsd).toBeNull();
  });

  it('takes attribution from an explicit arg, then the run context, then the session', async () => {
    getSessionMock.mockResolvedValue({ userId: 'session-user' });

    await runWithAiContext({ userId: 'ctx-user', workspaceId: 'ctx-ws' }, async () => {
      await recordAiUsage({ ...base, userId: 'explicit-user', workspaceId: 'explicit-ws' });
      await recordAiUsage(base);
    });
    await recordAiUsage(base);

    expect(createMock.mock.calls[0][0].data).toMatchObject({ userId: 'explicit-user', workspaceId: 'explicit-ws' });
    expect(createMock.mock.calls[1][0].data).toMatchObject({ userId: 'ctx-user', workspaceId: 'ctx-ws' });
    expect(createMock.mock.calls[2][0].data).toMatchObject({ userId: 'session-user', workspaceId: null });
  });

  it('lets a pipeline name its owner after it has loaded the run', async () => {
    await runWithAiContext({}, async () => {
      setAiContext({ userId: 'owner', workspaceId: 'ws-9' });
      await Promise.resolve();
      await recordAiUsage(base);
    });
    expect(createMock.mock.calls[0][0].data).toMatchObject({ userId: 'owner', workspaceId: 'ws-9' });
  });

  it('writes userId null when no user can be found, including when the session lookup throws', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    getSessionMock.mockRejectedValue(new Error('cookies() outside a request scope'));
    await recordAiUsage(base);
    expect(createMock.mock.calls[0][0].data.userId).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('never throws when the insert fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    createMock.mockRejectedValue(new Error('db down'));
    await expect(recordAiUsage({ ...base, userId: 'u-1' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('never throws on garbage input', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      recordAiUsage({
        provider: 'openai',
        model: undefined as unknown as string,
        feature: 'x',
        usage: undefined as unknown as typeof usage,
      }),
    ).resolves.toBeUndefined();
  });
});

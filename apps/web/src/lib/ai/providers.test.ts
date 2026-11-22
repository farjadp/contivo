import Anthropic from '@anthropic-ai/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fixtureHeaders, fixtureResponse, loadFixture } from './__fixtures__/load';
import { AiProviderError } from './errors';
import { parseJsonText, validateJsonSchema } from './output';
import {
  buildAnthropicParams,
  createAnthropicAdapter,
  defaultAnthropicClient,
  parseAnthropicContent,
  type AnthropicClientLike,
} from './providers/anthropic';
import { geminiAdapter, parseGeminiGrounding, toGeminiSchema } from './providers/gemini';
import { openAiAdapter } from './providers/openai';
import type { AiRequest } from './types';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['judgments'],
  properties: {
    judgments: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['domain', 'type', 'note'],
        properties: {
          domain: { type: 'string', maxLength: 20 },
          type: { type: 'string', enum: ['DIRECT', 'INDIRECT'] },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
};

const jsonSchemaRequest: AiRequest = {
  system: 'sys',
  prompt: 'judge these',
  output: { kind: 'json_schema', name: 'competitor_judgments', schema: SCHEMA },
  timeoutMs: 90_000,
};

const searchRequest: AiRequest = {
  prompt: 'Search the web for: "cloud accounting"',
  output: { kind: 'text' },
  webSearch: { country: 'IR', maxUses: 3 },
  timeoutMs: 150_000,
};

async function rejection(promise: Promise<unknown>): Promise<AiProviderError> {
  try {
    await promise;
  } catch (error) {
    return error as AiProviderError;
  }
  throw new Error('expected a rejection');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Output checks
// ---------------------------------------------------------------------------

describe('output validation', () => {
  it('parses fenced JSON and rejects prose', () => {
    expect(parseJsonText('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonText('sure! here you go')).toBeNull();
    expect(parseJsonText('')).toBeNull();
  });

  it('validates against the original schema (additionalProperties, enum, maxItems, maxLength, nullable)', () => {
    expect(validateJsonSchema({ judgments: [{ domain: 'a.com', type: 'DIRECT', note: null }] }, SCHEMA)).toEqual([]);
    expect(validateJsonSchema({ judgments: [{ domain: 'a.com', type: 'OTHER', note: 'x' }] }, SCHEMA)).not.toEqual([]);
    expect(validateJsonSchema({ judgments: [], extra: 1 }, SCHEMA)).toContain('$.extra: not allowed');
    expect(validateJsonSchema({}, SCHEMA)).toContain('$.judgments: required');
    expect(validateJsonSchema({ judgments: [{ domain: 'x'.repeat(30), type: 'DIRECT', note: null }] }, SCHEMA)).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

describe('toGeminiSchema', () => {
  it('strips additionalProperties recursively and maps nullable types', () => {
    const converted = toGeminiSchema(SCHEMA) as Record<string, any>;
    expect(JSON.stringify(converted)).not.toContain('additionalProperties');
    const item = converted.properties.judgments.items;
    expect(item.properties.note).toEqual({ type: 'string', nullable: true });
    expect(item.properties.type.enum).toEqual(['DIRECT', 'INDIRECT']);
    expect(converted.properties.judgments.maxItems).toBe(3);
  });

  it('turns const into a one-value enum', () => {
    expect(toGeminiSchema({ const: 'x' })).toEqual({ enum: ['x'], type: 'string' });
  });
});

describe('geminiAdapter', () => {
  it('sends the key in a header (never the URL), systemInstruction and a converted responseSchema', async () => {
    const fetchMock = vi.fn(async () => fixtureResponse('gemini-success.json'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await geminiAdapter.call({ task: 'competitor_judge', request: jsonSchemaRequest, model: 'gemini-3.7-flash', apiKey: 'AIzaTESTKEY' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('AIzaTESTKEY');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaTESTKEY');
    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'sys' }] });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(JSON.stringify(body.generationConfig.responseSchema)).not.toContain('additionalProperties');
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage.totalTokens).toBe(110);
  });

  it('a recorded error body is classified', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fixtureResponse('gemini-400-invalid-key.json')));
    const error = await rejection(geminiAdapter.call({ task: 'keywords', request: jsonSchemaRequest, model: 'm', apiKey: 'k' }));
    expect(error.errorClass).toBe('auth');
  });

  it('recorded 200 with empty content (thinking ate maxOutputTokens) → empty text, model as Google reports it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fixtureResponse('gemini-200-max-tokens-empty.json')));
    const result = await geminiAdapter.call({ task: 'keywords', request: jsonSchemaRequest, model: 'gemini-3.7-flash', apiKey: 'k' });
    expect(result.text).toBe('');
    expect(result.model).toBe('gemini-3.8-flash');
    expect(result.usage.completionTokens).toBe(13);
  });

  it('a safety block is a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fixtureResponse('gemini-safety-block.json')));
    const error = await rejection(geminiAdapter.call({ task: 'keywords', request: jsonSchemaRequest, model: 'm', apiKey: 'k' }));
    expect(error.errorClass).toBe('refusal');
  });

  it('grounding: redirect links become the domain in the title, or are dropped — never guessed', () => {
    const body = loadFixture('gemini-grounding.json').body as { candidates: unknown[] };
    const result = parseGeminiGrounding(body.candidates[0]);
    expect(result.query).toBe('cloud accounting software iran');
    // chunk 1's title is not a domain → dropped from citations
    expect(result.citations).toEqual([{ url: 'https://sepidar.example/', title: 'sepidar.example' }]);
    expect(result.sourceUrls).toEqual(['https://sepidar.example/', 'https://hamkaran.example/']);
  });
});

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

describe('openAiAdapter', () => {
  it('chat: strict json_schema response_format, system message, no temperature unless asked', async () => {
    const fetchMock = vi.fn(async () => fixtureResponse('openai-chat-success.json'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await openAiAdapter.call({ task: 'competitor_judge', request: { ...jsonSchemaRequest, temperature: 0.2 }, model: 'gpt-4.1', apiKey: 'sk-test' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'competitor_judgments', strict: true, schema: SCHEMA },
    });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.temperature).toBe(0.2);
    expect(result.model).toBe('gpt-4.1-2025-04-14');
    expect(result.usage.totalTokens).toBe(110);
  });

  it('web search: Responses API with country hint, extracted like search.ts', async () => {
    const fetchMock = vi.fn(async () => fixtureResponse('openai-responses-web-search.json'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await openAiAdapter.call({ task: 'competitor_web_search', request: searchRequest, model: 'gpt-5-mini', apiKey: 'sk-test' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(String(init.body));
    expect(body.tools[0]).toEqual({ type: 'web_search', search_context_size: 'low', user_location: { type: 'approximate', country: 'IR' } });
    expect(body.include).toEqual(['web_search_call.action.sources']);
    expect(body.temperature).toBeUndefined();
    expect(result.webSearch).toEqual({
      query: 'cloud accounting software',
      citations: [{ url: 'https://sepidar.example/', title: 'Sepidar' }],
      sourceUrls: ['https://sepidar.example/', 'https://noise.example/list'],
    });
    expect(result.usage.webSearchCalls).toBe(1);
  });

  it('recorded 429 insufficient_quota → billing; refusal field → refusal; fetch timeout → timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fixtureResponse('openai-429-insufficient-quota.json')));
    expect((await rejection(openAiAdapter.call({ task: 'keywords', request: jsonSchemaRequest, model: 'm', apiKey: 'k' }))).errorClass).toBe('billing');

    vi.stubGlobal('fetch', vi.fn(async () => fixtureResponse('openai-chat-refusal.json')));
    expect((await rejection(openAiAdapter.call({ task: 'keywords', request: jsonSchemaRequest, model: 'm', apiKey: 'k' }))).errorClass).toBe('refusal');

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    }));
    expect((await rejection(openAiAdapter.call({ task: 'keywords', request: jsonSchemaRequest, model: 'm', apiKey: 'k' }))).errorClass).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

type Create = AnthropicClientLike['beta']['messages']['create'];

function fakeClient(...responses: Array<unknown | Error>) {
  const create = vi.fn<Create>();
  for (const response of responses) {
    if (response instanceof Error) create.mockRejectedValueOnce(response);
    else create.mockResolvedValueOnce(response as Awaited<ReturnType<Create>>);
  }
  return { client: { beta: { messages: { create } } } as AnthropicClientLike, create };
}

function body(name: string) {
  return loadFixture(name).body;
}

describe('buildAnthropicParams (claude-api skill rules)', () => {
  it('no temperature, no thinking, effort low, structured output via output_config.format, refusal fallback on', () => {
    const params = buildAnthropicParams({ ...jsonSchemaRequest, temperature: 0.2 }, 'claude-opus-5-5') as unknown as Record<string, any>;
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.thinking).toBeUndefined();
    expect(params.output_format).toBeUndefined();
    expect(params.output_config.effort).toBe('low');
    expect(params.output_config.format.type).toBe('json_schema');
    // the SDK transform moves unsupported constraints (maxLength) out of the schema
    expect(JSON.stringify(params.output_config.format.schema)).not.toContain('"maxLength"');
    expect(params.max_tokens).toBe(16_000);
    expect(params.betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(params.fallbacks).toBe('default');
    expect(params.system).toBe('sys');
  });

  it('web search: web_search_20260209 server tool with max_uses and country, and no format (citations conflict)', () => {
    const params = buildAnthropicParams({ ...searchRequest, output: { kind: 'json_schema', name: 'x', schema: SCHEMA } }, 'claude-sonnet-5-5') as unknown as Record<string, any>;
    expect(params.tools).toEqual([
      { type: 'web_search_20260209', name: 'web_search', max_uses: 3, user_location: { type: 'approximate', country: 'IR' } },
    ]);
    expect(params.output_config.format).toBeUndefined();
  });
});

describe('anthropic adapter', () => {
  it('web search success → {query, citations, sourceUrls} in search.ts shape', async () => {
    const { client } = fakeClient(body('anthropic-web-search-success.json'));
    const adapter = createAnthropicAdapter(() => client);
    const result = await adapter.call({ task: 'competitor_web_search', request: searchRequest, model: 'claude-sonnet-5-5', apiKey: 'k' });
    expect(result.webSearch).toEqual({
      query: 'نرم افزار حسابداری ابری',
      citations: [
        { url: 'https://sepidar.example/', title: 'Sepidar' },
        { url: 'https://hamkaran.example/products', title: 'Hamkaran' },
      ],
      sourceUrls: ['https://sepidar.example/', 'https://hamkaran.example/products', 'https://noise.example/list'],
    });
    expect(result.text).toBe('Sepidar offers cloud accounting. Hamkaran too.');
    expect(result.usage).toEqual({ promptTokens: 1200, completionTokens: 300, totalTokens: 1500, webSearchCalls: 1 });
  });

  it('web_search_tool_result error object (HTTP 200) with no results → classified, too_many_requests = rate_limit', async () => {
    const { client } = fakeClient(body('anthropic-web-search-error.json'));
    const adapter = createAnthropicAdapter(() => client);
    const error = await rejection(adapter.call({ task: 'competitor_web_search', request: searchRequest, model: 'm', apiKey: 'k' }));
    expect(error.errorClass).toBe('rate_limit');
    expect(error.message).toContain('too_many_requests');
  });

  it('pause_turn: resends the conversation and merges both turns', async () => {
    const { client, create } = fakeClient(body('anthropic-web-search-pause-turn.json'), body('anthropic-web-search-success.json'));
    const adapter = createAnthropicAdapter(() => client);
    const result = await adapter.call({ task: 'competitor_web_search', request: searchRequest, model: 'm', apiKey: 'k' });
    expect(create).toHaveBeenCalledTimes(2);
    const second = create.mock.calls[1][0];
    expect(second.messages.at(-1)?.role).toBe('assistant');
    expect(result.webSearch?.query).toBe('accounting software iran');
    expect(result.webSearch?.sourceUrls[0]).toBe('https://sepidar.example/');
    expect(result.usage.promptTokens).toBe(2400);
  });

  it('pause_turn forever is capped', async () => {
    const pause = body('anthropic-web-search-pause-turn.json');
    const { client, create } = fakeClient(pause, pause, pause, pause, pause, pause, pause);
    const adapter = createAnthropicAdapter(() => client);
    const error = await rejection(adapter.call({ task: 'competitor_web_search', request: searchRequest, model: 'm', apiKey: 'k' }));
    expect(error.errorClass).toBe('invalid_output');
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('stop_reason refusal is checked before content', async () => {
    const { client } = fakeClient(body('anthropic-refusal.json'));
    const adapter = createAnthropicAdapter(() => client);
    const error = await rejection(adapter.call({ task: 'quality_gate', request: jsonSchemaRequest, model: 'm', apiKey: 'k' }));
    expect(error.errorClass).toBe('refusal');
    expect(error.message).toContain('cyber');
  });

  it('per-request timeout is passed to the SDK; typed SDK errors are classified', async () => {
    const f = loadFixture('anthropic-401-invalid-key.json');
    const sdkError = Anthropic.APIError.generate(f.status, f.body as object, undefined, fixtureHeaders(f));
    const { client, create } = fakeClient(sdkError);
    const adapter = createAnthropicAdapter(() => client);
    const error = await rejection(adapter.call({ task: 'quality_gate', request: jsonSchemaRequest, model: 'm', apiKey: 'k' }));
    expect(error.errorClass).toBe('auth');
    const options = create.mock.calls[0][1];
    expect(options?.timeout).toBeGreaterThan(89_000);
    expect(options?.timeout).toBeLessThanOrEqual(90_000);
  });

  it('JSON success returns the text block (thinking blocks ignored)', async () => {
    const { client } = fakeClient(body('anthropic-json-success.json'));
    const adapter = createAnthropicAdapter(() => client);
    const result = await adapter.call({ task: 'competitor_judge', request: jsonSchemaRequest, model: 'claude-opus-5-5', apiKey: 'k' });
    expect(result.text).toBe('{"judgments":[]}');
    expect(result.model).toBe('claude-opus-5-5');
  });

  it('parseAnthropicContent collects error objects separately', () => {
    const parsed = parseAnthropicContent((body('anthropic-web-search-error.json') as { content: never[] }).content);
    expect(parsed.searchErrors).toEqual(['too_many_requests']);
    expect(parsed.webSearch.sourceUrls).toEqual([]);
  });

  it('the real SDK client is created with maxRetries 0 (the layer owns retries)', () => {
    const client = defaultAnthropicClient('sk-ant-test-not-a-key') as unknown as { maxRetries: number };
    expect(client).toBeInstanceOf(Anthropic);
    expect(client.maxRetries).toBe(0);
  });
});

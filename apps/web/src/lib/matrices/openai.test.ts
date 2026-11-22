import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real recordAiUsage runs; only its database and the session are mocked,
// so these tests see the exact ai_usage_logs row a call would write.
const { usageCreateMock } = vi.hoisted(() => ({ usageCreateMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { aiUsageLog: { create: usageCreateMock } } }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'user-1' })) }));

import { runWithAiContext } from '@/lib/ai-usage';
import { callStructured, MatrixAiError } from './openai';

const args = { name: 'matrix_axes', schema: { type: 'object' }, system: 'sys', user: 'usr' };

function okResponse(content: string, totalTokens = 150) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: totalTokens } }),
    { status: 200 },
  );
}

describe('callStructured', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-secret';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  it('returns parsed data and token usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('{"a":1}')));
    await expect(callStructured<{ a: number }>(args)).resolves.toEqual({ data: { a: 1 }, tokens: 150 });
  });

  it('sends a strict json_schema request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await callStructured(args);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'matrix_axes', strict: true, schema: { type: 'object' } },
    });
    expect(init.signal).toBeDefined();
  });

  it('throws MatrixAiError with the status on non-2xx, never the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited sk-test-secret', { status: 429 })));
    const err = await callStructured(args).catch((e) => e);
    expect(err).toBeInstanceOf(MatrixAiError);
    expect(err.message).toContain('429');
    expect(err.message).not.toContain('sk-test-secret');
  });

  it('throws with tokens when the content is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('not json')));
    const err = await callStructured(args).catch((e) => e);
    expect(err).toBeInstanceOf(MatrixAiError);
    expect(err.tokens).toBe(150);
  });

  it('throws when content is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 })));
    await expect(callStructured(args)).rejects.toBeInstanceOf(MatrixAiError);
  });

  it('throws MatrixAiError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(callStructured(args)).rejects.toBeInstanceOf(MatrixAiError);
  });

  it('throws before calling fetch when the key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(callStructured(args)).rejects.toThrow('OPENAI_API_KEY is not set');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('callStructured usage logging', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-secret';
    usageCreateMock.mockReset();
    usageCreateMock.mockResolvedValue({ id: 'row-1' });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_API_KEY;
  });

  function replyWithUsage(content: string) {
    return new Response(
      JSON.stringify({
        model: 'gpt-4.1-2025-04-14',
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
      }),
      { status: 200 },
    );
  }

  async function settle() {
    // recordAiUsage is fire-and-forget; let its microtasks finish.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('records one row and returns exactly what it returned before', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(replyWithUsage('{"a":1}')));

    const result = await runWithAiContext({ userId: 'owner-1', workspaceId: 'ws-1' }, () =>
      callStructured<{ a: number }>(args),
    );
    await settle();

    expect(result).toEqual({ data: { a: 1 }, tokens: 1500 });
    expect(usageCreateMock).toHaveBeenCalledTimes(1);
    const data = usageCreateMock.mock.calls[0][0].data;
    expect(data).toMatchObject({
      userId: 'owner-1',
      workspaceId: 'ws-1',
      provider: 'openai',
      model: 'gpt-4.1-2025-04-14',
      feature: 'matrix_matrix_axes',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      estimatedCostUsd: '0.006000',
    });
  });

  it('a failing usage insert changes neither the result nor the error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    usageCreateMock.mockRejectedValue(new Error('db down'));

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(replyWithUsage('{"a":1}')));
    await expect(callStructured<{ a: number }>(args)).resolves.toEqual({ data: { a: 1 }, tokens: 1500 });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(replyWithUsage('not json')));
    const err = await callStructured(args).catch((e) => e);
    expect(err).toBeInstanceOf(MatrixAiError);
    expect(err.tokens).toBe(1500);

    await settle();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('records nothing when the provider refuses the call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
    await callStructured(args).catch(() => undefined);
    await settle();
    expect(usageCreateMock).not.toHaveBeenCalled();
  });
});

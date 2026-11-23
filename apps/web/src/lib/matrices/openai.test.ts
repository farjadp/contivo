import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiFailure, AiSuccess } from '@/lib/ai';

// The failover layer is mocked: no network. It records usage itself (under
// the task name and the provider that answered), so the call site must not.
const { runAiTaskMock, recordAiUsageMock } = vi.hoisted(() => ({
  runAiTaskMock: vi.fn(),
  recordAiUsageMock: vi.fn(async () => {}),
}));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/ai-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai-usage')>()),
  recordAiUsage: recordAiUsageMock,
}));

import { classifyRunError } from '@/lib/competitors/run-errors';
import { callStructured, MATRIX_REQUEST_TIMEOUT_MS, MatrixAiError } from './openai';

const args = { name: 'chart_scores', schema: { type: 'object' }, system: 'sys', user: 'usr' };

function ok(overrides: Partial<AiSuccess> = {}): AiSuccess {
  return {
    ok: true,
    provider: 'openai',
    model: 'gpt-4.1',
    text: '{"a":1}',
    json: { a: 1 },
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    failedOver: [],
    ...overrides,
  };
}

function failure(overrides: Partial<AiFailure> = {}): AiFailure {
  return {
    ok: false,
    kind: 'all_unavailable',
    attempts: [
      { provider: 'openai', errorClass: 'billing', status: 429, message: 'insufficient_quota sk-test-secret' },
      { provider: 'anthropic', errorClass: 'not_configured', message: 'skipped' },
    ],
    firstErrorClass: 'billing',
    allRateLimited: false,
    ...overrides,
  };
}

beforeEach(() => {
  runAiTaskMock.mockReset();
  recordAiUsageMock.mockClear();
});

describe('callStructured', () => {
  it('returns parsed data and token usage', async () => {
    runAiTaskMock.mockResolvedValue(ok());
    await expect(callStructured<{ a: number }>(args)).resolves.toEqual({ data: { a: 1 }, tokens: 150 });
    expect(recordAiUsageMock).not.toHaveBeenCalled();
  });

  it('sends a json_schema request on the matching matrix task', async () => {
    runAiTaskMock.mockResolvedValue(ok());
    await callStructured(args);
    const [task, request] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('matrix_score_chart');
    expect(request).toMatchObject({
      system: 'sys',
      prompt: 'usr',
      temperature: 0.2,
      timeoutMs: MATRIX_REQUEST_TIMEOUT_MS,
      output: { kind: 'json_schema', name: 'chart_scores', schema: { type: 'object' } },
    });
  });

  it('passes the run workspace and user from the AI context', async () => {
    runAiTaskMock.mockResolvedValue(ok());
    const { runWithAiContext } = await import('@/lib/ai-usage');
    await runWithAiContext({ userId: 'u1', workspaceId: 'w1' }, () => callStructured(args));
    expect(runAiTaskMock.mock.calls[0][2]).toEqual({ userId: 'u1', workspaceId: 'w1' });
  });

  it.each([
    ['market_axis_candidates', 'matrix_propose_axes'],
    ['chart_scores', 'matrix_score_chart'],
    ['chart_summary', 'matrix_summarise'],
    ['cross_chart_summary', 'matrix_summarise'],
  ])('maps %s to %s', async (name, task) => {
    runAiTaskMock.mockResolvedValue(ok());
    await callStructured({ ...args, name });
    expect(runAiTaskMock.mock.calls[0][0]).toBe(task);
  });

  it('refuses an unknown schema name without calling the layer', async () => {
    await expect(callStructured({ ...args, name: 'nope' })).rejects.toBeInstanceOf(MatrixAiError);
    expect(runAiTaskMock).not.toHaveBeenCalled();
  });

  it('all_unavailable -> MatrixAiError carrying AI_UNAVAILABLE, never the key or the upstream body', async () => {
    runAiTaskMock.mockResolvedValue(failure());
    const err = await callStructured(args).catch((e) => e);
    expect(err).toBeInstanceOf(MatrixAiError);
    expect(err.message).toMatch(/^AI_UNAVAILABLE: /);
    expect(err.message).not.toContain('sk-test-secret');
    expect(err.message).not.toContain('insufficient_quota');
    expect(err.tokens).toBeNull();
    expect(classifyRunError(err.message)).toBe('aiUnavailable');
  });

  it('every provider rate limited -> rateLimited, not aiUnavailable', async () => {
    runAiTaskMock.mockResolvedValue(
      failure({
        firstErrorClass: 'rate_limit',
        allRateLimited: true,
        attempts: [{ provider: 'openai', errorClass: 'rate_limit', status: 429, message: 'Rate limit reached' }],
      }),
    );
    const err = await callStructured(args).catch((e) => e);
    expect(classifyRunError(err.message)).toBe('rateLimited');
  });

  it('a bad request is a plain MatrixAiError (generic copy)', async () => {
    runAiTaskMock.mockResolvedValue(
      failure({ kind: 'bad_request', firstErrorClass: 'bad_request', attempts: [{ provider: 'openai', errorClass: 'bad_request', status: 400, message: 'x' }] }),
    );
    const err = await callStructured(args).catch((e) => e);
    expect(err).toBeInstanceOf(MatrixAiError);
    expect(classifyRunError(err.message)).toBe('generic');
  });

  it('falls back to parsing text, and throws with tokens when it is not valid JSON', async () => {
    runAiTaskMock.mockResolvedValue(ok({ json: undefined, text: '{"b":2}' }));
    await expect(callStructured(args)).resolves.toEqual({ data: { b: 2 }, tokens: 150 });

    runAiTaskMock.mockResolvedValue(ok({ json: undefined, text: 'not json' }));
    const err = await callStructured(args).catch((e) => e);
    expect(err).toBeInstanceOf(MatrixAiError);
    expect(err.tokens).toBe(150);
  });

  it('throws when content is missing', async () => {
    runAiTaskMock.mockResolvedValue(ok({ json: undefined, text: '' }));
    await expect(callStructured(args)).rejects.toBeInstanceOf(MatrixAiError);
  });

  it('throws MatrixAiError when the layer itself throws', async () => {
    runAiTaskMock.mockRejectedValue(new Error('boom'));
    await expect(callStructured(args)).rejects.toBeInstanceOf(MatrixAiError);
  });

  it('unknown usage reads as tokens null, never 0', async () => {
    runAiTaskMock.mockResolvedValue(ok({ usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }));
    await expect(callStructured(args)).resolves.toEqual({ data: { a: 1 }, tokens: null });
  });
});

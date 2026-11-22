import { describe, expect, it, vi } from 'vitest';

import { createAlertSink, type AiProviderEventRow, type AiProviderEventStore } from './alert';

function harness(storeImpl?: Partial<AiProviderEventStore>) {
  const rows: AiProviderEventRow[] = [];
  const store: AiProviderEventStore = {
    insert: vi.fn(async (row: AiProviderEventRow) => {
      rows.push(row);
    }),
    latestCriticalSince: vi.fn(async () => []),
    ...storeImpl,
  };
  const sentry = { captureMessage: vi.fn() };
  const log = { error: vi.fn(), warn: vi.fn() };
  const sink = createAlertSink({ store, sentry: sentry as never, log });
  return { sink, rows, sentry, log, store };
}

describe('alert sink', () => {
  it('attempt failed: one DB row, one Sentry message (fatal for billing, fingerprint [provider, class]), one console line', () => {
    const h = harness();
    h.sink.attemptFailed({
      provider: 'openai',
      task: 'competitor_judge',
      errorClass: 'billing',
      status: 429,
      message: 'You have no credits remaining. key sk-proj-abcdefghijklmnopqrstuv',
      failedOverTo: 'anthropic',
      forced: false,
      ctx: { workspaceId: 'w1', userId: 'u1' },
    });
    expect(h.rows).toEqual([
      {
        provider: 'openai',
        task: 'competitor_judge',
        errorClass: 'billing',
        status: 429,
        message: expect.not.stringContaining('sk-proj-abcdefghijklmnopqrstuv'),
        failedOverTo: 'anthropic',
        eventType: 'attempt_failed',
        workspaceId: 'w1',
        userId: 'u1',
      },
    ]);
    expect(h.sentry.captureMessage).toHaveBeenCalledWith('AI provider openai failed: billing', {
      level: 'fatal',
      tags: { 'ai.provider': 'openai', 'ai.task': 'competitor_judge', 'ai.error_class': 'billing' },
      fingerprint: ['openai', 'billing'],
      extra: expect.any(Object),
    });
    expect(h.log.error).toHaveBeenCalledWith('[ai] openai billing → anthropic for competitor_judge (HTTP 429)');
  });

  it('levels: auth/model_gone fatal, bad_request error, the rest warning', () => {
    const h = harness();
    const base = { provider: 'gemini' as const, task: 'content_draft' as const, message: 'x', failedOverTo: null, forced: false, ctx: {} };
    for (const errorClass of ['auth', 'model_gone', 'bad_request', 'rate_limit', 'server', 'timeout', 'invalid_output'] as const) {
      h.sink.attemptFailed({ ...base, errorClass });
    }
    expect(h.sentry.captureMessage.mock.calls.map((c) => c[1].level)).toEqual([
      'fatal',
      'fatal',
      'error',
      'warning',
      'warning',
      'warning',
      'warning',
    ]);
  });

  it('all unavailable: fatal "AI fully unavailable" and an all_unavailable row', () => {
    const h = harness();
    h.sink.allUnavailable(
      'competitor_judge',
      [
        { provider: 'openai', errorClass: 'billing', message: 'a' },
        { provider: 'anthropic', errorClass: 'not_configured', message: 'b' },
        { provider: 'gemini', errorClass: 'rate_limit', message: 'c' },
      ],
      {},
      'billing',
    );
    expect(h.sentry.captureMessage).toHaveBeenCalledWith('AI fully unavailable', expect.objectContaining({ level: 'fatal' }));
    expect(h.rows[0]).toMatchObject({ provider: 'all', eventType: 'all_unavailable', errorClass: 'billing' });
  });

  it('all unavailable row carries the cooling-down reason, not "cooling_down" (found in the live run)', () => {
    const h = harness();
    h.sink.allUnavailable('keywords', [{ provider: 'openai', errorClass: 'cooling_down', reason: 'billing', message: 'skipped' }], {}, 'billing');
    expect(h.rows[0].errorClass).toBe('billing');
  });

  it('health change: a health_changed row', () => {
    const h = harness();
    h.sink.healthChanged({ provider: 'openai', change: 'billing', coolingDownUntil: Date.parse('2026-11-22T01:27:00Z') }, 'keywords', {});
    h.sink.healthChanged({ provider: 'openai', change: 'recovered', coolingDownUntil: null }, 'keywords', {});
    expect(h.rows.map((r) => [r.eventType, r.errorClass])).toEqual([
      ['health_changed', 'billing'],
      ['health_changed', 'recovered'],
    ]);
  });

  it('forced failures are labelled', () => {
    const h = harness();
    h.sink.attemptFailed({ provider: 'openai', task: 'keywords', errorClass: 'billing', message: 'forced billing failure', failedOverTo: 'anthropic', forced: true, ctx: {} });
    expect(h.rows[0].message).toContain('[AI_FORCE_FAIL]');
    expect(h.log.error.mock.calls[0][0]).toContain('[forced by AI_FORCE_FAIL]');
  });

  it('not configured is logged once per provider', () => {
    const h = harness();
    h.sink.notConfigured('anthropic', 'ANTHROPIC_API_KEY');
    h.sink.notConfigured('anthropic', 'ANTHROPIC_API_KEY');
    expect(h.log.warn).toHaveBeenCalledTimes(1);
    expect(h.rows).toEqual([]);
  });

  it('a failing DB or Sentry never throws into the AI call', async () => {
    const h = harness({
      insert: vi.fn(async () => {
        throw new Error('relation "ai_provider_events" does not exist');
      }),
    });
    h.sentry.captureMessage.mockImplementation(() => {
      throw new Error('sentry down');
    });
    expect(() =>
      h.sink.attemptFailed({ provider: 'openai', task: 'keywords', errorClass: 'server', message: 'x', failedOverTo: null, forced: false, ctx: {} }),
    ).not.toThrow();
    expect(() => h.sink.allUnavailable('keywords', [], {}, 'not_configured')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.log.error).toHaveBeenCalledWith('[ai] could not write ai_provider_events row:', expect.stringContaining('does not exist'));
    expect(h.log.error).toHaveBeenCalledWith('[ai] Sentry captureMessage failed:', 'sentry down');
  });
});

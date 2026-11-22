import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiAlertSink, AiProviderEventStore, AttemptFailedAlert } from './alert';
import { AiProviderError } from './errors';
import { CRITICAL_COOLDOWN_MS, ProviderHealth, TRANSIENT_COOLDOWN_MS } from './health';
import { AiUnavailableError, createAiRunner, type AiRunnerDeps } from './run';
import type { AiErrorClass, AiRequest, ProviderAdapter, ProviderCallInput, ProviderId, ProviderSuccess } from './types';

// ---------------------------------------------------------------------------
// Harness: scripted adapters, fake clock, recording alert sink
// ---------------------------------------------------------------------------

type Step = AiErrorClass | { ok: string } | { retryAfterMs: number; class: AiErrorClass };

function ok(text: string): ProviderSuccess {
  return { model: 'm', text, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
}

function scripted(id: ProviderId, steps: Step[]) {
  const calls: ProviderCallInput[] = [];
  const adapter: ProviderAdapter = {
    id,
    keyEnv: `${id.toUpperCase()}_KEY`,
    async call(input) {
      calls.push(input);
      const step = steps.length > 1 ? steps.shift()! : steps[0];
      if (step === undefined) throw new Error('no script');
      if (typeof step === 'object' && 'ok' in step) return ok(step.ok);
      const cls = typeof step === 'string' ? step : step.class;
      const retryAfterMs = typeof step === 'object' && 'retryAfterMs' in step ? step.retryAfterMs : undefined;
      throw new AiProviderError({ provider: id, errorClass: cls, status: 500, message: `${id} ${cls}`, retryAfterMs });
    },
  };
  return { adapter, calls };
}

function recordingSink() {
  const failed: AttemptFailedAlert[] = [];
  const health: Array<{ provider: ProviderId; change: string }> = [];
  const allDown: string[] = [];
  const notConfigured: ProviderId[] = [];
  const sink: AiAlertSink = {
    attemptFailed: (a) => failed.push(a),
    healthChanged: (t) => health.push({ provider: t.provider, change: t.change }),
    allUnavailable: (task, _attempts, _ctx, first) => allDown.push(`${task}:${first}`),
    notConfigured: (p) => notConfigured.push(p),
  };
  return { sink, failed, health, allDown, notConfigured };
}

let clock = 0;
const sleep = vi.fn(async (ms: number) => {
  clock += ms;
});

const allKeys = { OPENAI_KEY: 'k1', ANTHROPIC_KEY: 'k2', GEMINI_KEY: 'k3', NODE_ENV: 'test' } as Record<string, string | undefined>;

function makeRunner(
  scripts: Partial<Record<ProviderId, Step[]>>,
  opts: { env?: Record<string, string | undefined>; store?: AiProviderEventStore | null; health?: ProviderHealth } = {},
) {
  const openai = scripted('openai', scripts.openai ?? [{ ok: 'openai' }]);
  const anthropic = scripted('anthropic', scripts.anthropic ?? [{ ok: 'anthropic' }]);
  const gemini = scripted('gemini', scripts.gemini ?? [{ ok: 'gemini' }]);
  const alerts = recordingSink();
  const recordUsage = vi.fn();
  const health = opts.health ?? new ProviderHealth(() => clock);
  const deps: AiRunnerDeps = {
    adapters: { openai: openai.adapter, anthropic: anthropic.adapter, gemini: gemini.adapter },
    health,
    alerts: alerts.sink,
    store: opts.store ?? null,
    resolveModel: async (provider) => `${provider}-model`,
    recordUsage,
    sleep,
    now: () => clock,
    env: () => opts.env ?? allKeys,
  };
  return { runner: createAiRunner(deps), openai, anthropic, gemini, alerts, recordUsage, health };
}

const text: AiRequest = { prompt: 'hi', output: { kind: 'text' }, timeoutMs: 1000 };
const json: AiRequest = {
  prompt: 'hi',
  output: { kind: 'json_schema', name: 's', schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } },
  timeoutMs: 1000,
};

beforeEach(() => {
  clock = 1_000_000;
  sleep.mockClear();
});

// ---------------------------------------------------------------------------

describe('runAiTask chain walk', () => {
  it('happy path: first provider answers, usage recorded once with feature = task', async () => {
    const h = makeRunner({});
    const result = await h.runner.runAiTask('competitor_judge', text, { workspaceId: 'w1', userId: 'u1' });
    expect(result).toMatchObject({ ok: true, provider: 'openai', text: 'openai', failedOver: [] });
    expect(h.recordUsage).toHaveBeenCalledTimes(1);
    expect(h.recordUsage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', feature: 'competitor_judge', workspaceId: 'w1', userId: 'u1' }),
    );
    expect(h.openai.calls[0].model).toBe('openai-model');
  });

  it('billing → next provider immediately (no retry, no sleep), marked unhealthy for 15 min, critical alert', async () => {
    const h = makeRunner({ openai: ['billing'] });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', failedOver: [{ provider: 'openai', errorClass: 'billing' }] });
    expect(h.openai.calls).toHaveLength(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(h.alerts.failed[0]).toMatchObject({ provider: 'openai', errorClass: 'billing', failedOverTo: 'anthropic' });
    expect(h.alerts.health).toEqual([{ provider: 'openai', change: 'billing' }]);
    const snap = h.runner.getProviderHealthSnapshot().find((s) => s.provider === 'openai')!;
    expect(snap.healthy).toBe(false);
    expect(snap.coolingDownUntil?.getTime()).toBe(clock + CRITICAL_COOLDOWN_MS);

    // second call skips openai without a request
    await h.runner.runAiTask('competitor_judge', text);
    expect(h.openai.calls).toHaveLength(1);
  });

  it('auth and model_gone also fail over now', async () => {
    for (const cls of ['auth', 'model_gone'] as const) {
      const h = makeRunner({ openai: [cls] });
      const result = await h.runner.runAiTask('keywords', text);
      expect(result.ok && result.provider).toBe('anthropic');
      expect(h.openai.calls).toHaveLength(1);
    }
  });

  it('rate limit → one retry after min(retry-after, 2 s), then next provider', async () => {
    const h = makeRunner({ openai: [{ class: 'rate_limit', retryAfterMs: 30_000 }] });
    const result = await h.runner.runAiTask('keywords', text);
    expect(h.openai.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', failedOver: [{ provider: 'openai', errorClass: 'rate_limit' }] });
    expect(h.alerts.failed.map((f) => f.failedOverTo)).toEqual(['openai', 'anthropic']);
    // cool-down = retry-after capped at 60 s
    const snap = h.runner.getProviderHealthSnapshot().find((s) => s.provider === 'openai')!;
    expect(snap.coolingDownUntil?.getTime()).toBe(clock + 30_000);
  });

  it('rate limit retry that succeeds stays on the same provider and does not cool down', async () => {
    const h = makeRunner({ openai: [{ class: 'rate_limit', retryAfterMs: 500 }, { ok: 'second try' }] });
    const result = await h.runner.runAiTask('keywords', text);
    expect(result).toMatchObject({ ok: true, provider: 'openai', text: 'second try', failedOver: [] });
    expect(sleep).toHaveBeenCalledWith(500);
    expect(h.runner.getProviderHealthSnapshot()[0].healthy).toBe(true);
  });

  it('5xx and timeout → next provider without retry', async () => {
    for (const cls of ['server', 'overloaded', 'timeout', 'network'] as const) {
      const h = makeRunner({ openai: [cls] });
      const result = await h.runner.runAiTask('keywords', text);
      expect(result.ok && result.provider).toBe('anthropic');
      expect(h.openai.calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it('bad_request → no failover, returned to the caller', async () => {
    const h = makeRunner({ openai: ['bad_request'] });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(result).toMatchObject({ ok: false, kind: 'bad_request', firstErrorClass: 'bad_request' });
    expect(h.anthropic.calls).toHaveLength(0);
    expect(h.alerts.failed[0].failedOverTo).toBeNull();
    expect(h.alerts.allDown).toEqual([]);
  });

  it('refusal → no failover', async () => {
    const h = makeRunner({ gemini: ['refusal'] });
    const result = await h.runner.runAiTask('content_draft', text);
    expect(result).toMatchObject({ ok: false, kind: 'refusal' });
    expect(h.openai.calls).toHaveLength(0);
  });

  it('invalid_output → same provider once more, then next', async () => {
    const h = makeRunner({ openai: ['invalid_output'] });
    const result = await h.runner.runAiTask('keywords', text);
    expect(h.openai.calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', failedOver: [{ provider: 'openai', errorClass: 'invalid_output' }] });
    // invalid output does not make a provider unhealthy
    expect(h.runner.getProviderHealthSnapshot()[0].healthy).toBe(true);
  });

  it('JSON that fails the schema is invalid_output (layer validates every provider)', async () => {
    const h = makeRunner({ openai: [{ ok: '{"b":1}' }], anthropic: [{ ok: '{"a":"yes"}' }] });
    const result = await h.runner.runAiTask('competitor_judge', json);
    expect(h.openai.calls).toHaveLength(2);
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', json: { a: 'yes' } });
    expect(h.alerts.failed[0].message).toContain('fails schema');
  });

  it('all down → all_unavailable + allUnavailable alert; allRateLimited only when every attempt was a rate limit', async () => {
    const h = makeRunner({ openai: ['billing'], anthropic: ['server'], gemini: ['timeout'] });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(result).toMatchObject({ ok: false, kind: 'all_unavailable', firstErrorClass: 'billing', allRateLimited: false });
    expect(h.alerts.allDown).toEqual(['competitor_judge:billing']);
    expect(h.alerts.failed.at(-1)?.failedOverTo).toBeNull();

    const r = makeRunner({ openai: ['rate_limit'], anthropic: ['rate_limit'], gemini: ['rate_limit'] });
    const rl = await r.runner.runAiTask('competitor_judge', text);
    expect(rl).toMatchObject({ ok: false, kind: 'all_unavailable', firstErrorClass: 'rate_limit', allRateLimited: true });
  });

  it('no key → skipped and logged once as not configured, never a failure', async () => {
    const env = { OPENAI_KEY: 'k1', GEMINI_KEY: 'k3', NODE_ENV: 'test' };
    const h = makeRunner({ openai: ['billing'] }, { env });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(result).toMatchObject({ ok: true, provider: 'gemini', failedOver: [{ provider: 'openai', errorClass: 'billing' }] });
    expect(h.anthropic.calls).toHaveLength(0);
    expect(h.alerts.failed.map((f) => f.provider)).toEqual(['openai']);
    expect(h.alerts.failed[0].failedOverTo).toBe('gemini');
    expect(h.alerts.notConfigured).toEqual(['anthropic']);
    expect(h.runner.getProviderHealthSnapshot().find((s) => s.provider === 'anthropic')).toMatchObject({ configured: false, healthy: true });
  });

  it('nothing configured → all_unavailable with firstErrorClass not_configured', async () => {
    const h = makeRunner({}, { env: { NODE_ENV: 'test' } });
    const result = await h.runner.runAiTask('keywords', text);
    expect(result).toMatchObject({ ok: false, kind: 'all_unavailable', firstErrorClass: 'not_configured' });
  });

  it('AiUnavailableError carries the failure', () => {
    const failure = { ok: false as const, kind: 'all_unavailable' as const, attempts: [], firstErrorClass: 'billing' as const, allRateLimited: false };
    const error = new AiUnavailableError('keywords', failure);
    expect(error.result).toBe(failure);
    expect(error.message).toContain('billing');
  });
});

describe('llm-engineer corrections', () => {
  it('B5: AiResult.model and ai_usage_logs use the model that actually answered (e.g. a Claude server-side fallback)', async () => {
    const h = makeRunner({ openai: ['billing'] });
    h.anthropic.adapter.call = async () => ({ model: 'claude-opus-4-8', text: 'served by fallback', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(result.ok && result.model).toBe('claude-opus-4-8');
    expect(h.recordUsage).toHaveBeenCalledWith(expect.objectContaining({ provider: 'anthropic', model: 'claude-opus-4-8' }));
  });

  it('B6: Claude json_object wrapped in prose is extracted, not invalid_output', async () => {
    const h = makeRunner({ openai: ['billing'], anthropic: [{ ok: 'Sure! {"a":"x"} Let me know.' }] });
    const result = await h.runner.runAiTask('keywords', { prompt: 'p', output: { kind: 'json_object' }, timeoutMs: 1000 });
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', json: { a: 'x' } });
  });

  it('B6: other providers stay strict (prose-wrapped JSON from OpenAI is invalid_output)', async () => {
    const h = makeRunner({ openai: [{ ok: 'Sure! {"a":"x"}' }], anthropic: [{ ok: '{"a":"y"}' }] });
    const result = await h.runner.runAiTask('keywords', { prompt: 'p', output: { kind: 'json_object' }, timeoutMs: 1000 });
    expect(result.ok && result.provider).toBe('anthropic');
    expect(h.alerts.failed.map((f) => f.errorClass)).toEqual(['invalid_output', 'invalid_output']);
  });

  it('B2: normalised enum value is what the caller gets', async () => {
    const schema = { type: 'object', required: ['t'], properties: { t: { type: 'string', enum: ['DIRECT', 'INDIRECT'] } } };
    const h = makeRunner({ openai: [{ ok: '{"t":"indirect"}' }] });
    const result = await h.runner.runAiTask('competitor_judge', { prompt: 'p', output: { kind: 'json_schema', name: 's', schema }, timeoutMs: 1000 });
    expect(result).toMatchObject({ ok: true, provider: 'openai', json: { t: 'INDIRECT' } });
  });
});

describe('cool-down and probe', () => {
  it('transient errors cool down only after 3 in a row, then the first call after expiry is the probe', async () => {
    const h = makeRunner({ openai: ['server', 'server', 'server', { ok: 'back' }] });
    await h.runner.runAiTask('keywords', text);
    await h.runner.runAiTask('keywords', text);
    expect(h.runner.hasHealthyProvider('keywords')).toBe(true);
    expect(h.runner.getProviderHealthSnapshot()[0].healthy).toBe(true);
    await h.runner.runAiTask('keywords', text);
    expect(h.runner.getProviderHealthSnapshot()[0].healthy).toBe(false);
    expect(h.openai.calls).toHaveLength(3);

    await h.runner.runAiTask('keywords', text); // skipped
    expect(h.openai.calls).toHaveLength(3);

    clock += TRANSIENT_COOLDOWN_MS + 1;
    const probe = await h.runner.runAiTask('keywords', text);
    expect(probe).toMatchObject({ ok: true, provider: 'openai', text: 'back' });
    expect(h.alerts.health.map((x) => x.change)).toEqual(['server', 'recovered']);
  });

  it('billing cool-down: skipped while cooling, probed after 15 min', async () => {
    const h = makeRunner({ openai: ['billing', { ok: 'paid' }] });
    await h.runner.runAiTask('keywords', text);
    clock += CRITICAL_COOLDOWN_MS - 1000;
    const during = await h.runner.runAiTask('keywords', text);
    expect(during.ok && during.provider).toBe('anthropic');
    expect(h.openai.calls).toHaveLength(1);
    clock += 2000;
    const after = await h.runner.runAiTask('keywords', text);
    expect(after.ok && after.provider).toBe('openai');
  });

  it('a cooling-down provider counts with its reason in firstErrorClass', async () => {
    const h = makeRunner({ openai: ['billing'], anthropic: ['server'], gemini: ['server'] });
    await h.runner.runAiTask('keywords', text);
    const second = await h.runner.runAiTask('keywords', text);
    expect(second).toMatchObject({ ok: false, firstErrorClass: 'billing' });
    expect(second.ok === false && second.attempts[0]).toMatchObject({ provider: 'openai', errorClass: 'cooling_down', reason: 'billing' });
  });

  it('hasHealthyProvider: false when every configured provider in the chain is cooling down', async () => {
    const h = makeRunner({ openai: ['billing'], anthropic: ['auth'], gemini: ['model_gone'] });
    expect(h.runner.hasHealthyProvider('competitor_judge')).toBe(true);
    await h.runner.runAiTask('competitor_judge', text);
    expect(h.runner.hasHealthyProvider('competitor_judge')).toBe(false);
  });
});

describe('AI_FORCE_FAIL through the runner', () => {
  it('forced billing fails without calling the adapter and still goes through alert + health', async () => {
    const env = { ...allKeys, AI_FORCE_FAIL: 'openai:billing' };
    const h = makeRunner({}, { env });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(h.openai.calls).toHaveLength(0);
    expect(result).toMatchObject({ ok: true, provider: 'anthropic', failedOver: [{ provider: 'openai', errorClass: 'billing' }] });
    expect(h.alerts.failed[0]).toMatchObject({ provider: 'openai', errorClass: 'billing', forced: true });
    expect(h.alerts.health).toEqual([{ provider: 'openai', change: 'billing' }]);
  });

  it('ignored in production', async () => {
    const env = { ...allKeys, NODE_ENV: 'production', AI_FORCE_FAIL: 'openai:billing' };
    const h = makeRunner({}, { env });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(result.ok && result.provider).toBe('openai');
    expect(h.openai.calls).toHaveLength(1);
  });
});

describe('health restored from ai_provider_events after a restart', () => {
  it('a billing event younger than 15 min puts the provider back in cool-down', async () => {
    const store: AiProviderEventStore = {
      insert: vi.fn(async () => {}),
      latestCriticalSince: vi.fn(async () => [{ provider: 'openai' as const, errorClass: 'billing' as const, createdAt: new Date(clock - 60_000) }]),
    };
    const h = makeRunner({}, { store });
    const result = await h.runner.runAiTask('competitor_judge', text);
    expect(result.ok && result.provider).toBe('anthropic');
    expect(h.openai.calls).toHaveLength(0);
    expect(store.latestCriticalSince).toHaveBeenCalledTimes(1);
    await h.runner.runAiTask('competitor_judge', text);
    expect(store.latestCriticalSince).toHaveBeenCalledTimes(1);
  });

  it('a fresh runner: snapshot after hydrate shows a stored real billing cool-down as unhealthy', async () => {
    const store: AiProviderEventStore = {
      insert: vi.fn(async () => {}),
      latestCriticalSince: vi.fn(async () => [{ provider: 'openai' as const, errorClass: 'billing' as const, createdAt: new Date(clock - 60_000) }]),
    };
    const h = makeRunner({}, { store });
    expect(h.runner.getProviderHealthSnapshot()[0].healthy).toBe(true); // not hydrated yet: the bug QA saw
    await h.runner.hydrate();
    const openai = h.runner.getProviderHealthSnapshot().find((s) => s.provider === 'openai')!;
    expect(openai).toMatchObject({ healthy: false, reason: 'billing' });
    expect(openai.coolingDownUntil?.getTime()).toBe(clock - 60_000 + CRITICAL_COOLDOWN_MS);
  });

  it('a recovery as the latest event, or a failing DB, does not block anything', async () => {
    const recovered: AiProviderEventStore = {
      insert: vi.fn(async () => {}),
      latestCriticalSince: vi.fn(async () => [{ provider: 'openai' as const, recovered: true as const, createdAt: new Date(clock) }]),
    };
    expect((await makeRunner({}, { store: recovered }).runner.runAiTask('keywords', text)).ok).toBe(true);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken: AiProviderEventStore = {
      insert: vi.fn(async () => {}),
      latestCriticalSince: vi.fn(async () => {
        throw new Error('relation "ai_provider_events" does not exist');
      }),
    };
    const result = await makeRunner({}, { store: broken }).runner.runAiTask('keywords', text);
    expect(result.ok && result.provider).toBe('openai');
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('could not restore provider health'), expect.any(String));
    spy.mockRestore();
  });
});

describe('robustness', () => {
  it('a usage logger that throws never breaks the answer', async () => {
    const h = makeRunner({});
    h.recordUsage.mockImplementation(() => {
      throw new Error('db down');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await h.runner.runAiTask('keywords', text);
    expect(result.ok).toBe(true);
    spy.mockRestore();
  });

  it('an unexpected adapter throw is treated as server and fails over loudly', async () => {
    const h = makeRunner({});
    h.openai.adapter.call = async () => {
      throw new TypeError('cannot read properties of undefined');
    };
    const result = await h.runner.runAiTask('keywords', text);
    expect(result.ok && result.provider).toBe('anthropic');
    expect(h.alerts.failed[0]).toMatchObject({ errorClass: 'server' });
    expect(h.alerts.failed[0].message).toContain('unexpected');
  });

  it('empty text with no search results is invalid_output', async () => {
    const h = makeRunner({ openai: [{ ok: '  ' }] });
    const result = await h.runner.runAiTask('keywords', text);
    expect(result.ok && result.provider).toBe('anthropic');
    expect(h.alerts.failed.map((f) => f.errorClass)).toEqual(['invalid_output', 'invalid_output']);
  });
});

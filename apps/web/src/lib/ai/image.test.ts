import { beforeEach, describe, expect, it, vi } from 'vitest';

const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage }));
vi.mock('@/lib/db', () => ({ prisma: {} }));

import {
  DEFAULT_OPENAI_IMAGE_FALLBACKS,
  DEFAULT_OPENAI_IMAGE_MODEL,
  classifyImageError,
  generateOpenAiImage,
  imageModelChain,
  resetImageAlerts,
  type ImageEventRow,
} from './image';
import { resetRetirementWarnings } from './retirements';

const ENV = { OPENAI_API_KEY: 'sk-test' };

/** The body OpenAI sent for gpt-image-1 on production, 23 Nov. */
const GONE = {
  error: {
    message: "The model 'gpt-image-1' does not exist.",
    type: 'image_generation_user_error',
    param: null,
    code: null,
  },
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const OK = (model: string) => reply(200, { model, data: [{ b64_json: 'aGVsbG8=' }], usage: { input_tokens: 50, output_tokens: 439, total_tokens: 489 } });

function harness(responses: Array<Response | Error | ((model: string) => Response)>) {
  const events: ImageEventRow[] = [];
  const logs: string[] = [];
  const models: string[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model as string;
    models.push(model);
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(model) : next;
  });
  return {
    events,
    logs,
    models,
    deps: {
      env: ENV,
      fetch: fetchMock as unknown as typeof fetch,
      insertEvent: async (row: ImageEventRow) => {
        events.push(row);
      },
      log: (line: string) => logs.push(line),
    },
  };
}

const prompt = { prompt: 'flat navy illustration', workspaceId: 'ws-1', userId: 'u-1' };

beforeEach(() => {
  captureMessage.mockReset();
  resetImageAlerts();
  resetRetirementWarnings();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('imageModelChain', () => {
  it('is the default then its fallbacks', () => {
    expect(imageModelChain({})).toEqual([DEFAULT_OPENAI_IMAGE_MODEL, ...DEFAULT_OPENAI_IMAGE_FALLBACKS]);
  });

  it('puts OPENAI_IMAGE_MODEL first and honours OPENAI_IMAGE_FALLBACK_MODELS, without duplicates', () => {
    expect(
      imageModelChain({ OPENAI_IMAGE_MODEL: 'gpt-image-2.6-sunburst', OPENAI_IMAGE_FALLBACK_MODELS: ' gpt-image-2.5-flare, gpt-image-2.6-sunburst ,' }),
    ).toEqual(['gpt-image-2.6-sunburst', 'gpt-image-2.5-flare']);
  });

  it('never calls the model that caused B19 by default', () => {
    expect(imageModelChain({})).not.toContain('gpt-image-1');
  });
});

describe('classifyImageError', () => {
  it('reads the live 400 "does not exist" as a gone model, not a bad request', () => {
    expect(classifyImageError(400, GONE).errorClass).toBe('model_gone');
  });
  it('reads org verification as auth', () => {
    expect(classifyImageError(403, { error: { message: 'Your organization must be verified to use the model `gpt-image-2.5-flare`.' } }).errorClass).toBe('auth');
  });
  it('reads a moderation block as a refusal', () => {
    expect(classifyImageError(400, { error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system.' } }).errorClass).toBe('refusal');
  });
  it('reads insufficient_quota as billing', () => {
    expect(classifyImageError(429, { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'You exceeded your current quota' } }).errorClass).toBe('billing');
  });
});

describe('generateOpenAiImage', () => {
  it('returns the picture from the first model that answers', async () => {
    const h = harness([OK(DEFAULT_OPENAI_IMAGE_MODEL)]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: true, model: DEFAULT_OPENAI_IMAGE_MODEL, b64: 'aGVsbG8=' });
    expect(h.events).toEqual([]);
  });

  it('moves to the next model when one is gone, and records the event', async () => {
    const h = harness([reply(400, GONE), (m) => OK(m)]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: true, model: DEFAULT_OPENAI_IMAGE_FALLBACKS[0] });
    expect(h.events).toHaveLength(1);
    expect(h.events[0]).toMatchObject({
      provider: 'openai',
      task: 'content_image',
      errorClass: 'model_gone',
      status: 400,
      eventType: 'attempt_failed',
      failedOverTo: `openai:${DEFAULT_OPENAI_IMAGE_FALLBACKS[0]}`,
      workspaceId: 'ws-1',
      userId: 'u-1',
    });
    expect(h.events[0].message).toMatch(/^IMAGE_MODEL_UNAVAILABLE gpt-image-2\.5-flare: /);
  });

  it('IMAGE_MODEL_UNAVAILABLE when every model is gone: fatal, logged, one event per model', async () => {
    const h = harness([reply(400, GONE), reply(404, GONE), reply(400, GONE)]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_MODEL_UNAVAILABLE' });
    expect(h.models).toEqual(imageModelChain({}));
    expect(h.events.map((e) => e.errorClass)).toEqual(['model_gone', 'model_gone', 'model_gone']);
    expect(h.events.at(-1)?.failedOverTo).toBeNull();
    expect(h.logs.join('\n')).toMatch(/IMAGE_MODEL_UNAVAILABLE.*text only/);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage.mock.calls[0][1]).toMatchObject({ level: 'fatal', fingerprint: ['ai-image', 'IMAGE_MODEL_UNAVAILABLE'] });
  });

  it('IMAGE_PROVIDER_OUT_OF_CREDIT stops at once: another model on the same key would fail too', async () => {
    const h = harness([reply(429, { error: { type: 'insufficient_quota', code: 'insufficient_quota', message: 'quota' } })]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_PROVIDER_OUT_OF_CREDIT' });
    expect(h.models).toHaveLength(1);
    expect(h.events[0]).toMatchObject({ errorClass: 'billing', failedOverTo: null });
    expect(captureMessage.mock.calls[0][1]).toMatchObject({ level: 'fatal' });
  });

  it('IMAGE_PROVIDER_AUTH on a bad key or an unverified org, without trying other models', async () => {
    const h = harness([reply(401, { error: { code: 'invalid_api_key', message: 'Incorrect API key provided: sk-abc***' } })]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_PROVIDER_AUTH' });
    expect(h.models).toHaveLength(1);
  });

  it('IMAGE_REJECTED on a moderation block, without retrying the same prompt elsewhere', async () => {
    const h = harness([reply(400, { error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system.' } })]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_REJECTED' });
    expect(h.models).toHaveLength(1);
    expect(captureMessage.mock.calls[0][1]).toMatchObject({ level: 'error' });
  });

  it('IMAGE_RATE_LIMITED after every model answered 429', async () => {
    const h = harness([reply(429, { error: { message: 'Rate limit reached' } }), reply(429, { error: { message: 'Rate limit reached' } }), reply(429, { error: { message: 'Rate limit reached' } })]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_RATE_LIMITED' });
    expect(h.models).toHaveLength(3);
  });

  it('IMAGE_PROVIDER_UNAVAILABLE on 5xx and network errors', async () => {
    const h = harness([reply(503, { error: { message: 'overloaded' } }), reply(500, { error: { message: 'server' } }), new TypeError('fetch failed')]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_PROVIDER_UNAVAILABLE' });
    expect(h.events.map((e) => e.errorClass)).toEqual(['overloaded', 'server', 'network']);
  });

  it('IMAGE_TIMEOUT when the last model timed out', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const h = harness([timeout, timeout, timeout]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_TIMEOUT' });
  });

  it('IMAGE_EMPTY_RESPONSE when a 200 carries no image on every model', async () => {
    const h = harness([reply(200, { data: [] }), reply(200, { data: [{}] }), reply(200, {})]);
    const result = await generateOpenAiImage(prompt, h.deps);
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_EMPTY_RESPONSE' });
  });

  it('IMAGE_NOT_CONFIGURED without a key, and makes no request', async () => {
    const h = harness([]);
    const result = await generateOpenAiImage(prompt, { ...h.deps, env: {} });
    expect(result).toMatchObject({ ok: false, cause: 'IMAGE_NOT_CONFIGURED' });
    expect(h.models).toEqual([]);
  });

  it('never stores or logs the API key', async () => {
    const h = harness([reply(401, { error: { message: 'Incorrect API key provided: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX' } })]);
    await generateOpenAiImage(prompt, h.deps);
    expect(JSON.stringify(h.events) + h.logs.join('')).not.toContain('sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX');
  });

  it('still answers when the event store is down', async () => {
    const h = harness([reply(400, GONE), (m) => OK(m)]);
    const result = await generateOpenAiImage(prompt, {
      ...h.deps,
      insertEvent: async () => {
        throw new Error('db down');
      },
    });
    expect(result.ok).toBe(true);
  });

  it('alerts once per cause per process', async () => {
    for (let i = 0; i < 3; i++) {
      const h = harness([reply(429, { error: { type: 'insufficient_quota', message: 'quota' } })]);
      await generateOpenAiImage(prompt, h.deps);
    }
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });

  it('warns when the configured model is about to shut down', async () => {
    const h = harness([OK('gpt-image-1.5')]);
    await generateOpenAiImage(prompt, { ...h.deps, env: { ...ENV, OPENAI_IMAGE_MODEL: 'gpt-image-1.5' } });
    // 2026-12-01 shutdown: inside the 14-day window from 22 Nov onward.
    if (Date.now() >= Date.parse('2026-11-17T00:00:00Z')) {
      expect(captureMessage.mock.calls.some((c) => /gpt-image-1\.5/.test(String(c[0])))).toBe(true);
    }
  });
});

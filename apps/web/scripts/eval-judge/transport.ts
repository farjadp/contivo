/**
 * How the eval reaches a model. Two transports:
 *
 *   - layerTransport(provider): the failover layer contivo-cto is building
 *     (src/lib/ai/run.ts, `runAiTask`), forced onto ONE provider. Until that
 *     module exists it fails every call with a clear message; nothing here
 *     calls a provider API directly, so the eval measures exactly the
 *     transport production will use.
 *   - fixtureTransport(replies): canned replies, for tests. Zero cost.
 *
 * Contract (src/lib/ai/types.ts as of 21 Nov; run.ts not written yet):
 *
 *   runAiTask('quality_gate', { system, prompt, output: { kind: 'json_object' }, timeoutMs })
 *   → AiSuccess { ok: true, provider, model, text, json, usage, failedOver }
 *   → AiFailure { ok: false, kind, attempts, firstErrorClass }
 *
 * Forcing one provider uses the layer's own env override (chains.ts):
 * AI_CHAIN_QUALITY_GATE=<provider>. A one-entry chain has nothing to fall
 * through to, and the result is still checked: anything not answered by the
 * forced provider is an error, never a data point.
 *
 * TODO(contivo-cto): if runAiTask's export name or module path differs when
 * run.ts lands, change LAYER_MODULE / the `runAiTask` lookup below.
 */

import type { AiTokenUsage } from '@/lib/ai-usage';

import type { JudgeCall, JudgeProvider, JudgeRequest, JudgeTransport } from './types';

const LAYER_MODULE = '@/lib/ai/run';
const TASK = 'quality_gate';
/** chains.ts chainEnvName('quality_gate'). */
export const CHAIN_ENV = 'AI_CHAIN_QUALITY_GATE';

type LayerResult =
  | {
      ok: true;
      provider: string;
      model: string;
      text: string;
      json?: unknown;
      usage?: AiTokenUsage | null;
      failedOver?: unknown[];
    }
  | { ok: false; kind: string; attempts?: unknown[] };

type RunAiTask = (task: string, request: Record<string, unknown>) => Promise<LayerResult>;

export class LayerNotAvailableError extends Error {
  constructor(detail: string) {
    super(
      `AI provider layer not available (${detail}). The eval needs runAiTask from ${LAYER_MODULE} with a forced-provider option; see docs/evals/judge-calibration.md.`,
    );
    this.name = 'LayerNotAvailableError';
  }
}

async function loadRunAiTask(): Promise<RunAiTask> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(/* @vite-ignore */ LAYER_MODULE)) as Record<string, unknown>;
  } catch (error) {
    throw new LayerNotAvailableError(`cannot import: ${(error as Error).message.split('\n')[0]}`);
  }
  if (typeof mod.runAiTask !== 'function') throw new LayerNotAvailableError('runAiTask is not exported');
  return mod.runAiTask as RunAiTask;
}

export function layerTransport(provider: JudgeProvider, loader: () => Promise<RunAiTask> = loadRunAiTask): JudgeTransport {
  let runAiTask: RunAiTask | null = null;
  return {
    provider,
    async call(request: JudgeRequest): Promise<JudgeCall> {
      runAiTask ??= await loader();
      const started = Date.now();
      let result: LayerResult;
      const previous = process.env[CHAIN_ENV];
      process.env[CHAIN_ENV] = provider;
      try {
        result = await runAiTask(TASK, {
          system: request.system,
          prompt: request.prompt,
          output: { kind: 'json_object' },
          timeoutMs: request.timeoutMs,
        });
      } catch (error) {
        return { ok: false, error: `threw: ${(error as Error).message}`, latencyMs: Date.now() - started };
      } finally {
        if (previous === undefined) delete process.env[CHAIN_ENV];
        else process.env[CHAIN_ENV] = previous;
      }
      const latencyMs = Date.now() - started;
      if (!result.ok) return { ok: false, error: `layer: ${result.kind}`, latencyMs };
      // Fail closed on a silent failover: a run forced onto Claude that was
      // answered by OpenAI would certify the wrong judge.
      if (result.provider !== provider || (result.failedOver?.length ?? 0) > 0) {
        return {
          ok: false,
          error: `provider_mismatch: forced ${provider}, answered by ${result.provider} (failedOver ${result.failedOver?.length ?? 0})`,
          latencyMs,
        };
      }
      return {
        ok: true,
        provider: result.provider,
        model: result.model,
        text: result.text,
        json: result.json ?? null,
        usage: result.usage ?? null,
        latencyMs,
      };
    },
  };
}

/** Replies keyed by a substring of the prompt (e.g. a phrase from the draft). */
export function fixtureTransport(
  replies: Array<{ match: string; reply: string | Error }>,
  model = 'fixture-model',
): JudgeTransport {
  return {
    provider: 'fixture',
    async call(request) {
      const hit = replies.find((r) => request.prompt.includes(r.match));
      if (!hit) return { ok: false, error: 'fixture: no reply for prompt', latencyMs: 0 };
      if (hit.reply instanceof Error) return { ok: false, error: hit.reply.message, latencyMs: 0 };
      return {
        ok: true,
        provider: 'fixture',
        model,
        text: hit.reply,
        json: null,
        usage: { promptTokens: 1000, completionTokens: 100, totalTokens: 1100 },
        latencyMs: 0,
      };
    },
  };
}

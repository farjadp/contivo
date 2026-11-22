/**
 * runAiTask: walk the task's provider chain, classify each failure, mark
 * health, log + alert every failure, and return the first good answer.
 *
 * Per class (spec §2):
 *  billing / auth / model_gone      → next provider now
 *  rate_limit                       → one retry after min(retry-after, 2 s), then next
 *  overloaded / server / timeout / network → next
 *  invalid_output                   → same provider once more, then next
 *  bad_request                      → stop, no failover (our bug)
 *  refusal                          → stop, no failover (content problem)
 *
 * A provider without a key is skipped and logged once; it is never a failure.
 */

import { recordAiUsage, type RecordAiUsageInput } from '@/lib/ai-usage';

import { createAlertSink, createPrismaEventStore, type AiAlertSink, type AiProviderEventStore } from './alert';
import { resolveChain } from './chains';
import { AiProviderError } from './errors';
import { forcedFailure } from './force-fail';
import { CRITICAL_COOLDOWN_MS, ProviderHealth } from './health';
import { createModelResolver, modelFor, type ModelResolver } from './models';
import { extractJsonObject, normaliseAndValidate, parseJsonText } from './output';
import { anthropicAdapter } from './providers/anthropic';
import { geminiAdapter } from './providers/gemini';
import { openAiAdapter } from './providers/openai';
import {
  PROVIDER_IDS,
  type AiAttempt,
  type AiCallContext,
  type AiErrorClass,
  type AiFailure,
  type AiRequest,
  type AiResult,
  type AiTask,
  type ProviderAdapter,
  type ProviderId,
  type ProviderSuccess,
} from './types';

export const RATE_LIMIT_RETRY_CAP_MS = 2_000;
/** Bound on the one DB read that restores health after a restart. */
const HYDRATE_TIMEOUT_MS = 2_000;

const FAILOVER_CLASSES: ReadonlySet<AiErrorClass> = new Set([
  'billing',
  'auth',
  'model_gone',
  'rate_limit',
  'overloaded',
  'server',
  'timeout',
  'network',
  'invalid_output',
]);

type Env = Record<string, string | undefined>;

export interface AiRunnerDeps {
  adapters: Record<ProviderId, ProviderAdapter>;
  health: ProviderHealth;
  alerts: AiAlertSink;
  store: AiProviderEventStore | null;
  resolveModel: ModelResolver;
  recordUsage: (input: RecordAiUsageInput) => void | Promise<void>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  env: () => Env;
}

export class AiUnavailableError extends Error {
  readonly result: AiFailure;
  readonly task: AiTask;

  constructor(task: AiTask, result: AiFailure) {
    super(`AI ${result.kind} for ${task} (first error: ${result.firstErrorClass})`);
    this.name = 'AiUnavailableError';
    this.task = task;
    this.result = result;
  }
}

export interface ProviderHealthSnapshot {
  provider: ProviderId;
  configured: boolean;
  healthy: boolean;
  coolingDownUntil: Date | null;
  reason: AiErrorClass | null;
  lastErrorClass: AiErrorClass | null;
  lastErrorAt: Date | null;
}

export interface AiRunner {
  runAiTask(task: AiTask, request: AiRequest, ctx?: AiCallContext): Promise<AiResult>;
  hasHealthyProvider(task: AiTask): boolean;
  getProviderHealthSnapshot(): ProviderHealthSnapshot[];
  /** Restore billing/auth cool-downs from ai_provider_events (once per runner). */
  hydrate(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAiRunner(deps: AiRunnerDeps): AiRunner {
  let hydration: Promise<void> | null = null;

  const isConfigured = (provider: ProviderId) => Boolean(deps.env()[deps.adapters[provider].keyEnv]?.trim());

  const hydrate = (): Promise<void> => {
    if (hydration) return hydration;
    hydration = (async () => {
      if (!deps.store) return;
      try {
        const since = new Date(deps.now() - CRITICAL_COOLDOWN_MS);
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timed out')), HYDRATE_TIMEOUT_MS).unref?.(),
        );
        const events = await Promise.race([deps.store.latestCriticalSince(since), timeout]);
        for (const event of events) {
          if ('errorClass' in event) deps.health.restore(event.provider, event.errorClass, event.createdAt);
        }
      } catch (error) {
        console.error('[ai] could not restore provider health from ai_provider_events:', errorMessage(error));
      }
    })();
    return hydration;
  };

  /** One call to one provider, with the forced-failure hook and output checks. */
  async function attemptOnce(provider: ProviderId, task: AiTask, request: AiRequest): Promise<ProviderSuccess & { json?: unknown }> {
    const forced = forcedFailure(provider, deps.env());
    if (forced) {
      throw Object.assign(
        new AiProviderError({
          provider,
          errorClass: forced,
          status: forced === 'billing' ? 429 : undefined,
          message: `forced ${forced} failure`,
        }),
        { forced: true },
      );
    }

    const adapter = deps.adapters[provider];
    const model = await modelFor(deps.resolveModel, provider, task, request);
    const apiKey = deps.env()[adapter.keyEnv]?.trim() ?? '';
    const result = await adapter.call({ task, request, model, apiKey });

    if (request.output.kind === 'text') {
      const foundSources = (result.webSearch?.citations.length ?? 0) + (result.webSearch?.sourceUrls.length ?? 0) > 0;
      if (!result.text.trim() && !foundSources) {
        throw new AiProviderError({ provider, errorClass: 'invalid_output', status: 200, message: 'empty text' });
      }
      return result;
    }

    // Claude runs json_object (and web-search JSON) without a format constraint
    // and may wrap the object in prose; the other providers are constrained.
    let json = provider === 'anthropic' ? extractJsonObject(result.text) : parseJsonText(result.text);
    if (json === null) {
      throw new AiProviderError({ provider, errorClass: 'invalid_output', status: 200, message: 'reply is not JSON' });
    }
    if (request.output.kind === 'json_object' && (typeof json !== 'object' || Array.isArray(json))) {
      throw new AiProviderError({ provider, errorClass: 'invalid_output', status: 200, message: 'reply is not a JSON object' });
    }
    if (request.output.kind === 'json_schema') {
      const checked = normaliseAndValidate(json, request.output.schema);
      if (checked.errors.length > 0) {
        throw new AiProviderError({
          provider,
          errorClass: 'invalid_output',
          status: 200,
          message: `reply fails schema ${request.output.name}: ${checked.errors.slice(0, 5).join('; ')}`,
        });
      }
      json = checked.value;
    }
    return { ...result, json };
  }

  function toProviderError(provider: ProviderId, error: unknown): AiProviderError & { forced?: boolean } {
    if (error instanceof AiProviderError) return error;
    // An adapter bug or unexpected throw: count it as a server-side failure so the chain moves on, loudly.
    return new AiProviderError({ provider, errorClass: 'server', message: `unexpected: ${errorMessage(error)}` });
  }

  async function runAiTask(task: AiTask, request: AiRequest, ctx: AiCallContext = {}): Promise<AiResult> {
    await hydrate();

    const chain = resolveChain(task, deps.env());
    const attempts: AiAttempt[] = [];
    const failedOver: Array<{ provider: ProviderId; errorClass: AiErrorClass }> = [];

    const nextUsable = (index: number): ProviderId | null => {
      for (let i = index + 1; i < chain.length; i += 1) {
        if (isConfigured(chain[i]) && deps.health.isAvailable(chain[i])) return chain[i];
      }
      return null;
    };

    const fail = (kind: AiFailure['kind']): AiFailure => {
      const real = attempts.filter((a) => a.errorClass !== 'not_configured');
      const first = real[0];
      const firstErrorClass: AiFailure['firstErrorClass'] = first
        ? first.errorClass === 'cooling_down'
          ? (first.reason ?? 'server')
          : (first.errorClass as AiErrorClass)
        : 'not_configured';
      const allRateLimited =
        real.length > 0 &&
        real.every((a) => a.errorClass === 'rate_limit' || (a.errorClass === 'cooling_down' && a.reason === 'rate_limit'));
      return { ok: false, kind, attempts, firstErrorClass, allRateLimited };
    };

    for (let index = 0; index < chain.length; index += 1) {
      const provider = chain[index];

      if (!isConfigured(provider)) {
        deps.alerts.notConfigured(provider, deps.adapters[provider].keyEnv);
        attempts.push({ provider, errorClass: 'not_configured', message: `${deps.adapters[provider].keyEnv} not set` });
        continue;
      }
      if (!deps.health.claim(provider)) {
        const view = deps.health.view(provider);
        attempts.push({
          provider,
          errorClass: 'cooling_down',
          reason: view.reason ?? view.lastErrorClass ?? undefined,
          message: view.coolingDownUntil
            ? `skipped: cooling down until ${view.coolingDownUntil.toISOString()}`
            : 'skipped: health probe already in flight',
        });
        continue;
      }

      let retriedRateLimit = false;
      let retriedInvalid = false;

      for (;;) {
        try {
          const result = await attemptOnce(provider, task, request);
          const transition = deps.health.recordReachable(provider);
          if (transition) deps.alerts.healthChanged(transition, task, ctx);
          try {
            void Promise.resolve(
              deps.recordUsage({
                provider,
                model: result.model,
                feature: task,
                usage: result.usage,
                workspaceId: ctx.workspaceId ?? null,
                userId: ctx.userId ?? null,
              }),
            ).catch((error) => console.error('[ai] recordAiUsage failed:', errorMessage(error)));
          } catch (error) {
            console.error('[ai] recordAiUsage failed:', errorMessage(error));
          }
          return {
            ok: true,
            provider,
            model: result.model,
            text: result.text,
            ...(result.json !== undefined ? { json: result.json } : {}),
            usage: result.usage,
            failedOver,
            ...(result.webSearch ? { webSearch: result.webSearch } : {}),
          };
        } catch (thrown) {
          const error = toProviderError(provider, thrown);
          const errorClass = error.errorClass;
          const retrySame =
            (errorClass === 'rate_limit' && !retriedRateLimit) || (errorClass === 'invalid_output' && !retriedInvalid);
          const willFailOver = !retrySame && FAILOVER_CLASSES.has(errorClass);
          const failedOverTo = retrySame ? provider : willFailOver ? nextUsable(index) : null;

          attempts.push({ provider, errorClass, status: error.status, message: error.message });
          deps.alerts.attemptFailed({
            provider,
            task,
            errorClass,
            status: error.status,
            message: error.message,
            failedOverTo,
            forced: Boolean(error.forced),
            ctx,
          });

          if (retrySame) {
            if (errorClass === 'rate_limit') {
              retriedRateLimit = true;
              await deps.sleep(Math.min(error.retryAfterMs ?? RATE_LIMIT_RETRY_CAP_MS, RATE_LIMIT_RETRY_CAP_MS));
            } else {
              retriedInvalid = true;
            }
            continue;
          }

          const transition = deps.health.recordFailure(provider, errorClass, error.retryAfterMs);
          if (transition) deps.alerts.healthChanged(transition, task, ctx);

          if (errorClass === 'bad_request') return fail('bad_request');
          if (errorClass === 'refusal') return fail('refusal');
          failedOver.push({ provider, errorClass });
          break;
        }
      }
    }

    const result = fail('all_unavailable');
    deps.alerts.allUnavailable(task, attempts, ctx, result.firstErrorClass);
    return result;
  }

  return {
    runAiTask,
    hydrate,
    hasHealthyProvider(task) {
      void hydrate();
      return resolveChain(task, deps.env()).some((p) => isConfigured(p) && deps.health.isAvailable(p));
    },
    getProviderHealthSnapshot() {
      return PROVIDER_IDS.map((provider) => {
        const view = deps.health.view(provider);
        return { provider, configured: isConfigured(provider), ...view };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Process-wide default runner
// ---------------------------------------------------------------------------

let defaultRunner: AiRunner | null = null;

function getDefaultRunner(): AiRunner {
  if (!defaultRunner) {
    const store = createPrismaEventStore();
    defaultRunner = createAiRunner({
      adapters: { openai: openAiAdapter, anthropic: anthropicAdapter, gemini: geminiAdapter },
      health: new ProviderHealth(),
      alerts: createAlertSink({ store }),
      store,
      resolveModel: createModelResolver(),
      recordUsage: (input) => recordAiUsage(input),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: Date.now,
      env: () => process.env,
    });
  }
  return defaultRunner;
}

export function runAiTask(task: AiTask, request: AiRequest, ctx?: AiCallContext): Promise<AiResult> {
  return getDefaultRunner().runAiTask(task, request, ctx);
}

/** No network: does `task` have at least one configured provider that is not cooling down? */
export function hasHealthyProvider(task: AiTask): boolean {
  return getDefaultRunner().hasHealthyProvider(task);
}

export function getProviderHealthSnapshot(): ProviderHealthSnapshot[] {
  return getDefaultRunner().getProviderHealthSnapshot();
}

/** For callers that prefer throwing: returns the success or throws AiUnavailableError. */
export async function runAiTaskOrThrow(task: AiTask, request: AiRequest, ctx?: AiCallContext) {
  const result = await runAiTask(task, request, ctx);
  if (!result.ok) throw new AiUnavailableError(task, result);
  return result;
}

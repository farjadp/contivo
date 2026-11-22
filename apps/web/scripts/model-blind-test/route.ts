/**
 * Pins `runAiTask` to one provider + model, with no side effects.
 *
 * A fresh failover runner per (brief × model) unit, built from the real
 * provider adapters:
 *  - one-entry chain for content_draft and humanize (AI_CHAIN_* override),
 *    so nothing can fail over to another vendor;
 *  - `modelOverride` on every request, so the admin setting / env defaults
 *    are never read (the resolver throws if it is);
 *  - no event store and a no-op Sentry: nothing is written to any database
 *    and no alert leaves the machine;
 *  - fresh ProviderHealth, so one unit's failure cannot skip the next unit.
 * The layer's own retry still applies (one retry on a 429, capped at 2 s).
 */

import { estimateCostUsd } from '@/lib/ai-usage';
import { createAlertSink } from '@/lib/ai/alert';
import { ProviderHealth } from '@/lib/ai/health';
import { anthropicAdapter } from '@/lib/ai/providers/anthropic';
import { geminiAdapter } from '@/lib/ai/providers/gemini';
import { openAiAdapter } from '@/lib/ai/providers/openai';
import { createAiRunner } from '@/lib/ai/run';
import type { AiTask, ProviderAdapter, ProviderId } from '@/lib/ai/types';

import type { Candidate } from './config';
import type { CallLog, RunAiTask } from './types';

/** The only tasks the content path may call. Anything else is a bug in the harness. */
export const ALLOWED_TASKS: ReadonlySet<AiTask> = new Set<AiTask>(['content_draft', 'humanize']);

export const REAL_ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  openai: openAiAdapter,
  anthropic: anthropicAdapter,
  gemini: geminiAdapter,
};

export function makeRoute(
  candidate: Candidate,
  calls: CallLog[],
  opts: { adapters?: Record<ProviderId, ProviderAdapter>; env?: Record<string, string | undefined>; now?: () => Date } = {},
): RunAiTask {
  const baseEnv = opts.env ?? process.env;
  const env = {
    ...baseEnv,
    AI_PROVIDER_DISABLED: '',
    AI_CHAIN_CONTENT_DRAFT: candidate.provider,
    AI_CHAIN_HUMANIZE: candidate.provider,
  };
  const runner = createAiRunner({
    adapters: opts.adapters ?? REAL_ADAPTERS,
    health: new ProviderHealth(),
    alerts: createAlertSink({ store: null, sentry: { captureMessage: () => '' } }),
    store: null,
    resolveModel: async () => {
      throw new Error('blind test: the resolver must not be used; every request carries modelOverride');
    },
    recordUsage: () => {},
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: Date.now,
    env: () => env,
  });

  return async (task, request, ctx) => {
    if (!ALLOWED_TASKS.has(task)) throw new Error(`blind test: unexpected AI task "${task}"`);
    const started = Date.now();
    const result = await runner.runAiTask(
      task,
      { ...request, modelOverride: { [candidate.provider]: candidate.model } },
      ctx,
    );
    const latencyMs = Date.now() - started;
    if (result.ok) {
      const wrongVendor = result.provider !== candidate.provider || result.failedOver.length > 0;
      calls.push({
        task,
        ok: !wrongVendor,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        costUsd: estimateCostUsd(result.model, result.usage, opts.now?.() ?? new Date()),
        latencyMs,
        error: wrongVendor ? `provider_mismatch: answered by ${result.provider}` : null,
        failedOver: result.failedOver.length,
      });
    } else {
      calls.push({
        task,
        ok: false,
        provider: null,
        model: null,
        usage: null,
        // Unknown, not zero: a 429/5xx/billing failure is normally free, an
        // unusable answer may have been billed. Reported separately.
        costUsd: null,
        latencyMs,
        error: `${result.kind}:${result.firstErrorClass}`,
        failedOver: 0,
      });
    }
    return result;
  };
}

/**
 * Types for the AI provider failover layer (spec:
 * docs/superpowers/specs/2026-11-22-ai-provider-failover-design.md).
 *
 * Call sites describe WHAT they need (`AiRequest`); the layer decides WHO
 * answers by walking the task's provider chain.
 */

import type { AiTokenUsage } from '@/lib/ai-usage';

export type ProviderId = 'openai' | 'anthropic' | 'gemini';

export const PROVIDER_IDS: readonly ProviderId[] = ['openai', 'anthropic', 'gemini'] as const;

/**
 * Every task that goes through the layer. The value is also written to
 * `ai_usage_logs.feature` and `ai_provider_events.task`.
 * Images are out of scope (OpenAI direct).
 */
export const AI_TASKS = [
  'competitor_web_search',
  'competitor_queries',
  'competitor_judge',
  'matrix_propose_axes',
  'matrix_score_chart',
  'matrix_summarise',
  'brand_assets',
  'keywords',
  'offerings',
  'website_analysis',
  'content_ideas',
  'content_draft',
  'instant_draft',
  'positioning',
  'serp_analysis',
  'legacy_competitors',
  'quality_gate',
  'humanize',
  'storylines',
  'narrative_change',
  'guide',
  'image_prompt',
  'report_narrative',
] as const;

export type AiTask = (typeof AI_TASKS)[number];

/**
 * How a failed attempt is classified (spec §2 "Error classification").
 * `not_configured` and `cooling_down` never come from a provider call: they
 * mark a provider that was skipped without a request.
 */
export type AiErrorClass =
  | 'billing'
  | 'auth'
  | 'model_gone'
  | 'rate_limit'
  | 'overloaded'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'invalid_output'
  | 'refusal';

export const AI_ERROR_CLASSES: readonly AiErrorClass[] = [
  'billing',
  'auth',
  'model_gone',
  'rate_limit',
  'overloaded',
  'server',
  'timeout',
  'network',
  'bad_request',
  'invalid_output',
  'refusal',
] as const;

export type AiMessage = { role: 'user' | 'assistant'; content: string };

export type AiOutput =
  | { kind: 'text' }
  | { kind: 'json_object' }
  | { kind: 'json_schema'; name: string; schema: Record<string, unknown> };

export interface AiRequest {
  system?: string;
  /** A single user prompt, or a conversation (first message must be `user`). */
  prompt: string | AiMessage[];
  output: AiOutput;
  /** Ask the provider to search the web; results come back in `AiResult.webSearch`. */
  webSearch?: { country?: string; maxUses?: number };
  /** Per attempt, not per chain. */
  timeoutMs: number;
  maxTokens?: number;
  /**
   * Sent to OpenAI and Gemini only. Never sent to Claude: Opus 5.5 /
   * Sonnet 5.5 reject sampling parameters with a 400.
   */
  temperature?: number;
  /** Replace the default model for one provider. */
  modelOverride?: Partial<Record<ProviderId, string>>;
}

export interface AiCallContext {
  workspaceId?: string | null;
  userId?: string | null;
}

/** Same shape as `QueryHarvestResult` in lib/competitors/search.ts. */
export interface AiWebSearchResult {
  /** The query the provider says it ran (first one); '' when it did not say. */
  query: string;
  /** URLs the model actually cited in its answer. */
  citations: Array<{ url: string; title?: string }>;
  /** Every result URL the search returned (noisy). */
  sourceUrls: string[];
}

export interface AiAttempt {
  provider: ProviderId;
  errorClass: AiErrorClass | 'not_configured' | 'cooling_down';
  status?: number;
  message: string;
  /** For `cooling_down`: why the provider is cooling down. */
  reason?: AiErrorClass;
}

export type AiSuccess = {
  ok: true;
  provider: ProviderId;
  model: string;
  text: string;
  /** Parsed JSON for `json_object` / `json_schema` output (validated for the latter). */
  json?: unknown;
  usage: AiTokenUsage;
  /** Providers that failed before this one answered, in order. */
  failedOver: Array<{ provider: ProviderId; errorClass: AiErrorClass }>;
  webSearch?: AiWebSearchResult;
};

export type AiFailure = {
  ok: false;
  kind: 'all_unavailable' | 'bad_request' | 'refusal';
  attempts: AiAttempt[];
  /**
   * Class of the first real failure (a cooling-down provider counts with
   * the reason it is cooling down). `not_configured` only when no provider
   * could even be tried.
   */
  firstErrorClass: AiErrorClass | 'not_configured';
  /** True only when every provider that was tried (or skipped as cooling down) was a genuine rate limit. */
  allRateLimited: boolean;
};

export type AiResult = AiSuccess | AiFailure;

/** What a provider adapter returns for one successful attempt. */
export interface ProviderSuccess {
  model: string;
  text: string;
  usage: AiTokenUsage;
  webSearch?: AiWebSearchResult;
}

export interface ProviderCallInput {
  task: AiTask;
  request: AiRequest;
  model: string;
  apiKey: string;
}

export interface ProviderAdapter {
  id: ProviderId;
  /** Env var holding the key; the provider is skipped when it is empty. */
  keyEnv: string;
  /** Throws `AiProviderError` on any failure. */
  call(input: ProviderCallInput): Promise<ProviderSuccess>;
}

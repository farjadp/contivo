/**
 * ai-usage.ts — one ai_usage_logs row per model call.
 *
 * The table existed and nothing wrote to it, so cost per user or workspace
 * was unknowable. Every provider fetch site now calls `recordAiUsage` after
 * it has parsed a successful response.
 *
 * The one rule: logging must never change the call. `recordAiUsage` never
 * throws and never rejects; call sites use `void recordAiUsage(...)` so the
 * AI call's return value, errors and timing are what they were before. The
 * parsers below are total functions (no input makes them throw) because they
 * run synchronously at the call site.
 *
 * Attribution, in order: explicit args → the run context set by
 * `runWithAiContext` (background pipelines, autopilot) → the signed-in
 * session. No user found → userId null, which the schema allows.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

export type AiProvider = 'openai' | 'anthropic' | 'gemini';

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** OpenAI Responses API `web_search` tool calls, billed per call. */
  webSearchCalls?: number;
  /** Images returned by an image-generation call. */
  images?: number;
}

export interface AiContext {
  userId?: string | null;
  workspaceId?: string | null;
}

// ---------------------------------------------------------------------------
// Parsers — pure, total, never NaN
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function tokens(prompt: unknown, completion: unknown, total: unknown): AiTokenUsage {
  const promptTokens = count(prompt);
  const completionTokens = count(completion);
  const reportedTotal = count(total);
  return {
    promptTokens,
    completionTokens,
    totalTokens: reportedTotal || promptTokens + completionTokens,
  };
}

/** OpenAI chat completions: `usage.prompt_tokens / completion_tokens / total_tokens`. */
export function parseOpenAiChatUsage(body: unknown): AiTokenUsage {
  const usage = asRecord(asRecord(body)?.usage);
  return tokens(usage?.prompt_tokens, usage?.completion_tokens, usage?.total_tokens);
}

/** OpenAI Responses API: `usage.input_tokens / output_tokens / total_tokens`, plus web search calls. */
export function parseOpenAiResponsesUsage(body: unknown): AiTokenUsage {
  const record = asRecord(body);
  const usage = asRecord(record?.usage);
  const output = Array.isArray(record?.output) ? (record?.output as unknown[]) : [];
  const webSearchCalls = output.filter((item) => asRecord(item)?.type === 'web_search_call').length;
  return { ...tokens(usage?.input_tokens, usage?.output_tokens, usage?.total_tokens), webSearchCalls };
}

/**
 * Gemini: `usageMetadata.promptTokenCount / candidatesTokenCount / totalTokenCount`.
 * Thinking tokens (`thoughtsTokenCount`) are not in `candidatesTokenCount` but
 * are billed at the output rate, so they are counted as completion tokens.
 */
export function parseGeminiUsage(body: unknown): AiTokenUsage {
  const meta = asRecord(asRecord(body)?.usageMetadata);
  const completion = count(meta?.candidatesTokenCount) + count(meta?.thoughtsTokenCount);
  return tokens(meta?.promptTokenCount, completion, meta?.totalTokenCount);
}

/** OpenAI images: tokens from `usage` when present (gpt-image-*), else 0; counts images returned. */
export function parseOpenAiImageUsage(body: unknown): AiTokenUsage {
  const record = asRecord(body);
  const usage = asRecord(record?.usage);
  const images = Array.isArray(record?.data) ? (record?.data as unknown[]).length : 0;
  return { ...tokens(usage?.input_tokens, usage?.output_tokens, usage?.total_tokens), images };
}

/**
 * The model the provider says answered (OpenAI `model`, e.g.
 * `gpt-4.1-2025-04-14`; Gemini `modelVersion`), else the one requested. A
 * retired model silently re-routed by the provider shows up here.
 */
export function resolveResponseModel(body: unknown, requested: string): string {
  const record = asRecord(body);
  const reported = record?.model ?? record?.modelVersion;
  return typeof reported === 'string' && reported.trim() ? reported.trim() : requested;
}

// ---------------------------------------------------------------------------
// Prices — USD per 1M tokens, standard (non-batch) tier
// ---------------------------------------------------------------------------
//
// Only models this code actually calls (env defaults and admin presets), and
// only prices read off the provider's own pricing page. A model that is not
// here is logged with estimatedCostUsd null, never a guess.
//
// OpenAI — https://developers.openai.com/api/docs/pricing (checked 2026-11-21)
//   gpt-4.1     $2.00 in / $8.00 out
//   gpt-5-mini  $0.25 in / $2.00 out (shutdown 2026-12-11)
//   gpt-6.2-sol $2.00 in / $10.00 out (checked 2026-11-22; prompts > 272K: $4 / $15)
//   Web search tool (Responses API): $10.00 / 1k calls + content tokens at model rates
//   NOT priced: gpt-image-1 (no longer on the page; only gpt-image-1.5 / -mini are)
//
// Gemini — https://ai.google.dev/gemini-api/docs/pricing (checked 2026-11-21)
//   gemini-2.5-pro  $1.25 in / $10.00 out (prompts <= 200k), $2.50 / $15.00 above;
//                   deprecated: from 2026-12-01 requests route to gemini-3.8-flash
//                   and are billed at its rates
//   gemini-3.8-flash $0.75 / $3.75 through 2026-12-31, $1.50 / $7.50 from 2027-01-01
//   gemini-3.1-flash-lite $0.25 / $1.50 (text/image/video input)
//   NOT priced: gemini-3.7-flash (the app's default) and gemini-3.5-flash — neither
//   is listed on the pricing page, gemini-flash-latest (an alias)
//
// Anthropic — Claude API pricing (claude-api skill models reference, checked 2026-11-22)
//   claude-sonnet-5-5 $2.00 in / $10.00 out
//   claude-opus-5-5   $4.00 in / $20.00 out
//   Web search server tool: $10 per 1,000 searches (same as OpenAI's per-call fee)
//   The adapter counts cache reads and writes as input; no call sets
//   cache_control today, so this matches the bill.
//
// Cached-input discounts are ignored: calls here do not read cached tokens,
// so a cached call is slightly over-estimated, never under.

interface PricePeriod {
  /** Inclusive UTC start; absent = since forever. Periods are in ascending order. */
  from?: string;
  inputPerM: number;
  outputPerM: number;
  longContext?: { abovePromptTokens: number; inputPerM: number; outputPerM: number };
}

const GEMINI_38_FLASH: PricePeriod[] = [
  { inputPerM: 0.75, outputPerM: 3.75 },
  { from: '2027-01-01T00:00:00Z', inputPerM: 1.5, outputPerM: 7.5 },
];

const PRICES: Record<string, PricePeriod[]> = {
  'gpt-4.1': [{ inputPerM: 2, outputPerM: 8 }],
  'gpt-5-mini': [{ inputPerM: 0.25, outputPerM: 2 }],
  'gpt-6.2-sol': [
    { inputPerM: 2, outputPerM: 10, longContext: { abovePromptTokens: 272_000, inputPerM: 4, outputPerM: 15 } },
  ],
  'gemini-2.5-pro': [
    {
      inputPerM: 1.25,
      outputPerM: 10,
      longContext: { abovePromptTokens: 200_000, inputPerM: 2.5, outputPerM: 15 },
    },
    { ...GEMINI_38_FLASH[0], from: '2026-12-01T00:00:00Z' },
    GEMINI_38_FLASH[1],
  ],
  'gemini-3.8-flash': GEMINI_38_FLASH,
  'gemini-3.1-flash-lite': [{ inputPerM: 0.25, outputPerM: 1.5 }],
  'claude-sonnet-5-5': [{ inputPerM: 2, outputPerM: 10 }],
  'claude-opus-5-5': [{ inputPerM: 4, outputPerM: 20 }],
};

/** Web search: $10.00 per 1,000 calls on OpenAI and on Claude (pricing notes above). */
const WEB_SEARCH_CALL_USD = 0.01;

const DATE_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

/**
 * Exact model id, or the same id with an OpenAI snapshot date suffix
 * (`gpt-4.1-2025-04-14` → `gpt-4.1`). Nothing looser: `gpt-4.1-mini` is a
 * different price and must not match `gpt-4.1`. A Gemini `models/` prefix is
 * stripped.
 */
export function priceKeyFor(model: string): string | null {
  if (typeof model !== 'string') return null;
  const id = model.trim().replace(/^models\//, '');
  if (PRICES[id]) return id;
  const undated = id.replace(DATE_SUFFIX, '');
  return undated !== id && PRICES[undated] ? undated : null;
}

const warnedUnpriced = new Set<string>();

export function estimateCostUsd(model: string, usage: AiTokenUsage, at: Date = new Date()): number | null {
  const key = priceKeyFor(model);
  if (!key) {
    const label = String(model);
    if (!warnedUnpriced.has(label)) {
      warnedUnpriced.add(label);
      console.warn(`[ai-usage] No verified price for model "${label}"; logging its usage with a null cost.`);
    }
    return null;
  }

  const periods = PRICES[key];
  const time = at.getTime();
  let period = periods[0];
  for (const candidate of periods) {
    if (!candidate.from || Date.parse(candidate.from) <= time) period = candidate;
  }

  const rate =
    period.longContext && usage.promptTokens > period.longContext.abovePromptTokens
      ? period.longContext
      : period;

  const tokenCost = (usage.promptTokens * rate.inputPerM + usage.completionTokens * rate.outputPerM) / 1_000_000;
  return tokenCost + count(usage.webSearchCalls) * WEB_SEARCH_CALL_USD;
}

// ---------------------------------------------------------------------------
// Attribution context
// ---------------------------------------------------------------------------

const aiContext = new AsyncLocalStorage<AiContext>();

/** Attributes every model call made inside `fn` (and anything it awaits) to this user/workspace. */
export function runWithAiContext<T>(context: AiContext, fn: () => T): T {
  return aiContext.run({ ...context }, fn);
}

/** The attribution context of the running call chain; empty outside `runWithAiContext`. */
export function getAiContext(): AiContext {
  return { ...(aiContext.getStore() ?? {}) };
}

/**
 * Fills in the current run context once the owner is known (a pipeline that
 * only learns its user after loading the run row). No-op outside a context.
 */
export function setAiContext(context: AiContext): void {
  const store = aiContext.getStore();
  if (store) Object.assign(store, context);
}

async function sessionUserId(): Promise<string | null> {
  try {
    const session = await getSession();
    return session?.userId ?? null;
  } catch {
    // Outside a request (cron, background run) there are no cookies to read.
    return null;
  }
}

// ---------------------------------------------------------------------------
// recordAiUsage
// ---------------------------------------------------------------------------

export interface RecordAiUsageInput {
  provider: AiProvider | string;
  model: string;
  feature: string;
  usage: AiTokenUsage;
  workspaceId?: string | null;
  userId?: string | null;
  jobId?: string | null;
}

const INT_MAX = 2_147_483_647;

export async function recordAiUsage(input: RecordAiUsageInput): Promise<void> {
  try {
    const context = aiContext.getStore();
    const userId = input.userId || context?.userId || (await sessionUserId()) || null;
    const workspaceId = input.workspaceId || context?.workspaceId || null;

    const usage: AiTokenUsage = {
      promptTokens: Math.min(count(input.usage?.promptTokens), INT_MAX),
      completionTokens: Math.min(count(input.usage?.completionTokens), INT_MAX),
      totalTokens: Math.min(count(input.usage?.totalTokens), INT_MAX),
      webSearchCalls: count(input.usage?.webSearchCalls),
      images: count(input.usage?.images),
    };
    const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : 'unknown';
    const cost = estimateCostUsd(model, usage);

    await prisma.aiUsageLog.create({
      data: {
        userId,
        workspaceId,
        provider: String(input.provider),
        model,
        feature: input.feature,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        // Decimal(10,6): rounded to the column's precision, null when unpriced.
        estimatedCostUsd: cost === null ? null : cost.toFixed(6),
        jobId: input.jobId || null,
      },
    });
  } catch (error) {
    console.error('[ai-usage] recordAiUsage failed:', error);
  }
}

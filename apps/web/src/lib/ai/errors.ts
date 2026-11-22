/**
 * Error classification (spec §2). Every provider failure ends up as one
 * `AiProviderError` with an `AiErrorClass`; run.ts decides what to do from
 * the class alone.
 *
 * Rules that came from real recorded bodies (see __fixtures__):
 * - OpenAI out of credit is a 429 whose error.type is `insufficient_quota`
 *   (code `credit_balance_exhausted`), not a rate limit.
 * - Gemini answers an invalid key with 400 INVALID_ARGUMENT +
 *   reason API_KEY_INVALID, which is auth, not our bad request.
 */

import Anthropic from '@anthropic-ai/sdk';

import { redactSecrets, truncateText } from '@/lib/competitors/redact';

import type { AiErrorClass, ProviderId } from './types';

export class AiProviderError extends Error {
  readonly provider: ProviderId;
  readonly errorClass: AiErrorClass;
  readonly status?: number;
  /** Provider-requested wait (Retry-After / RetryInfo), ms. */
  readonly retryAfterMs?: number;

  constructor(args: {
    provider: ProviderId;
    errorClass: AiErrorClass;
    message: string;
    status?: number;
    retryAfterMs?: number;
  }) {
    super(sanitizeAiMessage(args.message));
    this.name = 'AiProviderError';
    this.provider = args.provider;
    this.errorClass = args.errorClass;
    this.status = args.status;
    this.retryAfterMs = args.retryAfterMs;
  }
}

// ---------------------------------------------------------------------------
// Sanitiser — applied to every message that is stored, logged or alerted
// ---------------------------------------------------------------------------

const EXTRA_SECRET_PATTERNS: Array<[RegExp, string]> = [
  // Anthropic keys (sk-ant-...) are covered by redact.ts' sk- rule; Google keys are not.
  [/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]'],
  [/"?x-(?:api|goog-api)-key"?\s*[:=]\s*"?[^\s",}]+"?/gi, 'x-api-key:[redacted]'],
  [/([?&](?:key|api_key|apikey)=)[^&\s"']+/gi, '$1[redacted]'],
];

export const MAX_AI_MESSAGE_LENGTH = 500;

/** Redact anything key- or bearer-shaped, then cap at 500 chars. */
export function sanitizeAiMessage(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  let out = redactSecrets(text);
  for (const [pattern, replacement] of EXTRA_SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return truncateText(out, MAX_AI_MESSAGE_LENGTH);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      return asRecord(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return asRecord(body);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `Retry-After` (seconds or HTTP date) or OpenAI's `retry-after-ms`, in ms. */
export function parseRetryAfter(headers: Headers | null | undefined, now: number = Date.now()): number | undefined {
  if (!headers) return undefined;
  const ms = Number(headers.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms;
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function serverClass(status: number): AiErrorClass {
  return status === 503 || status === 529 ? 'overloaded' : 'server';
}

// ---------------------------------------------------------------------------
// OpenAI (HTTP status + JSON body)
// ---------------------------------------------------------------------------

const OPENAI_BILLING_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'billing_hard_limit_reached',
  'billing_not_active',
  'account_deactivated',
]);

export function classifyOpenAi(status: number, body: unknown, headers?: Headers | null): AiProviderError {
  const error = asRecord(parseBody(body)?.error);
  const type = str(error?.type);
  const code = str(error?.code);
  const message = str(error?.message) || (typeof body === 'string' ? body : '') || `HTTP ${status}`;
  const make = (errorClass: AiErrorClass, retryAfterMs?: number) =>
    new AiProviderError({ provider: 'openai', errorClass, status, message, retryAfterMs });

  // OpenAI docs: "Retrying billing, spend, or quota errors won't restore API access."
  // Match error.code AND error.type; never the message text.
  if (OPENAI_BILLING_CODES.has(type) || OPENAI_BILLING_CODES.has(code)) return make('billing');
  if (status === 429) return make('rate_limit', parseRetryAfter(headers));
  if (status === 401 || status === 403) return make('auth');
  if (status === 404 || code === 'model_not_found') return make('model_gone');
  if (status === 408) return make('timeout');
  if (status >= 500) return make(serverClass(status));
  return make('bad_request');
}

// ---------------------------------------------------------------------------
// Gemini (HTTP status + google.rpc error body)
// ---------------------------------------------------------------------------

/** Seconds from a google.rpc.RetryInfo `retryDelay` ("37s" / "1.5s"). */
function geminiRetryDelayMs(details: unknown[]): number | undefined {
  for (const detail of details) {
    const delay = str(asRecord(detail)?.retryDelay);
    const match = delay.match(/^(\d+(?:\.\d+)?)s$/);
    if (match) return Number(match[1]) * 1000;
  }
  return undefined;
}

function geminiQuotaIds(details: unknown[]): string[] {
  const ids: string[] = [];
  for (const detail of details) {
    const violations = asRecord(detail)?.violations;
    if (!Array.isArray(violations)) continue;
    for (const violation of violations) {
      const record = asRecord(violation);
      ids.push(str(record?.quotaId), str(record?.quotaMetric));
    }
  }
  return ids.filter(Boolean);
}

/** Newer AI Studio error shape: `{error:{code:"rate_limit_exceeded", message}}` (string code). */
const GEMINI_STRING_CODES: Record<string, AiErrorClass> = {
  payment_required: 'billing',
  quota_exceeded: 'billing',
  failed_precondition: 'billing',
  authentication: 'auth',
  permission_denied: 'auth',
  model_not_found: 'model_gone',
  not_found: 'model_gone',
  rate_limit_exceeded: 'rate_limit',
  invalid_argument: 'bad_request',
  service_unavailable: 'overloaded',
  api_error: 'server',
  deadline_exceeded: 'timeout',
};

export function classifyGemini(status: number, body: unknown): AiProviderError {
  const error = asRecord(parseBody(body)?.error);
  const rpcStatus = str(error?.status);
  const message = str(error?.message) || (typeof body === 'string' ? body : '') || `HTTP ${status}`;
  const details = Array.isArray(error?.details) ? (error?.details as unknown[]) : [];
  const reasons = details.map((d) => str(asRecord(d)?.reason));
  const make = (errorClass: AiErrorClass, retryAfterMs?: number) =>
    new AiProviderError({ provider: 'gemini', errorClass, status, message, retryAfterMs });

  // Recorded: an invalid key is HTTP 400 INVALID_ARGUMENT + API_KEY_INVALID — auth, not our bug.
  if (reasons.includes('API_KEY_INVALID') || reasons.includes('API_KEY_EXPIRED')) return make('auth');

  // Newer shape with a string code.
  const stringCode = typeof error?.code === 'string' ? (error.code as string).toLowerCase() : '';
  if (stringCode && GEMINI_STRING_CODES[stringCode]) return make(GEMINI_STRING_CODES[stringCode], geminiRetryDelayMs(details));

  if (status === 402) return make('billing'); // prepaid credits depleted

  if (status === 429 || rpcStatus === 'RESOURCE_EXHAUSTED') {
    // Gemini sends "check your plan and billing details" for a per-minute
    // AND a per-day limit, so the message is never used. QuotaFailure.quotaId:
    // PerDay or -FreeTier (we pay, so a free-tier bucket = billing not linked)
    // → billing; anything else (PerMinute, or no details) → rate limit.
    const quota = geminiQuotaIds(details).join(' ');
    if (/PerDay|FreeTier/i.test(quota)) return make('billing');
    return make('rate_limit', geminiRetryDelayMs(details));
  }

  // Disabled billing / free tier unavailable: a config problem waiting never fixes.
  if (rpcStatus === 'FAILED_PRECONDITION') return make('billing');
  // 403 is both "no key" (recorded: PERMISSION_DENIED, ACCESS_DENIED) and
  // "past due" (docs: cites an outstanding balance).
  if (status === 403 && /outstanding balance|past due|billing/i.test(message)) return make('billing');
  if (status === 401 || status === 403) return make('auth');
  if (status === 404) return make('model_gone');
  if (status === 408 || status === 504 || rpcStatus === 'DEADLINE_EXCEEDED') return make('timeout');
  if (status >= 500) return make(serverClass(status));
  return make('bad_request');
}

// ---------------------------------------------------------------------------
// Anthropic (typed SDK errors)
// ---------------------------------------------------------------------------

export function classifyAnthropic(error: unknown): AiProviderError {
  const make = (errorClass: AiErrorClass, message: string, status?: number, retryAfterMs?: number) =>
    new AiProviderError({ provider: 'anthropic', errorClass, status, message, retryAfterMs });

  if (error instanceof AiProviderError) return error;
  // Order matters: the connection errors are APIError subclasses in the TS SDK.
  if (error instanceof Anthropic.APIConnectionTimeoutError || error instanceof Anthropic.APIUserAbortError) {
    return make('timeout', error.message);
  }
  if (error instanceof Anthropic.APIConnectionError) return make('network', error.message);

  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : undefined;
    const message = error.apiMessage || error.message;
    const retryAfterMs = parseRetryAfter(error.headers ?? null);

    if (error instanceof Anthropic.PaymentRequiredError || error.type === 'billing_error') {
      return make('billing', message, status);
    }
    // A monthly spend cap is a 429 that retries cannot fix until access resumes.
    if (error.errorCode === 'enforced_spend_limit_reached') return make('billing', message, status);
    if (error instanceof Anthropic.BadRequestError) {
      // Two billing cases arrive as a 400 invalid_request_error with no code,
      // so the message prefix is the only signal: $0 credit, and our own
      // org/workspace spend limit.
      if (/credit balance is too low|reached your specified (?:workspace )?API usage limits/i.test(message)) {
        return make('billing', message, status);
      }
      return make('bad_request', message, status);
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      return make('auth', message, status);
    }
    if (error instanceof Anthropic.NotFoundError) return make('model_gone', message, status);
    if (error instanceof Anthropic.RateLimitError) return make('rate_limit', message, status, retryAfterMs);
    if (status === 529 || error.type === 'overloaded_error') return make('overloaded', message, status);
    // A 500 with type timeout_error, and 504, are timeouts.
    if (status === 408 || status === 504 || error.type === 'timeout_error') return make('timeout', message, status);
    if (error instanceof Anthropic.InternalServerError || (status !== undefined && status >= 500)) {
      return make('server', message, status);
    }
    return make('bad_request', message, status);
  }

  return classifyThrown('anthropic', error);
}

// ---------------------------------------------------------------------------
// fetch() threw (no HTTP response)
// ---------------------------------------------------------------------------

export function classifyThrown(provider: ProviderId, error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  const name = (error as { name?: unknown })?.name;
  const message = (error as { message?: unknown })?.message;
  const text = typeof message === 'string' && message ? message : String(error);
  const errorClass: AiErrorClass = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network';
  return new AiProviderError({ provider, errorClass, message: text });
}

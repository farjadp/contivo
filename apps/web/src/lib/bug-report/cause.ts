/**
 * Maps any thrown error, or a stored error string, to the closed CauseCode list.
 *
 * Pure. Reads message text only to classify it; never returns, logs or stores
 * it. Duck-typed (no instanceof on SDK classes) so it imports nothing heavy.
 */

import { classifyRunError } from '@/lib/competitors/run-errors';

import type { CauseCode } from './types';

// ---------------------------------------------------------------------------
// Text patterns (classification input only, never output)
// ---------------------------------------------------------------------------

/** OpenAI insufficient_quota / billing hard limit, Anthropic credit balance, Gemini quota exhausted. */
const OUT_OF_CREDIT_RE =
  /insufficient_quota|credit_balance_exhausted|exceeded your current quota|no credits remaining|credit balance is too low|billing_hard_limit|billing_not_active|spend_limit|spend limit|usage limits?|payment_required|RESOURCE_EXHAUSTED[\s\S]*quota|quota[\s\S]*RESOURCE_EXHAUSTED|\bbilling\b/i;
const AUTH_RE = /invalid_api_key|incorrect api key|API_KEY_INVALID|API_KEY_EXPIRED|model_not_found|authentication_error/i;
const RATE_LIMITED_RE = /\b429\b|rate[ _-]?limit|too many requests/i;
const OVERLOADED_RE = /overloaded|\b529\b|service_unavailable/i;
const CONNECTION_EXPIRED_RE = /session_expired|token[\s\S]{0,20}(expired|revoked)|(expired|revoked)[\s\S]{0,20}token|reconnect/i;
const CREDITS_EXHAUSTED_RE = /insufficient credits|not enough credits|out of credits|OUT_OF_CREDITS/i;

/** Mapping of lib/ai AiErrorClass values, as stored in ai_provider_events.errorClass and in AiProviderError. */
const AI_CLASS: Record<string, CauseCode | null> = {
  billing: 'PROVIDER_OUT_OF_CREDIT',
  auth: 'PROVIDER_AUTH',
  model_gone: 'PROVIDER_AUTH',
  not_configured: 'PROVIDER_AUTH',
  rate_limit: 'PROVIDER_RATE_LIMITED',
  overloaded: 'PROVIDER_UNAVAILABLE',
  server: 'PROVIDER_UNAVAILABLE',
  network: 'PROVIDER_UNAVAILABLE',
  timeout: 'PROVIDER_TIMEOUT',
  bad_request: 'UNKNOWN',
  invalid_output: 'UNKNOWN',
  refusal: 'UNKNOWN',
  cooling_down: null, // not a cause on its own: the event's `reason` holds it
};

/** Text-only classification shared by thrown messages and stored strings. Null when nothing matches. */
function classifyText(text: string): CauseCode | null {
  if (!text) return null;
  // Billing before rate limit: an out-of-credit 429 is not something waiting fixes.
  if (OUT_OF_CREDIT_RE.test(text)) return 'PROVIDER_OUT_OF_CREDIT';
  if (AUTH_RE.test(text)) return 'PROVIDER_AUTH';
  if (RATE_LIMITED_RE.test(text)) return 'PROVIDER_RATE_LIMITED';
  if (OVERLOADED_RE.test(text)) return 'PROVIDER_UNAVAILABLE';
  if (CREDITS_EXHAUSTED_RE.test(text)) return 'CREDITS_EXHAUSTED';
  if (CONNECTION_EXPIRED_RE.test(text)) return 'CONNECTION_EXPIRED';
  return null;
}

// ---------------------------------------------------------------------------
// Stored strings
// ---------------------------------------------------------------------------

/**
 * The cause for a string stored in discovery_runs.error / matrix_runs.error /
 * ai_provider_events.errorClass. Null when it carries no recognisable cause
 * (the caller shows "unknown" or nothing; never the raw string).
 */
export function classifyCauseFromStored(code: string | null | undefined): CauseCode | null {
  const text = (code ?? '').trim();
  if (!text) return null;

  if (Object.prototype.hasOwnProperty.call(AI_CLASS, text)) return AI_CLASS[text];

  // describeAiFailure writes "provider:class[:status]" per attempt; the first real class is the cause.
  const attemptClass = text.match(/\b(?:openai|anthropic|gemini)(?:[\w-]*):(billing|auth|model_gone|not_configured)\b/i);
  if (attemptClass) return AI_CLASS[attemptClass[1].toLowerCase()];

  const kind = classifyRunError(text);
  const direct = classifyText(text);
  switch (kind) {
    case 'timedOut':
      return 'TIMED_OUT';
    case 'dispatch':
      return 'DISPATCH_FAILED';
    case 'notEnoughEvidence':
      return 'NOT_ENOUGH_EVIDENCE';
    case 'rateLimited':
      return direct === 'PROVIDER_OUT_OF_CREDIT' || direct === 'PROVIDER_AUTH' ? direct : 'PROVIDER_RATE_LIMITED';
    case 'aiUnavailable':
    case 'judgeOutage':
    case 'searchUnavailable':
      return direct === 'PROVIDER_OUT_OF_CREDIT' || direct === 'PROVIDER_AUTH' ? direct : 'PROVIDER_UNAVAILABLE';
    case 'generic':
      break;
  }
  if (/^OUT_OF_CREDITS(_MID_RUN)?\b/.test(text)) return 'CREDITS_EXHAUSTED';
  return direct;
}

// ---------------------------------------------------------------------------
// Thrown values
// ---------------------------------------------------------------------------

type Loose = {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  type?: unknown;
  errorClass?: unknown;
  error?: unknown;
};

function asLoose(value: unknown): Loose | null {
  return value && typeof value === 'object' ? (value as Loose) : null;
}

function strOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** message + code + type of the error and of a nested `error` object (OpenAI-style bodies), for pattern tests. */
function haystack(err: Loose): string {
  const parts = [strOf(err.message), strOf(err.code), strOf(err.type)];
  const nested = asLoose(err.error);
  if (nested) parts.push(strOf(nested.message), strOf(nested.code), strOf(nested.type), strOf(nested.status));
  return parts.filter(Boolean).join(' ');
}

function statusOf(err: Loose): number | null {
  const raw = typeof err.status === 'number' ? err.status : typeof err.statusCode === 'number' ? err.statusCode : null;
  return raw;
}

export function classifyCause(error: unknown): CauseCode {
  try {
    if (typeof error === 'string') return classifyCauseFromStored(error) ?? 'UNKNOWN';
    const err = asLoose(error);
    if (!err) return 'UNKNOWN';
    const name = strOf(err.name);

    // lib/ai: the class is already decided (billing 429s are never 'rate_limit').
    if (name === 'AiProviderError' && typeof err.errorClass === 'string') {
      const mapped = AI_CLASS[err.errorClass];
      if (mapped) return mapped;
    }
    // lib/ai AiFailure-like: { firstErrorClass }
    const first = (err as { firstErrorClass?: unknown }).firstErrorClass;
    if (typeof first === 'string' && AI_CLASS[first]) return AI_CLASS[first] as CauseCode;

    if (name === 'InsufficientCreditsError') return 'CREDITS_EXHAUSTED';
    if (name === 'ZodError') return 'VALIDATION';
    if (/^PrismaClient/.test(name) || (/^P\d{4}$/.test(strOf(err.code)) && name !== '')) return 'DATABASE';
    if (name === 'TimeoutError' || name === 'AbortError') return 'TIMED_OUT';

    const text = haystack(err);
    const status = statusOf(err);
    const fromText = classifyText(text);
    if (fromText === 'PROVIDER_OUT_OF_CREDIT' || fromText === 'PROVIDER_AUTH') return fromText;
    if (status === 402) return 'PROVIDER_OUT_OF_CREDIT';
    if (status === 429) return 'PROVIDER_RATE_LIMITED';
    if (status === 401 && /api[ _-]?key/i.test(text)) return 'PROVIDER_AUTH';
    if (fromText) return fromText;

    // A stored-style code carried on an error ("TIMED_OUT: ...", "NOT_ENOUGH_EVIDENCE").
    const stored = classifyCauseFromStored(strOf(err.message));
    if (stored) return stored;
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

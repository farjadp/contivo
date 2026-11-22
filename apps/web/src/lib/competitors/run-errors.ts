/**
 * Stable prefixes written at the start of `DiscoveryRun.error`, so the UI
 * can map a failure to translated copy without ever showing the raw text
 * (which can hold configuration details such as "OPENAI_API_KEY is not
 * set", or upstream status text). The text after the prefix stays for
 * admins and logs.
 *
 * Pure and dependency-free: the client-side logic module imports it.
 */
export const RUN_ERROR = {
  /** Written by `reapStaleRuns`: the run outlived STALE_RUN_MINUTES. */
  TIMED_OUT: 'TIMED_OUT',
  /** The trigger to the background route failed before the run started. */
  DISPATCH_FAILED: 'DISPATCH_FAILED',
  /** Every judge batch failed, so nothing could be assessed. */
  JUDGE_UNAVAILABLE: 'JUDGE_UNAVAILABLE',
  /** Every web-search query failed, so no candidate ever reached judging. */
  SEARCH_UNAVAILABLE: 'SEARCH_UNAVAILABLE',
  /**
   * A matrix run: after reading the sites of competitors with no stored
   * evidence, fewer than two had anything to be scored on.
   */
  NOT_ENOUGH_EVIDENCE: 'NOT_ENOUGH_EVIDENCE',
  /**
   * No AI provider could do the job: every provider in the task's chain
   * failed or was skipped, or the first one failed on billing, auth or a
   * retired model. Never shown as "too many requests": a billing 429 is not
   * something waiting fixes.
   */
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
} as const;

export function withRunErrorCode(code: string, detail: string | null | undefined): string {
  const text = (detail ?? '').trim();
  return text ? `${code}: ${text}` : code;
}

export type RunErrorKind =
  | 'timedOut'
  | 'dispatch'
  | 'judgeOutage'
  | 'searchUnavailable'
  | 'rateLimited'
  | 'aiUnavailable'
  | 'notEnoughEvidence'
  | 'generic';

/** A 429 anywhere in an upstream message ("... failed: 429 Rate limit ..."). */
const RATE_LIMITED_RE = /\b429\b|rate limit/i;

/**
 * Billing/auth text in a stored error written before AI_UNAVAILABLE existed
 * (22 Nov: "JUDGE_UNAVAILABLE: Judge batch failed: 429 ... insufficient_quota").
 * Checked before RATE_LIMITED_RE so an out-of-credit 429 never reads as
 * "wait a few minutes".
 */
const BILLING_OR_AUTH_RE =
  /insufficient_quota|exceeded your current quota|credit balance|billing|invalid_api_key|incorrect api key/i;

/** Error classes after which waiting cannot help: the customer gets aiUnavailable. */
const NOT_TRANSIENT_CLASSES = new Set(['billing', 'auth', 'model_gone']);

/**
 * The parts of an `AiFailure` (lib/ai) this module reads. Declared
 * structurally so this file stays dependency-free for the client bundle.
 */
export type AiFailureLike = {
  kind: string;
  firstErrorClass: string;
  allRateLimited: boolean;
  attempts: ReadonlyArray<{ provider: string; errorClass: string; status?: number }>;
};

/**
 * True when a failed AI chain must be reported as AI_UNAVAILABLE: the chain
 * ended all_unavailable without every attempt being a genuine rate limit,
 * or its first real failure was billing/auth/model_gone (whatever came after).
 */
export function isAiUnavailableFailure(failure: AiFailureLike): boolean {
  if (NOT_TRANSIENT_CLASSES.has(failure.firstErrorClass)) return true;
  return failure.kind === 'all_unavailable' && !failure.allRateLimited;
}

/**
 * One line describing a failed chain, for `DiscoveryRun.error`/sourceStats:
 * provider:class[:status] per attempt, never the raw upstream body.
 * Prefixed with AI_UNAVAILABLE when `isAiUnavailableFailure`; an
 * all-rate-limited chain says "rate limited" so it classifies as rateLimited.
 */
export function describeAiFailure(label: string, failure: AiFailureLike): string {
  const attempts = failure.attempts
    .map((a) => [a.provider, a.errorClass, a.status].filter((part) => part !== undefined && part !== '').join(':'))
    .join(', ');
  const detail = `${label}: ${failure.kind} (${attempts || failure.firstErrorClass})`;
  if (isAiUnavailableFailure(failure)) return withRunErrorCode(RUN_ERROR.AI_UNAVAILABLE, detail);
  return failure.allRateLimited ? `${detail}; rate limited by every provider` : detail;
}

/** True when `text` already carries the AI_UNAVAILABLE code. */
export function hasAiUnavailableCode(text: string | null | undefined): boolean {
  const value = (text ?? '').trim();
  return value === RUN_ERROR.AI_UNAVAILABLE || value.startsWith(`${RUN_ERROR.AI_UNAVAILABLE}:`);
}

/**
 * The run error for a stage where everything failed: the first detail that
 * already carries AI_UNAVAILABLE wins as-is; otherwise `code` is prefixed to
 * the first detail.
 */
export function stageFailureError(code: string, details: ReadonlyArray<string | null | undefined>): string {
  const aiUnavailable = details.find((detail) => hasAiUnavailableCode(detail));
  if (aiUnavailable) return aiUnavailable.trim();
  return withRunErrorCode(code, details[0]);
}

/**
 * Which user-facing message a failed run's stored error maps to. Anything
 * unrecognised (including configuration errors) is 'generic', whose copy
 * reveals nothing about the cause.
 */
export function classifyRunError(error: string | null | undefined): RunErrorKind {
  const text = (error ?? '').trim();
  if (!text) return 'generic';
  if (text === RUN_ERROR.TIMED_OUT || text.startsWith(`${RUN_ERROR.TIMED_OUT}:`)) return 'timedOut';
  if (text.startsWith(RUN_ERROR.DISPATCH_FAILED)) return 'dispatch';
  if (text.startsWith(RUN_ERROR.NOT_ENOUGH_EVIDENCE)) return 'notEnoughEvidence';
  // Before the 429 check: a billing 429 is an outage, not a rate limit.
  if (hasAiUnavailableCode(text) || BILLING_OR_AUTH_RE.test(text)) return 'aiUnavailable';
  if (RATE_LIMITED_RE.test(text)) return 'rateLimited';
  if (text.startsWith(RUN_ERROR.JUDGE_UNAVAILABLE)) return 'judgeOutage';
  if (text.startsWith(RUN_ERROR.SEARCH_UNAVAILABLE)) return 'searchUnavailable';
  return 'generic';
}

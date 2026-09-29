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
} as const;

export function withRunErrorCode(code: string, detail: string | null | undefined): string {
  const text = (detail ?? '').trim();
  return text ? `${code}: ${text}` : code;
}

export type RunErrorKind = 'timedOut' | 'dispatch' | 'judgeOutage' | 'searchUnavailable' | 'rateLimited' | 'generic';

/** A 429 anywhere in an upstream message ("... failed: 429 Rate limit ..."). */
const RATE_LIMITED_RE = /\b429\b|rate limit/i;

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
  if (RATE_LIMITED_RE.test(text)) return 'rateLimited';
  if (text.startsWith(RUN_ERROR.JUDGE_UNAVAILABLE)) return 'judgeOutage';
  if (text.startsWith(RUN_ERROR.SEARCH_UNAVAILABLE)) return 'searchUnavailable';
  return 'generic';
}

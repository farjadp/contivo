/**
 * http-health.ts
 *
 * One place that turns an HTTP status or a fetch error into ConnectionHealth /
 * a retryable flag, so every adapter classifies failures the same way.
 *
 * The rule that matters: a network blip is `transient` and never marks a
 * connection EXPIRED. Before this, any thrown error during validation
 * disconnected a healthy account.
 */

import type { ConnectionHealth, PublishResult } from './social-adapter.interface';

/**
 * Error codes that mean the request never reached the platform, so retrying a
 * publish cannot create a duplicate post.
 */
const PRE_SEND_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === 'string' ? code : undefined;
}

export function describeFetchError(err: unknown): string {
  const code = errorCode(err);
  const message = err instanceof Error ? err.message : String(err);
  const cause = (err as { cause?: unknown })?.cause;
  const causeMessage = cause instanceof Error ? cause.message : '';
  return [message, causeMessage || code].filter(Boolean).join(': ');
}

/** True when a fetch failed before the request was sent. */
export function isPreSendNetworkError(err: unknown): boolean {
  const code = errorCode(err);
  return !!code && PRE_SEND_CODES.has(code);
}

/** Retry-After header in seconds (delta-seconds or HTTP date). */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/** Maps a token-check HTTP status to ConnectionHealth. */
export function healthFromStatus(
  status: number,
  label: string,
  retryAfter?: string | null,
): ConnectionHealth {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) {
    return { ok: false, reason: 'expired', detail: `${label} rejected the access token (401). Reconnect the account.` };
  }
  if (status === 403) {
    return { ok: false, reason: 'revoked', detail: `${label} denied access (403). Reconnect the account.` };
  }
  return {
    ok: false,
    reason: 'transient',
    detail: `${label} token check returned ${status}.`,
    retryAfterSec: status === 429 ? parseRetryAfter(retryAfter) : undefined,
  };
}

/** Maps a thrown fetch error during a token check. Always transient. */
export function healthFromFetchError(err: unknown, label: string): ConnectionHealth {
  return { ok: false, reason: 'transient', detail: `${label} unreachable: ${describeFetchError(err)}` };
}

/**
 * A failed publish response. Only 429 is retried automatically: the platform
 * says it did not take the post. A 5xx may have created it.
 */
export function failedPublishResult(status: number, error: string, retryAfter?: string | null): PublishResult {
  if (status === 429) {
    return { success: false, error, retryable: true, retryAfterSec: parseRetryAfter(retryAfter), failureCode: 'RATE_LIMITED' };
  }
  // 402: X pay-per-use credits depleted. Retrying only fails again.
  if (status === 402) return { success: false, error, retryable: false, failureCode: 'CREDITS_EXHAUSTED' };
  if (status === 401) return { success: false, error, retryable: false, failureCode: 'CONNECTION_EXPIRED' };
  return { success: false, error, retryable: false, failureCode: 'PLATFORM_ERROR' };
}

/** A thrown fetch error during publish. Retryable only if nothing was sent. */
export function failedPublishFromError(err: unknown, label: string): PublishResult {
  return {
    success: false,
    error: `${label} unreachable: ${describeFetchError(err)}`,
    retryable: isPreSendNetworkError(err),
    failureCode: 'UNREACHABLE',
  };
}

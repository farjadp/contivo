/**
 * Redact-then-truncate for any text that started as an upstream HTTP
 * response body and might end up persisted (`DiscoveryRun.error`,
 * `DiscoveryRun.sourceStats.errors[]`) or shown in the UI.
 *
 * This is deliberately called at the WRITE sites — `judge.ts`'s and
 * `search.ts`'s batch/query error strings, which interpolate `await
 * res.text()` from a failed OpenAI call, and `queries.ts`'s query-generation
 * error — not only where those fields are later read back for display. A
 * value that never gets redacted or capped before it reaches the database
 * is a value the database now holds forever (or until someone notices and
 * scrubs it by hand); truncating on the way out doesn't undo that.
 *
 * The read side (`growth-competitors.ts`'s `RunView`/`RunHistoryItem`
 * serializers) still calls this too, as defence in depth — a write site
 * added later that forgets to redact should not be the only thing standing
 * between a leaked value and the browser.
 */

export const MAX_UPSTREAM_TEXT_LENGTH = 500;

// Three independent passes, applied in this order, rather than one
// alternation. A single `(a|b|c)` alternation picks whichever branch
// matches first at a given position — here that was `"authorization":`
// winning over `Bearer `, consuming only the word "Bearer" and leaving the
// actual token sitting in the string right after "[redacted]". Chaining
// separate `.replace()` calls means each pattern gets to claim the full
// span it actually needs.
const AUTH_HEADER_JSON_RE = /"authorization"\s*:\s*"[^"]*"/gi;
const BEARER_TOKEN_RE = /Bearer\s+[^\s"'}]+/gi;
const API_KEY_RE = /sk-[A-Za-z0-9_-]{8,}/gi;

export function redactSecrets(value: string): string {
  return value
    .replace(AUTH_HEADER_JSON_RE, '"authorization":"[redacted]"')
    .replace(BEARER_TOKEN_RE, '[redacted]')
    .replace(API_KEY_RE, '[redacted]');
}

export function truncateText(value: string, maxLength: number = MAX_UPSTREAM_TEXT_LENGTH): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

/**
 * Redact secret-shaped substrings, then cap the length. `null`/`undefined`/
 * empty string all pass through as `null` — there is nothing to sanitize,
 * and callers already treat `null` as "no error text" throughout this
 * codebase's `DiscoveryRun.error` handling.
 */
export function sanitizeUpstreamText(
  value: string | null | undefined,
  maxLength: number = MAX_UPSTREAM_TEXT_LENGTH,
): string | null {
  if (!value) return null;
  return truncateText(redactSecrets(value), maxLength);
}

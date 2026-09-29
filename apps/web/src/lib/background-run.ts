/**
 * Kick off a long job in a route that owns its own `maxDuration`.
 *
 * A server action runs inside the request that called it, so it cannot
 * outlive that request's own time budget. To run something long (a
 * discovery pipeline, and — per the positioning-matrices redesign already
 * planning on this — future jobs like it) the action instead POSTs to an
 * internal route that has its own `export const maxDuration` and hands the
 * work to `after()`, then returns immediately.
 *
 * This helper is the reusable half of that pattern: it POSTs to
 * `${resolveWebAppUrl()}${path}` with the same `Bearer <CRON_SECRET>` this
 * repo's other internal routes require (see `/api/autopilot/tick`).
 *
 * It reports whether the dispatch itself succeeded (`{ ok: true }` / `{ ok:
 * false, error }`) rather than swallowing every failure silently. The
 * caller needs that: `startCompetitorDiscovery` already creates a
 * `DiscoveryRun` row in `PENDING` before calling this, and if the trigger
 * never even reached the route — a missing `CRON_SECRET`, a connection
 * refused, a non-2xx response — that row would otherwise sit in `PENDING`
 * until `reapStaleRuns` marks it `FAILED` up to `STALE_RUN_MINUTES` later,
 * with the polling UI stuck showing "discovering" and every retry refused
 * with `discoveryAlreadyRunning` in the meantime. The caller is expected to
 * mark the row `FAILED` itself on a `{ ok: false }` result, so the failure
 * is visible immediately instead of ten minutes later.
 */
import { sanitizeUpstreamText } from '@/lib/competitors/redact';

export type BackgroundRunResult = { ok: true } | { ok: false; error: string };

/**
 * The route this call hits returns 202 almost immediately (it hands the
 * actual work to `after()`) — this is a bound on that one HTTP round trip,
 * not on the job it triggers. Without it, a route that hangs (a bad
 * deploy, a port pointed at nothing, a proxy stuck mid-handshake) would
 * hang this call too, and since `startCompetitorDiscovery` now `await`s
 * this result, that would hang the server action — and the request behind
 * it — indefinitely.
 */
const TRIGGER_TIMEOUT_MS = 10_000;

/**
 * `WEB_APP_URL` is the explicit, deploy-time value (set in production per
 * the deploy runbook). It falls back to `NEXT_PUBLIC_APP_URL` (already set
 * in every environment for other client-facing purposes) and, failing
 * that, to `http://localhost:<PORT>` — `PORT` is what Next actually binds
 * to in dev, which is not fixed here on purpose (this repo's local dev
 * quirks: the web app's port is randomized per session, so a hardcoded
 * `:3000` would be wrong as often as it was right).
 */
function resolveWebAppUrl(): string {
  const explicit = process.env.WEB_APP_URL?.trim();
  if (explicit) return explicit;

  const publicUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (publicUrl) return publicUrl;

  const port = process.env.PORT?.trim() || '3000';
  return `http://localhost:${port}`;
}

type ErrorCause = { code?: string; address?: string; port?: number; message?: string };

/** The `cause` of a failed fetch, when it has one, reduced to the fields worth logging. */
export function describeCause(error: unknown): ErrorCause | null {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (!cause || typeof cause !== 'object') return null;
  const record = cause as Record<string, unknown>;
  const code = typeof record.code === 'string' && /^[A-Z0-9_]{2,40}$/.test(record.code) ? record.code : undefined;
  return {
    code,
    address: typeof record.address === 'string' ? record.address : undefined,
    port: typeof record.port === 'number' ? record.port : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
}

export async function triggerBackgroundRun(path: string, body: Record<string, unknown>): Promise<BackgroundRunResult> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Never log `secret` itself, even redacted-looking — just say which
    // env var is missing.
    return { ok: false, error: 'CRON_SECRET is not set' };
  }

  const baseUrl = resolveWebAppUrl();

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      signal: AbortSignal.timeout(TRIGGER_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { ok: false, error: `Background route responded ${res.status}` };
    }

    return { ok: true };
  } catch (error) {
    // undici puts the real cause (ECONNREFUSED, ENOTFOUND, the host and
    // port it tried) in `error.cause`; the message alone is just "fetch
    // failed". Log the full cause here, server-side only, and append only
    // its code to the returned text: that text is stored in
    // `DiscoveryRun.error`, and a host or port does not belong there.
    const cause = describeCause(error);
    if (cause) {
      console.error('triggerBackgroundRun: request to', path, 'failed:', cause);
    }
    const base = error instanceof Error ? error.message : 'Request to the background route failed';
    const message = cause?.code ? `${base} (${cause.code})` : base;
    // `sanitizeUpstreamText` here is defence in depth: a plain network
    // error from `fetch` (DNS failure, connection refused, timeout) has
    // never been observed to echo back a request header, but this is the
    // one place the secret this call sent is closest to whatever comes
    // back, and this result can end up in `DiscoveryRun.error` — shown in
    // the UI — via `startCompetitorDiscovery`'s dispatch-failure handling.
    return { ok: false, error: sanitizeUpstreamText(message) ?? 'Request to the background route failed' };
  }
}

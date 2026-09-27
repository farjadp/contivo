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
export type BackgroundRunResult = { ok: true } | { ok: false; error: string };

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
    return { ok: false, error: error instanceof Error ? error.message : 'Request to the background route failed' };
  }
}

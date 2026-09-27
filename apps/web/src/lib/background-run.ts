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
 * `${WEB_APP_URL}${path}` with the same `Bearer <CRON_SECRET>` this repo's
 * other internal routes require (see `/api/autopilot/tick`), and swallows
 * every error itself. The caller fires and forgets — the row the job
 * writes to (a `DiscoveryRun`, or whatever the caller uses to track
 * progress) is the source of truth for what happened, not this HTTP call's
 * outcome. A caller that needs to know the trigger itself failed should not
 * rely on this function; it deliberately never throws or returns a status.
 */
export async function triggerBackgroundRun(path: string, body: Record<string, unknown>): Promise<void> {
  const baseUrl = process.env.WEB_APP_URL;
  const secret = process.env.CRON_SECRET;

  if (!baseUrl || !secret) {
    // Never log `secret` itself, even redacted-looking — just say which
    // env var is missing.
    console.error(
      `triggerBackgroundRun: cannot reach ${path} — ${!baseUrl ? 'WEB_APP_URL' : 'CRON_SECRET'} is not set`,
    );
    return;
  }

  try {
    await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error(`triggerBackgroundRun: request to ${path} failed:`, error instanceof Error ? error.message : error);
  }
}

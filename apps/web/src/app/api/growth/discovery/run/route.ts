/**
 * POST /api/growth/discovery/run
 *
 * Internal trigger for one discovery run. `startCompetitorDiscovery`
 * (`@/app/actions/growth-competitors`) calls this — via
 * `triggerBackgroundRun` — right after it creates the `DiscoveryRun` row
 * under a fully ownership-checked action, and hands it nothing but that
 * row's id.
 *
 * This route deliberately takes no `workspaceId`. The run row already
 * carries its own `workspaceId` and `userId`, set at creation time by code
 * that already verified the caller owns that workspace — accepting a
 * workspace id here instead would turn this route into a way for anyone who
 * has (or guesses) the bearer secret to run an arbitrary workspace's
 * pipeline, bypassing every ownership check the action layer does. The only
 * things this endpoint trusts are its own bearer secret and the `runId`;
 * `runDiscoveryPipeline` re-reads the run row itself and does nothing if it
 * doesn't exist.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` — the same pattern this
 * repo's other internal routes use (see `/api/autopilot/tick`). Refuses to
 * run at all if `CRON_SECRET` is unset, so a misconfigured deploy fails
 * closed rather than accepting every request. The comparison is a plain
 * `timingSafeEqual` over buffers of matched length (equivalent to what
 * `/api/autopilot/tick` already does), not a raw `===`, so a wrong-but-same-
 * length guess does not leak timing information proportional to how many
 * leading bytes it got right.
 *
 * Returns immediately: the actual pipeline run is handed to `after()`, so
 * this response does not wait for it. `maxDuration` is this route's own
 * budget for that background work, not for the request itself.
 */
import { timingSafeEqual } from 'crypto';

import { after, NextResponse } from 'next/server';

import { runDiscoveryPipeline } from '@/lib/competitors/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // seconds; Vercel clamps to the plan limit

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';

  // Length-check first: timingSafeEqual throws on mismatched buffer
  // lengths, and the length check itself leaks nothing an attacker doesn't
  // already know from having sent the header.
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let runId: unknown;
  try {
    const body = await request.json();
    runId = (body as { runId?: unknown } | null)?.runId;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof runId !== 'string' || !runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 });
  }

  const id = runId;
  after(() => runDiscoveryPipeline(id));

  return NextResponse.json({ ok: true }, { status: 202 });
}

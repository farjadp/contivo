/**
 * POST /api/first-post/run
 *
 * Internal trigger for one first-post run (spec 2026-11-23-first-post-b D3).
 * `startFirstPost` / `firstPostOtherAngle` call it through
 * `triggerBackgroundRun` right after writing the FIRST_POST_RUN_STARTED row
 * under an ownership-checked action, and hand it nothing but that row's id.
 *
 * Same auth as /api/matrices/run: `Authorization: Bearer <CRON_SECRET>`,
 * compared with timingSafeEqual; refuses to run at all when CRON_SECRET is
 * unset. The body is `{ runId }` only. The row is loaded by id and must be a
 * FIRST_POST_RUN_STARTED row: user and workspace come from it, never from the
 * request, so a leaked secret cannot point a run at someone else's workspace
 * or at an arbitrary log row.
 *
 * Returns at once; the run is handed to `after()`.
 */
import { after, NextResponse } from 'next/server';

import { bearerMatches } from '@/lib/bearer-secret';
import { runFirstPost } from '@/lib/first-post/run';
import { readRunStarted } from '@/lib/first-post/run-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Only a serverless host enforces this (production is one long-lived Node
// process on Railway). What bounds a run there: the per-call AI timeouts, the
// matrices reaper, and FIRST_POST_STALE_MS, after which the view reports it
// as timedOut.
export const maxDuration = 300;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return bearerMatches(request.headers.get('authorization'), secret);
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

  const run = await readRunStarted(runId);
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const id = run.runId;
  after(() => runFirstPost(id));

  return NextResponse.json({ ok: true }, { status: 202 });
}

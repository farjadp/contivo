/**
 * POST|GET /api/autopilot/tick
 *
 * Cron entry point for Autopilot. Runs every enabled policy that is due,
 * a few per call, so one invocation stays inside the serverless budget.
 * Call repeatedly (Vercel Cron, the API's scheduler, or curl) to drain.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>` — Vercel Cron sends exactly
 * this header when CRON_SECRET is set on the project. Refuses to run at
 * all if CRON_SECRET is unset, so a misconfigured deploy fails closed.
 *
 * Optional query: ?limit=N (1-20, default 3), ?policyId=<id> to force one.
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { runDuePolicies, runPolicy } from '@/lib/autopilot/runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // seconds; Vercel clamps to the plan limit

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
}

async function handle(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const policyId = url.searchParams.get('policyId');
  const limitParam = Number(url.searchParams.get('limit') || 3);
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(20, limitParam)) : 3;

  const startedAt = Date.now();
  const results = policyId
    ? [await runPolicy(policyId, { trigger: 'cron' })]
    : await runDuePolicies({ limit, trigger: 'cron' });

  return NextResponse.json({
    ok: true,
    ranAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    processed: results.length,
    results,
  });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron uses GET.
export async function GET(request: Request) {
  return handle(request);
}

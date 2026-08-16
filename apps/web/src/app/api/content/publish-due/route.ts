/**
 * POST|GET /api/content/publish-due
 *
 * Cron entry point for website publishing: flips due blog items to PUBLISHED
 * and pings each site's revalidate hook. The social equivalent runs inside the
 * Nest API's per-minute scheduler.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, same as the Autopilot tick.
 * Fails closed when CRON_SECRET is unset.
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { publishDueWebContent } from '@/lib/site-api/publisher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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
  const limitParam = Number(url.searchParams.get('limit') || 10);
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, limitParam)) : 10;

  const startedAt = Date.now();
  const results = await publishDueWebContent({ limit });

  return NextResponse.json({
    ok: true,
    ranAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    published: results.filter((r) => r.published).length,
    processed: results.length,
    results,
  });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

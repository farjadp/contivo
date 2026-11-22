/**
 * POST|GET /api/bug-reports/purge
 *
 * Daily retention: deletes bug reports older than 90 days. Called by the API's
 * WebCronService with `Authorization: Bearer <CRON_SECRET>`, like the Autopilot tick.
 * Fails closed when CRON_SECRET is unset.
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

import { purgeOldBugReports } from '@/lib/bug-report/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  try {
    const deleted = await purgeOldBugReports();
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    console.error('bug-report purge failed:', error instanceof Error ? error.name : 'error');
    return NextResponse.json({ ok: false, error: 'Purge failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}

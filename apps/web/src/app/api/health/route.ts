/**
 * GET /api/health
 *
 * What a host's health check hits to decide whether this instance is serving.
 * It answers 200 only when the process can also reach the database, because a
 * web app that renders but cannot read Postgres is not actually up — every
 * signed-in page would fail, and a check that only proved Node was running
 * would keep routing traffic at it.
 *
 * Public and deliberately dull: it reports up/down and nothing about the
 * schema, the host or the error, so it cannot be used to probe the database.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { status: 'ok', database: 'ok' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    // The reason is logged for us, never returned to the caller.
    console.error('[health] database unreachable');
    return NextResponse.json(
      { status: 'degraded', database: 'unreachable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

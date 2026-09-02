/**
 * POST /api/debug/sentry-check
 *
 * Throws on purpose, so error reporting can be proved from the deployed app
 * rather than assumed. Unit tests can show the SDK captures an exception; only
 * this shows that *this deployment*, with *this DSN*, on *this host*, actually
 * gets an error into the dashboard.
 *
 * That distinction is the whole reason this file exists. The expensive bugs in
 * this codebase were all things that looked wired and were not — a retired
 * Gemini model falling back silently for months, an API unreachable behind a
 * guard, four onboarding blockers that all answered 200. Monitoring that is
 * quietly misconfigured is the same failure wearing a new coat, and it is
 * worse than none, because it is trusted.
 *
 * Auth: `Authorization: Bearer <CRON_SECRET>`, the same as the cron routes,
 * and it fails closed when CRON_SECRET is unset. Without that this would be a
 * public way to fill someone's error quota.
 *
 * Safe to call any time. It touches no data.
 */

import { timingSafeEqual } from 'crypto';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
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

  const dsn = process.env.SENTRY_DSN?.trim();
  const configured = Boolean(dsn && !/x{4,}/i.test(dsn) && dsn.startsWith('http'));

  if (!configured) {
    // Say so rather than throwing into the void, so a missing DSN is
    // distinguishable from a broken pipeline.
    return NextResponse.json(
      { reporting: 'off', reason: 'SENTRY_DSN is unset or still a placeholder' },
      { status: 503 },
    );
  }

  // Thrown, not captured by hand, so this exercises the same path a real
  // unhandled server error takes — including Next's onRequestError hook.
  throw new Error(
    `Deliberate Sentry check from ${process.env.NEXT_PUBLIC_APP_URL ?? 'unknown host'} at ${new Date().toISOString()}`,
  );
}

/**
 * Fixed-window rate limiting.
 *
 * Nothing in the product limited anything: sign-in accepted unlimited password
 * attempts, sign-up accepted unlimited accounts, and every account arrives with
 * a credit grant that buys real model calls. A script could mint accounts and
 * spend the OpenAI key indefinitely.
 *
 * Counters live in Postgres, not in process memory. The web app runs on
 * serverless functions, so an in-memory Map is per-instance — which for the two
 * endpoints that most need a limit is no limit at all.
 *
 * The window is fixed rather than sliding: a caller can send up to 2× the limit
 * across a window boundary. That is a known and acceptable looseness here,
 * because the limits exist to stop scripted abuse, not to meter a paid API.
 */

import { prisma } from '@/lib/db';
import { headers } from 'next/headers';

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts left in this window; 0 once blocked. */
  remaining: number;
  /** Whole seconds until the window resets. */
  retryAfter: number;
}

/**
 * Count one hit against `key` and say whether it is allowed.
 *
 * The upsert and the increment are a single statement so two concurrent
 * requests cannot both read the same count and both write count + 1. The
 * window reset is part of the same statement: when the stored window is older
 * than `windowMs` the row starts again at 1 rather than being deleted, so a
 * busy key stays one row forever.
 *
 * Fails open. If the database is unreachable, sign-in should still work — a
 * limiter that takes the whole login page down with it is worse than the abuse
 * it prevents.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const windowSeconds = Math.ceil(windowMs / 1000);

  try {
    const rows = await prisma.$queryRaw<Array<{ count: number; window_age: number }>>`
      INSERT INTO rate_limits ("key", "count", "windowStart")
      VALUES (${key}, 1, NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN rate_limits."windowStart" < NOW() - (${windowSeconds} || ' seconds')::interval
            THEN 1
          ELSE rate_limits."count" + 1
        END,
        "windowStart" = CASE
          WHEN rate_limits."windowStart" < NOW() - (${windowSeconds} || ' seconds')::interval
            THEN NOW()
          ELSE rate_limits."windowStart"
        END
      RETURNING "count",
        EXTRACT(EPOCH FROM (NOW() - "windowStart"))::int AS window_age
    `;

    const row = rows[0];
    if (!row) return { allowed: true, remaining: limit, retryAfter: 0 };

    const count = Number(row.count);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfter: Math.max(1, windowSeconds - Number(row.window_age)),
    };
  } catch {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}

/**
 * The caller's IP, as seen through Vercel's proxy.
 *
 * x-forwarded-for is client-controlled in general, but on Vercel the platform
 * appends the real peer address, so the LAST entry is the one to trust — taking
 * the first would let anyone reset their own bucket by sending a header.
 */
export async function callerIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return h.get('x-real-ip') ?? 'unknown';
}

/** A human "try again in ..." for the message shown on a blocked form. */
export function retryAfterLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}

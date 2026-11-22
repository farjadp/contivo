/**
 * last-seen.ts — users.lastSeenAt and SESSION_STARTED.
 *
 * Semantics (head-of-data, 2026-11-21): a session starts on the first
 * signed-in request after >= 30 minutes idle, or the first ever; lastSeenAt
 * is written at most once per 5 minutes.
 *
 * Cost: an in-process map skips the database entirely for 5 minutes after a
 * touch, so most requests cost nothing. Otherwise one SQL statement reads
 * the previous value and updates it only when stale; a row comes back only
 * when it updated. lastSeenAt is `timestamp without time zone` holding UTC
 * (Prisma's convention), hence `now() AT TIME ZONE 'UTC'`.
 *
 * Called from the dashboard layout on every signed-in render, so it never
 * throws: a tracking failure must not break a page.
 */

import { writeActivityLog } from '@/lib/activity-log';
import { prisma } from '@/lib/db';

const THROTTLE_MS = 5 * 60_000;
const MAX_TRACKED_USERS = 10_000;

const lastTouchedAt = new Map<string, number>();

export async function touchLastSeen(userId: string): Promise<void> {
  if (!userId) return;

  try {
    const now = Date.now();
    const last = lastTouchedAt.get(userId);
    if (last !== undefined && now - last < THROTTLE_MS) return;

    if (lastTouchedAt.size >= MAX_TRACKED_USERS) lastTouchedAt.clear();
    lastTouchedAt.set(userId, now);

    const rows = await prisma.$queryRaw<Array<{ previous: Date | null; sessionStarted: boolean }>>`
      WITH prev AS (SELECT "lastSeenAt" FROM users WHERE id = ${userId})
      UPDATE users u
      SET "lastSeenAt" = now() AT TIME ZONE 'UTC'
      FROM prev
      WHERE u.id = ${userId}
        AND (prev."lastSeenAt" IS NULL OR prev."lastSeenAt" < (now() AT TIME ZONE 'UTC') - interval '5 minutes')
      RETURNING
        prev."lastSeenAt" AS previous,
        (prev."lastSeenAt" IS NULL OR prev."lastSeenAt" < (now() AT TIME ZONE 'UTC') - interval '30 minutes') AS "sessionStarted"
    `;

    const row = rows[0];
    if (!row?.sessionStarted) return;

    await writeActivityLog({
      userId,
      action: 'SESSION_STARTED',
      detail: { previousSeenAt: row.previous ? row.previous.toISOString() : null },
    });
  } catch (error) {
    console.error('touchLastSeen failed:', error);
  }
}

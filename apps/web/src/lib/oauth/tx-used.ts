/**
 * Single-use ledger for OAuth transactions (security review H3).
 *
 * Why not consumeRateLimit: it fails OPEN on database errors and leaves a row
 * per login forever. Here a conflict or ANY error means "refuse".
 */

import { prisma } from '@/lib/db';

const GRACE_SECONDS = 5 * 60;

/** True only if this call is the first to use `jti`. Any error or conflict is false. */
export async function claimTx(jti: string, txExpiresAtSeconds: number): Promise<boolean> {
  try {
    // The column is a timezone-less timestamp. A bare Date parameter is cast
    // through the SESSION timezone, so under a non-UTC session expiresAt lands
    // hours early and prune could delete a live jti (a replay window). Pin it
    // to UTC explicitly, matching prune's `NOW() AT TIME ZONE 'UTC'`.
    const expiresAt = new Date((txExpiresAtSeconds + GRACE_SECONDS) * 1000);
    const inserted = await prisma.$executeRaw`
      INSERT INTO oauth_tx_used (jti, "expiresAt")
      VALUES (${jti}, (${expiresAt}::timestamptz AT TIME ZONE 'UTC'))
      ON CONFLICT (jti) DO NOTHING
    `;
    return inserted === 1;
  } catch (error) {
    console.error('[oauth] single-use insert failed; refusing', errorTag(error));
    return false;
  }
}

/** Opportunistic cleanup. Best effort: a failure only means rows linger. */
export async function pruneUsedTx(): Promise<void> {
  try {
    await prisma.$executeRaw`DELETE FROM oauth_tx_used WHERE "expiresAt" < (NOW() AT TIME ZONE 'UTC')`;
  } catch (error) {
    console.warn('[oauth] prune of oauth_tx_used failed', errorTag(error));
  }
}

/** Safe to log: class and code only, never the message (it can carry values). */
export function errorTag(error: unknown): { name: string; code?: string } {
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; code?: unknown };
    return {
      name: typeof e.name === 'string' ? e.name : 'Error',
      ...(typeof e.code === 'string' ? { code: e.code } : {}),
    };
  }
  return { name: 'Error' };
}

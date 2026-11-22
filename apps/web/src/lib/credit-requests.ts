/**
 * credit-requests.ts — customer requests for more credits, and the admin list
 * of accounts that are low or have asked.
 *
 * Credits cannot be bought yet (Stripe is not verified), so a top-up is a
 * manual admin adjustment. A request is a CREDITS_REQUESTED row in
 * activity_logs; no schema change, no email (the app sends none).
 */

import { prisma } from '@/lib/db';
import { ensureActivityLogTables } from '@/lib/activity-log';
import { AUTOPILOT_RUN_COST } from '@/lib/credit-costs';

export { CREDIT_REQUEST_WINDOW_HOURS } from '@/lib/credit-costs';

export const CREDITS_REQUESTED_ACTION = 'CREDITS_REQUESTED';
/** A request older than this no longer counts as pending on the admin list. */
export const PENDING_REQUEST_DAYS = 7;

export type LowCreditRow = {
  userId: string;
  email: string;
  name: string | null;
  /** Sum of every ledger row. Zero for an account with no ledger history. */
  balance: number;
  ledgerRows: number;
  /** Newest CREDITS_REQUESTED inside PENDING_REQUEST_DAYS, if any. */
  lastRequestAt: Date | null;
  /** Newest positive ADMIN_* ledger row (top-up, allocate, refund, promo). */
  lastAdminAdjustmentAt: Date | null;
};

export type RankedLowCreditRow = LowCreditRow & { pending: boolean };

/**
 * Filters and orders the admin list. Pending requests first (newest first),
 * then everyone under one run, lowest balance first.
 *
 * A request is pending when it is inside the window and newer than the last
 * admin top-up: once the team has topped the account up, the request is
 * answered even if the balance is still low. Someone who asked while above
 * the threshold stays on the list, so a request is never silently ignored.
 */
export function rankLowCreditUsers(rows: LowCreditRow[], now: Date = new Date()): RankedLowCreditRow[] {
  const windowStart = now.getTime() - PENDING_REQUEST_DAYS * 24 * 3600_000;
  return rows
    .map((row) => {
      const requestAt = row.lastRequestAt?.getTime() ?? null;
      const pending =
        requestAt !== null &&
        requestAt > windowStart &&
        (row.lastAdminAdjustmentAt === null || requestAt > row.lastAdminAdjustmentAt.getTime());
      return { ...row, pending };
    })
    .filter((row) => row.pending || row.balance < AUTOPILOT_RUN_COST)
    .sort((a, b) => {
      if (a.pending !== b.pending) return a.pending ? -1 : 1;
      if (a.pending && b.pending) return b.lastRequestAt!.getTime() - a.lastRequestAt!.getTime();
      if (a.balance !== b.balance) return a.balance - b.balance;
      return a.email.localeCompare(b.email);
    });
}

/**
 * Accounts under one Autopilot run, plus anyone with a recent request.
 *
 * Balance is not stored on the user: it is the sum of the append-only
 * credit_ledger. One grouped pass over the ledger (indexed on "userId") gives
 * every balance and the last admin top-up together; requests come from the
 * activity_logs (user_id, created_at) index, limited to the pending window.
 * The SQL does the threshold so the result stays small; the ordering and the
 * pending rule live in rankLowCreditUsers, where they are tested.
 */
export async function listLowCreditUsers(limit = 200): Promise<RankedLowCreditRow[]> {
  await ensureActivityLogTables();
  const rows = await prisma.$queryRaw<LowCreditRow[]>`
    WITH balances AS (
      SELECT
        u.id AS "userId",
        u.email,
        u.name,
        COALESCE(SUM(l.amount), 0)::int AS balance,
        COUNT(l.id)::int AS "ledgerRows",
        MAX(l."createdAt") FILTER (WHERE l.feature LIKE 'ADMIN\\_%' AND l.amount > 0) AS "lastAdminAdjustmentAt"
      FROM users u
      LEFT JOIN credit_ledger l ON l."userId" = u.id
      GROUP BY u.id
    ),
    requests AS (
      SELECT user_id, MAX(created_at) AS "lastRequestAt"
      FROM activity_logs
      WHERE action = ${CREDITS_REQUESTED_ACTION}
        AND created_at > NOW() - make_interval(days => ${PENDING_REQUEST_DAYS}::int)
      GROUP BY user_id
    )
    SELECT b.*, r."lastRequestAt"
    FROM balances b
    LEFT JOIN requests r ON r.user_id = b."userId"
    WHERE b.balance < ${AUTOPILOT_RUN_COST} OR r."lastRequestAt" IS NOT NULL
    ORDER BY r."lastRequestAt" DESC NULLS LAST, b.balance ASC
    LIMIT ${limit}
  `;
  return rankLowCreditUsers(rows);
}

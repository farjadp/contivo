/** Retention and erasure for bug reports. Server only. */

import { prisma } from '@/lib/db';

export const RETENTION_DAYS = 90;

/** Delete reports older than `days`. Returns how many rows went. */
export async function purgeOldBugReports(now: Date = new Date(), days: number = RETENTION_DAYS): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.bugReport.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

/** Erase the personal parts (message, context) of a user's reports; the row and its counts stay. */
export async function purgeBugReportsForUser(userId: string): Promise<number> {
  const result = await prisma.bugReport.updateMany({
    where: { userId },
    data: { message: null, context: {} },
  });
  return result.count;
}

/** Same erasure keyed by workspace (workspace deletion nulls the FK, so clear first). */
export async function purgeBugReportsForWorkspace(workspaceId: string): Promise<number> {
  const result = await prisma.bugReport.updateMany({
    where: { workspaceId },
    data: { message: null, context: {} },
  });
  return result.count;
}

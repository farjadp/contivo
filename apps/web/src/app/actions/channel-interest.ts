'use server';

/**
 * "Notify me" on a coming-soon network in the connect step.
 *
 * Each request is one activity_logs row (action CHANNEL_INTEREST, detail
 * { network }), so demand can be counted per network and per workspace with
 * no schema change. A workspace asks once per network: a second click returns
 * ok without writing, so double clicks do not inflate the count.
 */

import { randomUUID } from 'node:crypto';

import { ensureActivityLogTables } from '@/lib/activity-log';
import { getSession } from '@/lib/auth';
import { CHANNEL_INTEREST_ACTION, isComingSoonNetwork, type ComingSoonNetwork } from '@/lib/channel-interest';
import { prisma } from '@/lib/db';

export type ChannelInterestResult = { ok: true } | { error: 'unauthorized' | 'invalid' | 'failed' };

async function ownedWorkspace(userId: string, workspaceId: string): Promise<boolean> {
  if (!workspaceId) return false;
  const workspace = await prisma.workspace.findFirst({ where: { id: workspaceId, userId }, select: { id: true } });
  return Boolean(workspace);
}

export async function requestChannelNotice(workspaceId: string, network: string): Promise<ChannelInterestResult> {
  const session = await getSession();
  if (!session) return { error: 'unauthorized' };
  if (!isComingSoonNetwork(network)) return { error: 'invalid' };
  const userId = session.userId as string;

  try {
    if (!(await ownedWorkspace(userId, workspaceId))) return { error: 'unauthorized' };
    await ensureActivityLogTables();
    await prisma.$transaction(async (tx) => {
      // Serialise two quick clicks on the same tile.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`channel_interest:${workspaceId}:${network}`}))`;
      const existing = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM activity_logs
        WHERE workspace_id = ${workspaceId}
          AND action = ${CHANNEL_INTEREST_ACTION}
          AND detail->>'network' = ${network}
        LIMIT 1
      `;
      if (existing.length > 0) return;
      await tx.$executeRaw`
        INSERT INTO activity_logs (id, user_id, workspace_id, action, detail, created_at)
        VALUES (${randomUUID()}, ${userId}, ${workspaceId}, ${CHANNEL_INTEREST_ACTION}, ${JSON.stringify({
          network,
        })}::jsonb, NOW())
      `;
    });
    return { ok: true };
  } catch (error) {
    console.error('[channel-interest] request failed', error);
    return { error: 'failed' };
  }
}

/** Networks this workspace has already asked about, so the tiles show it after a reload. */
export async function listChannelNotices(workspaceId: string): Promise<ComingSoonNetwork[]> {
  const session = await getSession();
  if (!session) return [];
  try {
    if (!(await ownedWorkspace(session.userId as string, workspaceId))) return [];
    await ensureActivityLogTables();
    const rows = await prisma.$queryRaw<Array<{ network: string | null }>>`
      SELECT DISTINCT detail->>'network' AS network FROM activity_logs
      WHERE workspace_id = ${workspaceId} AND action = ${CHANNEL_INTEREST_ACTION}
    `;
    return rows.map((row) => row.network).filter(isComingSoonNetwork);
  } catch (error) {
    console.error('[channel-interest] list failed', error);
    return [];
  }
}

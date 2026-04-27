import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { getCompetitiveLandscapeLimit } from '@/lib/app-settings';

let ensureTablesPromise: Promise<void> | null = null;

export type ActivityLogEntry = {
  id: string;
  action: string;
  workspaceId: string | null;
  workspaceName: string | null;
  detail: any;
  createdAt: Date;
};

export type DiscoveryArchiveEntry = {
  id: string;
  runNumber: number;
  source: string;
  discoveredCount: number;
  createdAt: Date;
};

function isMissingRelationError(
  error: unknown,
): error is { code?: string; meta?: { code?: string; message?: string } } {
  if (!error || typeof error !== 'object') return false;

  const candidate = error as { code?: string; meta?: { code?: string; message?: string } };
  const message = String(candidate.meta?.message || '');

  return candidate.code === 'P2010' && (candidate.meta?.code === '42P01' || message.includes('does not exist'));
}

async function withLogTablesRetry<T>(operation: () => Promise<T>): Promise<T> {
  await ensureLogTables();

  try {
    return await operation();
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }

    ensureTablesPromise = null;
    await ensureLogTables();
    return operation();
  }
}

async function ensureLogTables(): Promise<void> {
  if (ensureTablesPromise) return ensureTablesPromise;

  ensureTablesPromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workspace_id TEXT NULL,
        action TEXT NOT NULL,
        detail JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created
      ON activity_logs(user_id, created_at DESC)
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_activity_logs_workspace_created
      ON activity_logs(workspace_id, created_at DESC)
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS competitor_discovery_runs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        run_number INT NOT NULL,
        source TEXT NOT NULL,
        discovered_count INT NOT NULL DEFAULT 0,
        competitors_snapshot JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (workspace_id, run_number)
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_comp_discovery_workspace_created
      ON competitor_discovery_runs(workspace_id, created_at DESC)
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_comp_discovery_user_created
      ON competitor_discovery_runs(user_id, created_at DESC)
    `);
  })()
    .catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });

  return ensureTablesPromise;
}

export async function writeActivityLog(input: {
  userId: string;
  action: string;
  workspaceId?: string | null;
  detail?: any;
}): Promise<void> {
  try {
    await withLogTablesRetry(() =>
      prisma.$executeRaw`
        INSERT INTO activity_logs (id, user_id, workspace_id, action, detail, created_at)
        VALUES (${randomUUID()}, ${input.userId}, ${input.workspaceId || null}, ${input.action}, ${
          input.detail ? JSON.stringify(input.detail) : null
        }::jsonb, NOW())
      `,
    );
  } catch (error) {
    console.error('writeActivityLog failed:', error);
  }
}

export async function listUserActivityLogs(userId: string, limit = 80): Promise<ActivityLogEntry[]> {
  return withLogTablesRetry(() =>
    prisma.$queryRaw<
      Array<{
        id: string;
        action: string;
        workspaceId: string | null;
        workspaceName: string | null;
        detail: any;
        createdAt: Date;
      }>
    >`
      SELECT
        l.id,
        l.action,
        l.workspace_id AS "workspaceId",
        w.name AS "workspaceName",
        l.detail,
        l.created_at AS "createdAt"
      FROM activity_logs l
      LEFT JOIN workspaces w ON w.id = l.workspace_id
      WHERE l.user_id = ${userId}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `,
  );
}

export async function listAllActivityLogs(
  limit = 200,
  actionPrefix?: string,
): Promise<ActivityLogEntry[]> {
  return withLogTablesRetry(async () => {
    const rows = actionPrefix
      ? await prisma.$queryRaw<
          Array<{
            id: string;
            action: string;
            workspaceId: string | null;
            workspaceName: string | null;
            detail: any;
            createdAt: Date;
          }>
        >`
          SELECT
            l.id,
            l.action,
            l.workspace_id AS "workspaceId",
            w.name AS "workspaceName",
            l.detail,
            l.created_at AS "createdAt"
          FROM activity_logs l
          LEFT JOIN workspaces w ON w.id = l.workspace_id
          WHERE l.action LIKE ${`${actionPrefix}%`}
          ORDER BY l.created_at DESC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw<
        Array<{
          id: string;
          action: string;
          workspaceId: string | null;
          workspaceName: string | null;
          detail: any;
          createdAt: Date;
        }>
      >`
        SELECT
          l.id,
          l.action,
          l.workspace_id AS "workspaceId",
          w.name AS "workspaceName",
          l.detail,
          l.created_at AS "createdAt"
        FROM activity_logs l
        LEFT JOIN workspaces w ON w.id = l.workspace_id
        ORDER BY l.created_at DESC
        LIMIT ${limit}
      `;

    return rows;
  });
}

export async function listWorkspaceActivityLogs(
  userId: string,
  workspaceId: string,
  limit = 400,
): Promise<ActivityLogEntry[]> {
  return withLogTablesRetry(() =>
    prisma.$queryRaw<
      Array<{
        id: string;
        action: string;
        workspaceId: string | null;
        workspaceName: string | null;
        detail: any;
        createdAt: Date;
      }>
    >`
      SELECT
        l.id,
        l.action,
        l.workspace_id AS "workspaceId",
        w.name AS "workspaceName",
        l.detail,
        l.created_at AS "createdAt"
      FROM activity_logs l
      LEFT JOIN workspaces w ON w.id = l.workspace_id
      WHERE l.user_id = ${userId}
        AND l.workspace_id = ${workspaceId}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `,
  );
}

export async function listWorkspaceActivityLogsForAdmin(
  workspaceId: string,
  limit = 400,
): Promise<ActivityLogEntry[]> {
  return withLogTablesRetry(() =>
    prisma.$queryRaw<
      Array<{
        id: string;
        action: string;
        workspaceId: string | null;
        workspaceName: string | null;
        detail: any;
        createdAt: Date;
      }>
    >`
      SELECT
        l.id,
        l.action,
        l.workspace_id AS "workspaceId",
        w.name AS "workspaceName",
        l.detail,
        l.created_at AS "createdAt"
      FROM activity_logs l
      LEFT JOIN workspaces w ON w.id = l.workspace_id
      WHERE l.workspace_id = ${workspaceId}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `,
  );
}

export async function listContentActivityLogs(
  contentId: string,
  limit = 120,
): Promise<ActivityLogEntry[]> {
  return withLogTablesRetry(() =>
    prisma.$queryRaw<
      Array<{
        id: string;
        action: string;
        workspaceId: string | null;
        workspaceName: string | null;
        detail: any;
        createdAt: Date;
      }>
    >`
      SELECT
        l.id,
        l.action,
        l.workspace_id AS "workspaceId",
        w.name AS "workspaceName",
        l.detail,
        l.created_at AS "createdAt"
      FROM activity_logs l
      LEFT JOIN workspaces w ON w.id = l.workspace_id
      WHERE COALESCE(l.detail::text, '') ILIKE ${`%${contentId}%`}
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `,
  );
}

export async function getWorkspaceDiscoveryStats(
  userId: string,
  workspaceId: string,
): Promise<{ usedRuns: number; remainingRuns: number }> {
  const maxRuns = await getCompetitiveLandscapeLimit();

  const rows = await withLogTablesRetry(() =>
    prisma.$queryRaw<Array<{ usedRuns: number }>>`
      SELECT COUNT(*)::int AS "usedRuns"
      FROM competitor_discovery_runs
      WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
    `,
  );

  const usedRuns = rows[0]?.usedRuns || 0;
  return {
    usedRuns,
    remainingRuns: Math.max(0, maxRuns - usedRuns),
  };
}

export async function createDiscoveryArchive(input: {
  userId: string;
  workspaceId: string;
  source: string;
  competitors: any[];
}): Promise<{ runNumber: number; remainingRuns: number }> {
  const maxRuns = await getCompetitiveLandscapeLimit();

  const stats = await getWorkspaceDiscoveryStats(input.userId, input.workspaceId);
  if (stats.remainingRuns <= 0) {
    throw new Error('DISCOVERY_LIMIT_REACHED');
  }

  const runNumber = stats.usedRuns + 1;

  await withLogTablesRetry(() =>
    prisma.$executeRaw`
      INSERT INTO competitor_discovery_runs (
        id,
        user_id,
        workspace_id,
        run_number,
        source,
        discovered_count,
        competitors_snapshot,
        created_at
      )
      VALUES (
        ${randomUUID()},
        ${input.userId},
        ${input.workspaceId},
        ${runNumber},
        ${input.source},
        ${input.competitors.length},
        ${JSON.stringify(input.competitors)}::jsonb,
        NOW()
      )
    `,
  );

  return {
    runNumber,
    remainingRuns: Math.max(0, maxRuns - runNumber),
  };
}

export async function listWorkspaceDiscoveryArchive(
  userId: string,
  workspaceId: string,
  limit = 10,
): Promise<DiscoveryArchiveEntry[]> {
  return withLogTablesRetry(() =>
    prisma.$queryRaw<
      Array<{
        id: string;
        runNumber: number;
        source: string;
        discoveredCount: number;
        createdAt: Date;
      }>
    >`
      SELECT
        id,
        run_number AS "runNumber",
        source,
        discovered_count AS "discoveredCount",
        created_at AS "createdAt"
      FROM competitor_discovery_runs
      WHERE user_id = ${userId} AND workspace_id = ${workspaceId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
  );
}

export async function getMaxDiscoveryRuns(): Promise<number> {
  return getCompetitiveLandscapeLimit();
}

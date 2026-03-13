import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

type UserAccessRow = {
  userId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedAt: Date | null;
  suspendedReason: string | null;
  reactivatedAt: Date | null;
  updatedAt: Date;
};

type WorkspaceArchiveRow = {
  workspaceId: string;
  isArchived: boolean;
  archivedAt: Date | null;
  archivedReason: string | null;
  restoredAt: Date | null;
  updatedAt: Date;
};

let ensureAdminStateTablesPromise: Promise<void> | null = null;

async function ensureAdminStateTables(): Promise<void> {
  if (ensureAdminStateTablesPromise) return ensureAdminStateTablesPromise;

  ensureAdminStateTablesPromise = (async () => {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS admin_user_controls (
        user_id TEXT PRIMARY KEY,
        access_status TEXT NOT NULL DEFAULT 'ACTIVE',
        suspended_at TIMESTAMPTZ NULL,
        suspended_reason TEXT NULL,
        reactivated_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS admin_workspace_controls (
        workspace_id TEXT PRIMARY KEY,
        is_archived BOOLEAN NOT NULL DEFAULT FALSE,
        archived_at TIMESTAMPTZ NULL,
        archived_reason TEXT NULL,
        restored_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_admin_user_controls_status
      ON admin_user_controls(access_status, updated_at DESC)
    `);

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_admin_workspace_controls_archived
      ON admin_workspace_controls(is_archived, updated_at DESC)
    `);
  })().catch((error) => {
    ensureAdminStateTablesPromise = null;
    throw error;
  });

  return ensureAdminStateTablesPromise;
}

export async function getUserAccessState(userId: string): Promise<UserAccessRow> {
  await ensureAdminStateTables();

  const rows = await prisma.$queryRaw<UserAccessRow[]>`
    SELECT
      user_id AS "userId",
      access_status AS "status",
      suspended_at AS "suspendedAt",
      suspended_reason AS "suspendedReason",
      reactivated_at AS "reactivatedAt",
      updated_at AS "updatedAt"
    FROM admin_user_controls
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  return (
    rows[0] || {
      userId,
      status: 'ACTIVE',
      suspendedAt: null,
      suspendedReason: null,
      reactivatedAt: null,
      updatedAt: new Date(0),
    }
  );
}

export async function listUserAccessStates(userIds: string[]): Promise<Map<string, UserAccessRow>> {
  await ensureAdminStateTables();
  if (userIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<UserAccessRow[]>`
    SELECT
      user_id AS "userId",
      access_status AS "status",
      suspended_at AS "suspendedAt",
      suspended_reason AS "suspendedReason",
      reactivated_at AS "reactivatedAt",
      updated_at AS "updatedAt"
    FROM admin_user_controls
    WHERE user_id IN (${Prisma.join(userIds)})
  `;

  return new Map(rows.map((row) => [row.userId, row]));
}

export async function suspendUser(userId: string, reason?: string | null): Promise<void> {
  await ensureAdminStateTables();
  await prisma.$executeRaw`
    INSERT INTO admin_user_controls (
      user_id,
      access_status,
      suspended_at,
      suspended_reason,
      reactivated_at,
      updated_at
    )
    VALUES (${userId}, 'SUSPENDED', NOW(), ${reason || null}, NULL, NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
      access_status = 'SUSPENDED',
      suspended_at = NOW(),
      suspended_reason = EXCLUDED.suspended_reason,
      reactivated_at = NULL,
      updated_at = NOW()
  `;
}

export async function reactivateUser(userId: string): Promise<void> {
  await ensureAdminStateTables();
  await prisma.$executeRaw`
    INSERT INTO admin_user_controls (
      user_id,
      access_status,
      suspended_at,
      suspended_reason,
      reactivated_at,
      updated_at
    )
    VALUES (${userId}, 'ACTIVE', NULL, NULL, NOW(), NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET
      access_status = 'ACTIVE',
      suspended_at = NULL,
      suspended_reason = NULL,
      reactivated_at = NOW(),
      updated_at = NOW()
  `;
}

export async function isUserSuspended(userId: string): Promise<boolean> {
  const state = await getUserAccessState(userId);
  return state.status === 'SUSPENDED';
}

export async function getWorkspaceArchiveState(workspaceId: string): Promise<WorkspaceArchiveRow> {
  await ensureAdminStateTables();

  const rows = await prisma.$queryRaw<WorkspaceArchiveRow[]>`
    SELECT
      workspace_id AS "workspaceId",
      is_archived AS "isArchived",
      archived_at AS "archivedAt",
      archived_reason AS "archivedReason",
      restored_at AS "restoredAt",
      updated_at AS "updatedAt"
    FROM admin_workspace_controls
    WHERE workspace_id = ${workspaceId}
    LIMIT 1
  `;

  return (
    rows[0] || {
      workspaceId,
      isArchived: false,
      archivedAt: null,
      archivedReason: null,
      restoredAt: null,
      updatedAt: new Date(0),
    }
  );
}

export async function listWorkspaceArchiveStates(workspaceIds: string[]): Promise<Map<string, WorkspaceArchiveRow>> {
  await ensureAdminStateTables();
  if (workspaceIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<WorkspaceArchiveRow[]>`
    SELECT
      workspace_id AS "workspaceId",
      is_archived AS "isArchived",
      archived_at AS "archivedAt",
      archived_reason AS "archivedReason",
      restored_at AS "restoredAt",
      updated_at AS "updatedAt"
    FROM admin_workspace_controls
    WHERE workspace_id IN (${Prisma.join(workspaceIds)})
  `;

  return new Map(rows.map((row) => [row.workspaceId, row]));
}

export async function archiveWorkspace(workspaceId: string, reason?: string | null): Promise<void> {
  await ensureAdminStateTables();
  await prisma.$executeRaw`
    INSERT INTO admin_workspace_controls (
      workspace_id,
      is_archived,
      archived_at,
      archived_reason,
      restored_at,
      updated_at
    )
    VALUES (${workspaceId}, TRUE, NOW(), ${reason || null}, NULL, NOW())
    ON CONFLICT (workspace_id)
    DO UPDATE SET
      is_archived = TRUE,
      archived_at = NOW(),
      archived_reason = EXCLUDED.archived_reason,
      restored_at = NULL,
      updated_at = NOW()
  `;
}

export async function restoreWorkspace(workspaceId: string): Promise<void> {
  await ensureAdminStateTables();
  await prisma.$executeRaw`
    INSERT INTO admin_workspace_controls (
      workspace_id,
      is_archived,
      archived_at,
      archived_reason,
      restored_at,
      updated_at
    )
    VALUES (${workspaceId}, FALSE, NULL, NULL, NOW(), NOW())
    ON CONFLICT (workspace_id)
    DO UPDATE SET
      is_archived = FALSE,
      archived_at = NULL,
      archived_reason = NULL,
      restored_at = NOW(),
      updated_at = NOW()
  `;
}

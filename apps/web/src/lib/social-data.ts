/**
 * social-data.ts
 *
 * Reads social connections and publish jobs straight from the database for
 * server components.
 *
 * The Connections page used to fetch these from the Nest API, but every API
 * route sits behind a global Clerk guard the web app cannot satisfy (it uses
 * its own cookie session), so those calls always 401'd and the catch block
 * turned that into an empty list — the page silently showed "no accounts"
 * no matter what was connected. Reading from Prisma here is both correct and
 * one less hop.
 */

import { prisma } from '@/lib/db';
import { effectiveConnectionStatus } from '@/lib/connection-health';
import { latestJobByContentItem, type LatestPublishJob } from '@/lib/publish-outcome';
import { pickConnectionMeta } from '@/lib/telegram-connect';

export type WorkspaceOption = { id: string; name: string };

/**
 * Resolves which workspace the Connections page should operate on:
 * the requested one if the user owns it, otherwise their first workspace.
 */
export async function resolveWorkspaceScope(userId: string, requestedId?: string) {
  const workspaces = await prisma.workspace.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  const requested = requestedId
    ? workspaces.find((w) => w.id === requestedId)
    : undefined;

  return {
    workspaces,
    workspace: requested ?? workspaces[0] ?? null,
  };
}

/**
 * `status` is what the row says; `effectiveStatus` / `daysLeft` add what
 * tokenExpiresAt says (a LinkedIn sign-in past or near its 60-day end), so
 * the page can warn before the first publish 401s.
 */
export async function getSocialConnections(workspaceId: string, now: Date = new Date()) {
  const rows = await prisma.socialConnection.findMany({
    where: { workspaceId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    // Never select the encrypted token columns.
    select: {
      id: true,
      platform: true,
      accountName: true,
      accountIdentifier: true,
      status: true,
      isDefault: true,
      lastSyncAt: true,
      createdAt: true,
      tokenExpiresAt: true,
      // Read here, but only pickConnectionMeta's fields reach the browser.
      metaJson: true,
    },
  });

  return rows.map((c) => {
    const health = effectiveConnectionStatus(
      { platform: String(c.platform), status: String(c.status), tokenExpiresAt: c.tokenExpiresAt },
      now,
    );
    return {
      id: c.id,
      platform: String(c.platform),
      accountName: c.accountName,
      accountIdentifier: c.accountIdentifier,
      status: String(c.status),
      isDefault: c.isDefault,
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
      effectiveStatus: health.status,
      daysLeft: health.daysLeft,
      meta: pickConnectionMeta(c.metaJson),
    };
  });
}

/**
 * The workspace's default LinkedIn connection (the one Autopilot and the
 * scheduler publish through: `isDefault`, see autopilot/runner.ts) when its
 * sign-in has run out or will within EXPIRY_WARNING_DAYS; otherwise null.
 */
export async function getDefaultLinkedInExpiry(workspaceId: string, now: Date = new Date()) {
  const row = await prisma.socialConnection.findFirst({
    where: { workspaceId, platform: 'LINKEDIN', isDefault: true },
    select: { accountName: true, status: true, tokenExpiresAt: true },
  });
  if (!row) return null;
  const health = effectiveConnectionStatus(
    { platform: 'LINKEDIN', status: String(row.status), tokenExpiresAt: row.tokenExpiresAt },
    now,
  );
  if (health.status === 'EXPIRED') return { kind: 'expired' as const, accountName: row.accountName };
  if (health.status === 'EXPIRING_SOON') {
    return { kind: 'expiringSoon' as const, accountName: row.accountName, daysLeft: health.daysLeft ?? 1 };
  }
  return null;
}

export async function getPublishJobs(workspaceId: string, limit = 100) {
  const rows = await prisma.socialPublishJob.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      platform: true,
      status: true,
      scheduledAtUtc: true,
      externalPostUrl: true,
      lastError: true,
      retryCount: true,
      createdAt: true,
      publishedAtUtc: true,
      // Which account a failed row's Reconnect restarts.
      socialConnectionId: true,
      // Status only: whether the account behind a failed job needs a reconnect.
      connection: { select: { status: true } },
    },
  });

  return rows.map((j) => ({
    id: j.id,
    platform: String(j.platform),
    status: String(j.status),
    scheduledAtUtc: j.scheduledAtUtc?.toISOString() ?? null,
    externalPostUrl: j.externalPostUrl,
    lastError: j.lastError,
    retryCount: j.retryCount,
    createdAt: j.createdAt.toISOString(),
    publishedAtUtc: j.publishedAtUtc?.toISOString() ?? null,
    socialConnectionId: j.socialConnectionId,
    connectionStatus: j.connection ? String(j.connection.status) : null,
  }));
}

/**
 * The newest social publish job per content item, keyed by content item id,
 * for the Pipeline to show where a post landed or why it did not. Token
 * columns are never selected; only the connection's status comes along.
 */
export async function getLatestPublishJobsByContentItem(
  workspaceId: string,
  limit = 500,
): Promise<Record<string, LatestPublishJob>> {
  const rows = await prisma.socialPublishJob.findMany({
    where: { workspaceId, contentItemId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      contentItemId: true,
      platform: true,
      status: true,
      externalPostUrl: true,
      lastError: true,
      publishedAtUtc: true,
      connection: { select: { status: true } },
    },
  });

  const latest: Record<string, LatestPublishJob> = {};
  for (const [contentItemId, j] of latestJobByContentItem(rows)) {
    latest[contentItemId] = {
      platform: String(j.platform),
      status: String(j.status),
      externalPostUrl: j.externalPostUrl,
      lastError: j.lastError,
      publishedAtUtc: j.publishedAtUtc?.toISOString() ?? null,
      connectionStatus: j.connection ? String(j.connection.status) : null,
    };
  }
  return latest;
}

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

export async function getSocialConnections(workspaceId: string) {
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
    },
  });

  return rows.map((c) => ({
    id: c.id,
    platform: String(c.platform),
    accountName: c.accountName,
    accountIdentifier: c.accountIdentifier,
    status: String(c.status),
    isDefault: c.isDefault,
    lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }));
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
  }));
}

'use server';

import { revalidatePath } from 'next/cache';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { writeActivityLog } from '@/lib/activity-log';
import { generateSiteKey } from '@/lib/site-api/keys';
import { actionError } from '@/lib/action-errors';
import { getTranslations } from 'next-intl/server';

export type SiteSummary = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  name: string;
  siteUrl: string;
  status: string;
  keyPrefix: string;
  revalidateUrl: string | null;
  hasRevalidateSecret: boolean;
  lastFetchedAt: string | null;
  lastRevalidateAt: string | null;
  lastRevalidateStatus: number | null;
  publishedCount: number;
  createdAt: string;
};

export type SiteInput = {
  workspaceId: string;
  name: string;
  siteUrl: string;
  revalidateUrl?: string | null;
  revalidateSecret?: string | null;
};

type UserAuth = { ok: true; userId: string } | { ok: false; error: string };

async function requireUser(): Promise<UserAuth> {
  const session = await getSession();
  if (!session) return { ok: false, error: await actionError('notAuthenticated') };
  return { ok: true, userId: session.userId as string };
}

export async function listSites(): Promise<{ sites: SiteSummary[]; workspaces: Array<{ id: string; name: string }> } | { error: string }> {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };

  const workspaces = await prisma.workspace.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  });

  const sites = await prisma.siteConnection.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: 'desc' },
    include: { workspace: { select: { name: true } } },
  });

  const counts = await prisma.contentItem.groupBy({
    by: ['workspaceId'],
    where: {
      workspaceId: { in: sites.map((s) => s.workspaceId) },
      status: 'PUBLISHED',
      channel: 'blog',
    },
    _count: { _all: true },
  });
  const countByWorkspace = new Map(counts.map((c) => [c.workspaceId, c._count._all]));

  return {
    workspaces,
    sites: sites.map((s) => ({
      id: s.id,
      workspaceId: s.workspaceId,
      workspaceName: s.workspace.name,
      name: s.name,
      siteUrl: s.siteUrl,
      status: String(s.status),
      keyPrefix: s.keyPrefix,
      revalidateUrl: s.revalidateUrl,
      hasRevalidateSecret: Boolean(s.revalidateSecret),
      lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null,
      lastRevalidateAt: s.lastRevalidateAt?.toISOString() ?? null,
      lastRevalidateStatus: s.lastRevalidateStatus,
      publishedCount: countByWorkspace.get(s.workspaceId) ?? 0,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

/**
 * Creates a site and returns the plaintext key ONCE. It is never stored and
 * cannot be retrieved again — only rotation produces a new one.
 */
export async function createSite(input: SiteInput) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };

  const clean = await normalize(input);
  if ('error' in clean) return { error: clean.error };

  const workspace = await prisma.workspace.findUnique({
    where: { id: clean.data.workspaceId, userId: auth.userId },
    select: { id: true },
  });
  if (!workspace) return { error: await actionError('workspaceNotFoundDot') };

  const key = generateSiteKey();
  const site = await prisma.siteConnection.create({
    data: {
      workspaceId: clean.data.workspaceId,
      userId: auth.userId,
      name: clean.data.name,
      siteUrl: clean.data.siteUrl,
      revalidateUrl: clean.data.revalidateUrl,
      revalidateSecret: clean.data.revalidateSecret,
      keyHash: key.hash,
      keyPrefix: key.prefix,
    },
  });

  await writeActivityLog({
    userId: auth.userId,
    workspaceId: clean.data.workspaceId,
    action: 'SITE_CONNECTION_CREATED',
    detail: { siteId: site.id, name: site.name, siteUrl: site.siteUrl },
  });

  revalidatePath('/connections');
  return { success: true, siteId: site.id, apiKey: key.plaintext };
}

/** Issues a new key and invalidates the old one immediately. */
export async function rotateSiteKey(siteId: string) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };

  const site = await prisma.siteConnection.findFirst({
    where: { id: siteId, userId: auth.userId },
    select: { id: true, workspaceId: true },
  });
  if (!site) return { error: await actionError('siteNotFound') };

  const key = generateSiteKey();
  await prisma.siteConnection.update({
    where: { id: site.id },
    data: { keyHash: key.hash, keyPrefix: key.prefix, status: 'ACTIVE' },
  });

  await writeActivityLog({
    userId: auth.userId,
    workspaceId: site.workspaceId,
    action: 'SITE_CONNECTION_KEY_ROTATED',
    detail: { siteId: site.id },
  });

  revalidatePath('/connections');
  return { success: true, apiKey: key.plaintext };
}

export async function setSiteStatus(siteId: string, status: 'ACTIVE' | 'DISABLED' | 'REVOKED') {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };

  const site = await prisma.siteConnection.findFirst({
    where: { id: siteId, userId: auth.userId },
    select: { id: true, workspaceId: true },
  });
  if (!site) return { error: await actionError('siteNotFound') };

  await prisma.siteConnection.update({ where: { id: site.id }, data: { status } });
  await writeActivityLog({
    userId: auth.userId,
    workspaceId: site.workspaceId,
    action: 'SITE_CONNECTION_STATUS_CHANGED',
    detail: { siteId: site.id, status },
  });

  revalidatePath('/connections');
  return { success: true };
}

export async function deleteSite(siteId: string) {
  const auth = await requireUser();
  if (!auth.ok) return { error: auth.error };

  const site = await prisma.siteConnection.findFirst({
    where: { id: siteId, userId: auth.userId },
    select: { id: true, workspaceId: true, name: true },
  });
  if (!site) return { error: await actionError('siteNotFound') };

  await prisma.siteConnection.delete({ where: { id: site.id } });
  await writeActivityLog({
    userId: auth.userId,
    workspaceId: site.workspaceId,
    action: 'SITE_CONNECTION_DELETED',
    detail: { siteId: site.id, name: site.name },
  });

  revalidatePath('/connections');
  return { success: true };
}

// ---------------------------------------------------------------------------

/* Async for the same reason as autopilot's normalizeInput: translated messages. */
async function normalize(input: SiteInput) {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) return { error: await actionError('siteNameRequired') };

  const siteUrl = String(input.siteUrl || '').trim();
  const urlError = await validateHttpUrl(siteUrl, 'siteUrl');
  if (urlError) return { error: urlError };

  const revalidateUrlRaw = String(input.revalidateUrl || '').trim();
  if (revalidateUrlRaw) {
    const err = await validateHttpUrl(revalidateUrlRaw, 'revalidateUrl');
    if (err) return { error: err };
  }

  return {
    data: {
      workspaceId: String(input.workspaceId || '').trim(),
      name,
      siteUrl,
      revalidateUrl: revalidateUrlRaw || null,
      revalidateSecret: String(input.revalidateSecret || '').trim().slice(0, 200) || null,
    },
  };
}

/**
 * `field` is a message key, not a label. It used to be the English string
 * 'Site URL', spliced into the sentence — which on the Persian side produced a
 * Persian sentence with an English noun wedged into the middle of it.
 */
async function validateHttpUrl(
  value: string,
  field: 'siteUrl' | 'revalidateUrl',
): Promise<string | null> {
  const t = await getTranslations('errors');
  const label = t(`fields.${field}`);
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return t('urlScheme', { label });
    }
    return null;
  } catch {
    return t('urlInvalid', { label });
  }
}

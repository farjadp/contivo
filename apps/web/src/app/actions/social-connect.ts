'use server';

import { createHmac } from 'crypto';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

/**
 * Builds the URL that starts an OAuth connect flow.
 *
 * The API's /connect endpoint is opened by a browser navigation, so it cannot
 * receive an Authorization header, and our session cookie does not reach the
 * API across origins. We therefore mint a short-lived HMAC token here — where
 * the session is known — which the API verifies (see connect-handoff.ts).
 *
 * Must stay in sync with apps/api/src/modules/social/connect-handoff.ts.
 */

const TTL_MS = 5 * 60 * 1000;

export type ConnectUrlResult = { url: string } | { error: string };

export async function getSocialConnectUrl(
  platform: string,
  workspaceId: string,
): Promise<ConnectUrlResult> {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };

  const userId = session.userId as string;
  const normalizedPlatform = String(platform || '').toLowerCase().trim();
  if (!['linkedin', 'x', 'facebook', 'tiktok'].includes(normalizedPlatform)) {
    return { error: `Unsupported platform: ${platform}` };
  }

  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, userId },
    select: { id: true },
  });
  // Admins may operate on any workspace; the API re-checks access regardless.
  if (!workspace) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (user?.role !== 'ADMIN') return { error: 'Workspace not found.' };
  }

  const secret = process.env.OAUTH_STATE_SECRET ?? 'contivo-oauth-state-secret';
  const body = Buffer.from(
    JSON.stringify({ userId, workspaceId, exp: Date.now() + TTL_MS }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const url = `${apiBase}/api/v1/social/oauth/${normalizedPlatform}/connect?workspaceId=${encodeURIComponent(
    workspaceId,
  )}&t=${encodeURIComponent(`${body}.${signature}`)}`;

  return { url };
}

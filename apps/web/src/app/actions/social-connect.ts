'use server';

import { createHmac, randomBytes } from 'crypto';
import { getLocale } from 'next-intl/server';

import { getSession, mintApiToken } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { actionError } from '@/lib/action-errors';
import { isSiteOnly, locales } from '@/i18n/routing';

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

/**
 * The handoff token is signed here and verified by the API, so this must be
 * the same value as OAUTH_STATE_SECRET on contivo-api. No default: the repo
 * is public, and a known key would let anyone forge a connect link for any
 * user and workspace. Not exported: a 'use server' file may only export
 * async actions.
 */
function getOAuthStateSecret(): string {
  const secret = process.env.OAUTH_STATE_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error(
      'OAUTH_STATE_SECRET is not set. It signs the social connect handoff token and has no default; ' +
        'set the same value on contivo-web and contivo-api (generate with `openssl rand -base64 32`).',
    );
  }
  return secret;
}

export type ConnectUrlResult = { url: string } | { error: string };

/**
 * The app locale this request runs in, for the return from the provider
 * (B18). The API only accepts app locales; anything else is left out and the
 * return falls back to the default locale, as before.
 */
async function appLocale(): Promise<string | undefined> {
  try {
    const locale = await getLocale();
    return (locales as readonly string[]).includes(locale) && !isSiteOnly(locale) ? locale : undefined;
  } catch {
    return undefined;
  }
}

export async function getSocialConnectUrl(
  platform: string,
  workspaceId: string,
): Promise<ConnectUrlResult> {
  const session = await getSession();
  if (!session) return { error: await actionError('notAuthenticated') };

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
    if (user?.role !== 'ADMIN') return { error: await actionError('workspaceNotFoundDot') };
  }

  const secret = getOAuthStateSecret();
  const locale = await appLocale();
  const body = Buffer.from(
    // `n`: every link is distinct; the API lets each link start one flow only.
    JSON.stringify({
      userId,
      workspaceId,
      ...(locale && { locale }),
      exp: Date.now() + TTL_MS,
      n: randomBytes(9).toString('base64url'),
    }),
    'utf8',
  ).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const url = `${apiBase}/api/v1/social/oauth/${normalizedPlatform}/connect?workspaceId=${encodeURIComponent(
    workspaceId,
  )}&t=${encodeURIComponent(`${body}.${signature}`)}`;

  return { url };
}

export type FinalizeConnectResult = 'ok' | 'foreign' | 'failed';

export interface FinalizeConnectOutcome {
  result: FinalizeConnectResult;
  /**
   * The workspace the connection was saved to, when the API says so (B17).
   * Only a hint for where to land: the page still looks it up among the
   * signed-in user's own workspaces before showing it.
   */
  workspaceId?: string;
}

/**
 * Step 3 of a social connect: confirms the account the OAuth callback parked
 * under `ticket`, as the user signed in HERE.
 *
 * The API cannot see this app's session cookie, so it cannot tell who is
 * really in the browser that came back from LinkedIn. It parks the account
 * and lets this action decide: the API saves it only when the session user is
 * the user who started the flow. A victim who opens an attacker's connect link
 * lands here with their own session, gets 'foreign', and nothing is connected.
 */
export async function finalizeSocialConnect(ticket: string): Promise<FinalizeConnectOutcome> {
  const session = await getSession();
  if (!session || !ticket) return { result: 'failed' };

  try {
    const token = await mintApiToken();
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${apiBase}/api/v1/social/oauth/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ticket }),
      cache: 'no-store',
    });
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { workspaceId?: unknown } | null;
      const workspaceId = typeof body?.workspaceId === 'string' && body.workspaceId ? body.workspaceId : undefined;
      return workspaceId ? { result: 'ok', workspaceId } : { result: 'ok' };
    }
    if (res.status === 403) return { result: 'foreign' };
    console.error(`Social connect finalize failed: HTTP ${res.status}`);
    return { result: 'failed' };
  } catch (error) {
    console.error('Social connect finalize failed:', error);
    return { result: 'failed' };
  }
}

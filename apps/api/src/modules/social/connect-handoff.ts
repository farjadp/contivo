/**
 * connect-handoff.ts
 *
 * Lets the browser start an OAuth connect flow without a Clerk JWT.
 *
 * The OAuth `/connect` endpoint is reached by a plain browser navigation, so
 * it cannot carry an Authorization header — and the web app authenticates
 * with its own session cookie rather than Clerk, which the API cannot read
 * across origins. Instead the web app, which already knows who the user is,
 * mints a short-lived HMAC token naming the user and workspace, and the API
 * verifies it here.
 *
 * The signing secret (OAUTH_STATE_SECRET) is the same one already used for
 * the OAuth state parameter, so no new secret has to be distributed.
 */

import * as crypto from 'crypto';

const TTL_MS = 5 * 60 * 1000; // 5 minutes: long enough to click, short enough to be useless if leaked

export type HandoffPayload = { userId: string; workspaceId: string };

function secret(): string {
  return process.env.OAUTH_STATE_SECRET ?? 'contivo-oauth-state-secret';
}

function sign(body: string): string {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

/** Mints `<base64url(json)>.<hmac>`. Used by the web app. */
export function createHandoffToken(payload: HandoffPayload, now = Date.now()): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: now + TTL_MS }),
    'utf8',
  ).toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * Verifies a handoff token. Returns null for anything malformed, tampered
 * with, or expired — callers must treat null as "not authenticated".
 */
export function verifyHandoffToken(token: string | undefined | null, now = Date.now()): HandoffPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [body, signature] = parts;
  const expected = sign(body);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof parsed?.exp !== 'number' || parsed.exp < now) return null;
    if (typeof parsed?.userId !== 'string' || typeof parsed?.workspaceId !== 'string') return null;
    return { userId: parsed.userId, workspaceId: parsed.workspaceId };
  } catch {
    return null;
  }
}

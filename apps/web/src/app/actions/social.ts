/**
 * apps/web/src/app/actions/social.ts
 *
 * Server actions for social media connections and publish jobs.
 * These are called directly from React Server Components and Client Components.
 *
 * All API calls go through the NestJS API at NEXT_PUBLIC_API_URL.
 * Tokens are never returned — only safe connection metadata.
 */

'use server';

import { revalidatePath } from 'next/cache';

import { actionError } from '@/lib/action-errors';
import { mintApiToken } from '@/lib/auth';

import { getSocialConnectUrl } from './social-connect';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Why a call failed, for a UI that wants to branch on it. `error` is always a
 * sentence a user can read.
 * - session_expired: no session or the API rejected the token (401).
 * - forbidden: not this user's workspace (403).
 * - not_found / conflict / rejected: 404 / 409 / other 4xx, `error` is the API's message.
 * - unreachable: the API did not answer.
 * - api_error: 5xx.
 * - reconnect_unsupported: the platform has no connect flow to restart.
 */
export type SocialActionErrorCode =
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rejected'
  | 'unreachable'
  | 'api_error'
  | 'reconnect_unsupported';

export type SocialActionResult<T> = { data?: T; error?: string; code?: SocialActionErrorCode };

/** Nest error bodies: message is a string, a string[], or { message, errors[] }. */
function readApiMessage(body: unknown): string | null {
  const message = (body as { message?: unknown } | null)?.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join(' ') || null;
  if (message && typeof message === 'object') {
    const inner = message as { message?: unknown; errors?: unknown };
    const parts = [
      typeof inner.message === 'string' ? inner.message : null,
      ...(Array.isArray(inner.errors) ? inner.errors.filter((e): e is string => typeof e === 'string') : []),
    ].filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  }
  return null;
}

/**
 * Calls the Nest API with the user's minted bearer. The browser never calls
 * the API directly; without the header every route here returned 401.
 */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<SocialActionResult<T>> {
  const token = await mintApiToken();
  if (!token) return { error: await actionError('sessionExpired'), code: 'session_expired' };

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch (err) {
    console.error(`Social API unreachable for ${path}:`, err);
    return { error: 'Could not reach the publishing service. Try again in a minute.', code: 'unreachable' };
  }

  if (!res.ok) {
    if (res.status === 401) return { error: await actionError('sessionExpired'), code: 'session_expired' };
    const body = await res.json().catch(() => null);
    const apiMessage = readApiMessage(body);
    if (res.status === 403) {
      return { error: apiMessage ?? 'You do not have access to this workspace.', code: 'forbidden' };
    }
    if (res.status >= 500) {
      console.error(`Social API ${res.status} for ${path}:`, apiMessage);
      return { error: 'The publishing service had a problem. Try again in a minute.', code: 'api_error' };
    }
    const code: SocialActionErrorCode =
      res.status === 404 ? 'not_found' : res.status === 409 ? 'conflict' : 'rejected';
    return { error: apiMessage ?? `The request was rejected (${res.status}).`, code };
  }

  try {
    return { data: (await res.json()) as T };
  } catch {
    return { error: 'The publishing service sent an unreadable reply.', code: 'api_error' };
  }
}

// ─── Social Connections ───────────────────────────────────────────────────────

/** List all social connections for a workspace. */
export async function listSocialConnections(workspaceId: string) {
  return apiFetch<{
    connections: Array<{
      id: string;
      platform: string;
      accountName: string;
      accountIdentifier: string;
      status: string;
      isDefault: boolean;
      lastSyncAt: string | null;
      createdAt: string;
    }>;
    total: number;
  }>(`/social/connections?workspaceId=${workspaceId}`);
}

/** Save a new social connection (called after OAuth callback). */
export async function createSocialConnection(data: {
  workspaceId: string;
  platform: string;
  accountName: string;
  accountIdentifier: string;
  accessToken: string;
  refreshToken?: string;
  scopes?: string[];
  isDefault?: boolean;
}) {
  const result = await apiFetch('/social/connections', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  revalidatePath('/connections');
  return result;
}

/** Set a connection as default for its platform. */
export async function setDefaultConnection(
  id: string,
  workspaceId: string,
) {
  const result = await apiFetch(`/social/connections/${id}?workspaceId=${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isDefault: true }),
  });
  revalidatePath('/connections');
  return result;
}

/** Disconnect a social account. */
export async function disconnectSocialConnection(id: string, workspaceId: string) {
  const result = await apiFetch(
    `/social/connections/${id}?workspaceId=${workspaceId}`,
    { method: 'DELETE' },
  );
  revalidatePath('/connections');
  return result;
}

/**
 * Starts a reconnect. The API marks a broken connection PENDING_REAUTH and
 * says which connect flow restarts it; for OAuth platforms this returns the
 * provider URL — the caller navigates the browser there
 * (`window.location.href = data.url`). The OAuth callback upserts the same
 * row back to CONNECTED.
 */
export async function reconnectSocialConnection(
  id: string,
  workspaceId: string,
): Promise<
  SocialActionResult<{
    connection: { id: string; platform: string; status: string };
    reconnect: { platform: string; flow: 'oauth' | 'unsupported' };
    url: string;
  }>
> {
  const result = await apiFetch<{
    connection: { id: string; platform: string; status: string };
    reconnect: { platform: string; flow: 'oauth' | 'unsupported' };
  }>(`/social/connections/${encodeURIComponent(id)}/reconnect?workspaceId=${encodeURIComponent(workspaceId)}`, {
    method: 'POST',
  });
  revalidatePath('/connections');
  if (!result.data) return { error: result.error, code: result.code };

  const { reconnect } = result.data;
  if (reconnect?.flow !== 'oauth') {
    return {
      error: `Reconnecting ${reconnect?.platform ?? 'this account'} is not available here yet.`,
      code: 'reconnect_unsupported',
    };
  }

  const connect = await getSocialConnectUrl(reconnect.platform, workspaceId);
  if ('error' in connect) return { error: connect.error, code: 'rejected' };
  return { data: { ...result.data, url: connect.url } };
}

// ─── Publish Jobs ─────────────────────────────────────────────────────────────

/** List publish jobs for a workspace. */
export async function listPublishJobs(workspaceId: string, status?: string) {
  const qs = new URLSearchParams({ workspaceId });
  if (status) qs.set('status', status);
  return apiFetch<{
    jobs: Array<{
      id: string;
      platform: string;
      status: string;
      scheduledAtUtc: string | null;
      externalPostUrl: string | null;
      lastError: string | null;
      retryCount: number;
      createdAt: string;
      publishedAtUtc: string | null;
    }>;
    total: number;
  }>(`/social/publish-jobs?${qs.toString()}`);
}

/** Retry a failed publish job. */
export async function retryPublishJob(id: string, workspaceId: string) {
  const result = await apiFetch(
    `/social/publish-jobs/${id}/retry?workspaceId=${workspaceId}`,
    { method: 'POST' },
  );
  revalidatePath('/connections');
  return result;
}

/** Cancel a pending/scheduled publish job. */
export async function cancelPublishJob(id: string, workspaceId: string) {
  const result = await apiFetch(
    `/social/publish-jobs/${id}?workspaceId=${workspaceId}`,
    { method: 'DELETE' },
  );
  revalidatePath('/connections');
  return result;
}

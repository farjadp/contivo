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

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data?: T; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/v1${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });

    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try {
        const body = await res.json() as { message?: string };
        if (body.message) msg = body.message;
      } catch { /* ignore */ }
      return { error: msg };
    }

    const data = await res.json() as T;
    return { data };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
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

/** Trigger reconnect (marks as PENDING_REAUTH). */
export async function reconnectSocialConnection(id: string, workspaceId: string) {
  const result = await apiFetch(
    `/social/connections/${id}/reconnect?workspaceId=${workspaceId}`,
    { method: 'POST' },
  );
  revalidatePath('/connections');
  return result;
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

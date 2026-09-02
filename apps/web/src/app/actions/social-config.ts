'use server';

/**
 * Which social platforms this deployment can actually connect.
 *
 * The credentials live only on the API, so the Connections page cannot answer
 * this itself. Asking beats duplicating the env vars into the web app, where
 * they would drift.
 */

import { getSession, mintApiToken } from '@/lib/auth';

export type PlatformConfig = Record<string, boolean>;

export async function getConfiguredPlatforms(): Promise<PlatformConfig | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    const token = await mintApiToken();
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const res = await fetch(`${base}/api/v1/social/oauth/config`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { platforms?: PlatformConfig };
    return body.platforms ?? null;
  } catch (error) {
    // The API being unreachable is not the same as a platform being
    // unconfigured, so return null and let the UI stay neutral rather than
    // wrongly telling the user their setup is broken.
    console.error('Could not read social platform config:', error);
    return null;
  }
}

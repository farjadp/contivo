/**
 * connect-attempt.ts
 *
 * Remembers, in this browser, that an OAuth connect was started (B13).
 *
 * LinkedIn's own sign-in page sometimes loses the way back: a customer who is
 * signed out of LinkedIn signs in (Google, passkey, email check) and lands on
 * their LinkedIn feed. Contivo never gets the callback, so nothing tells them
 * the connection did not happen. The authorize URL we send is correct — its
 * login page carries `session_redirect` — so the drop is LinkedIn's, and we
 * cannot fix it there. What we can do is notice it when they come back: if an
 * attempt is recorded and the page shows no result, offer "try again". By
 * then they are signed in to LinkedIn, so the second attempt goes straight to
 * the consent screen.
 *
 * Browser storage only: it is a convenience for one person in one browser.
 * Every read and write tolerates storage being blocked.
 */

export const CONNECT_ATTEMPT_KEY = 'contivo:connect-attempt';

/** Long enough to sign in and find the way back, short enough not to nag tomorrow. */
export const CONNECT_ATTEMPT_MAX_AGE_MS = 30 * 60 * 1000;

/** Platforms whose connect leaves Contivo for the provider's site. */
export const OAUTH_CONNECT_PLATFORMS = ['linkedin'] as const;
export type OAuthConnectPlatform = (typeof OAUTH_CONNECT_PLATFORMS)[number];

export interface ConnectAttempt {
  platform: OAuthConnectPlatform;
  workspaceId: string;
  startedAt: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isOAuthConnectPlatform(value: string): value is OAuthConnectPlatform {
  return (OAUTH_CONNECT_PLATFORMS as readonly string[]).includes(value);
}

export function markConnectAttempt(
  platform: string,
  workspaceId: string,
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): void {
  if (!storage || !isOAuthConnectPlatform(platform)) return;
  try {
    const attempt: ConnectAttempt = { platform, workspaceId, startedAt: now };
    storage.setItem(CONNECT_ATTEMPT_KEY, JSON.stringify(attempt));
  } catch {
    // Storage full or blocked: the banner is a nicety, the connect still runs.
  }
}

export function clearConnectAttempt(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(CONNECT_ATTEMPT_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * The attempt to offer a retry for, or null. Expired or malformed records are
 * removed so they never come back.
 */
export function readConnectAttempt(
  now: number = Date.now(),
  storage: StorageLike | null = defaultStorage(),
): ConnectAttempt | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(CONNECT_ATTEMPT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConnectAttempt>;
    const valid =
      typeof parsed.platform === 'string' &&
      isOAuthConnectPlatform(parsed.platform) &&
      typeof parsed.workspaceId === 'string' &&
      parsed.workspaceId.length > 0 &&
      typeof parsed.startedAt === 'number' &&
      parsed.startedAt <= now &&
      now - parsed.startedAt <= CONNECT_ATTEMPT_MAX_AGE_MS;
    if (valid) return parsed as ConnectAttempt;
  } catch {
    // Fall through to cleanup.
  }
  clearConnectAttempt(storage);
  return null;
}

/**
 * last-workspace.ts
 *
 * Remembers which workspace the customer was last working in, so pages that
 * are not inside a workspace (Connections, reached from the top bar) open on
 * that one instead of the oldest workspace (B2, B17).
 *
 * A plain cookie, readable by the server render. It is only a hint: the
 * server looks the id up among the signed-in user's own workspaces and
 * ignores it otherwise, so a stale or edited value can never show someone
 * else's workspace.
 */

export const LAST_WORKSPACE_COOKIE = 'contivo_ws';

/** 90 days: long enough to outlive a holiday, short enough to forget a closed workspace. */
const MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/** Paths under /growth that are not a workspace. */
const NOT_A_WORKSPACE = new Set(['new', 'analyzing']);

/**
 * The workspace id in a locale-free app path, e.g. `/growth/abc/` → `abc`.
 * Null for any page that is not inside a workspace.
 */
export function workspaceIdFromPath(pathname: string): string | null {
  const match = /^\/growth\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  const id = decodeURIComponentSafe(match[1]!);
  return id && !NOT_A_WORKSPACE.has(id) ? id : null;
}

/** Workspace ids are cuid/uuid-like; anything else is not worth a cookie. */
export function isPlausibleWorkspaceId(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** Browser only. Never throws: blocked cookies just mean no memory. */
export function rememberWorkspace(workspaceId: string): void {
  if (typeof document === 'undefined' || !isPlausibleWorkspaceId(workspaceId)) return;
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${workspaceId}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
  } catch {
    // Cookies blocked: Connections falls back to the first workspace.
  }
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

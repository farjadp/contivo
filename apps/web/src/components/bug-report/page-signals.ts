/**
 * Small pure readers the provider uses, kept out of React so they can be
 * tested without a DOM.
 */
import { REF_PATTERN, type ViewedIds } from '@/lib/bug-report/types';

/** The ref held in a `document.cookie` string, or null if absent or malformed. */
export function readRefFromCookie(cookieString: string, cookieName: string): string | null {
  for (const part of cookieString.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== cookieName) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
    return REF_PATTERN.test(value) ? value : null;
  }
  return null;
}

const DATA_ATTRIBUTES: ReadonlyArray<readonly [keyof ViewedIds, string]> = [
  ['contentItemId', 'data-content-item-id'],
  ['matrixRunId', 'data-matrix-run-id'],
  ['discoveryRunId', 'data-discovery-run-id'],
  ['publishLogId', 'data-publish-log-id'],
];

/**
 * Ids of the objects on screen: the workspace id from the route, plus any of
 * the data-* attributes a page chooses to expose. First match wins.
 */
export function readViewedIds(root: Pick<ParentNode, 'querySelector'> | null, workspaceId: string | null): ViewedIds {
  const ids: ViewedIds = {};
  if (workspaceId) ids.workspaceId = workspaceId;
  if (!root) return ids;
  for (const [key, attr] of DATA_ATTRIBUTES) {
    try {
      const value = root.querySelector(`[${attr}]`)?.getAttribute(attr);
      if (value) ids[key] = value;
    } catch {
      // A hostile selector result is not worth a crash; the id is just missing.
    }
  }
  return ids;
}

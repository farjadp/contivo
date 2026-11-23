/**
 * In-memory ring buffers for the bug-report context (spec section 3).
 *
 * Pure module: no React, no DOM, no storage. Nothing here is persisted or sent
 * anywhere until the person presses Send and `buildClientContext` is called.
 * The server never trusts this for anything but display, but it is still kept
 * small and scrubbed here so a leak is impossible at the source.
 */
import type { Breadcrumb, ClientContext, ConsoleEntry, ViewedIds } from './types';

export const BREADCRUMB_CAP = 20;
export const CONSOLE_CAP = 10;
export const CONSOLE_MESSAGE_MAX = 200;
const LABEL_MAX = 120;

let breadcrumbs: Breadcrumb[] = [];
let consoleErrors: ConsoleEntry[] = [];

/** Things that must never leave the browser, even inside an error message. */
const SECRET_PATTERNS: RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}/, // JWT header
  /\bsk-[A-Za-z0-9_-]{8,}/i, // OpenAI-style key
  /\bBearer\s+\S+/i,
  /\b[0-9a-f]{32,}\b/i, // long hex (hashes, session ids)
  /[A-Za-z0-9+/_-]{40,}={0,2}/, // long base64 / base64url run
  /\b(?:auth-token|session|cookie|set-cookie|api[_-]?key|secret|password|token)\s*[=:]/i,
];

export function looksSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text));
}

/** `https://x.test/a/b?q=1#h` becomes `/a/b`. Anything unparseable becomes `/`. */
export function urlToPath(raw: string): string {
  try {
    return new URL(raw, 'http://local.invalid').pathname || '/';
  } catch {
    return '/';
  }
}

/** Route as sent: pathname only, no query or hash, capped. */
export function cleanRoute(raw: string): string {
  const path = raw.split(/[?#]/)[0] || '/';
  return path.slice(0, 200);
}

/**
 * Prepares one console message: URLs reduced to their path, truncated to 200
 * chars. Returns null when it looks like it carries a token, cookie or key,
 * in which case the whole entry is dropped rather than half-redacted.
 */
export function sanitizeConsoleMessage(raw: unknown): string | null {
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Error) text = raw.message;
  else {
    try {
      text = String(raw);
    } catch {
      return null;
    }
  }
  text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)'"<>]+/gi, (m) => urlToPath(m)).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (looksSecret(text)) return null;
  return text.slice(0, CONSOLE_MESSAGE_MAX);
}

function pushCapped<T>(list: T[], item: T, cap: number): T[] {
  const next = [...list, item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function pushBreadcrumb(entry: Omit<Breadcrumb, 't'> & { t?: number }): void {
  const label = String(entry.label ?? '').slice(0, LABEL_MAX);
  if (!label || looksSecret(label)) return;
  const crumb: Breadcrumb = { t: entry.t ?? Date.now(), kind: entry.kind, label };
  if (entry.code) crumb.code = entry.code;
  if (entry.ref) crumb.ref = entry.ref;
  breadcrumbs = pushCapped(breadcrumbs, crumb, BREADCRUMB_CAP);
}

export function pushConsole(kind: ConsoleEntry['kind'], raw: unknown, t: number = Date.now()): void {
  const message = sanitizeConsoleMessage(raw);
  if (message === null) return;
  consoleErrors = pushCapped(consoleErrors, { t, kind, message }, CONSOLE_CAP);
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function cleanViewedIds(ids: ViewedIds): ViewedIds {
  const out: ViewedIds = {};
  for (const key of ['workspaceId', 'contentItemId', 'discoveryRunId', 'matrixRunId', 'publishLogId'] as const) {
    const value = ids[key];
    if (typeof value === 'string' && ID_PATTERN.test(value)) out[key] = value;
  }
  return out;
}

export function buildClientContext(input: {
  route: string;
  locale: string;
  viewport: { w: number; h: number };
  viewedIds: ViewedIds;
}): ClientContext {
  return {
    route: cleanRoute(input.route),
    locale: input.locale.slice(0, 8),
    viewport: { w: Math.round(input.viewport.w) || 0, h: Math.round(input.viewport.h) || 0 },
    breadcrumbs: breadcrumbs.map((b) => ({ ...b })),
    consoleErrors: consoleErrors.map((c) => ({ ...c })),
    viewedIds: cleanViewedIds(input.viewedIds),
  };
}

/** Test hook; also what a sign-out could call. */
export function resetBuffers(): void {
  breadcrumbs = [];
  consoleErrors = [];
}

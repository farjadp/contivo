/**
 * Redaction and validation for anything a browser sends us in a bug report.
 *
 * The client is never trusted. Whatever it sends is shaped to the ClientContext type,
 * capped, and scrubbed of things that look like credentials. A shape violation drops
 * that field (or list item); it never throws, because a broken report is still better
 * than a report the user cannot send.
 */

import {
  CAUSE_CODES,
  REF_PATTERN,
  type Breadcrumb,
  type CauseCode,
  type ClientContext,
  type ConsoleEntry,
  type ViewedIds,
} from './types';

const REDACTED = '[redacted]';

export const MAX_BREADCRUMBS = 20;
export const MAX_CONSOLE_ERRORS = 10;
export const MAX_CONSOLE_MESSAGE = 200;
const MAX_LABEL = 80;
const MAX_ROUTE = 200;

/** Prisma cuid v1: 'c' + 24 base36 chars. Loose on length so a future cuid2 id still passes. */
const CUID_PATTERN = /^c[a-z0-9]{20,30}$/;

const JWT = /eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g;
const BEARER = /\b(?:bearer|basic)\s+[\w.~+/=-]{6,}/gi;
// name=value or name: value where the name says it is a credential.
const CREDENTIAL_PAIR =
  /\b[\w.-]*(?:token|session|auth|cookie|secret|password|passwd|apikey|api[_-]key|signature)[\w.-]*\s*[=:]\s*[^\s;,&'"]+/gi;
// Raw Cookie / Set-Cookie header values: everything to the end of the line.
const COOKIE_HEADER = /\b(?:set-)?cookie\s*:[^\n]*/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Vendor-prefixed keys: sk-..., sk_live_..., pk_..., rk_..., xoxb-..., ghp_..., AIza...
const VENDOR_KEY = /\b(?:sk|pk|rk|whsec|xox[abprs]|gh[pousr]|glpat|AIza)[-_A-Za-z0-9]{16,}/g;
const URL_WITH_HOST = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/?#'"<>]+((?:\/[^\s?#'"<>]*)?)(?:\?[^\s#'"<>]*)?(?:#[^\s'"<>]*)?/gi;
const LONG_RUN = /[A-Za-z0-9+/_=-]{32,}/g;

function looksLikeSecretRun(run: string): boolean {
  if (/^[0-9a-f]{32,}$/i.test(run)) return true; // hex digest or key
  if (/^[0-9a-f-]{36}$/i.test(run) && run.split('-').length === 5) return false; // a plain uuid
  const hasDigit = /\d/.test(run);
  const hasUpper = /[A-Z]/.test(run);
  const hasLower = /[a-z]/.test(run);
  // Lowercase-only runs are slugs and paths, not tokens.
  return hasDigit && hasUpper && hasLower;
}

/** Scrub credential-looking substrings, reduce URLs to their path, trim to `max`. */
export function redactText(input: string, max: number): string {
  if (typeof input !== 'string' || max <= 0) return '';
  let s = input.slice(0, max * 4); // bound the regex work on hostile input
  s = s.replace(COOKIE_HEADER, REDACTED);
  s = s.replace(URL_WITH_HOST, (_m, path: string) => path || '/');
  s = s.replace(JWT, REDACTED);
  s = s.replace(BEARER, REDACTED);
  s = s.replace(CREDENTIAL_PAIR, REDACTED);
  s = s.replace(EMAIL, REDACTED);
  s = s.replace(VENDOR_KEY, REDACTED);
  s = s.replace(LONG_RUN, (run) => (looksLikeSecretRun(run) ? REDACTED : run));
  s = s.trim();
  return s.length > max ? s.slice(0, max) : s;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finiteNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function cleanRoute(v: unknown): string {
  if (typeof v !== 'string') return '';
  let path = v.trim();
  const abs = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(path);
  if (abs) path = path.slice(abs[0].length);
  path = path.split(/[?#]/)[0];
  if (!path.startsWith('/')) return '';
  return redactText(path, MAX_ROUTE);
}

function cleanBreadcrumb(v: unknown): Breadcrumb | null {
  if (!isRecord(v)) return null;
  const t = finiteNumber(v.t);
  if (t === null) return null;
  if (v.kind !== 'route' && v.kind !== 'click' && v.kind !== 'action_failed') return null;
  if (typeof v.label !== 'string') return null;
  const label = redactText(v.label, MAX_LABEL);
  if (!label) return null;
  const out: Breadcrumb = { t, kind: v.kind, label };
  if (typeof v.code === 'string' && (CAUSE_CODES as readonly string[]).includes(v.code)) {
    out.code = v.code as CauseCode;
  }
  if (typeof v.ref === 'string' && REF_PATTERN.test(v.ref)) out.ref = v.ref;
  return out;
}

function cleanConsoleEntry(v: unknown): ConsoleEntry | null {
  if (!isRecord(v)) return null;
  const t = finiteNumber(v.t);
  if (t === null) return null;
  if (v.kind !== 'error' && v.kind !== 'rejection') return null;
  if (typeof v.message !== 'string') return null;
  const message = redactText(v.message, MAX_CONSOLE_MESSAGE);
  if (!message) return null;
  return { t, kind: v.kind, message };
}

const VIEWED_KEYS = ['workspaceId', 'contentItemId', 'discoveryRunId', 'matrixRunId', 'publishLogId'] as const;

function cleanViewedIds(v: unknown): ViewedIds {
  const out: ViewedIds = {};
  if (!isRecord(v)) return out;
  for (const key of VIEWED_KEYS) {
    const val = v[key];
    if (typeof val === 'string' && CUID_PATTERN.test(val)) out[key] = val;
  }
  return out;
}

function cleanList<T>(v: unknown, max: number, clean: (x: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  // Keep the newest: the client sends oldest first.
  for (const item of v.slice(-max * 2)) {
    const c = clean(item);
    if (c) out.push(c);
  }
  return out.slice(-max);
}

export function emptyClientContext(): ClientContext {
  return { route: '', locale: '', viewport: { w: 0, h: 0 }, breadcrumbs: [], consoleErrors: [], viewedIds: {} };
}

/** Shape, cap and scrub an untrusted client payload. Never throws. */
export function sanitizeClientContext(input: unknown): ClientContext {
  try {
    if (!isRecord(input)) return emptyClientContext();
    const vp = isRecord(input.viewport) ? input.viewport : {};
    const w = finiteNumber(vp.w);
    const h = finiteNumber(vp.h);
    const path = cleanRoute(input.path);
    return {
      route: cleanRoute(input.route),
      ...(path ? { path } : {}),
      locale: typeof input.locale === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(input.locale) ? input.locale : '',
      viewport: {
        w: w !== null && w >= 0 && w <= 20000 ? Math.round(w) : 0,
        h: h !== null && h >= 0 && h <= 20000 ? Math.round(h) : 0,
      },
      breadcrumbs: cleanList(input.breadcrumbs, MAX_BREADCRUMBS, cleanBreadcrumb),
      consoleErrors: cleanList(input.consoleErrors, MAX_CONSOLE_ERRORS, cleanConsoleEntry),
      viewedIds: cleanViewedIds(input.viewedIds),
    };
  } catch {
    return emptyClientContext();
  }
}

/**
 * Shared contract for the bug-report feature (spec:
 * docs/superpowers/specs/2026-11-22-bug-reports-design.md).
 *
 * This file is the seam between the server side (lib/bug-report/*, actions) and the
 * UI (components/bug-report/*). Change it only with the cto's say-so.
 * It must stay import-safe in client components: types and constants only, no server imports.
 */

/** Closed list of failure causes. Never carries upstream text, tokens or secrets. */
export const CAUSE_CODES = [
  'PROVIDER_OUT_OF_CREDIT', // OpenAI/Anthropic/Gemini billing or quota exhausted
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_UNAVAILABLE', // 5xx or all providers down
  'PROVIDER_AUTH', // bad/retired key or model
  'CREDITS_EXHAUSTED', // the workspace's own Contivo credits
  'NOT_ENOUGH_EVIDENCE',
  'CONNECTION_EXPIRED', // social token expired or revoked
  'VALIDATION',
  'DISPATCH_FAILED',
  'TIMED_OUT',
  'DATABASE',
  'UNKNOWN',
] as const;
export type CauseCode = (typeof CAUSE_CODES)[number];

/** Reference shown to the user, e.g. CTV-7F3K. Alphabet has no 0 O 1 I L. */
export const REF_PATTERN = /^CTV-[2-9A-HJKMNP-Z]{4}$/;
export const REF_COOKIE = 'ctv-last-ref'; // non-httpOnly, 10 min, value = a ref; set by recordActionFailure
export const MESSAGE_MAX = 1000;
export const CONTEXT_MAX_BYTES = 32 * 1024;

export type Breadcrumb = {
  t: number; // epoch ms
  kind: 'route' | 'click' | 'action_failed';
  /** route path pattern, a data-action name, or an action name. Never user text. */
  label: string;
  code?: CauseCode;
  ref?: string;
};

export type ConsoleEntry = { t: number; kind: 'error' | 'rejection'; message: string }; // message <= 200 chars, redacted

export type ViewedIds = {
  workspaceId?: string;
  contentItemId?: string;
  discoveryRunId?: string;
  matrixRunId?: string;
  publishLogId?: string;
};

/** What the browser sends. The server never trusts it for anything but display. */
export type ClientContext = {
  route: string; // pathname only, no query
  locale: string;
  viewport: { w: number; h: number };
  breadcrumbs: Breadcrumb[]; // last 20
  consoleErrors: ConsoleEntry[]; // last 10
  viewedIds: ViewedIds;
};

export type SubmitBugReportInput = { message?: string; ref?: string; client: ClientContext };
export type SubmitBugReportResult = { ok: true; ref: string } | { ok: false; error: string };

/** Server action result shape for wrapped actions: the friendly text stays, the ref is added. */
export type ActionFailure = { error: string; ref?: string };

export type ReportStatus = 'NEW' | 'SEEN' | 'FIXED' | 'WONTFIX';
export const REPORT_STATUSES: readonly ReportStatus[] = ['NEW', 'SEEN', 'FIXED', 'WONTFIX'];

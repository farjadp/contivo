/**
 * Server-built context for a bug report.
 *
 * Everything here is read from our own database. The browser contributes only its
 * breadcrumbs and console errors (display only, sanitized) and the ids of what the user
 * was looking at, and those ids are kept only if they belong to the caller.
 *
 * Stored: ids, codes, statuses, timestamps. Never the raw `error` strings of runs,
 * provider messages, draft text or tokens.
 */

import { prisma } from '@/lib/db';

import { resolveAppVersion } from './app-version';
import { classifyCauseFromStored } from './cause';
import { redactText, sanitizeClientContext } from './redact';
import {
  CAUSE_CODES,
  CONTEXT_MAX_BYTES,
  REF_PATTERN,
  type Breadcrumb,
  type CauseCode,
  type ClientContext,
  type ConsoleEntry,
  type ViewedIds,
} from './types';

export type FailedRunItem = {
  kind: 'discovery' | 'matrix' | 'publish';
  id: string;
  status: string;
  stage: string | null;
  startedAt: string; // ISO
  code: CauseCode | null;
};

export type ProviderEventItem = {
  id: string;
  provider: string;
  task: string;
  errorClass: string;
  status: number | null;
  eventType: string;
  failedOverTo: string | null;
  createdAt: string; // ISO
};

export type ActivityItem = {
  action: string;
  createdAt: string; // ISO
  ref?: string;
  code?: string;
  actionName?: string; // detail.action
};

export type ServerContext = {
  v: 1;
  builtAt: string;
  appVersion: string | null;
  userId: string;
  workspaceId: string | null;
  /** The caller's own ACTION_FAILED ref this report is about; null when none was given or it did not verify. */
  ref: string | null;
  viewedIds: ViewedIds;
  causeCode: CauseCode | null;
  failedAction: string | null;
  sentryEventId: string | null;
  failedRuns: FailedRunItem[]; // newest first
  aiProviderEvents: ProviderEventItem[]; // newest first
  activity: ActivityItem[]; // newest first
  client: Pick<ClientContext, 'route' | 'path' | 'locale' | 'viewport'> & {
    breadcrumbs: Breadcrumb[]; // oldest first
    consoleErrors: ConsoleEntry[]; // oldest first
  };
  /** Sections that could not be read. A report with a hole says so instead of looking complete. */
  degraded: string[];
};

export type BuildServerContextInput = {
  userId: string;
  workspaceId?: string | null;
  ref?: string | null;
  client: unknown;
};

export type BuildServerContextResult = {
  context: ServerContext;
  causeCode: CauseCode | null;
  failedAction: string | null;
  sentryEventId: string | null;
};

const FAILED_RUNS = 5;
const PROVIDER_EVENTS = 10;
const ACTIVITY = 20;
/** A failed run older than this is not offered as "the" cause of a report. */
const RECENT_FAILURE_MS = 48 * 60 * 60 * 1000;
const SENTRY_ID = /^[0-9a-f]{32}$/i;

function isCause(v: unknown): v is CauseCode {
  return typeof v === 'string' && (CAUSE_CODES as readonly string[]).includes(v);
}

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function safe<T>(section: string, degraded: string[], fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    degraded.push(section);
    console.error(`bug-report context: ${section} unreadable`, error instanceof Error ? error.name : 'error');
    return fallback;
  }
}

/** Keep only the viewed ids (and the workspace) that belong to the caller. */
async function verifyViewedIds(
  userId: string,
  claimed: ViewedIds,
  workspaceId: string | null,
  degraded: string[],
): Promise<ViewedIds> {
  const out: ViewedIds = {};
  if (workspaceId) out.workspaceId = workspaceId;
  const owns = async (section: string, fn: () => Promise<unknown>): Promise<boolean> =>
    safe(section, degraded, async () => Boolean(await fn()), false);

  // Independent ownership checks, run together. Each is still scoped to the caller in its query.
  const [content, discovery, matrix, publish] = await Promise.all([
    claimed.contentItemId
      ? owns('viewedIds', () =>
          prisma.contentItem.findFirst({ where: { id: claimed.contentItemId, userId }, select: { id: true } }))
      : false,
    claimed.discoveryRunId
      ? owns('viewedIds', () =>
          prisma.discoveryRun.findFirst({ where: { id: claimed.discoveryRunId, workspace: { userId } }, select: { id: true } }))
      : false,
    claimed.matrixRunId
      ? owns('viewedIds', () =>
          prisma.matrixRun.findFirst({ where: { id: claimed.matrixRunId, workspace: { userId } }, select: { id: true } }))
      : false,
    claimed.publishLogId && workspaceId
      ? owns('viewedIds', () =>
          prisma.socialPublishLog.findFirst({
            where: { id: claimed.publishLogId, job: { workspaceId } },
            select: { id: true },
          }))
      : false,
  ]);
  if (content) out.contentItemId = claimed.contentItemId;
  if (discovery) out.discoveryRunId = claimed.discoveryRunId;
  if (matrix) out.matrixRunId = claimed.matrixRunId;
  if (publish) out.publishLogId = claimed.publishLogId;
  return out;
}

async function loadFailedRuns(workspaceId: string): Promise<FailedRunItem[]> {
  const [discovery, matrix, publish] = await Promise.all([
    prisma.discoveryRun.findMany({
      where: { workspaceId, status: 'FAILED' },
      orderBy: { startedAt: 'desc' },
      take: FAILED_RUNS,
      select: { id: true, status: true, stage: true, startedAt: true, error: true },
    }),
    prisma.matrixRun.findMany({
      where: { workspaceId, status: 'FAILED' },
      orderBy: { startedAt: 'desc' },
      take: FAILED_RUNS,
      select: { id: true, status: true, stage: true, startedAt: true, error: true },
    }),
    prisma.socialPublishLog.findMany({
      where: { errorMessage: { not: null }, job: { workspaceId } },
      orderBy: { createdAt: 'desc' },
      take: FAILED_RUNS,
      select: { id: true, status: true, action: true, createdAt: true, errorMessage: true },
    }),
  ]);
  const items: FailedRunItem[] = [
    ...discovery.map((r) => ({
      kind: 'discovery' as const,
      id: r.id,
      status: r.status,
      stage: r.stage,
      startedAt: r.startedAt.toISOString(),
      code: classifyCauseFromStored(r.error),
    })),
    ...matrix.map((r) => ({
      kind: 'matrix' as const,
      id: r.id,
      status: r.status,
      stage: r.stage,
      startedAt: r.startedAt.toISOString(),
      code: classifyCauseFromStored(r.error),
    })),
    ...publish.map((r) => ({
      kind: 'publish' as const,
      id: r.id,
      status: r.status,
      stage: r.action,
      startedAt: r.createdAt.toISOString(),
      code: classifyCauseFromStored(r.errorMessage),
    })),
  ];
  items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return items.slice(0, FAILED_RUNS);
}

async function loadProviderEvents(workspaceId: string): Promise<ProviderEventItem[]> {
  const rows = await prisma.aiProviderEvent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: PROVIDER_EVENTS,
    select: {
      id: true,
      provider: true,
      task: true,
      errorClass: true,
      status: true,
      eventType: true,
      failedOverTo: true,
      createdAt: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    task: r.task,
    errorClass: r.errorClass,
    status: r.status,
    eventType: r.eventType,
    failedOverTo: r.failedOverTo,
    createdAt: r.createdAt.toISOString(),
  }));
}

function activityItem(row: { action: string; detail: unknown; created_at: Date }): ActivityItem {
  const detail = asObject(row.detail);
  const item: ActivityItem = { action: redactText(row.action, 80), createdAt: row.created_at.toISOString() };
  if (typeof detail.ref === 'string' && /^CTV-[2-9A-HJKMNP-Z]{4}$/.test(detail.ref)) item.ref = detail.ref;
  if (typeof detail.code === 'string') item.code = redactText(detail.code, 60);
  if (typeof detail.action === 'string') item.actionName = redactText(detail.action, 80);
  return item;
}

async function loadActivity(userId: string): Promise<ActivityItem[]> {
  const rows = await prisma.activity_logs.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: ACTIVITY,
    select: { action: true, detail: true, created_at: true },
  });
  return rows.map(activityItem);
}

type FailedActionRow = { causeCode: CauseCode | null; failedAction: string | null; sentryEventId: string | null };

/** The ACTION_FAILED row for this ref, only if it is the caller's own. */
async function loadActionFailed(userId: string, ref: string): Promise<FailedActionRow | null> {
  const row = await prisma.activity_logs.findFirst({
    where: { user_id: userId, action: 'ACTION_FAILED', detail: { path: ['ref'], equals: ref } },
    orderBy: { created_at: 'desc' },
    select: { detail: true },
  });
  if (!row) return null;
  const d = asObject(row.detail);
  return {
    causeCode: isCause(d.code) ? d.code : null,
    failedAction: typeof d.action === 'string' ? redactText(d.action, 80) || null : null,
    sentryEventId: typeof d.sentryEventId === 'string' && SENTRY_ID.test(d.sentryEventId) ? d.sentryEventId : null,
  };
}

type ListSpec = { get: (c: ServerContext) => unknown[]; oldest: 'first' | 'last' };
const LISTS: ListSpec[] = [
  { get: (c) => c.failedRuns, oldest: 'last' },
  { get: (c) => c.aiProviderEvents, oldest: 'last' },
  { get: (c) => c.activity, oldest: 'last' },
  { get: (c) => c.client.breadcrumbs, oldest: 'first' },
  { get: (c) => c.client.consoleErrors, oldest: 'first' },
];

/** Drop the oldest item of the longest list until the JSON fits. Returns true when it fits. */
export function capContext(context: ServerContext, maxBytes: number = CONTEXT_MAX_BYTES): boolean {
  while (JSON.stringify(context).length > maxBytes) {
    let target: ListSpec | null = null;
    let longest = 0;
    for (const spec of LISTS) {
      const len = spec.get(context).length;
      if (len > longest) {
        longest = len;
        target = spec;
      }
    }
    if (!target) return false;
    const list = target.get(context);
    if (target.oldest === 'first') list.shift();
    else list.pop();
  }
  return true;
}

export async function buildServerContext(input: BuildServerContextInput): Promise<BuildServerContextResult> {
  const { userId } = input;
  const ref = input.ref && REF_PATTERN.test(input.ref) ? input.ref : null;
  const degraded: string[] = [];
  const client = sanitizeClientContext(input.client);

  // Nothing below depends on the workspace except the workspace-scoped reads, so the
  // user-scoped ones start now and overlap the workspace lookup.
  const activityP = safe('activity', degraded, () => loadActivity(userId), []);
  const actionFailedP = ref ? safe('actionFailed', degraded, () => loadActionFailed(userId, ref), null) : Promise.resolve(null);

  // Workspace: the explicit argument first, then the one the browser says it was viewing.
  // Either way it must be the caller's. Candidates are checked together; order decides.
  const candidates = [...new Set([input.workspaceId, client.viewedIds.workspaceId].filter((c): c is string => Boolean(c)))];
  const owned = await Promise.all(
    candidates.map((candidate) =>
      safe('workspace', degraded, async () =>
        prisma.workspace.findFirst({ where: { id: candidate, userId }, select: { id: true } }), null)),
  );
  const workspaceId: string | null = owned.find((w) => w)?.id ?? null;

  const [viewedIds, failedRuns, aiProviderEvents, activity, actionFailed] = await Promise.all([
    verifyViewedIds(userId, client.viewedIds, workspaceId, degraded),
    workspaceId ? safe('failedRuns', degraded, () => loadFailedRuns(workspaceId), []) : Promise.resolve([] as FailedRunItem[]),
    workspaceId
      ? safe('aiProviderEvents', degraded, () => loadProviderEvents(workspaceId), [])
      : Promise.resolve([] as ProviderEventItem[]),
    activityP,
    actionFailedP,
  ]);

  let causeCode: CauseCode | null = actionFailed?.causeCode ?? null;
  let failedAction: string | null = actionFailed?.failedAction ?? null;
  if (!causeCode || !failedAction) {
    const recent = failedRuns.find(
      (r) => r.code !== null && Date.now() - new Date(r.startedAt).getTime() <= RECENT_FAILURE_MS,
    );
    if (recent) {
      causeCode = causeCode ?? recent.code;
      failedAction = failedAction ?? `${recent.kind}_run`;
    }
  }
  const sentryEventId = actionFailed?.sentryEventId ?? null;

  const context: ServerContext = {
    v: 1,
    builtAt: new Date().toISOString(),
    // Literal property reads so Next inlines APP_COMMIT_SHA from next.config `env`.
    appVersion: resolveAppVersion({
      APP_COMMIT_SHA: process.env.APP_COMMIT_SHA,
      RAILWAY_GIT_COMMIT_SHA: process.env.RAILWAY_GIT_COMMIT_SHA,
      RAILWAY_DEPLOYMENT_ID: process.env.RAILWAY_DEPLOYMENT_ID,
    }),
    userId,
    workspaceId,
    ref: actionFailed ? ref : null,
    viewedIds,
    causeCode,
    failedAction,
    sentryEventId,
    failedRuns,
    aiProviderEvents,
    activity,
    client: {
      route: client.route,
      ...(client.path ? { path: client.path } : {}),
      locale: client.locale,
      viewport: client.viewport,
      breadcrumbs: client.breadcrumbs,
      consoleErrors: client.consoleErrors,
    },
    degraded,
  };
  if (!capContext(context)) context.degraded.push('oversize');

  return { context, causeCode, failedAction, sentryEventId };
}

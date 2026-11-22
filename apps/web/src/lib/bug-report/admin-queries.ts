/**
 * Admin read model for bug reports. Server only; callers are admin pages behind the
 * (admin) layout guard. The user's email is read here and nowhere else.
 */

import { prisma } from '@/lib/db';

import type { ServerContext } from './context';
import {
  CAUSE_CODES,
  REPORT_STATUSES,
  type CauseCode,
  type ReportDetail,
  type ReportGroupRow,
  type ReportStatus,
  type TimelineItem,
  type ViewedIds,
} from './types';

/** Most recent reports considered when grouping. Bounded so the page stays fast. */
const GROUPING_WINDOW = 2000;
const SIBLINGS = 20;

function asStatus(v: string): ReportStatus {
  return (REPORT_STATUSES as readonly string[]).includes(v) ? (v as ReportStatus) : 'NEW';
}

function asCause(v: unknown): CauseCode | null {
  return typeof v === 'string' && (CAUSE_CODES as readonly string[]).includes(v) ? (v as CauseCode) : null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').map((x) => x as Record<string, unknown>) : [];
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function ms(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export async function listReportGroups(): Promise<ReportGroupRow[]> {
  const rows = await prisma.bugReport.findMany({
    orderBy: { createdAt: 'desc' },
    take: GROUPING_WINDOW,
    select: { fingerprint: true, referenceCode: true, userId: true, status: true, message: true, createdAt: true },
  });

  type Acc = {
    fingerprint: string;
    count: number;
    users: Set<string>;
    lastSeen: Date;
    anyNew: boolean;
    latestStatus: ReportStatus;
    sampleRef: string;
    sampleMessage: string | null;
  };
  const groups = new Map<string, Acc>();
  // Rows arrive newest first, so the first row seen for a fingerprint is its latest.
  for (const r of rows) {
    const g = groups.get(r.fingerprint);
    if (!g) {
      groups.set(r.fingerprint, {
        fingerprint: r.fingerprint,
        count: 1,
        users: new Set(r.userId ? [r.userId] : []),
        lastSeen: r.createdAt,
        anyNew: r.status === 'NEW',
        latestStatus: asStatus(r.status),
        sampleRef: r.referenceCode,
        sampleMessage: r.message,
      });
    } else {
      g.count += 1;
      if (r.userId) g.users.add(r.userId);
      if (r.status === 'NEW') g.anyNew = true;
      if (!g.sampleMessage && r.message) g.sampleMessage = r.message;
    }
  }

  const sampleRefs = [...groups.values()].map((g) => g.sampleRef);
  const causeByRef = new Map<string, CauseCode | null>();
  if (sampleRefs.length > 0) {
    const samples = await prisma.bugReport.findMany({
      where: { referenceCode: { in: sampleRefs } },
      select: { referenceCode: true, context: true },
    });
    for (const s of samples) causeByRef.set(s.referenceCode, asCause(asRecord(s.context).causeCode));
  }

  return [...groups.values()]
    .map<ReportGroupRow>((g) => ({
      fingerprint: g.fingerprint,
      count: g.count,
      distinctUsers: g.users.size,
      lastSeen: g.lastSeen.toISOString(),
      status: g.anyNew ? 'NEW' : g.latestStatus,
      topCause: causeByRef.get(g.sampleRef) ?? null,
      sampleRef: g.sampleRef,
      sampleMessage: g.sampleMessage,
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

/** Merge everything the context holds into one oldest-first list. Labels are names and codes only. */
export function buildTimeline(context: unknown): TimelineItem[] {
  const ctx = asRecord(context) as Partial<ServerContext> & Record<string, unknown>;
  const items: TimelineItem[] = [];
  const client = asRecord(ctx.client);

  for (const b of asArray(client.breadcrumbs)) {
    const t = ms(b.t);
    const label = str(b.label);
    if (t === null || !label) continue;
    items.push({ t, source: 'client', label: `${str(b.kind) ?? 'event'}: ${label}`, code: str(b.code), refId: str(b.ref) });
  }
  for (const c of asArray(client.consoleErrors)) {
    const t = ms(c.t);
    if (t === null) continue;
    items.push({ t, source: 'client', label: `console ${str(c.kind) ?? 'error'}` });
  }
  for (const r of asArray(ctx.failedRuns)) {
    const t = ms(r.startedAt);
    if (t === null) continue;
    const kind = str(r.kind) ?? 'run';
    items.push({
      t,
      source: kind === 'publish' ? 'publish' : 'run',
      label: `${kind} ${kind === 'publish' ? 'log' : 'run'} ${str(r.status) ?? ''}${str(r.stage) ? ` at ${str(r.stage)}` : ''}`.trim(),
      code: str(r.code),
      refId: str(r.id),
    });
  }
  for (const e of asArray(ctx.aiProviderEvents)) {
    const t = ms(e.createdAt);
    if (t === null) continue;
    items.push({
      t,
      source: 'ai_provider',
      label: `${str(e.provider) ?? 'provider'} ${str(e.task) ?? ''} ${str(e.eventType) ?? ''}${str(e.failedOverTo) ? ` -> ${str(e.failedOverTo)}` : ''}`
        .replace(/\s+/g, ' ')
        .trim(),
      code: str(e.errorClass),
      refId: str(e.id),
    });
  }
  for (const a of asArray(ctx.activity)) {
    const t = ms(a.createdAt);
    const action = str(a.action);
    if (t === null || !action) continue;
    items.push({ t, source: 'activity', label: str(a.actionName) ? `${action} (${str(a.actionName)})` : action, code: str(a.code), refId: str(a.ref) });
  }
  return items.sort((a, b) => a.t - b.t);
}

export async function getReportDetail(referenceCode: string): Promise<ReportDetail | null> {
  const r = await prisma.bugReport.findUnique({
    where: { referenceCode },
    include: {
      user: { select: { id: true, email: true } },
      workspace: { select: { id: true, name: true } },
    },
  });
  if (!r) return null;

  const siblings = await prisma.bugReport.findMany({
    where: { fingerprint: r.fingerprint, NOT: { id: r.id } },
    orderBy: { createdAt: 'desc' },
    take: SIBLINGS,
    select: { referenceCode: true, createdAt: true, status: true },
  });

  const ctx = asRecord(r.context);
  return {
    id: r.id,
    referenceCode: r.referenceCode,
    status: asStatus(r.status),
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    message: r.message,
    locale: r.locale,
    route: r.route,
    appVersion: r.appVersion,
    user: r.user ? { id: r.user.id, email: r.user.email ?? null } : null,
    workspace: r.workspace ? { id: r.workspace.id, name: r.workspace.name ?? null } : null,
    causeCode: asCause(ctx.causeCode),
    sentryEventId: str(ctx.sentryEventId) ?? null,
    viewedIds: asRecord(ctx.viewedIds) as ViewedIds,
    timeline: buildTimeline(r.context),
    groupSiblings: siblings.map((s) => ({
      referenceCode: s.referenceCode,
      createdAt: s.createdAt.toISOString(),
      status: asStatus(s.status),
    })),
  };
}

export async function countUnseenReports(): Promise<number> {
  return prisma.bugReport.count({ where: { status: 'NEW' } });
}

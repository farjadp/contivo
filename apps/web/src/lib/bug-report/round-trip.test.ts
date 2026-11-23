/**
 * QA: the whole report round trip on an in-memory database, real code everywhere else:
 * submitBugReport -> buildServerContext -> fingerprint -> listReportGroups / getReportDetail.
 * A failed matrix run with a stored cause, an EMPTY message, two users: the cause must be
 * readable by the admin, and the two reports must collapse into one fingerprint row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown> & { id: string; referenceCode: string; userId: string | null; fingerprint: string; createdAt: Date; status: string; message: string | null; context: unknown };

const { db, sessionMock, logMock } = vi.hoisted(() => {
  const reports: Row[] = [];
  const failedRuns: Array<{ workspaceId: string; id: string; status: string; stage: string; startedAt: Date; error: string }> = [];
  const workspaces = [
    { id: 'clws0000000000000000000a1', userId: 'user-a', name: 'Shop A' },
    { id: 'clws0000000000000000000b2', userId: 'user-b', name: 'Shop B' },
  ];
  const sessionMock = { getSession: vi.fn() };
  const logMock = { writeActivityLog: vi.fn(async () => {}) };
  let seq = 0;
  const db = {
    reports,
    failedRuns,
    workspaces,
    prisma: {
      bugReport: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (reports.some((r) => r.referenceCode === data.referenceCode)) throw Object.assign(new Error('unique'), { code: 'P2002' });
          const row = { id: `rep${++seq}`, status: 'NEW', createdAt: new Date(Date.now() + seq), resolvedAt: null, ...data } as unknown as Row;
          reports.push(row);
          return row;
        },
        findMany: async ({ where }: { where?: { referenceCode?: { in: string[] }; fingerprint?: string; NOT?: { id: string } } } = {}) => {
          let rows = [...reports].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          if (where?.referenceCode?.in) rows = rows.filter((r) => where.referenceCode!.in.includes(r.referenceCode));
          if (where?.fingerprint) rows = rows.filter((r) => r.fingerprint === where.fingerprint);
          if (where?.NOT) rows = rows.filter((r) => r.id !== where.NOT!.id);
          return rows;
        },
        findUnique: async ({ where }: { where: { referenceCode: string } }) => {
          const r = reports.find((x) => x.referenceCode === where.referenceCode);
          if (!r) return null;
          const ws = workspaces.find((w) => w.id === r.workspaceId) ?? null;
          return { ...r, user: r.userId ? { id: r.userId, email: `${r.userId}@example.test` } : null, workspace: ws ? { id: ws.id, name: ws.name } : null };
        },
      },
      workspace: { findFirst: async ({ where }: { where: { id: string; userId: string } }) => workspaces.find((w) => w.id === where.id && w.userId === where.userId) ?? null },
      contentItem: { findFirst: async () => null },
      discoveryRun: { findFirst: async () => null, findMany: async () => [] },
      matrixRun: {
        findFirst: async ({ where }: { where: { id: string; workspace: { userId: string } } }) => {
          const run = failedRuns.find((r) => r.id === where.id);
          const ws = run && workspaces.find((w) => w.id === run.workspaceId);
          return run && ws && ws.userId === where.workspace.userId ? { id: run.id } : null;
        },
        findMany: async ({ where }: { where: { workspaceId: string } }) => failedRuns.filter((r) => r.workspaceId === where.workspaceId),
      },
      socialPublishLog: { findFirst: async () => null, findMany: async () => [] },
      aiProviderEvent: { findMany: async () => [] },
      activity_logs: { findMany: async () => [], findFirst: async () => null },
    },
  };
  return { db, sessionMock, logMock };
});
vi.mock('@/lib/db', () => ({ prisma: db.prisma }));
vi.mock('@/lib/auth', () => sessionMock);
vi.mock('@/lib/activity-log', () => logMock);
vi.mock('@/lib/action-errors', () => ({ actionError: async (k: string) => `err:${k}` }));
const rate = vi.hoisted(() => ({ used: new Map<string, number>() }));
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: async (key: string, limit: number) => {
    const n = (rate.used.get(key) ?? 0) + 1;
    rate.used.set(key, n);
    return { allowed: n <= limit, remaining: Math.max(0, limit - n), retryAfter: 0 };
  },
}));

import { submitBugReport } from '@/app/actions/bug-report';

import { getReportDetail, listReportGroups } from './admin-queries';

// The string a real out-of-credit matrix failure stores (captured from the real pipeline, 22 Nov, local run).
const STORED =
  'AI_UNAVAILABLE: Matrix AI call chart_scores failed: all_unavailable (openai:billing:429, anthropic:not_configured, gemini:not_configured)';

const clientFor = (wsId: string, runId: string) => ({
  route: `/en/growth/${wsId}`,
  locale: 'en',
  viewport: { w: 375, h: 700 },
  breadcrumbs: [{ t: Date.now() - 4000, kind: 'click' as const, label: 'matrices-generate' }],
  consoleErrors: [],
  viewedIds: { workspaceId: wsId, matrixRunId: runId },
});

beforeEach(() => {
  db.reports.length = 0;
  db.failedRuns.length = 0;
  rate.used.clear();
  db.failedRuns.push(
    { workspaceId: db.workspaces[0].id, id: 'clmx0000000000000000000a1', status: 'FAILED', stage: 'SCORE', startedAt: new Date(Date.now() - 20_000), error: STORED },
    { workspaceId: db.workspaces[1].id, id: 'clmx0000000000000000000b2', status: 'FAILED', stage: 'SCORE', startedAt: new Date(Date.now() - 10_000), error: STORED },
  );
});

describe('report round trip', () => {
  it('an empty report names the real cause; two users with the same failure make one group', async () => {
    const refs: string[] = [];
    for (const [user, i] of [['user-a', 0], ['user-b', 1]] as const) {
      sessionMock.getSession.mockResolvedValue({ userId: user });
      const res = await submitBugReport({ message: '', client: clientFor(db.workspaces[i].id, db.failedRuns[i].id) });
      expect(res.ok).toBe(true);
      if (res.ok) refs.push(res.ref);
    }
    expect(db.reports).toHaveLength(2);
    expect(db.reports.every((r) => r.message === null)).toBe(true);
    expect(JSON.stringify(db.reports.map((r) => r.context)).length).toBeLessThan(2 * 32 * 1024);
    expect(JSON.stringify(db.reports.map((r) => r.context))).not.toMatch(/all_unavailable|AI_UNAVAILABLE|chart_scores/);

    const groups = await listReportGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ count: 2, distinctUsers: 2, topCause: 'PROVIDER_OUT_OF_CREDIT', status: 'NEW', sampleMessage: null });

    const detail = await getReportDetail(refs[0]);
    expect(detail?.causeCode).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(detail?.message).toBeNull();
    expect(detail?.timeline.some((t) => t.source === 'run' && t.code === 'PROVIDER_OUT_OF_CREDIT')).toBe(true);
    expect(detail?.groupSiblings.map((s) => s.referenceCode)).toEqual([refs[1]]);
  });

  it('refuses the 11th report in an hour from one user, and never stores it', async () => {
    sessionMock.getSession.mockResolvedValue({ userId: 'user-a' });
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await submitBugReport({ message: `m${i}`, client: clientFor(db.workspaces[0].id, db.failedRuns[0].id) }));
    expect(results.slice(0, 10).every((r) => r.ok)).toBe(true);
    expect(results[10]).toEqual({ ok: false, error: 'err:bugReportRateLimited' });
    expect(db.reports).toHaveLength(10);
  });

  it("a user cannot attach another user's workspace or run to a report", async () => {
    sessionMock.getSession.mockResolvedValue({ userId: 'user-a' });
    const res = await submitBugReport({ message: 'hi', client: clientFor(db.workspaces[1].id, db.failedRuns[1].id) });
    expect(res.ok).toBe(true);
    const ctx = db.reports[0].context as { workspaceId: string | null; failedRuns: unknown[]; viewedIds: Record<string, string> };
    expect(ctx.workspaceId).toBeNull();
    expect(ctx.failedRuns).toEqual([]);
    expect(ctx.viewedIds).toEqual({});
  });
});

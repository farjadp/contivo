import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { bugReport: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() } },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { buildTimeline, countUnseenReports, getReportDetail, listReportGroups } from './admin-queries';

const d = (iso: string) => new Date(iso);
const row = (o: Record<string, unknown>) => ({ message: null, userId: 'u1', status: 'NEW', ...o });

beforeEach(() => vi.clearAllMocks());

describe('listReportGroups', () => {
  it('groups by fingerprint with counts, distinct users, rollup and cause', async () => {
    // newest first, as the query orders them
    prismaMock.bugReport.findMany
      .mockResolvedValueOnce([
        row({ fingerprint: 'fpA', referenceCode: 'CTV-AAAA', userId: 'u1', status: 'FIXED', createdAt: d('2026-11-22T10:00:00Z'), message: 'broke' }),
        row({ fingerprint: 'fpB', referenceCode: 'CTV-BBBB', userId: 'u3', status: 'SEEN', createdAt: d('2026-11-22T09:00:00Z') }),
        row({ fingerprint: 'fpA', referenceCode: 'CTV-CCCC', userId: 'u2', status: 'NEW', createdAt: d('2026-11-21T10:00:00Z') }),
        row({ fingerprint: 'fpA', referenceCode: 'CTV-DDDD', userId: 'u2', status: 'FIXED', createdAt: d('2026-11-20T10:00:00Z') }),
      ])
      .mockResolvedValueOnce([
        { referenceCode: 'CTV-AAAA', context: { causeCode: 'PROVIDER_OUT_OF_CREDIT' } },
        { referenceCode: 'CTV-BBBB', context: {} },
      ]);
    const groups = await listReportGroups();
    expect(groups).toHaveLength(2);
    const a = groups.find((g) => g.fingerprint === 'fpA')!;
    expect(a).toMatchObject({
      count: 3,
      distinctUsers: 2,
      status: 'NEW', // one NEW report makes the group NEW even though the latest is FIXED
      topCause: 'PROVIDER_OUT_OF_CREDIT',
      sampleRef: 'CTV-AAAA',
      sampleMessage: 'broke',
      lastSeen: '2026-11-22T10:00:00.000Z',
    });
    const b = groups.find((g) => g.fingerprint === 'fpB')!;
    expect(b).toMatchObject({ count: 1, status: 'SEEN', topCause: null });
    expect(groups[0].fingerprint).toBe('fpA'); // most recent first
  });

  it('uses the most recent status when nothing is NEW', async () => {
    prismaMock.bugReport.findMany
      .mockResolvedValueOnce([
        row({ fingerprint: 'fpA', referenceCode: 'CTV-AAAA', status: 'WONTFIX', createdAt: d('2026-11-22T10:00:00Z') }),
        row({ fingerprint: 'fpA', referenceCode: 'CTV-BBBB', status: 'SEEN', createdAt: d('2026-11-21T10:00:00Z') }),
      ])
      .mockResolvedValueOnce([]);
    expect((await listReportGroups())[0].status).toBe('WONTFIX');
  });

  it('returns an empty list without a second query when there are no reports', async () => {
    prismaMock.bugReport.findMany.mockResolvedValueOnce([]);
    expect(await listReportGroups()).toEqual([]);
    expect(prismaMock.bugReport.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('buildTimeline', () => {
  it('merges every source oldest first and carries no free text', () => {
    const t = (iso: string) => Date.parse(iso);
    const items = buildTimeline({
      client: {
        breadcrumbs: [{ t: t('2026-11-22T10:00:03Z'), kind: 'action_failed', label: 'startMatrixRun', code: 'PROVIDER_OUT_OF_CREDIT', ref: 'CTV-7F3K' }],
        consoleErrors: [{ t: t('2026-11-22T10:00:04Z'), kind: 'error', message: 'secret-ish text' }],
      },
      failedRuns: [{ kind: 'matrix', id: 'm1', status: 'FAILED', stage: 'SCORE', startedAt: '2026-11-22T10:00:01.000Z', code: 'PROVIDER_OUT_OF_CREDIT' }],
      aiProviderEvents: [{ id: 'e1', provider: 'openai', task: 'judge', errorClass: 'billing', eventType: 'attempt_failed', failedOverTo: 'gemini', createdAt: '2026-11-22T10:00:00.500Z' }],
      activity: [{ action: 'ACTION_FAILED', createdAt: '2026-11-22T10:00:02.000Z', ref: 'CTV-7F3K', code: 'PROVIDER_OUT_OF_CREDIT' }],
    });
    expect(items.map((i) => i.source)).toEqual(['ai_provider', 'run', 'activity', 'client', 'client']);
    expect(items.map((i) => i.t)).toEqual([...items.map((i) => i.t)].sort((a, b) => a - b));
    expect(items[1]).toMatchObject({ refId: 'm1', code: 'PROVIDER_OUT_OF_CREDIT', label: 'matrix run FAILED at SCORE' });
    expect(JSON.stringify(items)).not.toContain('secret-ish');
  });

  it('survives a purged or malformed context', () => {
    expect(buildTimeline({})).toEqual([]);
    expect(buildTimeline(null)).toEqual([]);
    expect(buildTimeline({ failedRuns: 'x', client: { breadcrumbs: [{ t: 'bad' }] } })).toEqual([]);
  });
});

describe('getReportDetail', () => {
  it('returns null for an unknown ref', async () => {
    prismaMock.bugReport.findUnique.mockResolvedValue(null);
    expect(await getReportDetail('CTV-ZZZZ')).toBeNull();
  });

  it('maps the row, email and siblings', async () => {
    prismaMock.bugReport.findUnique.mockResolvedValue({
      id: 'r1', referenceCode: 'CTV-AAAA', status: 'SEEN', createdAt: d('2026-11-22T10:00:00Z'), resolvedAt: null,
      message: '<b>hi</b>', locale: 'fa', route: '/fa/x', appVersion: 'abc1234', fingerprint: 'fpA',
      user: { id: 'u1', email: 'a@b.co' }, workspace: { id: 'w1', name: 'Acme' },
      context: { causeCode: 'PROVIDER_OUT_OF_CREDIT', sentryEventId: 'a'.repeat(32), viewedIds: { workspaceId: 'w1' } },
    });
    prismaMock.bugReport.findMany.mockResolvedValue([{ referenceCode: 'CTV-BBBB', createdAt: d('2026-11-21T10:00:00Z'), status: 'NEW' }]);
    const r = await getReportDetail('CTV-AAAA');
    expect(r).toMatchObject({
      referenceCode: 'CTV-AAAA', message: '<b>hi</b>', user: { id: 'u1', email: 'a@b.co' },
      workspace: { id: 'w1', name: 'Acme' }, causeCode: 'PROVIDER_OUT_OF_CREDIT', viewedIds: { workspaceId: 'w1' },
      groupSiblings: [{ referenceCode: 'CTV-BBBB', status: 'NEW', createdAt: '2026-11-21T10:00:00.000Z' }],
    });
    expect(prismaMock.bugReport.findMany.mock.calls[0][0].where).toEqual({ fingerprint: 'fpA', NOT: { id: 'r1' } });
  });

  it('handles a purged report (user gone, empty context)', async () => {
    prismaMock.bugReport.findUnique.mockResolvedValue({
      id: 'r1', referenceCode: 'CTV-AAAA', status: 'NEW', createdAt: d('2026-11-22T10:00:00Z'), resolvedAt: null,
      message: null, locale: null, route: null, appVersion: null, fingerprint: 'fpA', user: null, workspace: null, context: {},
    });
    prismaMock.bugReport.findMany.mockResolvedValue([]);
    const r = await getReportDetail('CTV-AAAA');
    expect(r).toMatchObject({ user: null, workspace: null, causeCode: null, timeline: [], viewedIds: {} });
  });
});

describe('countUnseenReports', () => {
  it('counts NEW reports', async () => {
    prismaMock.bugReport.count.mockResolvedValue(4);
    expect(await countUnseenReports()).toBe(4);
    expect(prismaMock.bugReport.count).toHaveBeenCalledWith({ where: { status: 'NEW' } });
  });
});

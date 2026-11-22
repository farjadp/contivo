import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findFirst: vi.fn() },
    contentItem: { findFirst: vi.fn() },
    discoveryRun: { findFirst: vi.fn(), findMany: vi.fn() },
    matrixRun: { findFirst: vi.fn(), findMany: vi.fn() },
    socialPublishLog: { findFirst: vi.fn(), findMany: vi.fn() },
    aiProviderEvent: { findMany: vi.fn() },
    activity_logs: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { buildServerContext, capContext, type ServerContext } from './context';

const WS = 'clws0000000000000000000a1';
const OTHER_WS = 'clws0000000000000000000b2';
const MATRIX = 'clmx0000000000000000000a1';
const FOREIGN_MATRIX = 'clmx0000000000000000000z9';
const USER = 'user-1';
const client = (viewedIds: Record<string, string> = {}) => ({
  route: '/en/growth/x/matrices',
  locale: 'en',
  viewport: { w: 100, h: 200 },
  breadcrumbs: [],
  consoleErrors: [],
  viewedIds,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workspace.findFirst.mockImplementation(async ({ where }) => (where.id === WS && where.userId === USER ? { id: WS } : null));
  prismaMock.contentItem.findFirst.mockResolvedValue(null);
  prismaMock.discoveryRun.findFirst.mockResolvedValue(null);
  prismaMock.discoveryRun.findMany.mockResolvedValue([]);
  prismaMock.matrixRun.findFirst.mockImplementation(async ({ where }) => (where.id === MATRIX ? { id: MATRIX } : null));
  prismaMock.matrixRun.findMany.mockResolvedValue([]);
  prismaMock.socialPublishLog.findFirst.mockResolvedValue(null);
  prismaMock.socialPublishLog.findMany.mockResolvedValue([]);
  prismaMock.aiProviderEvent.findMany.mockResolvedValue([]);
  prismaMock.activity_logs.findMany.mockResolvedValue([]);
  prismaMock.activity_logs.findFirst.mockResolvedValue(null);
});

describe('buildServerContext', () => {
  it('names the real cause of a failed matrix run from its stored code (never the raw error)', async () => {
    const RAW = 'JUDGE_UNAVAILABLE: Judge batch failed: 429 You exceeded your current quota insufficient_quota sk-proj-SECRET';
    prismaMock.matrixRun.findMany.mockResolvedValue([
      { id: MATRIX, status: 'FAILED', stage: 'SCORE', startedAt: new Date(Date.now() - 60_000), error: RAW },
    ]);
    const { context, causeCode, failedAction } = await buildServerContext({ userId: USER, workspaceId: WS, client: client() });
    expect(causeCode).toBe('PROVIDER_OUT_OF_CREDIT');
    expect(failedAction).toBe('matrix_run');
    expect(context.failedRuns[0]).toMatchObject({ kind: 'matrix', id: MATRIX, stage: 'SCORE', code: 'PROVIDER_OUT_OF_CREDIT' });
    const json = JSON.stringify(context);
    expect(json).not.toContain('insufficient_quota');
    expect(json).not.toContain('sk-proj');
  });

  it('does not blame a stale failure', async () => {
    prismaMock.matrixRun.findMany.mockResolvedValue([
      { id: MATRIX, status: 'FAILED', stage: 'SCORE', startedAt: new Date(Date.now() - 10 * 86400_000), error: 'AI_UNAVAILABLE: openai:billing' },
    ]);
    const { causeCode } = await buildServerContext({ userId: USER, workspaceId: WS, client: client() });
    expect(causeCode).toBeNull();
  });

  it('drops viewed ids and a workspace the caller does not own', async () => {
    const { context } = await buildServerContext({
      userId: USER,
      workspaceId: OTHER_WS,
      client: client({ workspaceId: OTHER_WS, matrixRunId: FOREIGN_MATRIX }),
    });
    expect(context.workspaceId).toBeNull();
    expect(context.viewedIds).toEqual({});
    expect(prismaMock.matrixRun.findMany).not.toHaveBeenCalled(); // no foreign workspace data read
    expect(prismaMock.aiProviderEvent.findMany).not.toHaveBeenCalled();
    // the ownership predicate is part of the query
    expect(prismaMock.matrixRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FOREIGN_MATRIX, workspace: { userId: USER } } }),
    );
  });

  it('keeps owned viewed ids', async () => {
    const { context } = await buildServerContext({ userId: USER, client: client({ workspaceId: WS, matrixRunId: MATRIX }) });
    expect(context.viewedIds).toEqual({ workspaceId: WS, matrixRunId: MATRIX });
  });

  it('takes cause, action and sentry id from the caller\'s own ACTION_FAILED row; whitelists activity detail', async () => {
    prismaMock.activity_logs.findFirst.mockResolvedValue({
      detail: { ref: 'CTV-7F3K', action: 'startMatrixRun', code: 'PROVIDER_RATE_LIMITED', sentryEventId: 'a'.repeat(32), message: 'secret text' },
    });
    prismaMock.activity_logs.findMany.mockResolvedValue([
      { action: 'ACTION_FAILED', created_at: new Date(), detail: { ref: 'CTV-7F3K', code: 'PROVIDER_RATE_LIMITED', action: 'startMatrixRun', email: 'a@b.co', draft: 'private' } },
    ]);
    const r = await buildServerContext({ userId: USER, workspaceId: WS, ref: 'CTV-7F3K', client: client() });
    expect(r.causeCode).toBe('PROVIDER_RATE_LIMITED');
    expect(r.failedAction).toBe('startMatrixRun');
    expect(r.sentryEventId).toBe('a'.repeat(32));
    expect(prismaMock.activity_logs.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ user_id: USER, action: 'ACTION_FAILED' }) }),
    );
    const json = JSON.stringify(r.context);
    expect(json).not.toContain('private');
    expect(json).not.toContain('a@b.co');
    expect(json).not.toContain('secret text');
    expect(r.context.activity[0]).toEqual({ action: 'ACTION_FAILED', createdAt: expect.any(String), ref: 'CTV-7F3K', code: 'PROVIDER_RATE_LIMITED', actionName: 'startMatrixRun' });
  });

  it('ignores a malformed ref and reads no ACTION_FAILED row', async () => {
    await buildServerContext({ userId: USER, ref: 'not-a-ref', client: client() });
    expect(prismaMock.activity_logs.findFirst).not.toHaveBeenCalled();
  });

  it('provider events carry no message', async () => {
    prismaMock.aiProviderEvent.findMany.mockResolvedValue([
      { id: 'e1', provider: 'openai', task: 'judge', errorClass: 'billing', status: 429, eventType: 'attempt_failed', failedOverTo: 'gemini', createdAt: new Date() },
    ]);
    const { context } = await buildServerContext({ userId: USER, workspaceId: WS, client: client() });
    expect(context.aiProviderEvents[0]).not.toHaveProperty('message');
    expect(prismaMock.aiProviderEvent.findMany.mock.calls[0][0].select).not.toHaveProperty('message');
  });

  it('marks an unreadable section as degraded instead of looking complete', async () => {
    prismaMock.aiProviderEvent.findMany.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { context } = await buildServerContext({ userId: USER, workspaceId: WS, client: client() });
    spy.mockRestore();
    expect(context.degraded).toContain('aiProviderEvents');
  });

  it('sanitizes client text and enforces the byte cap by dropping oldest items from the longest list', async () => {
    const big = {
      ...client(),
      breadcrumbs: Array.from({ length: 20 }, (_, i) => ({ t: i, kind: 'route', label: 'x'.repeat(80) })),
    };
    prismaMock.activity_logs.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ action: 'A'.repeat(80), created_at: new Date(1e12 - i), detail: { code: 'C'.repeat(60), action: 'D'.repeat(80) } })),
    );
    const { context } = await buildServerContext({ userId: USER, workspaceId: WS, client: big });
    expect(JSON.stringify(context).length).toBeLessThanOrEqual(32 * 1024);

    const tiny = structuredClone(context) as ServerContext;
    const fits = capContext(tiny, 3000);
    expect(fits).toBe(true);
    expect(JSON.stringify(tiny).length).toBeLessThanOrEqual(3000);
    // oldest dropped: breadcrumbs lose from the front, activity from the back
    if (tiny.client.breadcrumbs.length < 20) expect(tiny.client.breadcrumbs[0].t).toBeGreaterThan(0);
  });
});

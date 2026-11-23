import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, sessionMock, rateMock, ctxMock, logMock } = vi.hoisted(() => ({
  prismaMock: { bugReport: { create: vi.fn() } },
  sessionMock: { getSession: vi.fn() },
  rateMock: { consumeRateLimit: vi.fn() },
  ctxMock: { buildServerContext: vi.fn() },
  logMock: { writeActivityLog: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => sessionMock);
vi.mock('@/lib/rate-limit', () => rateMock);
vi.mock('@/lib/bug-report/context', () => ctxMock);
vi.mock('@/lib/activity-log', () => logMock);
const afterMock = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock('next/server', () => afterMock);
vi.mock('@/lib/action-errors', () => ({ actionError: async (k: string) => `err:${k}` }));

import { submitBugReport } from './bug-report';

const client = { route: '/en/growth/x', locale: 'en', viewport: { w: 1, h: 1 }, breadcrumbs: [], consoleErrors: [], viewedIds: {} };
const baseContext = (over: Record<string, unknown> = {}) => ({
  context: { ref: null, workspaceId: 'ws1', appVersion: 'abc1234', client: { route: '/en/growth/x', locale: 'en' }, ...over },
  causeCode: 'PROVIDER_OUT_OF_CREDIT',
  failedAction: 'startMatrixRun',
  sentryEventId: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  afterMock.after.mockImplementation((fn: () => unknown) => {
    void fn();
  });
  sessionMock.getSession.mockResolvedValue({ userId: 'u1' });
  rateMock.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
  ctxMock.buildServerContext.mockResolvedValue(baseContext());
  prismaMock.bugReport.create.mockResolvedValue({});
});

describe('submitBugReport', () => {
  it('requires a session', async () => {
    sessionMock.getSession.mockResolvedValue(null);
    expect(await submitBugReport({ client })).toEqual({ ok: false, error: 'err:notAuthenticated' });
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it('rate limits at 10 per hour per user', async () => {
    rateMock.consumeRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 100 });
    expect(await submitBugReport({ client })).toEqual({ ok: false, error: 'err:bugReportRateLimited' });
    expect(rateMock.consumeRateLimit).toHaveBeenCalledWith('bugreport:u1', 10, 3_600_000);
    expect(prismaMock.bugReport.create).not.toHaveBeenCalled();
  });

  it('stores a redacted, capped message with fingerprint, route and version, and logs BUG_REPORT_SENT', async () => {
    const r = await submitBugReport({ message: `  it broke sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123 ${'x'.repeat(2000)}`, client });
    expect(r.ok).toBe(true);
    const data = prismaMock.bugReport.create.mock.calls[0][0].data;
    expect(data.message).not.toContain('sk-proj');
    expect(data.message.length).toBeLessThanOrEqual(1000);
    expect(data).toMatchObject({ userId: 'u1', workspaceId: 'ws1', route: '/en/growth/x', locale: 'en', appVersion: 'abc1234' });
    expect(data.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(data.referenceCode).toMatch(/^CTV-[2-9A-HJKMNP-Z]{4}$/);
    expect(logMock.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'BUG_REPORT_SENT', detail: { ref: data.referenceCode } }));
    expect(r).toEqual({ ok: true, ref: data.referenceCode });
  });

  it('allows an empty message', async () => {
    expect((await submitBugReport({ message: '   ', client })).ok).toBe(true);
    expect(prismaMock.bugReport.create.mock.calls[0][0].data.message).toBeNull();
  });

  it('reuses a verified failure ref', async () => {
    ctxMock.buildServerContext.mockResolvedValue(baseContext({ ref: 'CTV-7F3K' }));
    const r = await submitBugReport({ ref: 'CTV-7F3K', client });
    expect(r).toEqual({ ok: true, ref: 'CTV-7F3K' });
    expect(prismaMock.bugReport.create.mock.calls[0][0].data.referenceCode).toBe('CTV-7F3K');
  });

  it('does not reuse a ref that did not verify', async () => {
    const r = await submitBugReport({ ref: 'CTV-7F3K', client });
    expect(r.ok && r.ref).not.toBe('CTV-7F3K');
  });

  it('falls back to a fresh ref when the failure ref is already used', async () => {
    ctxMock.buildServerContext.mockResolvedValue(baseContext({ ref: 'CTV-7F3K' }));
    prismaMock.bugReport.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const r = await submitBugReport({ ref: 'CTV-7F3K', client });
    expect(prismaMock.bugReport.create).toHaveBeenCalledTimes(2);
    expect(r.ok && r.ref).not.toBe('CTV-7F3K');
  });

  it('gives up after 5 unique violations with a friendly error', async () => {
    prismaMock.bugReport.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await submitBugReport({ client })).toEqual({ ok: false, error: 'err:bugReportFailed' });
    spy.mockRestore();
    expect(prismaMock.bugReport.create).toHaveBeenCalledTimes(5);
  });

  it('never throws: a database failure becomes a friendly error', async () => {
    prismaMock.bugReport.create.mockRejectedValue(new Error('connection refused'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await submitBugReport({ client })).toEqual({ ok: false, error: 'err:bugReportFailed' });
    spy.mockRestore();
    expect(logMock.writeActivityLog).not.toHaveBeenCalled();
  });
});

describe('submitBugReport speed', () => {
  it('replies without waiting for the BUG_REPORT_SENT row: it is handed to after()', async () => {
    afterMock.after.mockImplementation(() => {}); // the framework runs it later
    logMock.writeActivityLog.mockResolvedValue(undefined);
    const r = await submitBugReport({ client });
    expect(r.ok).toBe(true);
    expect(afterMock.after).toHaveBeenCalledTimes(1);
    expect(logMock.writeActivityLog).not.toHaveBeenCalled(); // runs only when after() runs it
    await afterMock.after.mock.calls[0][0]();
    expect(logMock.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'BUG_REPORT_SENT' }));
  });

  it('still writes the row (fire-and-forget) when after() is unavailable outside a request', async () => {
    afterMock.after.mockImplementation(() => {
      throw new Error('outside request scope');
    });
    logMock.writeActivityLog.mockResolvedValue(undefined);
    const r = await submitBugReport({ client });
    expect(r.ok).toBe(true);
    expect(logMock.writeActivityLog).toHaveBeenCalledTimes(1);
  });

  it('a failing activity write never fails the report', async () => {
    afterMock.after.mockImplementation(() => {
      throw new Error('outside request scope');
    });
    logMock.writeActivityLog.mockRejectedValue(new Error('db'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await submitBugReport({ client });
    await new Promise((res) => setTimeout(res, 0));
    spy.mockRestore();
    expect(r.ok).toBe(true);
  });
});

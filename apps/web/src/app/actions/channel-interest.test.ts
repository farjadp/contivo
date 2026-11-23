import { beforeEach, describe, expect, it, vi } from 'vitest';

// "Notify me" is demand data: one row per workspace and network, never for a
// workspace the caller does not own, never for a network we do not plan.

const { sessionMock, findWorkspaceMock, txExecute, txQuery, transactionMock, queryMock } = vi.hoisted(() => {
  const txExecute = vi.fn();
  const txQuery = vi.fn();
  return {
    sessionMock: vi.fn(),
    findWorkspaceMock: vi.fn(),
    txExecute,
    txQuery,
    transactionMock: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: txExecute, $queryRaw: txQuery })),
    queryMock: vi.fn(),
  };
});

vi.mock('@/lib/auth', () => ({ getSession: sessionMock }));
vi.mock('@/lib/activity-log', () => ({ ensureActivityLogTables: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => ({
  prisma: {
    workspace: { findFirst: findWorkspaceMock },
    $transaction: transactionMock,
    $queryRaw: queryMock,
  },
}));

import { listChannelNotices, requestChannelNotice } from './channel-interest';

/** The SQL text of a tagged-template call, values left out. */
const sql = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ userId: 'user-a' });
  findWorkspaceMock.mockResolvedValue({ id: 'ws-1' });
  txQuery.mockResolvedValue([]);
});

describe('requestChannelNotice', () => {
  it('records the workspace, network and time once', async () => {
    expect(await requestChannelNotice('ws-1', 'telegram')).toEqual({ ok: true });
    expect(findWorkspaceMock).toHaveBeenCalledWith({ where: { id: 'ws-1', userId: 'user-a' }, select: { id: true } });
    const insert = txExecute.mock.calls.find((call) => sql(call).includes('INSERT INTO activity_logs'));
    expect(insert).toBeDefined();
    expect(sql(insert!)).toContain('NOW()');
    expect(insert!.slice(1)).toEqual(expect.arrayContaining(['user-a', 'ws-1', 'CHANNEL_INTEREST', '{"network":"telegram"}']));
  });

  it('does not write a second row for the same workspace and network', async () => {
    txQuery.mockResolvedValue([{ id: 'existing' }]);
    expect(await requestChannelNotice('ws-1', 'x')).toEqual({ ok: true });
    expect(txExecute.mock.calls.some((call) => sql(call).includes('INSERT'))).toBe(false);
  });

  it('refuses a workspace the caller does not own', async () => {
    findWorkspaceMock.mockResolvedValue(null);
    expect(await requestChannelNotice('ws-other', 'x')).toEqual({ error: 'unauthorized' });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('refuses networks that are not planned, including Substack and Medium', async () => {
    for (const network of ['substack', 'medium', 'linkedin', '']) {
      expect(await requestChannelNotice('ws-1', network)).toEqual({ error: 'invalid' });
    }
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('refuses without a session', async () => {
    sessionMock.mockResolvedValue(null);
    expect(await requestChannelNotice('ws-1', 'x')).toEqual({ error: 'unauthorized' });
  });

  it('reports a failed write instead of pretending it worked', async () => {
    transactionMock.mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await requestChannelNotice('ws-1', 'x')).toEqual({ error: 'failed' });
  });
});

describe('listChannelNotices', () => {
  it('returns only known networks for an owned workspace', async () => {
    queryMock.mockResolvedValue([{ network: 'x' }, { network: 'bogus' }, { network: null }, { network: 'threads' }]);
    expect(await listChannelNotices('ws-1')).toEqual(['x', 'threads']);
  });

  it('returns nothing for a workspace the caller does not own', async () => {
    findWorkspaceMock.mockResolvedValue(null);
    expect(await listChannelNotices('ws-other')).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });
});

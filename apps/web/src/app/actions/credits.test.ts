import { beforeEach, describe, expect, it, vi } from 'vitest';

// "Request more credits": the only way a customer can ask for a top-up while
// buying credits is not possible. It writes one CREDITS_REQUESTED activity row
// per user per 24 hours, for a workspace the session user owns, and never
// reports success when the write failed. Prisma, the session and the log
// writer are mocked; the dedupe SQL itself is proven against the local DB.

const { prismaMock, sessionMock, recordMock, balanceMock } = vi.hoisted(() => ({
  prismaMock: { workspace: { findUnique: vi.fn() } },
  sessionMock: vi.fn(),
  recordMock: vi.fn(),
  balanceMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: sessionMock }));
vi.mock('@/lib/activity-log', () => ({ recordActivityOncePerWindow: recordMock }));
vi.mock('@/lib/credits', () => ({ getCreditBalance: balanceMock }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));

import { CREDITS_REQUESTED_ACTION, CREDIT_REQUEST_WINDOW_HOURS } from '@/lib/credit-requests';
import { requestMoreCredits } from './credits';

const OWNER = 'user-a';
const INTRUDER = 'user-b';
const WORKSPACE = 'ws-a';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workspace.findUnique.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === WORKSPACE && where.userId === OWNER ? { id: WORKSPACE } : null,
  );
  balanceMock.mockResolvedValue(4);
  recordMock.mockResolvedValue({ recorded: true });
});

describe('requestMoreCredits', () => {
  it('rejects a caller with no session and writes nothing', async () => {
    sessionMock.mockResolvedValue(null);

    const result = await requestMoreCredits(WORKSPACE);

    expect(result).toEqual({ error: 'notAuthenticated' });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("rejects a workspace the user does not own and writes nothing", async () => {
    sessionMock.mockResolvedValue({ userId: INTRUDER });

    const result = await requestMoreCredits(WORKSPACE);

    expect(result).toEqual({ error: 'workspaceNotFoundDot' });
    expect(prismaMock.workspace.findUnique).toHaveBeenCalledWith({
      where: { id: WORKSPACE, userId: INTRUDER },
      select: { id: true },
    });
    expect(recordMock).not.toHaveBeenCalled();
  });

  it('writes one CREDITS_REQUESTED row with the workspace and the balance, deduped per 24 h', async () => {
    sessionMock.mockResolvedValue({ userId: OWNER });

    const result = await requestMoreCredits(WORKSPACE);

    expect(result).toEqual({ status: 'requested' });
    expect(CREDIT_REQUEST_WINDOW_HOURS).toBe(24);
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock).toHaveBeenCalledWith({
      userId: OWNER,
      workspaceId: WORKSPACE,
      action: CREDITS_REQUESTED_ACTION,
      detail: { workspaceId: WORKSPACE, balance: 4 },
      windowHours: 24,
    });
    expect(CREDITS_REQUESTED_ACTION).toBe('CREDITS_REQUESTED');
  });

  it('says "already requested" when a request exists inside the window', async () => {
    sessionMock.mockResolvedValue({ userId: OWNER });
    const lastAt = new Date('2026-11-22T08:00:00.000Z');
    recordMock.mockResolvedValue({ recorded: false, lastAt });

    const result = await requestMoreCredits(WORKSPACE);

    expect(result).toEqual({ status: 'already_requested', requestedAt: lastAt.toISOString() });
  });

  it('returns an error rather than a confirmation when the write fails', async () => {
    sessionMock.mockResolvedValue({ userId: OWNER });
    recordMock.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await requestMoreCredits(WORKSPACE);

    expect(result).toEqual({ error: 'creditRequestFailed' });
    spy.mockRestore();
  });

  it('rejects an empty workspace id without touching the database', async () => {
    sessionMock.mockResolvedValue({ userId: OWNER });

    const result = await requestMoreCredits('');

    expect(result).toEqual({ error: 'workspaceNotFoundDot' });
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled();
  });
});

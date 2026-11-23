import { beforeEach, describe, expect, it, vi } from 'vitest';

// STEP_VIEWED from the non-workspace pages (spec §7): fire-and-forget, a
// closed tab list, and a page render must never fail because a log did.

const { writeMock } = vi.hoisted(() => ({ writeMock: vi.fn() }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: writeMock }));

import { logStepView } from './step-view';

beforeEach(() => {
  vi.clearAllMocks();
  writeMock.mockResolvedValue(undefined);
});

describe('logStepView', () => {
  it('writes STEP_VIEWED with the tab and workspace', () => {
    logStepView('user-1', 'today', 'ws-1');
    expect(writeMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      action: 'STEP_VIEWED',
      detail: { tab: 'today' },
    });
  });

  it('writes without a workspace for pages that have none', () => {
    logStepView('user-1', 'onboarding');
    expect(writeMock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: null, detail: { tab: 'onboarding' } }));
  });

  it('drops a tab outside the closed list', () => {
    logStepView('user-1', 'admin' as never);
    logStepView('user-1', '<script>' as never);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('drops a call without a user', () => {
    logStepView('', 'today');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('returns at once and never throws, even when the write rejects or throws', async () => {
    writeMock.mockRejectedValueOnce(new Error('db down'));
    expect(logStepView('user-1', 'today')).toBeUndefined();
    writeMock.mockImplementationOnce(() => {
      throw new Error('sync boom');
    });
    expect(() => logStepView('user-1', 'today')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});

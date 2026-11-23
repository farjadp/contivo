import { beforeEach, describe, expect, it, vi } from 'vitest';

// NEXT_STEP_CLICKED (spec §7): the client sends two strings; both are checked
// against closed lists and anything else writes nothing.

const { sessionMock, writeMock } = vi.hoisted(() => ({ sessionMock: vi.fn(), writeMock: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getSession: sessionMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: writeMock }));

import { recordNextStepClick } from './next-step';

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ userId: 'user-1' });
  writeMock.mockResolvedValue(undefined);
});

describe('recordNextStepClick', () => {
  it('writes NEXT_STEP_CLICKED with the step and surface', async () => {
    await recordNextStepClick('publishNow', 'workspace');
    expect(writeMock).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: null,
      action: 'NEXT_STEP_CLICKED',
      detail: { stepId: 'publishNow', surface: 'workspace' },
    });
  });

  it('a bad stepId writes no row', async () => {
    await recordNextStepClick('dropTables' as never, 'workspace');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('a bad surface writes no row', async () => {
    await recordNextStepClick('publishNow', 'https://evil.example' as never);
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('non-string input writes no row', async () => {
    await recordNextStepClick({ toString: () => 'publishNow' } as never, 'workspace');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('without a session writes no row', async () => {
    sessionMock.mockResolvedValue(null);
    await recordNextStepClick('publishNow', 'workspace');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('never throws when the write fails', async () => {
    writeMock.mockRejectedValue(new Error('db down'));
    await expect(recordNextStepClick('writeOwn', 'today')).resolves.toBeUndefined();
  });
});

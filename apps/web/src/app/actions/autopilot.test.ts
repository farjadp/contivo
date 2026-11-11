import { beforeEach, describe, expect, it, vi } from 'vitest';

// getAutopilotState reads agents, runs, social connections and sites for a
// client-supplied workspaceId. It must not read any of them for a workspace
// the session user does not own. Prisma and the session are mocked.

const { prismaMock, sessionMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findUnique: vi.fn() },
    autopilotPolicy: { findMany: vi.fn() },
    autopilotRun: { findMany: vi.fn() },
    socialConnection: { findMany: vi.fn() },
    siteConnection: { count: vi.fn() },
  },
  sessionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ getSession: sessionMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: vi.fn() }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));
vi.mock('@/lib/autopilot/runner', () => ({ runPolicy: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getAutopilotState } from './autopilot';

const OWNER = 'user-a';
const INTRUDER = 'user-b';
const WORKSPACE = 'ws-a';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workspace.findUnique.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === WORKSPACE && where.userId === OWNER ? { id: WORKSPACE } : null,
  );
  prismaMock.autopilotPolicy.findMany.mockResolvedValue([]);
  prismaMock.autopilotRun.findMany.mockResolvedValue([]);
  prismaMock.socialConnection.findMany.mockResolvedValue([
    { platform: 'LINKEDIN', accountName: 'Owner' },
  ]);
  prismaMock.siteConnection.count.mockResolvedValue(1);
});

describe('getAutopilotState', () => {
  it("returns an error and reads nothing for another user's workspace", async () => {
    sessionMock.mockResolvedValue({ userId: INTRUDER });

    const result = await getAutopilotState(WORKSPACE);

    expect(result).toEqual({ error: 'workspaceNotFoundDot' });
    expect(prismaMock.autopilotPolicy.findMany).not.toHaveBeenCalled();
    expect(prismaMock.autopilotRun.findMany).not.toHaveBeenCalled();
    expect(prismaMock.socialConnection.findMany).not.toHaveBeenCalled();
    expect(prismaMock.siteConnection.count).not.toHaveBeenCalled();
  });

  it('returns the state to the workspace owner', async () => {
    sessionMock.mockResolvedValue({ userId: OWNER });

    const result = await getAutopilotState(WORKSPACE);

    expect(result).toMatchObject({
      agents: [],
      policy: null,
      runs: [],
      connectedPlatforms: [{ platform: 'LINKEDIN', accountName: 'Owner' }],
      hasSiteConnection: true,
    });
  });
});

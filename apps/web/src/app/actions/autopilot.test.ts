import { beforeEach, describe, expect, it, vi } from 'vitest';

// getAutopilotState reads agents, runs, social connections and sites for a
// client-supplied workspaceId. It must not read any of them for a workspace
// the session user does not own. Prisma and the session are mocked.

const { prismaMock, sessionMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findUnique: vi.fn() },
    autopilotPolicy: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
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

import { getAutopilotState, saveAutopilotPolicy, type AutopilotPolicyInput } from './autopilot';

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

describe('saveAutopilotPolicy requireReview', () => {
  const AGENT = 'agent-1';
  const input: AutopilotPolicyInput & { agentId?: string } = {
    agentId: AGENT,
    enabled: true,
    postsPerWeek: 3,
    channels: ['linkedin'],
    timezone: 'America/Toronto',
    windowStartHour: 9,
    windowEndHour: 18,
    publishDays: [1, 2, 3],
  };
  const stored = {
    id: AGENT,
    name: 'Autopilot',
    recipeKey: null,
    enabled: true,
    postsPerWeek: 3,
    channels: ['linkedin'],
    timezone: 'America/Toronto',
    windowStartHour: 9,
    windowEndHour: 18,
    publishDays: [1, 2, 3],
    goal: null,
    topicHints: [],
    avoidTopics: [],
    storylineIds: [],
    requireReview: false,
    lastRunAt: null,
    nextRunAt: null,
  };

  beforeEach(() => {
    prismaMock.autopilotPolicy.findFirst.mockResolvedValue({ id: AGENT });
    prismaMock.autopilotPolicy.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...stored,
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    }));
  });

  it('persists requireReview for the owner and returns it', async () => {
    sessionMock.mockResolvedValue({ userId: OWNER });

    const result = await saveAutopilotPolicy(WORKSPACE, { ...input, requireReview: true });

    expect(prismaMock.autopilotPolicy.findFirst).toHaveBeenCalledWith({ where: { id: AGENT, workspaceId: WORKSPACE } });
    expect(prismaMock.autopilotPolicy.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: AGENT }, data: expect.objectContaining({ requireReview: true }) }),
    );
    expect(result).toMatchObject({ success: true, policy: { requireReview: true } });
  });

  it('leaves requireReview unchanged when the caller omits it', async () => {
    sessionMock.mockResolvedValue({ userId: OWNER });

    await saveAutopilotPolicy(WORKSPACE, input);

    const { data } = prismaMock.autopilotPolicy.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(data.requireReview).toBeUndefined();
  });

  it("rejects another user's workspace and writes nothing", async () => {
    sessionMock.mockResolvedValue({ userId: INTRUDER });

    const result = await saveAutopilotPolicy(WORKSPACE, { ...input, requireReview: true });

    expect(result).toEqual({ error: 'workspaceNotFoundDot' });
    expect(prismaMock.autopilotPolicy.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.autopilotPolicy.update).not.toHaveBeenCalled();
    expect(prismaMock.autopilotPolicy.create).not.toHaveBeenCalled();
  });
});

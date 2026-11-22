import { beforeEach, describe, expect, it, vi } from 'vitest';

// saveIdeaToPipelineCore is called with a client-supplied workspaceId (the
// server action) and by the autopilot runner. Either way it must refuse to
// write into a workspace the actor does not own. No database: prisma is mocked
// and the workspace lookup honours the { id, userId } filter it is given.

const { prismaMock, activityLogMock, frameworkLogMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findUnique: vi.fn() },
    contentItem: { create: vi.fn() },
  },
  activityLogMock: vi.fn(),
  frameworkLogMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('@/lib/framework-metadata-log', () => ({
  logFrameworkMetadata: frameworkLogMock,
  getLatestFrameworkMetadataForContentItem: vi.fn(),
}));
vi.mock('@/lib/gemini', () => ({
  generateContentIdeasWithGemini: vi.fn(),
  generateContentDraftWithGemini: vi.fn(),
}));
vi.mock('@/lib/humanize', () => ({ humanizeDraft: vi.fn() }));
vi.mock('@/lib/content-image', () => ({ generateImageForContentItem: vi.fn() }));
vi.mock('@/lib/narrative/context', () => ({
  loadStorylineContext: vi.fn(),
  storylinePromptBlock: vi.fn(),
}));
vi.mock('@/lib/app-settings', () => ({
  getContentWordCountLimits: vi.fn(),
  getDefaultScheduleDelayHours: vi.fn(),
  getIdeationMaxContentCount: vi.fn(),
}));

import { resolveChannelFromFormat, saveIdeaToPipelineCore } from './content-engine';

const OWNER = 'user-a';
const INTRUDER = 'user-b';
const WORKSPACE = 'ws-a';

const idea = { topic: 'Why audits matter', format: 'LinkedIn post', angle: 'x' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workspace.findUnique.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === WORKSPACE && where.userId === OWNER ? { id: WORKSPACE } : null,
  );
  prismaMock.contentItem.create.mockImplementation(async ({ data }: { data: { topic: string; channel: string } }) => ({
    id: 'item-1',
    topic: data.topic,
    channel: data.channel,
  }));
});

describe('saveIdeaToPipelineCore', () => {
  it("refuses to write into another user's workspace", async () => {
    const result = await saveIdeaToPipelineCore({ userId: INTRUDER, workspaceId: WORKSPACE }, idea);

    expect(result).toEqual({ error: 'Workspace not found' });
    expect(prismaMock.workspace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: WORKSPACE, userId: INTRUDER } }),
    );
    expect(prismaMock.contentItem.create).not.toHaveBeenCalled();
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('saves the idea for the workspace owner', async () => {
    const result = await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, idea);

    expect(result).toEqual({ success: true, id: 'item-1' });
    expect(prismaMock.contentItem.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.contentItem.create.mock.calls[0][0].data).toMatchObject({
      userId: OWNER,
      workspaceId: WORKSPACE,
      status: 'DRAFT',
    });
  });
});

describe('resolveChannelFromFormat', () => {
  // The old rule was format.includes('x'): any word with an x went to X.
  it.each([
    ['checklist', 'linkedin'],
    ['explainer', 'linkedin'],
    ['Text post', 'linkedin'],
    ['LinkedIn carousel', 'linkedin'],
    ['x thread', 'twitter'],
    ['X post', 'twitter'],
    ['twitter', 'twitter'],
    ['Tweet', 'twitter'],
    ['Twitter/X thread', 'twitter'],
    ['blog article', 'blog'],
    ['Long-form article', 'blog'],
    ['Email newsletter', 'email'],
    ['instagram caption', 'instagram'],
    ['', 'linkedin'],
    [undefined, 'linkedin'],
  ])('%s → %s', (format, channel) => {
    expect(resolveChannelFromFormat(format)).toBe(channel);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// saveIdeaToPipelineCore is called with a client-supplied workspaceId (the
// server action) and by the autopilot runner. Either way it must refuse to
// write into a workspace the actor does not own. No database: prisma is mocked
// and the workspace lookup honours the { id, userId } filter it is given.

const { prismaMock, activityLogMock, frameworkLogMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findUnique: vi.fn() },
    contentItem: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
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
const { ideasMock, draftMock } = vi.hoisted(() => ({ ideasMock: vi.fn(), draftMock: vi.fn() }));
vi.mock('@/lib/gemini', () => ({
  generateContentIdeasWithGemini: ideasMock,
  generateContentDraftWithGemini: draftMock,
}));
vi.mock('@/lib/report-readiness', () => ({
  matricesGate: () => ({ ok: true, competitorBasis: 'ACCEPTED' }),
}));
vi.mock('@/lib/humanize', () => ({ humanizeDraft: vi.fn() }));
vi.mock('@/lib/content-image', () => ({ generateImageForContentItem: vi.fn() }));
vi.mock('@/lib/narrative/context', () => ({
  loadStorylineContext: vi.fn(),
  storylinePromptBlock: vi.fn(),
}));
vi.mock('@/lib/app-settings', () => ({
  getContentWordCountLimits: vi.fn(async () => ({
    linkedin: { min: 100, max: 300 },
    blog: { min: 600, max: 1200 },
    twitter: { min: 50, max: 280 },
    email: { min: 150, max: 400 },
    instagram: { min: 50, max: 200 },
  })),
  getDefaultScheduleDelayHours: vi.fn(),
  getIdeationMaxContentCount: vi.fn(async () => 10),
}));

import {
  generateDraftForItem,
  generateDraftPreviewCore,
  ideateForWorkspace,
  resolveChannelFromFormat,
  resolveIdeaChannel,
  saveIdeaToPipelineCore,
} from './content-engine';

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
    // B6, the production repro: the model's format label for a LinkedIn idea.
    ['LinkedIn text post (strong opinion, reason, example)', 'linkedin'],
    ['X / Twitter thread', 'twitter'],
  ])('%s → %s', (format, channel) => {
    expect(resolveChannelFromFormat(format)).toBe(channel);
  });
});

describe('resolveIdeaChannel', () => {
  // B6: the platform the user picked in the Ideation form decides the channel.
  // The model-written format label is only a fallback for ideas without one.
  it.each([
    [{ selected_platform: 'linkedin', format: 'X / Twitter thread' }, 'linkedin'],
    [{ selected_platform: 'x', format: 'LinkedIn text post' }, 'twitter'],
    [{ selected_platform: 'blog', format: 'Text post' }, 'blog'],
    [{ selected_platform: 'email', format: 'Text post' }, 'email'],
    // Platforms with no publishing channel fall back to the format label.
    [{ selected_platform: 'landing_page', format: 'Blog article' }, 'blog'],
    [{ selected_platform: 'strategy_note', format: 'Text post' }, 'linkedin'],
    // Legacy ideas carry no platform.
    [{ format: 'X / Twitter thread' }, 'twitter'],
    [{ format: 'LinkedIn text post (strong opinion, reason, example)' }, 'linkedin'],
    [{}, 'linkedin'],
  ])('%j → %s', (input, channel) => {
    expect(resolveIdeaChannel(input)).toBe(channel);
  });
});

describe('Ideation → pipeline (B6/B7)', () => {
  const linkedinIdea = {
    topic: 'Why audits matter',
    angle: 'Most audits are theatre',
    format: 'LinkedIn text post (strong opinion, reason, example)',
    selected_platform: 'linkedin',
    target_word_count: 200,
  };

  it('saves a LinkedIn idea as linkedin even when the format mentions X', async () => {
    await saveIdeaToPipelineCore(
      { userId: OWNER, workspaceId: WORKSPACE },
      { ...linkedinIdea, format: 'X / Twitter thread' },
    );
    expect(prismaMock.contentItem.create.mock.calls[0][0].data.channel).toBe('linkedin');
  });

  it('saves the generated preview as a finished draft, not the outline', async () => {
    const preview = 'Most audits are theatre.\n\nHere is why, and what to do instead.';
    const result = await saveIdeaToPipelineCore(
      { userId: OWNER, workspaceId: WORKSPACE },
      { ...linkedinIdea, preview_text: preview },
    );

    expect(result).toEqual({ success: true, id: 'item-1' });
    const data = prismaMock.contentItem.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ channel: 'linkedin', content: preview, status: 'GENERATED' });
    // Not scheduled: the customer still reviews and approves before it publishes.
    expect(data.scheduledAtUtc).toBeUndefined();
    // No second model call.
    expect(draftMock).not.toHaveBeenCalled();
  });

  it('keeps the outline as a DRAFT when there is no preview', async () => {
    await saveIdeaToPipelineCore(
      { userId: OWNER, workspaceId: WORKSPACE },
      { ...linkedinIdea, preview_text: '   ' },
    );
    const data = prismaMock.contentItem.create.mock.calls[0][0].data;
    expect(data.status).toBe('DRAFT');
    expect(data.content).toContain('ANGLE/HOOK: Most audits are theatre');
  });

  it('passes the storyline id through', async () => {
    await saveIdeaToPipelineCore(
      { userId: OWNER, workspaceId: WORKSPACE },
      { ...linkedinIdea, storyline_id: 'story-1' },
    );
    expect(prismaMock.contentItem.create.mock.calls[0][0].data.storylineId).toBe('story-1');
  });

  it('generates the preview for the chosen platform with LinkedIn word counts', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: WORKSPACE,
      userId: OWNER,
      contentLanguage: 'en',
      brandSummary: { industry: 'Dental clinic' },
    });
    draftMock.mockResolvedValue('A full LinkedIn post.');

    const result = await generateDraftPreviewCore({ userId: OWNER, workspaceId: WORKSPACE }, linkedinIdea);

    expect(result).toMatchObject({ success: true, channel: 'linkedin', preview: 'A full LinkedIn post.' });
    expect(draftMock.mock.calls[0][3]).toBe('linkedin');
    expect(draftMock.mock.calls[0][4].wordCount).toMatchObject({ platform: 'linkedin', min: 100, max: 300 });
  });
});

/*
  When the AI provider chain fails, the generators return null. They used to
  return template text that was then saved, scheduled and published. These
  pin that a null leaves the database untouched.
*/
describe('AI chain failure (generators return null)', () => {
  const ownedWorkspace = {
    id: WORKSPACE,
    userId: OWNER,
    contentLanguage: 'en',
    brandSummary: { industry: 'Dental clinic' },
    audienceInsights: {
      competitiveMatrices: { charts: [{}] },
      competitorKeywordsIntel: { competitors: [{ competitor: 'X' }] },
    },
    contentItems: [{ id: 'item-1', topic: 'Why audits matter', channel: 'LINKEDIN', content: '', storylineId: null }],
  };

  beforeEach(() => {
    prismaMock.workspace.findUnique.mockResolvedValue(ownedWorkspace);
  });

  it('generateDraftForItem returns an error and writes nothing', async () => {
    draftMock.mockResolvedValue(null);

    const result = await generateDraftForItem({ userId: OWNER, workspaceId: WORKSPACE }, 'item-1');

    expect(result).toEqual({ error: 'AI generation failed' });
    expect(draftMock).toHaveBeenCalledTimes(1);
    // The call carries who the usage/alerts belong to.
    expect(draftMock.mock.calls[0][7]).toEqual({ userId: OWNER, workspaceId: WORKSPACE });
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
    expect(prismaMock.contentItem.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.contentItem.create).not.toHaveBeenCalled();
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('generateDraftPreviewCore returns an error and logs nothing', async () => {
    draftMock.mockResolvedValue(null);

    const result = await generateDraftPreviewCore({ userId: OWNER, workspaceId: WORKSPACE }, idea);

    expect(result).toEqual({ error: 'AI generation failed' });
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('ideateForWorkspace returns an error and logs nothing', async () => {
    ideasMock.mockResolvedValue(null);

    const result = await ideateForWorkspace({ userId: OWNER, workspaceId: WORKSPACE });

    expect(result).toEqual({ error: 'Failed to generate ideas.' });
    expect(ideasMock.mock.calls[0][2]).toEqual({ userId: OWNER, workspaceId: WORKSPACE });
    expect(activityLogMock).not.toHaveBeenCalled();
    expect(frameworkLogMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

// saveIdeaToPipelineCore is called with a client-supplied workspaceId (the
// server action) and by the autopilot runner. Either way it must refuse to
// write into a workspace the actor does not own. No database: prisma is mocked
// and the workspace lookup honours the { id, userId } filter it is given.

const { prismaMock, activityLogMock, frameworkLogMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findUnique: vi.fn() },
    contentItem: { create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(async () => 0), findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
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
const { evaluateMock } = vi.hoisted(() => ({ evaluateMock: vi.fn() }));
vi.mock('@/lib/autopilot/quality-gate', () => ({ evaluateDraft: evaluateMock }));
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
  getDefaultScheduleDelayHours: vi.fn(async () => 24),
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
  process.env.JWT_SECRET = 'test-secret';
  prismaMock.contentItem.findMany.mockResolvedValue([]);
  prismaMock.contentItem.count.mockResolvedValue(0);
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
    ['telegram', 'telegram'],
    ['Telegram channel post', 'telegram'],
    ['LinkedIn text post with an expert example', 'linkedin'],
    ['', 'linkedin'],
    [undefined, 'linkedin'],
  ])('%s → %s', (format, channel) => {
    expect(resolveChannelFromFormat(format)).toBe(channel);
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

/*
  B6 (e2e handover 2026-11-22): a LinkedIn idea was saved as an X post because
  the channel was guessed from the model's format text. The platform the user
  picked is now carried on the idea and always wins.
*/
describe('resolveIdeaChannel', () => {
  it('uses the stamped channel over a format that names another channel', () => {
    expect(resolveIdeaChannel({ channel: 'linkedin', format: 'X thread' })).toBe('linkedin');
  });
  it('maps the ideation platform value x to twitter', () => {
    expect(resolveIdeaChannel({ platform: 'x', format: 'LinkedIn post' })).toBe('twitter');
  });
  it('falls back to the format for ideas with no channel', () => {
    expect(resolveIdeaChannel({ format: 'LinkedIn text post … example' })).toBe('linkedin');
    expect(resolveIdeaChannel({ channel: 'landing_page', format: 'blog article' })).toBe('blog');
  });
  it('keeps telegram and threads when chosen explicitly (autopilot runner)', () => {
    expect(resolveIdeaChannel({ channel: 'telegram', format: 'LinkedIn post' })).toBe('telegram');
    expect(resolveIdeaChannel({ channel: 'threads', format: 'LinkedIn post' })).toBe('threads');
  });
  it('ignores prototype keys', () => {
    expect(resolveIdeaChannel({ channel: 'constructor', format: '' })).toBe('linkedin');
  });
});

describe('LinkedIn idea → preview → pipeline (B6, B7)', () => {
  const ownedWorkspace = {
    id: WORKSPACE,
    userId: OWNER,
    contentLanguage: 'en',
    brandSummary: { industry: 'Dental clinic' },
    audienceInsights: {
      competitiveMatrices: { charts: [{}] },
      competitorKeywordsIntel: { competitors: [{ competitor: 'X' }] },
    },
  };
  const modelIdea = { topic: 'Why audits matter', format: 'LinkedIn text post with one example (X-ray of a clinic)', angle: 'a' };

  beforeEach(() => {
    prismaMock.workspace.findUnique.mockResolvedValue(ownedWorkspace);
  });

  it('ideation stamps the chosen platform on every idea', async () => {
    ideasMock.mockResolvedValue({
      ideas: [modelIdea, { ...modelIdea, format: 'Twitter-style hook' }],
      framework: { framework_id: 'f', framework_name: 'F' },
      quality_scores: {},
      fallback_used: false,
      fallback_framework_id: null,
    });

    const result = await ideateForWorkspace({ userId: OWNER, workspaceId: WORKSPACE }, { platform: 'linkedin' });

    expect('ideas' in result && result.ideas?.map((i) => i.channel)).toEqual(['linkedin', 'linkedin']);
  });

  it('the preview is drafted for the stamped channel', async () => {
    draftMock.mockResolvedValue('The full post.');

    const result = await generateDraftPreviewCore(
      { userId: OWNER, workspaceId: WORKSPACE },
      { ...modelIdea, format: 'X-style thread', channel: 'linkedin' },
    );

    expect(result).toMatchObject({ success: true, channel: 'linkedin', preview: 'The full post.' });
    expect(draftMock.mock.calls[0][3]).toBe('linkedin');
    expect(draftMock.mock.calls[0][4].wordCount.platform).toBe('linkedin');
  });

  it('saves the stamped channel, not one guessed from the format', async () => {
    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, { ...modelIdea, format: 'X thread', channel: 'linkedin' });

    expect(prismaMock.contentItem.create.mock.calls[0][0].data).toMatchObject({ channel: 'linkedin', status: 'DRAFT' });
  });

  it('keeps a generated preview as the body, status GENERATED', async () => {
    await saveIdeaToPipelineCore(
      { userId: OWNER, workspaceId: WORKSPACE },
      { ...modelIdea, channel: 'linkedin' },
      { body: '  The full 265-word post.  ' },
    );

    expect(prismaMock.contentItem.create.mock.calls[0][0].data).toMatchObject({
      channel: 'linkedin',
      content: 'The full 265-word post.',
      status: 'GENERATED',
    });
    expect(activityLogMock.mock.calls[0][0].detail).toMatchObject({ fromPreview: true });
  });

  it('saves the outline when there is no preview (or a blank one)', async () => {
    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, modelIdea, { body: '   ' });

    const data = prismaMock.contentItem.create.mock.calls[0][0].data;
    expect(data.status).toBe('DRAFT');
    expect(data.content).toMatch(/^ANGLE\/HOOK: /);
  });

  it('refuses a preview body over the size limit', async () => {
    const result = await saveIdeaToPipelineCore(
      { userId: OWNER, workspaceId: WORKSPACE },
      modelIdea,
      { body: 'a'.repeat(100_001) },
    );

    expect(result).toEqual({ error: 'Preview is too long to save.' });
    expect(prismaMock.contentItem.create).not.toHaveBeenCalled();
  });
});

// B15: LinkedIn and X show markdown as typed, so social bodies are stored plain.
describe('social drafts are stored as plain text (B15)', () => {
  beforeEach(() => {
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: WORKSPACE,
      userId: OWNER,
      contentLanguage: 'en',
      brandSummary: { industry: 'Dental clinic' },
    });
  });

  it('preview and saved preview drop markdown for LinkedIn', async () => {
    draftMock.mockResolvedValue('**Hook line.**\n\n- one\n- two\n\n#Tag');
    const result = await generateDraftPreviewCore({ userId: OWNER, workspaceId: WORKSPACE }, { topic: 'T', channel: 'linkedin' });
    expect(result).toMatchObject({ preview: 'Hook line.\n\n• one\n• two\n\n#Tag' });

    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, { topic: 'T', channel: 'linkedin' }, { body: '**Bold** text' });
    expect(prismaMock.contentItem.create.mock.calls[0][0].data.content).toBe('Bold text');
  });

  it('a blog preview keeps its markdown', async () => {
    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, { topic: 'T', channel: 'blog' }, { body: '## Heading\n\n**Bold**' });
    expect(prismaMock.contentItem.create.mock.calls[0][0].data.content).toBe('## Heading\n\n**Bold**');
  });
});

describe('pipeline generation stores plain text for LinkedIn (B15)', () => {
  it('generateDraftForItem converts the body before saving', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: WORKSPACE,
      userId: OWNER,
      contentLanguage: 'en',
      brandSummary: { industry: 'Dental clinic' },
      audienceInsights: {
        competitiveMatrices: { charts: [{}] },
        competitorKeywordsIntel: { competitors: [{ competitor: 'X' }] },
      },
      contentItems: [{ id: 'item-1', topic: 'T', channel: 'linkedin', content: '', storylineId: null }],
    });
    draftMock.mockResolvedValue('## Why\n\n**Short** answer.');
    prismaMock.contentItem.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'item-1',
      topic: 'T',
      channel: 'linkedin',
      ...data,
    }));

    await generateDraftForItem({ userId: OWNER, workspaceId: WORKSPACE }, 'item-1');

    expect(prismaMock.contentItem.update).toHaveBeenCalled();
    expect(prismaMock.contentItem.update.mock.calls[0][0].data.content).toBe('Why\n\nShort answer.');
  });
});

/*
  B8: AI drafts made by hand are quality-gated once per generated text, and a
  failed draft is never left SCHEDULED.
*/
describe('quality gate on manual drafts (B8)', () => {
  const PASS = { approved: true, rejectedBy: null, reasons: [], checks: [], scores: null, judge: 'openai', judgeModel: 'm1' };
  const FAIL = { approved: false, rejectedBy: 'low_score', reasons: ['Below threshold: clarity 4/10.'], checks: [], scores: null, judge: 'openai', judgeModel: 'm1' };
  const ws = {
    id: WORKSPACE,
    userId: OWNER,
    contentLanguage: 'EN',
    brandSummary: { industry: 'Dental clinic' },
    contentItems: [{ id: 'item-1', topic: 'Why audits matter', channel: 'linkedin', content: '', storylineId: null, scheduledAtUtc: null, scheduledTimezone: null }],
  };

  beforeEach(() => {
    prismaMock.workspace.findUnique.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === WORKSPACE && where.userId === OWNER ? ws : null,
    );
    prismaMock.contentItem.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'item-1', topic: 'Why audits matter', channel: 'linkedin', ...data }));
    draftMock.mockResolvedValue('A finished LinkedIn post body.');
  });

  it('preview: gates once and returns the verdict with a token', async () => {
    evaluateMock.mockResolvedValue(FAIL);
    const result: any = await generateDraftPreviewCore({ userId: OWNER, workspaceId: WORKSPACE }, idea);
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(evaluateMock.mock.calls[0][0]).toMatchObject({ content: 'A finished LinkedIn post body.', channel: 'linkedin', aiContext: { userId: OWNER, workspaceId: WORKSPACE } });
    expect(result.verdict).toMatchObject({ approved: false, rejectedBy: 'low_score', source: 'preview' });
    expect(typeof result.verdictToken).toBe('string');
  });

  it('preview: a judge provider failure is a fail, not a pass', async () => {
    evaluateMock.mockRejectedValue(new Error('provider down'));
    const result: any = await generateDraftPreviewCore({ userId: OWNER, workspaceId: WORKSPACE }, idea);
    expect(result.verdict).toMatchObject({ approved: false, rejectedBy: 'gate_unavailable' });
  });

  it('save: a valid token stores the preview verdict with no second gate call', async () => {
    evaluateMock.mockResolvedValue(PASS);
    const preview: any = await generateDraftPreviewCore({ userId: OWNER, workspaceId: WORKSPACE }, idea);
    evaluateMock.mockClear();
    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, idea, { body: preview.preview, verdictToken: preview.verdictToken });
    expect(evaluateMock).not.toHaveBeenCalled();
    const data = prismaMock.contentItem.create.mock.calls[0][0].data;
    expect(data.status).toBe('GENERATED');
    expect(data.qualityVerdict).toMatchObject({ approved: true, source: 'preview' });
  });

  it('save: changed text or a missing token stores not_checked, with no gate call', async () => {
    evaluateMock.mockResolvedValue(PASS);
    const preview: any = await generateDraftPreviewCore({ userId: OWNER, workspaceId: WORKSPACE }, idea);
    evaluateMock.mockClear();
    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, idea, { body: `${preview.preview} edited`, verdictToken: preview.verdictToken });
    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, idea, { body: preview.preview });
    expect(evaluateMock).not.toHaveBeenCalled();
    for (const call of prismaMock.contentItem.create.mock.calls) {
      expect(call[0].data.qualityVerdict).toMatchObject({ approved: false, rejectedBy: 'not_checked' });
    }
  });

  it('save without a preview (outline only) stays ungated', async () => {
    await saveIdeaToPipelineCore({ userId: OWNER, workspaceId: WORKSPACE }, idea);
    expect(prismaMock.contentItem.create.mock.calls[0][0].data.qualityVerdict).toBeUndefined();
  });

  it('pipeline generate: a pass is SCHEDULED with the verdict stored', async () => {
    evaluateMock.mockResolvedValue(PASS);
    await generateDraftForItem({ userId: OWNER, workspaceId: WORKSPACE }, 'item-1');
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    const data = prismaMock.contentItem.update.mock.calls[0][0].data;
    expect(data.status).toBe('SCHEDULED');
    expect(data.scheduledAtUtc).toBeInstanceOf(Date);
    expect(data.qualityVerdict).toMatchObject({ approved: true, source: 'pipeline' });
  });

  it('pipeline generate: a fail is GENERATED with no schedule', async () => {
    evaluateMock.mockResolvedValue(FAIL);
    await generateDraftForItem({ userId: OWNER, workspaceId: WORKSPACE }, 'item-1');
    const data = prismaMock.contentItem.update.mock.calls[0][0].data;
    expect(data.status).toBe('GENERATED');
    expect(data.scheduledAtUtc).toBeNull();
    expect(data.qualityVerdict).toMatchObject({ approved: false, rejectedBy: 'low_score' });
  });

  it('autopilot source: no gate call here (the runner gates), still SCHEDULED', async () => {
    await generateDraftForItem({ userId: OWNER, workspaceId: WORKSPACE }, 'item-1', { source: 'autopilot' });
    expect(evaluateMock).not.toHaveBeenCalled();
    expect(prismaMock.contentItem.update.mock.calls[0][0].data.status).toBe('SCHEDULED');
  });
});

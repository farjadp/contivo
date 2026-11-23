import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  workspaceFindFirst: vi.fn(),
  socialFindMany: vi.fn(),
  siteCount: vi.fn(),
  policyCount: vi.fn(),
  storylineCount: vi.fn(),
  contentCount: vi.fn(),
  loadGuidedMode: vi.fn(),
  readKillSwitch: vi.fn(),
  loadFirstPostState: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    workspace: { findFirst: m.workspaceFindFirst },
    socialConnection: { findMany: m.socialFindMany },
    siteConnection: { count: m.siteCount },
    autopilotPolicy: { count: m.policyCount },
    storyline: { count: m.storylineCount },
    contentItem: { count: m.contentCount },
  },
}));
vi.mock('@/lib/first-post/mode', () => ({ loadGuidedMode: m.loadGuidedMode, readKillSwitch: m.readKillSwitch }));
vi.mock('@/lib/first-post/load', () => ({ loadFirstPostState: m.loadFirstPostState }));

import { buildNextStep } from './next-step';
import { loadNextStepInput, workspaceFactsFrom } from './next-step-load';

/** Four charts on a confirmed basis: what matricesGate accepts. */
const READY_MATRICES = {
  competitiveMatrices: {
    pipeline: 'v2',
    charts: [{}, {}, {}, {}],
  },
};

const WORKSPACE = {
  id: 'ws1',
  brandSummary: { industry: 'saas' },
  audienceInsights: {
    competitorKeywordsIntel: { competitors: [{ name: 'a' }, { name: 'b' }] },
  },
  competitors: [
    { userDecision: 'ACCEPTED' },
    { userDecision: 'ACCEPTED' },
    { userDecision: 'PENDING' },
    { userDecision: null },
    { userDecision: 'REJECTED' },
  ],
};

const DRAFT_LOAD = {
  state: { phase: 'draft', contentItemId: 'c1', approved: true, linkedIn: { connected: true, accountName: 'Sara' } },
  facts: {},
  draft: { id: 'c1', content: 'text', topic: 't', qualityVerdict: null },
  why: { matrixCharts: 4, matricesReady: true, keywordCompetitors: 2, gaps: 1, topGap: 'x' },
  otherAnglesUsed: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.readKillSwitch.mockReturnValue(false);
  m.loadGuidedMode.mockResolvedValue(true);
  m.workspaceFindFirst.mockResolvedValue(WORKSPACE);
  m.socialFindMany.mockResolvedValue([]);
  m.siteCount.mockResolvedValue(0);
  m.policyCount.mockResolvedValue(0);
  m.storylineCount.mockResolvedValue(0);
  m.contentCount.mockResolvedValue(0);
  m.loadFirstPostState.mockResolvedValue(DRAFT_LOAD);
});

describe('loadNextStepInput', () => {
  it('returns null and reads nothing when the kill switch is on', async () => {
    m.readKillSwitch.mockReturnValue(true);
    await expect(loadNextStepInput('u1', 'ws1', 'workspace')).resolves.toBeNull();
    expect(m.loadGuidedMode).not.toHaveBeenCalled();
    expect(m.workspaceFindFirst).not.toHaveBeenCalled();
    expect(m.loadFirstPostState).not.toHaveBeenCalled();
  });

  it('has no facts for a user with no workspace, and the bar asks for a company', async () => {
    const load = await loadNextStepInput('u1', null, 'today');
    expect(load).not.toBeNull();
    expect(load!.input).toEqual({ guided: true, facts: null, firstPost: null, surface: 'today' });
    expect(m.workspaceFindFirst).not.toHaveBeenCalled();
    expect(buildNextStep({ ...load!.input, onFirstPostTab: false })?.id).toBe('addCompany');
  });

  it('checks ownership: someone else\'s workspace gives no facts and no first-post read', async () => {
    m.workspaceFindFirst.mockResolvedValue(null);
    const load = await loadNextStepInput('u1', 'ws-other', 'workspace');
    expect(m.workspaceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws-other', userId: 'u1' } }),
    );
    expect(load!.input.facts).toBeNull();
    expect(m.loadFirstPostState).not.toHaveBeenCalled();
  });

  it('builds the facts the way the workspace page does', async () => {
    m.workspaceFindFirst.mockResolvedValue({ ...WORKSPACE, audienceInsights: { ...WORKSPACE.audienceInsights, ...READY_MATRICES } });
    m.socialFindMany.mockResolvedValue([{ platform: 'LINKEDIN' }]);
    m.storylineCount.mockResolvedValue(3);
    m.policyCount.mockResolvedValue(1);
    m.contentCount.mockImplementation(async ({ where }: { where: { status: string } }) =>
      where.status === 'PUBLISHED' ? 2 : 5,
    );

    const load = await loadNextStepInput('u1', 'ws1', 'workspace');
    const facts = load!.input.facts!;
    expect(facts).toMatchObject({
      workspaceId: 'ws1',
      hasBrandSummary: true,
      acceptedCompetitors: 2,
      totalCompetitors: 4,
      matrixCharts: 4,
      keywordCompetitors: 2,
      storylines: 3,
      hasChannel: true,
      channelLabel: 'LINKEDIN',
      autopilotEnabled: true,
      publishedCount: 2,
      scheduledCount: 5,
    });
    // Same channel rule as getAutopilotState: connected AND default.
    expect(m.socialFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws1', status: 'CONNECTED', isDefault: true } }),
    );
    expect(m.siteCount).toHaveBeenCalledWith({ where: { workspaceId: 'ws1', status: 'ACTIVE' } });
    expect(m.policyCount).toHaveBeenCalledWith({ where: { workspaceId: 'ws1', enabled: true } });
  });

  it('in guided mode reads the first-post state and hands it to the bar', async () => {
    const load = await loadNextStepInput('u1', 'ws1', 'workspace');
    expect(m.loadFirstPostState).toHaveBeenCalledWith('u1', 'ws1');
    expect(load!.input.firstPost).toEqual(DRAFT_LOAD.state);
    expect(load!.firstPost).toBe(DRAFT_LOAD);
    expect(buildNextStep({ ...load!.input, onFirstPostTab: true })?.id).toBe('publishNow');
  });

  it('in guided mode lets a first-post read error through instead of showing a wrong step', async () => {
    m.loadFirstPostState.mockRejectedValue(new Error('db down'));
    await expect(loadNextStepInput('u1', 'ws1', 'today')).rejects.toThrow('db down');
  });

  it('in open mode skips the first-post read on Today and Connections', async () => {
    m.loadGuidedMode.mockResolvedValue(false);
    const today = await loadNextStepInput('u1', 'ws1', 'today');
    const connections = await loadNextStepInput('u1', 'ws1', 'connections');
    expect(m.loadFirstPostState).not.toHaveBeenCalled();
    expect(today!.input.guided).toBe(false);
    expect(today!.input.firstPost).toBeNull();
    expect(connections!.input.firstPost).toBeNull();
  });

  it('in open mode still reads it on the workspace surfaces, so the live link survives a reload', async () => {
    m.loadGuidedMode.mockResolvedValue(false);
    const published = {
      ...DRAFT_LOAD,
      state: { phase: 'published', contentItemId: 'c1', url: 'https://www.linkedin.com/feed/update/1', publishedAtUtc: null },
    };
    m.loadFirstPostState.mockResolvedValue(published);
    const load = await loadNextStepInput('u1', 'ws1', 'connected');
    expect(load!.input.firstPost).toEqual(published.state);
    expect(buildNextStep({ ...load!.input, onFirstPostTab: true })?.id).toBe('firstPostLive');
  });

  it('in open mode drops a first-post read error: the published user keeps a working page', async () => {
    m.loadGuidedMode.mockResolvedValue(false);
    m.loadFirstPostState.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const load = await loadNextStepInput('u1', 'ws1', 'workspace');
    expect(load!.input.firstPost).toBeNull();
    expect(load!.firstPost).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('workspaceFactsFrom', () => {
  it('names a website when only a site is connected, and nothing when neither is', () => {
    const base = { connections: [], siteCount: 0, autopilotEnabled: false, storylines: 0, publishedCount: 0, scheduledCount: 0 };
    expect(workspaceFactsFrom(WORKSPACE, { ...base, siteCount: 1 })).toMatchObject({ hasChannel: true, channelLabel: 'Website' });
    expect(workspaceFactsFrom(WORKSPACE, base)).toMatchObject({ hasChannel: false, channelLabel: null });
    expect(workspaceFactsFrom({ ...WORKSPACE, brandSummary: null, audienceInsights: null }, base)).toMatchObject({
      hasBrandSummary: false,
      matrixCharts: 0,
      matricesReady: false,
      keywordCompetitors: 0,
    });
  });

  it('joins several platforms the way the workspace page labels them', () => {
    const facts = workspaceFactsFrom(WORKSPACE, {
      connections: [{ platform: 'LINKEDIN' }, { platform: 'X' }],
      siteCount: 1,
      autopilotEnabled: false,
      storylines: 0,
      publishedCount: 0,
      scheduledCount: 0,
    });
    expect(facts.channelLabel).toBe('LINKEDIN, X');
  });
});

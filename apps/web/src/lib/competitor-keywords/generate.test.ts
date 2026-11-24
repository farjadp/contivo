import { beforeEach, describe, expect, it, vi } from 'vitest';

// The session-less core behind generateWorkspaceCompetitorKeywords. It takes an
// actor, never a session, and returns error KEYS (the action translates them).

const { prismaMock, activityLogMock, runAiTaskMock, siteSignalsMock } = vi.hoisted(() => ({
  runAiTaskMock: vi.fn(),
  prismaMock: { workspace: { findUnique: vi.fn(), update: vi.fn() } },
  activityLogMock: vi.fn(),
  siteSignalsMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('@/lib/competitors/site-signals', () => ({ collectSiteSignals: siteSignalsMock }));

import { generateCompetitorKeywordsCore } from './generate';

const actor = { userId: 'user-1', workspaceId: 'ws-1' };

function competitor(name: string, domain: string) {
  return { name, domain, type: 'DIRECT', userDecision: 'ACCEPTED', confidence: null, sources: [], evidence: null };
}

function workspace() {
  return {
    id: 'ws-1',
    userId: 'user-1',
    name: 'Acme',
    websiteUrl: 'https://acme.com',
    brandSummary: {},
    audienceInsights: { competitiveMatrices: { run_id: 'r1' } },
    competitors: [competitor('Alpha', 'alpha.com'), competitor('Beta', 'beta.com')],
  };
}

function aiOk(json: unknown) {
  return {
    ok: true as const,
    provider: 'openai' as const,
    model: 'gpt-4.1',
    json,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  };
}

const intel = (domain: string) => ({
  competitor: domain,
  domain,
  primary_keywords: ['content calendar'],
  secondary_keywords: ['editorial workflow'],
});

const GAP = { topic: 'Audit checklists', competitor_weakness: 'none write them', audience_importance: 'buyers ask' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.workspace.findUnique.mockResolvedValue(workspace());
  prismaMock.workspace.update.mockResolvedValue({});
  siteSignalsMock.mockImplementation(async (domain: string) => ({ domain, pages_scanned: ['/'], evidence: `${domain} text` }));
});

describe('generateCompetitorKeywordsCore', () => {
  it('loads the workspace through the actor (owner-scoped)', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue(null);
    expect(await generateCompetitorKeywordsCore(actor)).toEqual({ ok: false, errorKey: 'workspaceNotFound' });
    expect(prismaMock.workspace.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws-1', userId: 'user-1' } }),
    );
  });

  it('needs 2 selected competitors', async () => {
    prismaMock.workspace.findUnique.mockResolvedValue({ ...workspace(), competitors: [competitor('Alpha', 'alpha.com')] });
    expect(await generateCompetitorKeywordsCore(actor)).toEqual({ ok: false, errorKey: 'needTwoReviewed' });
  });

  it('returns notEnoughCompetitorSignals when fewer than 2 sites could be read, without calling the model', async () => {
    siteSignalsMock.mockImplementation(async (domain: string) => ({
      domain,
      pages_scanned: [],
      evidence: domain === 'alpha.com' ? 'text' : '',
    }));
    expect(await generateCompetitorKeywordsCore(actor)).toEqual({ ok: false, errorKey: 'notEnoughCompetitorSignals' });
    expect(runAiTaskMock).not.toHaveBeenCalled();
  });

  it('saves a good result into audienceInsights, keeping the other keys, and returns the payload', async () => {
    runAiTaskMock.mockResolvedValue(aiOk({ competitors: [intel('alpha.com'), intel('beta.com')], content_gaps: [GAP] }));

    const result = await generateCompetitorKeywordsCore(actor);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.competitors).toHaveLength(2);
    expect(result.payload.content_gaps[0].topic).toBe('Audit checklists');
    const saved = prismaMock.workspace.update.mock.calls[0][0].data.audienceInsights;
    expect(saved.competitiveMatrices).toEqual({ run_id: 'r1' });
    expect(saved.competitorKeywordsIntel.competitor_basis).toBe('ACCEPTED');
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMPETITOR_KEYWORDS_GENERATED', userId: 'user-1', workspaceId: 'ws-1' }),
    );
  });

  it('an AI outage saves nothing and returns a key', async () => {
    runAiTaskMock.mockResolvedValue({ ok: false, kind: 'all_unavailable', attempts: [], firstErrorClass: 'billing', allRateLimited: false });
    expect(await generateCompetitorKeywordsCore(actor)).toEqual({ ok: false, errorKey: 'keywordsFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('a thrown error is returned as keywordsFailed, not thrown', async () => {
    prismaMock.workspace.findUnique.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await generateCompetitorKeywordsCore(actor)).toEqual({ ok: false, errorKey: 'keywordsFailed' });
    spy.mockRestore();
  });
});

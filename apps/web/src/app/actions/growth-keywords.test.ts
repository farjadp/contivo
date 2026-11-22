import { beforeEach, describe, expect, it, vi } from 'vitest';

// An AI failure must never be saved as a result (spec 2026-09-29, D1), and a
// missing intent split is null, never a made-up 55/20/15/10 (D2). No network,
// no database: prisma, the session, site reading and fetch are mocked.

const { prismaMock, activityLogMock, runAiTaskMock } = vi.hoisted(() => ({
  runAiTaskMock: vi.fn(),
  prismaMock: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
  },
  activityLogMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/ai', () => ({ runAiTask: runAiTaskMock }));
vi.mock('@/lib/auth', () => ({ getSession: vi.fn(async () => ({ userId: 'user-1' })) }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('@/lib/action-errors', () => ({ actionError: vi.fn(async (key: string) => key) }));
vi.mock('@/lib/competitors/site-signals', () => ({
  collectSiteSignals: vi.fn(async (domain: string) => ({
    domain,
    pages_scanned: ['/'],
    evidence: `${domain} sells content planning software for marketing teams`,
  })),
}));

import { generateWorkspaceCompetitorKeywords } from './growth-keywords';

const fetchMock = vi.fn();

function competitor(name: string, domain: string) {
  return {
    name,
    domain,
    type: 'DIRECT',
    description: '',
    category: '',
    audienceGuess: '',
    userDecision: 'ACCEPTED',
    confidence: null,
    sources: [],
    evidence: null,
  };
}

const PREVIOUS = { competitors: [{ domain: 'old.com' }], content_gaps: [] };

function workspace() {
  return {
    id: 'ws-1',
    userId: 'user-1',
    name: 'Acme',
    websiteUrl: 'https://acme.com',
    brandSummary: {},
    audienceInsights: { competitorKeywordsIntel: PREVIOUS },
    competitors: [competitor('Alpha', 'alpha.com'), competitor('Beta', 'beta.com')],
  };
}

function aiOk(json: unknown) {
  return {
    ok: true as const,
    provider: 'openai' as const,
    model: 'gpt-4.1',
    text: JSON.stringify(json),
    json,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    failedOver: [],
  };
}

function aiDown(firstErrorClass: string, allRateLimited = false) {
  return { ok: false as const, kind: 'all_unavailable' as const, attempts: [], firstErrorClass, allRateLimited };
}

function intel(domain: string, overrides: Record<string, unknown> = {}) {
  return {
    competitor: domain,
    domain,
    primary_keywords: ['content calendar'],
    secondary_keywords: ['editorial workflow'],
    keyword_clusters: [],
    intent_distribution: { informational: 50, commercial: 30, product: 10, educational: 10 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  prismaMock.workspace.findUnique.mockResolvedValue(workspace());
  prismaMock.workspace.update.mockResolvedValue({});
});

describe('generateWorkspaceCompetitorKeywords never saves an AI failure', () => {
  it('calls the keywords task through the failover layer, never fetch', async () => {
    runAiTaskMock.mockResolvedValue(aiOk({ competitors: [intel('alpha.com'), intel('beta.com')], content_gaps: [] }));

    await generateWorkspaceCompetitorKeywords('ws-1');

    expect(runAiTaskMock).toHaveBeenCalledTimes(1);
    const [task, request, ctx] = runAiTaskMock.mock.calls[0];
    expect(task).toBe('keywords');
    expect(request).toMatchObject({ output: { kind: 'json_object' }, timeoutMs: 60_000 });
    expect(ctx).toEqual({ workspaceId: 'ws-1', userId: 'user-1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a rate limit on every provider keeps the "try again in a few minutes" copy and saves nothing', async () => {
    runAiTaskMock.mockResolvedValue(aiDown('rate_limit', true));

    const result = await generateWorkspaceCompetitorKeywords('ws-1');

    expect(result).toEqual({ error: 'keywordsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('billing or auth never says "wait a few minutes": generic error, nothing saved', async () => {
    for (const cls of ['billing', 'auth', 'not_configured']) {
      runAiTaskMock.mockResolvedValue(aiDown(cls));
      const result = await generateWorkspaceCompetitorKeywords('ws-1');
      expect(result).toEqual({ error: 'keywordsFailed' });
    }
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPETITOR_KEYWORDS_FAILED',
        detail: expect.objectContaining({ reason: 'ai_unavailable', firstErrorClass: 'billing' }),
      }),
    );
  });

  it('returns keywordsAiFailed when the model answered with a non-object, and logs the spent tokens', async () => {
    runAiTaskMock.mockResolvedValue(aiOk('this is not an object'));

    const result = await generateWorkspaceCompetitorKeywords('ws-1');

    expect(result).toEqual({ error: 'keywordsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPETITOR_KEYWORDS_FAILED',
        detail: expect.objectContaining({ totalTokens: 150 }),
      }),
    );
  });

  it('returns keywordsAiFailed when no competitor came back with a single keyword', async () => {
    runAiTaskMock.mockResolvedValue(
      aiOk({
        competitors: [
          intel('alpha.com', { primary_keywords: [], secondary_keywords: [] }),
          intel('beta.com', { primary_keywords: [], secondary_keywords: [] }),
        ],
        content_gaps: [],
      }),
    );

    const result = await generateWorkspaceCompetitorKeywords('ws-1');

    expect(result).toEqual({ error: 'keywordsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });
});

describe('generateWorkspaceCompetitorKeywords saves only what the model said', () => {
  it('saves a good result', async () => {
    runAiTaskMock.mockResolvedValue(
      aiOk({ competitors: [intel('alpha.com'), intel('beta.com')], content_gaps: [] }),
    );

    const result = await generateWorkspaceCompetitorKeywords('ws-1');

    expect(result).toHaveProperty('success', true);
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1);
  });

  it('keeps a skipped competitor with a null intent split, not an invented one', async () => {
    runAiTaskMock.mockResolvedValue(aiOk({ competitors: [intel('alpha.com')], content_gaps: [] }));

    const result = (await generateWorkspaceCompetitorKeywords('ws-1')) as {
      payload: { competitors: Array<{ domain: string; intent_distribution: unknown }> };
    };

    const beta = result.payload.competitors.find((item) => item.domain === 'beta.com');
    expect(beta).toBeDefined();
    expect(beta?.intent_distribution).toBeNull();
  });

  it('stores a null intent split when the model left the numbers out', async () => {
    runAiTaskMock.mockResolvedValue(
      aiOk({
        competitors: [intel('alpha.com', { intent_distribution: {} }), intel('beta.com')],
        content_gaps: [],
      }),
    );

    const result = (await generateWorkspaceCompetitorKeywords('ws-1')) as {
      payload: { competitors: Array<{ domain: string; intent_distribution: unknown }> };
    };

    const alpha = result.payload.competitors.find((item) => item.domain === 'alpha.com');
    expect(alpha?.intent_distribution).toBeNull();
  });
});

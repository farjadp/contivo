import { beforeEach, describe, expect, it, vi } from 'vitest';

// An AI failure must never be saved as a result (spec 2026-09-29, D1), and a
// missing intent split is null, never a made-up 55/20/15/10 (D2). No network,
// no database: prisma, the session, site reading and fetch are mocked.

const { prismaMock, activityLogMock } = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
  },
  activityLogMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
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

function openAiReply(content: unknown) {
  return {
    ok: true,
    json: async () => ({
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }],
    }),
    text: async () => '',
  };
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
  process.env.OPENAI_API_KEY = 'test-key';
  vi.stubGlobal('fetch', fetchMock);
  prismaMock.workspace.findUnique.mockResolvedValue(workspace());
  prismaMock.workspace.update.mockResolvedValue({});
});

describe('generateWorkspaceCompetitorKeywords never saves an AI failure', () => {
  it('returns keywordsAiFailed and keeps the previous result when OpenAI errors', async () => {
    fetchMock.mockResolvedValue({ ok: false, text: async () => 'rate limited', json: async () => ({}) });

    const result = await generateWorkspaceCompetitorKeywords('ws-1');

    expect(result).toEqual({ error: 'keywordsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('returns keywordsAiFailed when the reply is not JSON, and logs the spent tokens', async () => {
    fetchMock.mockResolvedValue(openAiReply('this is not json'));

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
    fetchMock.mockResolvedValue(
      openAiReply({
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
    fetchMock.mockResolvedValue(
      openAiReply({ competitors: [intel('alpha.com'), intel('beta.com')], content_gaps: [] }),
    );

    const result = await generateWorkspaceCompetitorKeywords('ws-1');

    expect(result).toHaveProperty('success', true);
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1);
  });

  it('keeps a skipped competitor with a null intent split, not an invented one', async () => {
    fetchMock.mockResolvedValue(openAiReply({ competitors: [intel('alpha.com')], content_gaps: [] }));

    const result = (await generateWorkspaceCompetitorKeywords('ws-1')) as {
      payload: { competitors: Array<{ domain: string; intent_distribution: unknown }> };
    };

    const beta = result.payload.competitors.find((item) => item.domain === 'beta.com');
    expect(beta).toBeDefined();
    expect(beta?.intent_distribution).toBeNull();
  });

  it('stores a null intent split when the model left the numbers out', async () => {
    fetchMock.mockResolvedValue(
      openAiReply({
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

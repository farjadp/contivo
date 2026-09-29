import { beforeEach, describe, expect, it, vi } from 'vitest';

// A failed extraction must never be saved, and must not be followed by a
// comparison prompt run on nothing (spec 2026-09-29, D1). No network, no
// database: prisma, the session, site reading and fetch are mocked.

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
    evidence: `${domain} offers a content planning plan and onboarding services`,
  })),
}));

import { generateWorkspaceProductsServicesIntel } from './growth-offerings';

const fetchMock = vi.fn();

function workspace() {
  return {
    id: 'ws-1',
    userId: 'user-1',
    name: 'Acme',
    websiteUrl: 'https://acme.com',
    brandSummary: {},
    audienceInsights: { productsServicesIntel: { client_offerings: { offerings: [{ name: 'Old' }] } } },
    competitors: [
      {
        name: 'Alpha',
        domain: 'alpha.com',
        type: 'DIRECT',
        description: '',
        category: '',
        audienceGuess: '',
        userDecision: 'ACCEPTED',
        confidence: null,
        sources: [],
        evidence: null,
      },
    ],
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

function extraction(clientOfferings: unknown[], competitorOfferings: unknown[]) {
  return {
    client_offerings: { company_name: 'Acme', website: 'https://acme.com', offerings: clientOfferings, summary: {} },
    competitor_offerings: [
      { competitor_name: 'Alpha', website: 'https://alpha.com', offerings: competitorOfferings, summary: {} },
    ],
    comparison_summary: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPENAI_API_KEY = 'test-key';
  vi.stubGlobal('fetch', fetchMock);
  prismaMock.workspace.findUnique.mockResolvedValue(workspace());
  prismaMock.workspace.update.mockResolvedValue({});
});

describe('generateWorkspaceProductsServicesIntel never saves an AI failure', () => {
  it('returns offeringsAiFailed, keeps the previous result and runs no comparison', async () => {
    fetchMock.mockResolvedValue({ ok: false, text: async () => 'rate limited', json: async () => ({}) });

    const result = await generateWorkspaceProductsServicesIntel('ws-1');

    expect(result).toEqual({ error: 'offeringsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PRODUCTS_SERVICES_INTEL_FAILED' }),
    );
  });

  it('treats an unparseable extraction as a failure', async () => {
    fetchMock.mockResolvedValue(openAiReply('not json'));

    const result = await generateWorkspaceProductsServicesIntel('ws-1');

    expect(result).toEqual({ error: 'offeringsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateWorkspaceProductsServicesIntel compares only real offerings', () => {
  it('saves an empty extraction without spending a comparison call', async () => {
    fetchMock.mockResolvedValue(openAiReply(extraction([], [])));

    const result = await generateWorkspaceProductsServicesIntel('ws-1');

    expect(result).toHaveProperty('success', true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('runs the comparison when there is something to compare', async () => {
    fetchMock
      .mockResolvedValueOnce(openAiReply(extraction([{ name: 'Planner' }], [{ name: 'Scheduler' }])))
      .mockResolvedValueOnce(openAiReply({ positioning_insight: 'Acme plans, Alpha schedules.' }));

    const result = (await generateWorkspaceProductsServicesIntel('ws-1')) as {
      payload: { comparison_analysis: { positioning_insight: string } };
    };

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.payload.comparison_analysis.positioning_insight).toBe('Acme plans, Alpha schedules.');
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1);
  });
});

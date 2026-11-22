import { beforeEach, describe, expect, it, vi } from 'vitest';

// A failed extraction must never be saved, and must not be followed by a
// comparison prompt run on nothing (spec 2026-09-29, D1). No network, no
// database: prisma, the session, site reading and fetch are mocked.

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
  vi.stubGlobal('fetch', fetchMock);
  prismaMock.workspace.findUnique.mockResolvedValue(workspace());
  prismaMock.workspace.update.mockResolvedValue({});
});

describe('generateWorkspaceProductsServicesIntel never saves an AI failure', () => {
  it('rate limit everywhere: offeringsAiFailed, previous result kept, no comparison', async () => {
    runAiTaskMock.mockResolvedValue(aiDown('rate_limit', true));

    const result = await generateWorkspaceProductsServicesIntel('ws-1');

    expect(result).toEqual({ error: 'offeringsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(runAiTaskMock).toHaveBeenCalledTimes(1);
    expect(runAiTaskMock.mock.calls[0][0]).toBe('offerings');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'PRODUCTS_SERVICES_INTEL_FAILED' }),
    );
  });

  it('billing or auth: generic offeringsFailed, never the "few minutes" copy', async () => {
    for (const cls of ['billing', 'auth']) {
      runAiTaskMock.mockResolvedValue(aiDown(cls));
      expect(await generateWorkspaceProductsServicesIntel('ws-1')).toEqual({ error: 'offeringsFailed' });
    }
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('treats a non-object extraction as a failure', async () => {
    runAiTaskMock.mockResolvedValue(aiOk('not json'));

    const result = await generateWorkspaceProductsServicesIntel('ws-1');

    expect(result).toEqual({ error: 'offeringsAiFailed' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(runAiTaskMock).toHaveBeenCalledTimes(1);
  });
});

describe('generateWorkspaceProductsServicesIntel compares only real offerings', () => {
  it('saves an empty extraction without spending a comparison call', async () => {
    runAiTaskMock.mockResolvedValue(aiOk(extraction([], [])));

    const result = await generateWorkspaceProductsServicesIntel('ws-1');

    expect(result).toHaveProperty('success', true);
    expect(runAiTaskMock).toHaveBeenCalledTimes(1);
  });

  it('runs the comparison when there is something to compare', async () => {
    runAiTaskMock
      .mockResolvedValueOnce(aiOk(extraction([{ name: 'Planner' }], [{ name: 'Scheduler' }])))
      .mockResolvedValueOnce(aiOk({ positioning_insight: 'Acme plans, Alpha schedules.' }));

    const result = (await generateWorkspaceProductsServicesIntel('ws-1')) as {
      payload: { comparison_analysis: { positioning_insight: string } };
    };

    expect(runAiTaskMock).toHaveBeenCalledTimes(2);
    expect(runAiTaskMock.mock.calls.map((c) => c[0])).toEqual(['offerings', 'offerings']);
    expect(result.payload.comparison_analysis.positioning_insight).toBe('Acme plans, Alpha schedules.');
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1);
  });
});

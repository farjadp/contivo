import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// These tests exist to prove the security discipline this file's header
// comment describes, not to exercise the discovery pipeline itself (that is
// pipeline.test.ts's job, already 96 tests deep). Every test here either:
//   - shows a client-supplied workspace id or competitor id from another
//     account is rejected before any write happens, or
//   - shows an "enum-ish" field (decision, type, rejectionReason, country,
//     language) outside its fixed allowlist is rejected before any write,
//     or
//   - shows the quota only counts DONE runs plus the legacy archive.
//
// `@/lib/db` and `getSession` are mocked throughout — no real database, no
// real OpenAI call, no real pipeline run (a live run costs upward of
// 570,000 tokens and this file must never trigger one).
// ---------------------------------------------------------------------------

const { prismaMock, sessionMock, activityLogMock, backgroundRunMock, pipelineMock, judgeMock, queriesMock } =
  vi.hoisted(() => ({
    prismaMock: {
      workspace: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      discoveryRun: {
        findFirst: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        findMany: vi.fn(),
      },
      competitor: {
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
      },
    },
    sessionMock: { getSession: vi.fn() },
    activityLogMock: {
      writeActivityLog: vi.fn(),
      getMaxDiscoveryRuns: vi.fn(),
      getWorkspaceDiscoveryStats: vi.fn(),
    },
    backgroundRunMock: { triggerBackgroundRun: vi.fn() },
    pipelineMock: {
      reapStaleRuns: vi.fn(),
      parseStoredEvidence: vi.fn((value: unknown) => (Array.isArray(value) ? value : [])),
    },
    judgeMock: { enrichCandidates: vi.fn(), judgeCandidates: vi.fn() },
    queriesMock: { buildBrandBrief: vi.fn(() => ({})) },
  }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => sessionMock);
vi.mock('@/lib/activity-log', () => activityLogMock);
vi.mock('@/lib/background-run', () => backgroundRunMock);
vi.mock('@/lib/competitors/pipeline', () => pipelineMock);
vi.mock('@/lib/competitors/judge', () => judgeMock);
vi.mock('@/lib/competitors/queries', () => queriesMock);
// Real allowlist-shaped domain normalisation matters for addManualCompetitor's
// duplicate check, so this one is not mocked.
// `@/lib/competitors/domains` and `@/lib/competitors/scoring` are left real.

// `actionError` calls next-intl's `getTranslations`, which needs a full
// request-scoped i18n setup this test has no reason to provide. Every
// assertion below checks *that* an error key came back and that no write
// happened, not the exact translated sentence, so the key itself is enough.
vi.mock('@/lib/action-errors', () => ({
  actionError: vi.fn(async (key: string) => key),
}));

import {
  addManualCompetitor,
  getDiscoveryStatus,
  listDiscoveryRuns,
  removeCompetitor,
  setCompetitorDecision,
  startCompetitorDiscovery,
  updateCompetitorType,
  updateTargetMarket,
} from './growth-competitors';

const SESSION = { userId: 'user-1', email: 'user1@example.com', role: 'USER' as const };

function workspaceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ws-1',
    userId: 'user-1',
    name: 'Acme',
    websiteUrl: 'https://acme.com',
    brandSummary: {},
    targetCountry: null,
    targetLanguage: 'en',
    competitors: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.getSession.mockResolvedValue(SESSION);
  activityLogMock.getMaxDiscoveryRuns.mockResolvedValue(3);
  activityLogMock.getWorkspaceDiscoveryStats.mockResolvedValue({ usedRuns: 0, remainingRuns: 3 });
  pipelineMock.reapStaleRuns.mockResolvedValue(undefined);
  prismaMock.discoveryRun.findFirst.mockResolvedValue(null);
  prismaMock.discoveryRun.count.mockResolvedValue(0);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Ownership: a workspace id that is not the caller's
// ---------------------------------------------------------------------------

describe('ownership: a workspace belonging to another user', () => {
  beforeEach(() => {
    // findFirst is scoped by { id, userId } in every action; a workspace
    // that belongs to someone else simply never matches that filter.
    prismaMock.workspace.findFirst.mockResolvedValue(null);
  });

  it('startCompetitorDiscovery returns the not-found error and creates no run', async () => {
    const result = await startCompetitorDiscovery('ws-not-mine');

    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.discoveryRun.create).not.toHaveBeenCalled();
    expect(backgroundRunMock.triggerBackgroundRun).not.toHaveBeenCalled();
  });

  it('setCompetitorDecision returns the not-found error and updates nothing', async () => {
    const result = await setCompetitorDecision('ws-not-mine', 'comp-1', 'ACCEPTED');

    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.competitor.updateMany).not.toHaveBeenCalled();
  });

  it('updateCompetitorType returns the not-found error and updates nothing', async () => {
    const result = await updateCompetitorType('ws-not-mine', 'comp-1', 'DIRECT');

    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.competitor.updateMany).not.toHaveBeenCalled();
  });

  it('removeCompetitor returns the not-found error and deletes nothing', async () => {
    const result = await removeCompetitor('ws-not-mine', 'comp-1');

    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.competitor.deleteMany).not.toHaveBeenCalled();
  });

  it('updateTargetMarket returns the not-found error and updates nothing', async () => {
    const result = await updateTargetMarket('ws-not-mine', 'US', 'en');

    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('addManualCompetitor returns the not-found error and creates nothing', async () => {
    const result = await addManualCompetitor('ws-not-mine', 'rival.com');

    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.competitor.create).not.toHaveBeenCalled();
  });

  it('getDiscoveryStatus returns the same empty shape as a workspace that does not exist at all', async () => {
    const result = await getDiscoveryStatus('ws-not-mine');

    expect(result.run).toBeNull();
    expect(result.competitors).toEqual([]);
    // Same shape a nonexistent workspace id would produce — this action
    // never distinguishes "not yours" from "does not exist".
  });

  it('listDiscoveryRuns returns an empty list rather than an error', async () => {
    const result = await listDiscoveryRuns('ws-not-mine');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ownership: a competitor id that belongs to a different workspace
// ---------------------------------------------------------------------------

describe('ownership: a competitor id from another workspace', () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
  });

  it('setCompetitorDecision performs no write when the row is not in this workspace', async () => {
    // The where clause is always { id, workspaceId } — a competitor that
    // belongs to a different workspace matches zero rows, never this
    // workspace's row by coincidence.
    prismaMock.competitor.updateMany.mockResolvedValue({ count: 0 });

    const result = await setCompetitorDecision('ws-1', 'someone-elses-competitor', 'ACCEPTED');

    expect(result).toEqual({ error: 'competitorNotFound' });
    expect(prismaMock.competitor.updateMany).toHaveBeenCalledWith({
      where: { id: 'someone-elses-competitor', workspaceId: 'ws-1' },
      data: expect.any(Object),
    });
  });

  it('updateCompetitorType performs no write when the row is not in this workspace', async () => {
    prismaMock.competitor.updateMany.mockResolvedValue({ count: 0 });

    const result = await updateCompetitorType('ws-1', 'someone-elses-competitor', 'DIRECT');

    expect(result).toEqual({ error: 'competitorNotFound' });
    expect(prismaMock.competitor.updateMany).toHaveBeenCalledWith({
      where: { id: 'someone-elses-competitor', workspaceId: 'ws-1' },
      data: { type: 'DIRECT' },
    });
  });

  it('removeCompetitor deletes no row when it is not in this workspace', async () => {
    prismaMock.competitor.deleteMany.mockResolvedValue({ count: 0 });

    const result = await removeCompetitor('ws-1', 'someone-elses-competitor');

    expect(result).toEqual({ error: 'competitorNotFound' });
    expect(prismaMock.competitor.deleteMany).toHaveBeenCalledWith({
      where: { id: 'someone-elses-competitor', workspaceId: 'ws-1' },
    });
  });
});

// ---------------------------------------------------------------------------
// Allowlist validation — each enum-ish field
// ---------------------------------------------------------------------------

describe('allowlist validation', () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
  });

  it('setCompetitorDecision rejects a decision outside {ACCEPTED, REJECTED, PENDING}', async () => {
    const result = await setCompetitorDecision('ws-1', 'comp-1', 'HACKED' as never);

    expect(result).toEqual({ error: 'competitorPayloadInvalid' });
    expect(prismaMock.competitor.updateMany).not.toHaveBeenCalled();
  });

  it('setCompetitorDecision rejects a rejectionReason outside the fixed set', async () => {
    const result = await setCompetitorDecision('ws-1', 'comp-1', 'REJECTED', 'because I said so');

    expect(result).toEqual({ error: 'competitorPayloadInvalid' });
    expect(prismaMock.competitor.updateMany).not.toHaveBeenCalled();
  });

  it('setCompetitorDecision accepts a rejectionReason from the fixed set', async () => {
    prismaMock.competitor.updateMany.mockResolvedValue({ count: 1 });

    const result = await setCompetitorDecision('ws-1', 'comp-1', 'REJECTED', 'DUPLICATE');

    expect(result).toEqual({ success: true });
    expect(prismaMock.competitor.updateMany).toHaveBeenCalledWith({
      where: { id: 'comp-1', workspaceId: 'ws-1' },
      data: { userDecision: 'REJECTED', rejectionReason: 'DUPLICATE' },
    });
  });

  it('updateCompetitorType rejects a type outside {DIRECT, INDIRECT, ASPIRATIONAL}', async () => {
    const result = await updateCompetitorType('ws-1', 'comp-1', 'ENTERPRISE_GIANT' as never);

    expect(result).toEqual({ error: 'competitorPayloadInvalid' });
    expect(prismaMock.competitor.updateMany).not.toHaveBeenCalled();
  });

  it('updateTargetMarket rejects a language outside {fa, en}', async () => {
    const result = await updateTargetMarket('ws-1', null, 'de' as never);

    expect(result).toEqual({ error: 'competitorPayloadInvalid' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('updateTargetMarket rejects a country that is not a bare two-letter code', async () => {
    const result = await updateTargetMarket('ws-1', 'United States', 'en');

    expect(result).toEqual({ error: 'competitorPayloadInvalid' });
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('updateTargetMarket accepts a null country and a two-letter code', async () => {
    prismaMock.workspace.update.mockResolvedValue({});

    const nullResult = await updateTargetMarket('ws-1', null, 'en');
    expect(nullResult).toEqual({ success: true });

    const codeResult = await updateTargetMarket('ws-1', 'CA', 'fa');
    expect(codeResult).toEqual({ success: true });
    expect(prismaMock.workspace.update).toHaveBeenLastCalledWith({
      where: { id: 'ws-1' },
      data: { targetCountry: 'CA', targetLanguage: 'fa' },
    });
  });
});

// ---------------------------------------------------------------------------
// startCompetitorDiscovery: one run at a time
// ---------------------------------------------------------------------------

describe('startCompetitorDiscovery', () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
  });

  it('refuses when a run is already PENDING or RUNNING for this workspace', async () => {
    prismaMock.discoveryRun.findFirst.mockResolvedValue({ id: 'active-run' });

    const result = await startCompetitorDiscovery('ws-1');

    expect(result).toEqual({ error: 'discoveryAlreadyRunning' });
    expect(prismaMock.discoveryRun.create).not.toHaveBeenCalled();
    expect(backgroundRunMock.triggerBackgroundRun).not.toHaveBeenCalled();
  });

  it('reaps stale runs before checking whether one is active', async () => {
    prismaMock.discoveryRun.findFirst.mockResolvedValue(null);
    prismaMock.discoveryRun.create.mockResolvedValue({ id: 'new-run' });

    await startCompetitorDiscovery('ws-1');

    expect(pipelineMock.reapStaleRuns).toHaveBeenCalledWith('ws-1');
  });

  it('refuses with the limit-reached error, without creating a run, once the quota is used up', async () => {
    activityLogMock.getMaxDiscoveryRuns.mockResolvedValue(3);
    prismaMock.discoveryRun.count.mockResolvedValue(1); // 1 DONE run
    activityLogMock.getWorkspaceDiscoveryStats.mockResolvedValue({ usedRuns: 2, remainingRuns: 1 }); // 2 legacy rows

    const result = await startCompetitorDiscovery('ws-1');

    expect(result).toEqual({
      error: 'discoveryLimitReached',
      meta: { usedRuns: 3, remainingRuns: 0, maxRuns: 3 },
    });
    expect(prismaMock.discoveryRun.create).not.toHaveBeenCalled();
  });

  it('creates a PENDING run and triggers the background route with only the runId', async () => {
    prismaMock.discoveryRun.create.mockResolvedValue({ id: 'new-run' });

    const result = await startCompetitorDiscovery('ws-1');

    expect(result).toEqual({ runId: 'new-run' });
    expect(prismaMock.discoveryRun.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: 'ws-1', userId: 'user-1', status: 'PENDING' }),
      }),
    );
    expect(backgroundRunMock.triggerBackgroundRun).toHaveBeenCalledWith('/api/growth/discovery/run', {
      runId: 'new-run',
    });
  });
});

// ---------------------------------------------------------------------------
// Quota: only DONE runs plus the legacy archive count
// ---------------------------------------------------------------------------

describe('discovery quota', () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
    prismaMock.discoveryRun.findMany.mockResolvedValue([]);
    prismaMock.competitor.findMany.mockResolvedValue([]);
  });

  it('counts DONE DiscoveryRun rows plus legacy archive rows, and nothing else', async () => {
    activityLogMock.getMaxDiscoveryRuns.mockResolvedValue(10);
    prismaMock.discoveryRun.count.mockResolvedValue(2); // 2 DONE runs
    activityLogMock.getWorkspaceDiscoveryStats.mockResolvedValue({ usedRuns: 5, remainingRuns: 5 }); // 5 legacy rows

    const status = await getDiscoveryStatus('ws-1');

    expect(status.meta).toEqual({ usedRuns: 7, remainingRuns: 3, maxRuns: 10 });
    // The count query itself only ever asks for DONE — a FAILED, EMPTY,
    // PENDING or RUNNING run structurally cannot be included in this number.
    expect(prismaMock.discoveryRun.count).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1', status: 'DONE' },
    });
  });

  it('a FAILED run does not raise usedRuns', async () => {
    activityLogMock.getMaxDiscoveryRuns.mockResolvedValue(10);
    // No DONE rows — only a FAILED one exists, which the DONE-only count
    // query below never sees.
    prismaMock.discoveryRun.count.mockResolvedValue(0);
    activityLogMock.getWorkspaceDiscoveryStats.mockResolvedValue({ usedRuns: 0, remainingRuns: 10 });

    const status = await getDiscoveryStatus('ws-1');

    expect(status.meta.usedRuns).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addManualCompetitor
// ---------------------------------------------------------------------------

describe('addManualCompetitor', () => {
  it('rejects a duplicate domain without creating a row', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(
      workspaceRow({ competitors: [{ id: 'existing', domain: 'rival.com', name: 'Rival' }] }),
    );

    const result = await addManualCompetitor('ws-1', 'https://rival.com/pricing');

    expect(result).toEqual({ error: 'competitorAlreadyExists' });
    expect(prismaMock.competitor.create).not.toHaveBeenCalled();
  });

  it('rejects an unparsable domain without creating a row', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());

    const result = await addManualCompetitor('ws-1', 'not a domain at all');

    expect(result).toEqual({ error: 'invalidUrl' });
    expect(prismaMock.competitor.create).not.toHaveBeenCalled();
  });

  it('saves the competitor as ACCEPTED even when the judge says it is not a match, and surfaces the reason as a warning', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
    judgeMock.enrichCandidates.mockResolvedValue([
      { domain: 'notacompetitor.com', frequency: 1, sources: ['MANUAL'], evidence: [], siteTitle: null, siteEvidence: '', pageLanguage: 'en' },
    ]);
    judgeMock.judgeCandidates.mockResolvedValue({
      judged: [
        {
          domain: 'notacompetitor.com',
          frequency: 1,
          sources: ['MANUAL'],
          evidence: [],
          siteTitle: null,
          siteEvidence: '',
          pageLanguage: 'en',
          name: 'Not A Competitor Inc',
          isCompetitor: false,
          labels: [],
          type: 'DIRECT',
          scaleMatch: true,
          judgeConfidence: 0.9,
          reason: 'Sells something entirely unrelated.',
          positioning: null,
          keyFeatures: [],
          description: 'An unrelated business.',
        },
      ],
      tokens: 100,
    });
    prismaMock.competitor.create.mockResolvedValue({
      id: 'new-comp',
      name: 'Not A Competitor Inc',
      domain: 'notacompetitor.com',
      description: 'An unrelated business.',
      type: 'DIRECT',
      userDecision: 'ACCEPTED',
      rejectionReason: null,
      source: 'MANUAL',
      sources: ['MANUAL'],
      labels: [],
      confidence: 0.9,
      positioning: null,
      keyFeatures: [],
      evidence: [],
      createdAt: new Date(),
    });

    const result = await addManualCompetitor('ws-1', 'notacompetitor.com');

    expect('error' in result).toBe(false);
    if (!('error' in result)) {
      expect(result.judgeWarning).toBe('Sells something entirely unrelated.');
      expect(result.competitor.userDecision).toBe('ACCEPTED');
    }
    expect(prismaMock.competitor.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userDecision: 'ACCEPTED', source: 'MANUAL' }) }),
    );
  });

  it('does not consume a discovery run', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
    judgeMock.enrichCandidates.mockResolvedValue([]);
    prismaMock.competitor.create.mockResolvedValue({
      id: 'new-comp',
      name: 'somesite.com',
      domain: 'somesite.com',
      description: null,
      type: 'DIRECT',
      userDecision: 'ACCEPTED',
      rejectionReason: null,
      source: 'MANUAL',
      sources: ['MANUAL'],
      labels: [],
      confidence: null,
      positioning: null,
      keyFeatures: [],
      evidence: [],
      createdAt: new Date(),
    });

    await addManualCompetitor('ws-1', 'somesite.com');

    expect(prismaMock.discoveryRun.create).not.toHaveBeenCalled();
  });
});

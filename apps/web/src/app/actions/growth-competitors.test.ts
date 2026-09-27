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
        update: vi.fn(),
        findMany: vi.fn(),
      },
      competitor: {
        updateMany: vi.fn(),
        deleteMany: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        groupBy: vi.fn(),
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

/** Narrows getDiscoveryStatus's result, failing the test on the error branch. */
function asStatus<T extends object>(result: T | { error: string }): T {
  if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
  return result as T;
}

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
  backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: true });
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

  it('removeCompetitor returns the not-found error and changes nothing', async () => {
    const result = await removeCompetitor('ws-not-mine', 'comp-1');

    expect(result).toEqual({ error: 'workspaceNotFound' });
    expect(prismaMock.competitor.updateMany).not.toHaveBeenCalled();
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
    const result = asStatus(await getDiscoveryStatus('ws-not-mine'));

    expect(result.run).toBeNull();
    expect(result.competitors).toEqual([]);
    // Same shape a nonexistent workspace id would produce — this action
    // never distinguishes "not yours" from "does not exist".
  });

  it('listDiscoveryRuns returns an empty list rather than an error', async () => {
    const result = await listDiscoveryRuns('ws-not-mine');
    expect(result).toEqual([]);
  });

  it('never reads another workspace\'s runs, queries, market or competitor counts', async () => {
    const statusResult = await getDiscoveryStatus('ws-not-mine');
    const historyResult = await listDiscoveryRuns('ws-not-mine');

    expect(statusResult).toEqual({
      run: null,
      meta: { usedRuns: 0, remainingRuns: 0, maxRuns: 3 },
      competitors: [],
    });
    expect(historyResult).toEqual([]);
    expect(prismaMock.discoveryRun.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.discoveryRun.findMany).not.toHaveBeenCalled();
    expect(prismaMock.competitor.findMany).not.toHaveBeenCalled();
    expect(prismaMock.competitor.groupBy).not.toHaveBeenCalled();
  });

  it('getDiscoveryStatus returns an identical result for a workspace id that does not exist', async () => {
    const notMine = await getDiscoveryStatus('ws-not-mine');
    const missing = await getDiscoveryStatus('ws-does-not-exist');
    expect(missing).toEqual(notMine);
  });
});

// ---------------------------------------------------------------------------
// Session: a lost session is reported, not disguised as an empty workspace
// ---------------------------------------------------------------------------

describe('no session', () => {
  it('getDiscoveryStatus returns the not-authenticated error and reads nothing', async () => {
    sessionMock.getSession.mockResolvedValue(null);

    const result = await getDiscoveryStatus('ws-1');

    expect(result).toEqual({ error: 'notAuthenticated' });
    expect(prismaMock.workspace.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.discoveryRun.findFirst).not.toHaveBeenCalled();
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

  it('removeCompetitor changes no row when it is not in this workspace', async () => {
    prismaMock.competitor.updateMany.mockResolvedValue({ count: 0 });

    const result = await removeCompetitor('ws-1', 'someone-elses-competitor');

    expect(result).toEqual({ error: 'competitorNotFound' });
    expect(prismaMock.competitor.updateMany).toHaveBeenCalledWith({
      where: { id: 'someone-elses-competitor', workspaceId: 'ws-1' },
      data: { userDecision: 'REJECTED', rejectionReason: null },
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

    for (const reason of ['DIFFERENT_MARKET', 'TOO_BIG', 'DIFFERENT_PRODUCT', 'NOT_A_COMPANY']) {
      const result = await setCompetitorDecision('ws-1', 'comp-1', 'REJECTED', reason);

      expect(result).toEqual({ success: true });
      expect(prismaMock.competitor.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'comp-1', workspaceId: 'ws-1' },
        data: { userDecision: 'REJECTED', rejectionReason: reason },
      });
    }
  });

  it('setCompetitorDecision rejects the retired reason codes, including the free catch-all OTHER', async () => {
    for (const reason of ['OTHER', 'NOT_A_COMPETITOR', 'WRONG_SCALE', 'DUPLICATE', 'ALREADY_KNOWN']) {
      const result = await setCompetitorDecision('ws-1', 'comp-1', 'REJECTED', reason);
      expect(result).toEqual({ error: 'competitorPayloadInvalid' });
    }
    expect(prismaMock.competitor.updateMany).not.toHaveBeenCalled();
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

  it('marks the run FAILED immediately, and reports an error, when the background trigger cannot be dispatched at all', async () => {
    prismaMock.discoveryRun.create.mockResolvedValue({ id: 'new-run' });
    backgroundRunMock.triggerBackgroundRun.mockResolvedValue({ ok: false, error: 'CRON_SECRET is not set' });
    prismaMock.discoveryRun.update.mockResolvedValue({});

    const result = await startCompetitorDiscovery('ws-1');

    expect(result).toEqual({ error: 'discoveryDispatchFailed' });
    expect(prismaMock.discoveryRun.update).toHaveBeenCalledWith({
      where: { id: 'new-run' },
      data: expect.objectContaining({ status: 'FAILED', error: 'CRON_SECRET is not set' }),
    });
  });

  it('returns discoveryAlreadyRunning, not a raw database error, when the database constraint catches a race the findFirst check missed', async () => {
    // Simulates two concurrent calls both passing the `active` findFirst
    // check before either has written its row: the partial unique index
    // (discovery_runs_one_active_per_workspace) is what actually stops the
    // second create, surfaced by Prisma as a P2002 whose `meta.target`
    // names the `workspaceId` column — verified directly against the real
    // local database (see the fix-round report), not assumed.
    const { Prisma } = await import('@prisma/client');
    prismaMock.discoveryRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { modelName: 'DiscoveryRun', target: ['workspaceId'] },
      }),
    );

    const result = await startCompetitorDiscovery('ws-1');

    expect(result).toEqual({ error: 'discoveryAlreadyRunning' });
    expect(backgroundRunMock.triggerBackgroundRun).not.toHaveBeenCalled();
  });

  it('re-throws a database error that is not the active-run unique constraint', async () => {
    const { Prisma } = await import('@prisma/client');
    prismaMock.discoveryRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Some other failure', {
        code: 'P2003',
        clientVersion: '5.22.0',
      }),
    );

    await expect(startCompetitorDiscovery('ws-1')).rejects.toThrow('Some other failure');
  });

  it('re-throws a P2002 on this model that is not the active-run constraint, rather than reporting discoveryAlreadyRunning for it', async () => {
    // A P2002 whose target does not name workspaceId is some other unique
    // violation entirely (DiscoveryRun has none today, but this proves the
    // catch does not swallow every P2002 indiscriminately).
    const { Prisma } = await import('@prisma/client');
    prismaMock.discoveryRun.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.22.0',
        meta: { modelName: 'DiscoveryRun', target: ['id'] },
      }),
    );

    await expect(startCompetitorDiscovery('ws-1')).rejects.toThrow('Unique constraint failed');
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

    const status = asStatus(await getDiscoveryStatus('ws-1'));

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

    const status = asStatus(await getDiscoveryStatus('ws-1'));

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

  it('rejects the workspace\'s own domain without creating a row', async () => {
    // workspaceRow() defaults websiteUrl to https://acme.com.
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());

    const result = await addManualCompetitor('ws-1', 'https://acme.com/pricing');

    expect(result).toEqual({ error: 'competitorIsOwnDomain' });
    expect(prismaMock.competitor.create).not.toHaveBeenCalled();
  });

  it('saves the competitor as ACCEPTED even when the judge says it is not a match, and surfaces the reason as a warning', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
    judgeMock.enrichCandidates.mockResolvedValue({
      enriched: [
        { domain: 'notacompetitor.com', frequency: 1, sources: ['MANUAL'], evidence: [], siteTitle: null, siteEvidence: '', pageLanguage: 'en' },
      ],
      skipped: 0,
      budgetExceeded: false,
    });
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
    judgeMock.enrichCandidates.mockResolvedValue({ enriched: [], skipped: 0, budgetExceeded: false });
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

// ---------------------------------------------------------------------------
// removeCompetitor: rejects, never deletes
// ---------------------------------------------------------------------------

describe('removeCompetitor', () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
  });

  it('marks the row REJECTED instead of deleting it, so the next run keeps excluding its domain', async () => {
    prismaMock.competitor.updateMany.mockResolvedValue({ count: 1 });

    const result = await removeCompetitor('ws-1', 'comp-1');

    expect(result).toEqual({ success: true });
    expect(prismaMock.competitor.updateMany).toHaveBeenCalledWith({
      where: { id: 'comp-1', workspaceId: 'ws-1' },
      data: { userDecision: 'REJECTED', rejectionReason: null },
    });
    expect(prismaMock.competitor.deleteMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Run details: market, queries, per-run counts
// ---------------------------------------------------------------------------

function runRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    workspaceId: 'ws-1',
    status: 'DONE',
    stage: 'SAVE',
    market: { country: 'IR', language: 'fa' },
    queries: ['نرم‌افزار حسابداری', '  crm for clinics  '],
    sourceStats: { queries: { count: 2, tokens: 10 } },
    savedCount: 3,
    tokensUsed: 100,
    error: null,
    startedAt: new Date('2026-09-27T10:00:00Z'),
    finishedAt: new Date('2026-09-27T10:05:00Z'),
    ...overrides,
  };
}

describe('getDiscoveryStatus run details', () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
    prismaMock.competitor.findMany.mockResolvedValue([]);
  });

  it('returns the run\'s own market snapshot and its queries as trimmed strings', async () => {
    prismaMock.discoveryRun.findFirst.mockResolvedValue(runRow());

    const result = asStatus(await getDiscoveryStatus('ws-1'));
    expect(result.run?.market).toEqual({ country: 'IR', language: 'fa' });
    expect(result.run?.queries).toEqual(['نرم‌افزار حسابداری', 'crm for clinics']);
    expect(prismaMock.discoveryRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1' } }),
    );
    expect(prismaMock.competitor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'ws-1' } }),
    );
  });

  it('drops malformed queries and markets instead of passing them through', async () => {
    prismaMock.discoveryRun.findFirst.mockResolvedValue(
      runRow({
        market: { country: 'Iran; DROP TABLE', language: 'de' },
        queries: ['ok', 42, null, { evil: true }, '   ', 'x'.repeat(500)],
      }),
    );

    const result = asStatus(await getDiscoveryStatus('ws-1'));
    expect(result.run?.market).toBeNull();
    expect(result.run?.queries).toHaveLength(2);
    expect(result.run?.queries[0]).toBe('ok');
    expect(result.run?.queries[1].length).toBeLessThanOrEqual(201);
  });

  it('returns no queries while the run has not written any yet', async () => {
    prismaMock.discoveryRun.findFirst.mockResolvedValue(runRow({ status: 'RUNNING', queries: null }));

    const result = asStatus(await getDiscoveryStatus('ws-1'));
    expect(result.run?.queries).toEqual([]);
  });
});

describe('listDiscoveryRuns run details', () => {
  beforeEach(() => {
    prismaMock.workspace.findFirst.mockResolvedValue(workspaceRow());
  });

  it('returns market, query count and found/accepted counts per run, counted within this workspace only', async () => {
    prismaMock.discoveryRun.findMany.mockResolvedValue([
      runRow(),
      runRow({ id: 'run-2', status: 'EMPTY', queries: null, sourceStats: { queries: { count: 9, tokens: null } }, market: { country: null, language: 'en' } }),
      runRow({ id: 'run-3', status: 'FAILED', queries: null, sourceStats: null }),
    ]);
    prismaMock.competitor.groupBy.mockResolvedValue([
      { discoveryRunId: 'run-1', userDecision: 'ACCEPTED', _count: { _all: 2 } },
      { discoveryRunId: 'run-1', userDecision: 'PENDING', _count: { _all: 1 } },
      { discoveryRunId: 'run-1', userDecision: 'REJECTED', _count: { _all: 1 } },
    ]);

    const result = await listDiscoveryRuns('ws-1');

    expect(prismaMock.discoveryRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: 'ws-1' } }));
    expect(prismaMock.competitor.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: 'ws-1', discoveryRunId: { in: ['run-1', 'run-2', 'run-3'] } },
      }),
    );
    expect(result.map(({ id, market, queryCount, foundCount, acceptedCount }) => ({ id, market, queryCount, foundCount, acceptedCount }))).toEqual([
      { id: 'run-1', market: { country: 'IR', language: 'fa' }, queryCount: 2, foundCount: 4, acceptedCount: 2 },
      { id: 'run-2', market: { country: null, language: 'en' }, queryCount: 9, foundCount: 0, acceptedCount: 0 },
      { id: 'run-3', market: { country: 'IR', language: 'fa' }, queryCount: null, foundCount: 0, acceptedCount: 0 },
    ]);
  });

  it('does not query competitor counts when the workspace has no runs', async () => {
    prismaMock.discoveryRun.findMany.mockResolvedValue([]);

    const result = await listDiscoveryRuns('ws-1');

    expect(result).toEqual([]);
    expect(prismaMock.competitor.groupBy).not.toHaveBeenCalled();
  });
});

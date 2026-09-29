import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, activityLogMock, proposeMock, scoreMock, summariseMock, persistMock } = vi.hoisted(() => ({
  prismaMock: {
    matrixRun: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    matrixChart: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  activityLogMock: { writeActivityLog: vi.fn() },
  proposeMock: { proposeMarketAxes: vi.fn() },
  scoreMock: { scoreChart: vi.fn(), applyCoreAgreement: vi.fn() },
  summariseMock: { summariseChart: vi.fn(), summariseAcrossCharts: vi.fn() },
  persistMock: { rebuildMatricesProjection: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => activityLogMock);
vi.mock('./propose-axes', () => proposeMock);
vi.mock('./score-chart', () => scoreMock);
vi.mock('./summarise', () => summariseMock);
vi.mock('./persist', () => persistMock);

import { MatrixAiError } from './openai';
import {
  MATRIX_STAGES,
  MATRIX_STALE_RUN_MINUTES,
  SCORE_CONCURRENCY,
  reapStaleMatrixRuns,
  runMatrixPipeline,
} from './pipeline';
import type { ScoredCompany } from './score-chart';

const MARKET_AXES = [
  {
    key: 'price_service',
    x: { label: 'Price', low: 'Cheap', high: 'Premium' },
    y: { label: 'Service', low: 'Self-serve', high: 'Managed' },
    rationale: 'r1',
  },
  {
    key: 'local_global',
    x: { label: 'Reach', low: 'Local', high: 'Global' },
    y: { label: 'Audience', low: 'SMB', high: 'Enterprise' },
    rationale: 'r2',
  },
];

function competitor(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Company ${id}`,
    domain: `${id}.com`,
    type: 'INDIRECT',
    positioning: 'positioning',
    keyFeatures: ['feature'],
    labels: ['label'],
    evidence: [{ id: `ev-${id}`, kind: 'site', url: `https://${id}.com`, title: 'Title', snippet: 'Snippet' }],
    ...overrides,
  };
}

function makeRun(overrides: { workspace?: Record<string, unknown>; run?: Record<string, unknown> } = {}) {
  return {
    id: 'run-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    status: 'PENDING',
    language: 'en',
    basis: 'ACCEPTED',
    competitorSet: [
      { competitorId: 'c2', domain: 'c2.com', type: 'DIRECT' },
      { competitorId: 'c1', domain: 'c1.com', type: 'ASPIRATIONAL' },
    ],
    startedAt: new Date(),
    ...overrides.run,
    workspace: {
      id: 'ws-1',
      name: 'Acme',
      websiteUrl: 'https://acme.com',
      brandSummary: { valueProposition: 'We sell things' },
      audienceInsights: null,
      targetCountry: 'IR',
      contentLanguage: 'FA',
      matrixAxes: MARKET_AXES,
      competitors: [competitor('c1'), competitor('c2'), competitor('c3')],
      ...overrides.workspace,
    },
  };
}

function scored(competitorId: string | null): ScoredCompany {
  return {
    competitorId,
    name: competitorId ?? 'Acme',
    domain: competitorId ? `${competitorId}.com` : 'acme.com',
    type: competitorId ? 'DIRECT' : 'TARGET',
    xScore: 5,
    yScore: 5,
    confidence: 0.7,
    estimated: false,
    xReason: 'x reason',
    yReason: 'y reason',
    evidenceRefs: competitorId ? [`ev-${competitorId}`] : ['own:valueProposition'],
    certainty: 'likely',
  };
}

const SCORES = [scored(null), scored('c2'), scored('c1')];
const CHART_SUMMARY = {
  marketPattern: 'pattern',
  opportunity: 'opportunity',
  contentAngles: [{ angle: 'angle', audienceSegment: 'segment' }],
};
const CROSS = { crossChartSummary: 'cross', strongestDifferentiation: 'diff', targetAudienceSegment: 'aud' };

/** Every updateMany call's `data`, in order. */
function runWrites() {
  return prismaMock.matrixRun.updateMany.mock.calls.map((call) => call[0]);
}

function finalRunWrite() {
  const writes = runWrites();
  return writes[writes.length - 1];
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.matrixRun.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.matrixChart.create.mockResolvedValue({});
  prismaMock.$transaction.mockImplementation((fn: (tx: typeof prismaMock) => unknown) => fn(prismaMock));
  scoreMock.scoreChart.mockResolvedValue({ scores: SCORES, tokens: 100 });
  scoreMock.applyCoreAgreement.mockImplementation((a: ScoredCompany[], b: ScoredCompany[]) => [a, b]);
  summariseMock.summariseChart.mockResolvedValue({ summary: CHART_SUMMARY, tokens: 10 });
  summariseMock.summariseAcrossCharts.mockResolvedValue({ summary: CROSS, tokens: 5 });
  persistMock.rebuildMatricesProjection.mockResolvedValue({});
  proposeMock.proposeMarketAxes.mockResolvedValue({
    candidates: [...MARKET_AXES, { ...MARKET_AXES[0], key: 'a3' }, { ...MARKET_AXES[1], key: 'a4' }],
    tokens: 40,
  });
});

describe('constants', () => {
  it('exposes the stale window, stages and concurrency', () => {
    expect(MATRIX_STALE_RUN_MINUTES).toBe(10);
    expect(MATRIX_STAGES).toEqual(['AXES', 'SCORE', 'SUMMARISE', 'SAVE']);
    expect(SCORE_CONCURRENCY).toBe(3);
  });
});

describe('runMatrixPipeline', () => {
  it('pauses at NEEDS_AXES with 4 candidates when the workspace has no market axes, writing no charts', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun({ workspace: { matrixAxes: null } }));

    await runMatrixPipeline('run-1');

    expect(proposeMock.proposeMarketAxes).toHaveBeenCalledTimes(1);
    expect(proposeMock.proposeMarketAxes.mock.calls[0][1]).toBe('en');
    expect(proposeMock.proposeMarketAxes.mock.calls[0][2]).toEqual({ brandName: 'Acme', targetCountry: 'IR' });

    const last = finalRunWrite();
    expect(last.where).toEqual({ id: 'run-1', status: 'RUNNING' });
    expect(last.data.status).toBe('NEEDS_AXES');
    expect(last.data.axisCandidates).toHaveLength(4);
    expect(last.data.tokensUsed).toBe(40);
    expect(last.data.finishedAt).toBeInstanceOf(Date);

    expect(scoreMock.scoreChart).not.toHaveBeenCalled();
    expect(prismaMock.matrixChart.create).not.toHaveBeenCalled();
    expect(persistMock.rebuildMatricesProjection).not.toHaveBeenCalled();
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRICES_AXES_PROPOSED', workspaceId: 'ws-1', userId: 'user-1' }),
    );
  });

  it('creates charts in axis order, finishes DONE, rebuilds the projection once and sums tokens', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun());
    scoreMock.scoreChart
      .mockResolvedValueOnce({ scores: SCORES, tokens: 100 })
      .mockResolvedValueOnce({ scores: SCORES, tokens: null })
      .mockResolvedValueOnce({ scores: SCORES, tokens: 100 })
      .mockResolvedValueOnce({ scores: SCORES, tokens: 100 });

    await runMatrixPipeline('run-1');

    // claim, then guarded stage writes, then DONE inside the transaction
    expect(runWrites()[0]).toEqual({ where: { id: 'run-1', status: 'PENDING' }, data: { status: 'RUNNING' } });
    const stages = runWrites()
      .map((w) => w.data.stage)
      .filter(Boolean);
    expect(stages).toEqual(['AXES', 'SCORE', 'SUMMARISE', 'SAVE']);

    expect(scoreMock.scoreChart).toHaveBeenCalledTimes(4);
    expect(scoreMock.applyCoreAgreement).toHaveBeenCalledTimes(1);

    // bundle: exactly competitorSet ids, in its order, with the snapshot's type
    const bundle = scoreMock.scoreChart.mock.calls[0][0];
    expect(bundle.competitors.map((c: { competitorId: string }) => c.competitorId)).toEqual(['c2', 'c1']);
    expect(bundle.competitors.map((c: { type: string }) => c.type)).toEqual(['DIRECT', 'ASPIRATIONAL']);
    expect(scoreMock.scoreChart.mock.calls[0][2]).toBe('en');

    const done = finalRunWrite();
    expect(done.where).toEqual({ id: 'run-1', status: 'RUNNING' });
    expect(done.data.status).toBe('DONE');
    expect(done.data.crossChart).toEqual(CROSS);
    expect(done.data.axesUsed.map((a: { key: string }) => a.key)).toEqual([
      'offer_breadth_specialization',
      'content_presence_focus',
      'price_service',
      'local_global',
    ]);
    // 3 x 100 + null (unknown, skipped) + 4 x 10 + 5
    expect(done.data.tokensUsed).toBe(345);

    expect(prismaMock.matrixChart.create).toHaveBeenCalledTimes(4);
    const charts = prismaMock.matrixChart.create.mock.calls.map((c) => c[0].data);
    expect(charts.map((c) => c.order)).toEqual([0, 1, 2, 3]);
    expect(charts.map((c) => c.kind)).toEqual(['CORE', 'CORE', 'MARKET', 'MARKET']);
    expect(charts[2]).toMatchObject({
      runId: 'run-1',
      workspaceId: 'ws-1',
      key: 'price_service',
      name: 'Price / Service',
      xLabel: 'Price',
      yLabel: 'Service',
      marketPattern: 'pattern',
      opportunity: 'opportunity',
      contentAngles: CHART_SUMMARY.contentAngles,
    });
    expect(charts[2].scores.create).toHaveLength(3);
    expect(charts[2].scores.create[1]).toMatchObject({ competitorId: 'c2', evidenceRefs: ['ev-c2'], xReason: 'x reason' });

    expect(persistMock.rebuildMatricesProjection).toHaveBeenCalledTimes(1);
    expect(persistMock.rebuildMatricesProjection).toHaveBeenCalledWith('ws-1');
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MATRICES_GENERATED',
        detail: { runId: 'run-1', charts: 4, tokens: 345 },
      }),
    );
  });

  it('fails the whole run when one chart fails, writing no charts and not touching the projection', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun());
    scoreMock.scoreChart
      .mockResolvedValueOnce({ scores: SCORES, tokens: 100 })
      .mockRejectedValueOnce(new MatrixAiError('chart scoring omitted company c1 Bearer sk-abcdefghijklmnopqrstuvwxyz', 70))
      .mockResolvedValue({ scores: SCORES, tokens: 100 });

    await runMatrixPipeline('run-1');

    const failed = finalRunWrite();
    expect(failed.where).toEqual({ id: 'run-1', status: { in: ['PENDING', 'RUNNING'] } });
    expect(failed.data.status).toBe('FAILED');
    expect(failed.data.error).toContain('chart scoring omitted company c1');
    expect(failed.data.error).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(failed.data.finishedAt).toBeInstanceOf(Date);
    // the successful charts' spend plus what the failed call reported
    expect(failed.data.tokensUsed).toBeGreaterThanOrEqual(170);

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.matrixChart.create).not.toHaveBeenCalled();
    expect(summariseMock.summariseChart).not.toHaveBeenCalled();
    expect(persistMock.rebuildMatricesProjection).not.toHaveBeenCalled();
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRICES_RUN_FAILED' }),
    );
  });

  it('returns without any other write when the claim is lost', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun());
    prismaMock.matrixRun.updateMany.mockResolvedValueOnce({ count: 0 });

    await runMatrixPipeline('run-1');

    expect(prismaMock.matrixRun.updateMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.matrixChart.create).not.toHaveBeenCalled();
    expect(scoreMock.scoreChart).not.toHaveBeenCalled();
    expect(proposeMock.proposeMarketAxes).not.toHaveBeenCalled();
    expect(activityLogMock.writeActivityLog).not.toHaveBeenCalled();
  });

  it('does nothing for a run that does not exist', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(null);

    await runMatrixPipeline('missing');

    expect(prismaMock.matrixRun.updateMany).not.toHaveBeenCalled();
  });

  it('fails when fewer than 2 of the snapshotted competitors still exist', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun({ workspace: { competitors: [competitor('c1')] } }));

    await runMatrixPipeline('run-1');

    const failed = finalRunWrite();
    expect(failed.data.status).toBe('FAILED');
    expect(failed.data.error).toMatch(/not enough competitors/);
    expect(scoreMock.scoreChart).not.toHaveBeenCalled();
    expect(prismaMock.matrixChart.create).not.toHaveBeenCalled();
  });

  it('fails when the workspace has no brand summary', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun({ workspace: { brandSummary: null } }));

    await runMatrixPipeline('run-1');

    expect(finalRunWrite().data.status).toBe('FAILED');
    expect(scoreMock.scoreChart).not.toHaveBeenCalled();
  });

  it('writes nothing more when the run was reaped before SAVE', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun());
    // claim + AXES + SCORE + SUMMARISE + SAVE stage writes succeed, the DONE write finds nothing
    prismaMock.matrixRun.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await runMatrixPipeline('run-1');

    expect(prismaMock.matrixChart.create).not.toHaveBeenCalled();
    expect(persistMock.rebuildMatricesProjection).not.toHaveBeenCalled();
    expect(runWrites().some((w) => w.data.status === 'FAILED')).toBe(false);
    expect(activityLogMock.writeActivityLog).not.toHaveBeenCalled();
  });

  it('keeps the run DONE when the projection rebuild fails, and logs it', async () => {
    prismaMock.matrixRun.findUnique.mockResolvedValue(makeRun());
    persistMock.rebuildMatricesProjection.mockRejectedValue(new Error('blob write failed'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runMatrixPipeline('run-1');

    expect(runWrites().some((w) => w.data.status === 'FAILED')).toBe(false);
    expect(finalRunWrite().data.status).toBe('DONE');
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRICES_PROJECTION_FAILED' }),
    );
    expect(activityLogMock.writeActivityLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATRICES_GENERATED' }),
    );
    errorSpy.mockRestore();
  });

  it('never throws, even when recording the failure fails', async () => {
    prismaMock.matrixRun.findUnique.mockRejectedValue(new Error('db down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.matrixRun.updateMany.mockRejectedValue(new Error('still down'));

    await expect(runMatrixPipeline('run-1')).resolves.toBeUndefined();
    errorSpy.mockRestore();
  });
});

describe('reapStaleMatrixRuns', () => {
  it('marks only in-flight runs older than 10 minutes as FAILED and never touches NEEDS_AXES', async () => {
    const now = Date.now();
    prismaMock.matrixRun.findMany.mockResolvedValue([
      { id: 'old-running', status: 'RUNNING', startedAt: new Date(now - 11 * 60 * 1000) },
      { id: 'old-pending', status: 'PENDING', startedAt: new Date(now - 30 * 60 * 1000) },
      { id: 'fresh', status: 'RUNNING', startedAt: new Date(now - 2 * 60 * 1000) },
      { id: 'paused', status: 'NEEDS_AXES', startedAt: new Date(now - 60 * 60 * 1000) },
    ]);

    await reapStaleMatrixRuns('ws-1');

    const query = prismaMock.matrixRun.findMany.mock.calls[0][0];
    expect(query.where).toEqual({ workspaceId: 'ws-1', status: { in: ['PENDING', 'RUNNING'] } });

    expect(prismaMock.matrixRun.updateMany).toHaveBeenCalledTimes(1);
    const write = prismaMock.matrixRun.updateMany.mock.calls[0][0];
    expect(write.where).toEqual({ id: { in: ['old-running', 'old-pending'] }, status: { in: ['PENDING', 'RUNNING'] } });
    expect(write.data.status).toBe('FAILED');
    expect(write.data.error).toBe('TIMED_OUT');
  });

  it('writes nothing when no run is stale', async () => {
    prismaMock.matrixRun.findMany.mockResolvedValue([
      { id: 'fresh', status: 'RUNNING', startedAt: new Date() },
    ]);

    await reapStaleMatrixRuns('ws-1');

    expect(prismaMock.matrixRun.updateMany).not.toHaveBeenCalled();
  });
});

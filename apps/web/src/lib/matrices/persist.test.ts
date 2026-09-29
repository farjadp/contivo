import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    matrixRun: { findFirst: vi.fn() },
    matrixOverride: { findMany: vi.fn() },
    competitor: { findMany: vi.fn() },
    workspace: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));

import { rebuildMatricesProjection } from './persist';

const ownId = (text: string) => `own:${createHash('sha256').update(text).digest('hex').slice(0, 8)}`;

function competitor(id: string, decision: string | null = 'ACCEPTED') {
  return { id, userDecision: decision, confidence: 0.9, sources: [], evidence: null as unknown };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run_1',
    status: 'DONE',
    basis: 'ACCEPTED',
    language: 'en',
    finishedAt: new Date('2026-09-29T10:00:00.000Z'),
    startedAt: new Date('2026-09-29T09:00:00.000Z'),
    tokensUsed: 4321,
    model: 'gpt-4.1',
    competitorSet: [
      { competitorId: 'a', domain: 'a.com', type: 'DIRECT' },
      { competitorId: 'b', domain: 'b.com', type: 'DIRECT' },
    ],
    crossChart: { crossChartSummary: 'sum', strongestDifferentiation: 'diff', targetAudienceSegment: 'seg' },
    charts: [
      {
        key: 'core',
        kind: 'CORE',
        order: 0,
        name: 'Core chart',
        xLabel: 'X',
        yLabel: 'Y',
        marketPattern: 'pattern',
        opportunity: 'opp',
        contentAngles: [{ angle: 'ang', audienceSegment: 'seg' }],
        whiteSpace: { xBand: 0, yBand: 2, nearestCompetitorDistance: 3.2 },
        scores: [
          { competitorId: null, name: 'us', domain: 'us.com', type: 'TARGET', xScore: 5, yScore: 5, xReason: 'r', yReason: 'r', evidenceRefs: [], confidence: 0.9, estimated: false },
          { competitorId: 'a', name: 'A', domain: 'a.com', type: 'DIRECT', xScore: 2, yScore: 3, xReason: 'r', yReason: 'r', evidenceRefs: [], confidence: 0.9, estimated: false },
          { competitorId: 'b', name: 'B', domain: 'b.com', type: 'DIRECT', xScore: 7, yScore: 8, xReason: 'r', yReason: 'r', evidenceRefs: [], confidence: 0.9, estimated: false },
        ],
      },
    ],
    ...overrides,
  };
}

function setup(opts: { run?: unknown; overrides?: unknown[]; competitors?: unknown[]; insights?: unknown; brandSummary?: unknown } = {}) {
  prismaMock.matrixRun.findFirst.mockResolvedValue('run' in opts ? opts.run : run());
  prismaMock.matrixOverride.findMany.mockResolvedValue(opts.overrides ?? []);
  prismaMock.competitor.findMany.mockResolvedValue(opts.competitors ?? [competitor('a'), competitor('b')]);
  prismaMock.workspace.findUnique.mockResolvedValue({
    brandSummary: opts.brandSummary ?? null,
    audienceInsights: 'insights' in opts ? opts.insights : { other: { keep: true }, competitiveMatrices: { token_usage: 9, legacy: true } },
  });
  prismaMock.workspace.update.mockResolvedValue({});
}

beforeEach(() => vi.clearAllMocks());

describe('rebuildMatricesProjection', () => {
  it('returns null and writes nothing when there is no DONE run', async () => {
    setup({ run: null });
    expect(await rebuildMatricesProjection('ws-1')).toBeNull();
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
    expect(prismaMock.matrixRun.findFirst.mock.calls[0][0].where).toMatchObject({ workspaceId: 'ws-1', status: 'DONE' });
  });

  it('applies an override and records the AI number', async () => {
    setup({ overrides: [{ chartKey: 'core', competitorId: null, xScore: 9, yScore: null, note: 'mine' }] });
    const result = await rebuildMatricesProjection('ws-1');
    const us = result!.charts[0].companies[0];
    expect(us.x_score).toBe(9);
    expect(us.override).toEqual({ ai_x_score: 5, ai_y_score: 5, note: 'mine' });
    expect(result!.tokens_used).toBe(4321);
    expect(result!.stale).toBe(false);
    expect(result!.cross_chart_summary).toBe('sum');
  });

  it('keeps other audienceInsights keys and replaces the legacy blob entirely', async () => {
    setup();
    await rebuildMatricesProjection('ws-1');
    const data = prismaMock.workspace.update.mock.calls[0][0].data.audienceInsights;
    expect(data.other).toEqual({ keep: true });
    expect(data.competitiveMatrices.run_id).toBe('run_1');
    expect(data.competitiveMatrices.token_usage).toBeUndefined();
    expect(data.competitiveMatrices.legacy).toBeUndefined();
  });

  it('resolves evidence refs against current competitor rows and the brand summary', async () => {
    const r = run();
    r.charts[0].scores[0].evidenceRefs = [ownId('We sell x')] as never;
    r.charts[0].scores[1].evidenceRefs = ['ab12cd34'] as never;
    r.charts[0].scores[2].evidenceRefs = ['dead0000'] as never;
    setup({
      run: r,
      brandSummary: { tagline: '  We sell x  ' },
      competitors: [
        { ...competitor('a'), evidence: [{ id: 'ab12cd34', url: 'https://a.com/p', title: 'A page', kind: 'site' }] },
        competitor('b'),
      ],
    });
    const [us, a, b] = (await rebuildMatricesProjection('ws-1'))!.charts[0].companies;
    expect(us.evidence).toEqual([{ id: ownId('We sell x'), url: '', title: 'We sell x' }]);
    expect(a.evidence).toEqual([{ id: 'ab12cd34', url: 'https://a.com/p', title: 'A page' }]);
    expect(b.evidence_missing).toBe(true);
    expect(b.estimated).toBe(true);
  });

  it('returns null without writing when the run basis is not a valid one', async () => {
    setup({ run: run({ basis: 'NONE' }) });
    expect(await rebuildMatricesProjection('ws-1')).toBeNull();
    expect(prismaMock.workspace.update).not.toHaveBeenCalled();
  });

  it('coerces a bad token count to 0', async () => {
    setup({ run: run({ tokensUsed: null }) });
    expect((await rebuildMatricesProjection('ws-1'))!.tokens_used).toBe(0);
  });

  it('writes when audienceInsights was empty', async () => {
    setup({ insights: null });
    await rebuildMatricesProjection('ws-1');
    const data = prismaMock.workspace.update.mock.calls[0][0].data.audienceInsights;
    expect(Object.keys(data)).toEqual(['competitiveMatrices']);
  });

  it('ignores an override for a deleted competitor', async () => {
    setup({
      competitors: [competitor('b')],
      overrides: [{ chartKey: 'core', competitorId: 'a', xScore: 9, yScore: 9, note: null }],
    });
    const result = await rebuildMatricesProjection('ws-1');
    const a = result!.charts[0].companies.find((c) => c.name === 'A')!;
    expect(a.x_score).toBe(2);
    expect(a.override).toBeUndefined();
  });

  it('marks the projection stale when a competitor was accepted after the run', async () => {
    setup({ competitors: [competitor('a'), competitor('b'), competitor('c')] });
    expect((await rebuildMatricesProjection('ws-1'))!.stale).toBe(true);
  });

  it('projects the stored white space and the run model', async () => {
    setup({ overrides: [{ chartKey: 'core', competitorId: null, xScore: 1, yScore: 9, note: null }] });
    const result = (await rebuildMatricesProjection('ws-1'))!;
    expect(result.charts[0].white_space).toEqual({ xBand: 0, yBand: 2, nearestCompetitorDistance: 3.2 });
    expect(result.model).toBe('gpt-4.1');
  });

  it('projects a malformed stored white space as none, and a missing model as null', async () => {
    const bad = run({ model: null });
    (bad.charts[0] as Record<string, unknown>).whiteSpace = { xBand: 7, yBand: 'x' };
    setup({ run: bad });
    const result = (await rebuildMatricesProjection('ws-1'))!;
    expect(result.charts[0].white_space).toBeNull();
    expect(result.model).toBeNull();
  });

  it('is not stale with 13 selected competitors when the run holds the capped 12', async () => {
    const ids = Array.from({ length: 13 }, (_, i) => `c${String(i + 1).padStart(2, '0')}`);
    setup({
      run: run({ competitorSet: ids.slice(0, 12).map((id) => ({ competitorId: id, domain: `${id}.com`, type: 'DIRECT' })) }),
      competitors: [...ids].reverse().map((id) => competitor(id)),
    });
    expect((await rebuildMatricesProjection('ws-1'))!.stale).toBe(false);
  });

  it('turns malformed JSON columns into empty values instead of throwing', async () => {
    setup({
      run: run({
        competitorSet: 'garbage',
        crossChart: 42,
        charts: [{ ...run().charts[0], contentAngles: { nope: true } }],
      }),
      competitors: [],
    });
    const result = await rebuildMatricesProjection('ws-1');
    expect(result!.cross_chart_summary).toBe('');
    expect(result!.strongest_differentiation_opportunity).toBe('');
    expect(result!.target_audience_segment).toBe('');
    expect(result!.charts[0].content_angles).toEqual([]);
    expect(result!.stale).toBe(false);
  });
});

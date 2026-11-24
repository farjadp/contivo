import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, runLogMock } = vi.hoisted(() => ({
  prismaMock: {
    competitor: { count: vi.fn() },
    contentItem: { findMany: vi.fn() },
    socialPublishJob: { findMany: vi.fn() },
    socialConnection: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
  },
  runLogMock: { readRunRows: vi.fn(), countOtherAngles: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('./run-log', () => runLogMock);

import { loadFirstPostState } from './load';

const now = Date.now();
const at = (minAgo: number) => new Date(now - minAgo * 60_000);

const FINISHED_ROWS = [
  { id: 'fpr_ws1_1', action: 'FIRST_POST_RUN_STARTED', detail: { runId: 'fpr_ws1_1', attempt: 1, accepted: 2 }, createdAt: at(5) },
  { id: 'r2', action: 'FIRST_POST_RUN_FINISHED', detail: { runId: 'fpr_ws1_1', contentItemId: 'item-1', approved: true }, createdAt: at(1) },
];

const MATRICES = { run_id: 'mr', competitor_basis: 'ACCEPTED', charts: [{}, {}, {}, {}] };
const KEYWORDS = { competitors: [{}, {}], content_gaps: [{ topic: 'Audit checklists' }, { topic: 'x' }] };

beforeEach(() => {
  vi.clearAllMocks();
  runLogMock.readRunRows.mockResolvedValue([]);
  runLogMock.countOtherAngles.mockResolvedValue(0);
  prismaMock.competitor.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
    where.userDecision === 'ACCEPTED' ? 1 : 4,
  );
  prismaMock.contentItem.findMany.mockResolvedValue([]);
  prismaMock.socialPublishJob.findMany.mockResolvedValue([]);
  prismaMock.socialConnection.findFirst.mockResolvedValue(null);
  prismaMock.workspace.findFirst.mockResolvedValue({
    audienceInsights: { competitiveMatrices: MATRICES, competitorKeywordsIntel: KEYWORDS },
  });
});

describe('loadFirstPostState', () => {
  it('no run yet: confirm with the competitor counts, no draft, and the why-facts from audienceInsights', async () => {
    const result = await loadFirstPostState('u1', 'ws1');

    expect(result.state).toEqual({ phase: 'confirm', accepted: 1, suggestions: 4 });
    expect(result.draft).toBeNull();
    expect(result.otherAnglesUsed).toBe(0);
    expect(result.why).toEqual({ matrixCharts: 4, matricesReady: true, keywordCompetitors: 2, gaps: 2, topGap: 'Audit checklists' });
    expect(result.facts.linkedIn).toEqual({ connected: false });

    // suggestions = every row except REJECTED, nulls included
    const suggestionsWhere = prismaMock.competitor.count.mock.calls.map((c) => c[0].where).find((w) => w.OR);
    expect(suggestionsWhere).toEqual({
      workspaceId: 'ws1',
      OR: [{ userDecision: null }, { userDecision: { not: 'REJECTED' } }],
    });
    expect(prismaMock.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ws1', userId: 'u1' } }),
    );
    expect(prismaMock.contentItem.findMany).not.toHaveBeenCalled();
  });

  it('a finished run: draft phase with the item, owner-scoped, and the default connected LinkedIn account', async () => {
    runLogMock.readRunRows.mockResolvedValue(FINISHED_ROWS);
    runLogMock.countOtherAngles.mockResolvedValue(2);
    prismaMock.contentItem.findMany.mockResolvedValue([
      { id: 'item-1', status: 'GENERATED', publishedAtUtc: null, content: 'Post text', topic: 'Why audits', qualityVerdict: { approved: true } },
    ]);
    prismaMock.socialConnection.findFirst.mockResolvedValue({ accountName: 'Sara Ahmadi' });

    const result = await loadFirstPostState('u1', 'ws1');

    expect(prismaMock.contentItem.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['item-1'] },
      workspaceId: 'ws1',
      userId: 'u1',
    });
    expect(prismaMock.socialConnection.findFirst.mock.calls[0][0].where).toEqual({
      workspaceId: 'ws1',
      platform: 'LINKEDIN',
      status: 'CONNECTED',
      isDefault: true,
    });
    expect(result.state).toEqual({
      phase: 'draft',
      contentItemId: 'item-1',
      approved: true,
      linkedIn: { connected: true, accountName: 'Sara Ahmadi' },
    });
    expect(result.draft).toEqual({ id: 'item-1', content: 'Post text', topic: 'Why audits', qualityVerdict: { approved: true } });
    expect(result.otherAnglesUsed).toBe(2);
  });

  it('the draft is "approved" by its stored verdict now, not the run row (Check again / edit / Publish anyway move it)', async () => {
    const rows = [
      FINISHED_ROWS[0],
      { ...FINISHED_ROWS[1], detail: { runId: 'fpr_ws1_1', contentItemId: 'item-1', approved: false } },
    ];
    runLogMock.readRunRows.mockResolvedValue(rows);
    const item = (qualityVerdict: unknown) => [
      { id: 'item-1', status: 'GENERATED', publishedAtUtc: null, content: 'Post', topic: 't', qualityVerdict },
    ];

    prismaMock.contentItem.findMany.mockResolvedValue(item({ approved: true }));
    expect((await loadFirstPostState('u1', 'ws1')).state).toMatchObject({ phase: 'draft', approved: true });

    prismaMock.contentItem.findMany.mockResolvedValue(item({ approved: false, rejectedBy: 'low_score' }));
    expect((await loadFirstPostState('u1', 'ws1')).state).toMatchObject({ phase: 'draft', approved: false });

    prismaMock.contentItem.findMany.mockResolvedValue(item({ approved: false, rejectedBy: 'low_score', override: { by: 'u1' } }));
    expect((await loadFirstPostState('u1', 'ws1')).state).toMatchObject({ phase: 'draft', approved: true });
  });

  it("'Why this post' names the gap the current draft is about, or none, never a stale top gap", async () => {
    runLogMock.readRunRows.mockResolvedValue(FINISHED_ROWS);
    const item = (topic: string) => [
      { id: 'item-1', status: 'GENERATED', publishedAtUtc: null, content: 'Post', topic, qualityVerdict: null },
    ];
    prismaMock.workspace.findFirst.mockResolvedValue({
      audienceInsights: {
        competitiveMatrices: MATRICES,
        competitorKeywordsIntel: { competitors: [{}, {}], content_gaps: [{ topic: 'Audit checklists' }, { topic: 'Remote onboarding' }] },
      },
    });

    prismaMock.contentItem.findMany.mockResolvedValue(item('Remote onboarding that sticks'));
    expect((await loadFirstPostState('u1', 'ws1')).why.topGap).toBe('Remote onboarding');

    prismaMock.contentItem.findMany.mockResolvedValue(item('Why our founders still answer support'));
    expect((await loadFirstPostState('u1', 'ws1')).why.topGap).toBeNull();
  });

  it('a published item: the newest publish job gives the URL, through safePostUrl', async () => {
    runLogMock.readRunRows.mockResolvedValue(FINISHED_ROWS);
    prismaMock.contentItem.findMany.mockResolvedValue([
      { id: 'item-1', status: 'PUBLISHED', publishedAtUtc: at(0), content: 'Post', topic: 't', qualityVerdict: null },
    ]);
    prismaMock.socialPublishJob.findMany.mockResolvedValue([
      { contentItemId: 'item-1', status: 'PUBLISHED', externalPostUrl: 'https://www.linkedin.com/feed/update/1', publishedAtUtc: at(0) },
      { contentItemId: 'item-1', status: 'FAILED', externalPostUrl: 'javascript:alert(1)', publishedAtUtc: null },
    ]);

    const result = await loadFirstPostState('u1', 'ws1');

    expect(prismaMock.socialPublishJob.findMany.mock.calls[0][0]).toMatchObject({
      where: { contentItemId: { in: ['item-1'] }, workspaceId: 'ws1' },
      orderBy: { createdAt: 'desc' },
    });
    expect(result.state).toMatchObject({ phase: 'published', url: 'https://www.linkedin.com/feed/update/1' });
  });

  it('a deleted item reads as confirm and has no draft', async () => {
    runLogMock.readRunRows.mockResolvedValue(FINISHED_ROWS);
    const result = await loadFirstPostState('u1', 'ws1');
    expect(result.state.phase).toBe('confirm');
    expect(result.draft).toBeNull();
  });

  it('missing intelligence gives zeros and null, never invented values', async () => {
    prismaMock.workspace.findFirst.mockResolvedValue({ audienceInsights: null });
    const { why } = await loadFirstPostState('u1', 'ws1');
    expect(why).toEqual({ matrixCharts: 0, matricesReady: false, keywordCompetitors: 0, gaps: 0, topGap: null });
  });

  it('a database error is thrown, not read as an empty state', async () => {
    runLogMock.readRunRows.mockRejectedValue(new Error('db down'));
    await expect(loadFirstPostState('u1', 'ws1')).rejects.toThrow('db down');
  });
});

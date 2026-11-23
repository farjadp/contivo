import { beforeEach, describe, expect, it, vi } from 'vitest';

// runFirstPost(runId): the background run. Each step calls the same function
// the manual UI calls; nothing here charges credits. One test at the bottom
// runs the REAL ideateForWorkspace, so the real loadIdeationContext and
// matricesGate decide on fixture data.

const h = vi.hoisted(() => ({
  prismaMock: {
    workspace: { findFirst: vi.fn(), findUnique: vi.fn() },
    matrixRun: { findUnique: vi.fn(), findFirst: vi.fn() },
    competitor: { findMany: vi.fn() },
    contentItem: { findMany: vi.fn() },
  },
  runLog: {
    readRunStarted: vi.fn(),
    claimRun: vi.fn(),
    writeStepRow: vi.fn(),
    readRunRows: vi.fn(),
  },
  startRun: { createMatrixRunRow: vi.fn() },
  pipeline: { runMatrixPipeline: vi.fn() },
  keywords: { generateCompetitorKeywordsCore: vi.fn() },
  engine: {
    ideate: vi.fn(),
    preview: vi.fn(),
    save: vi.fn(),
    actual: null as null | typeof import('@/lib/content-engine'),
  },
  credits: { chargeCredits: vi.fn() },
  gemini: { ideas: vi.fn(), draft: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: h.prismaMock }));
vi.mock('./run-log', () => h.runLog);
vi.mock('@/lib/matrices/start-run', () => h.startRun);
vi.mock('@/lib/matrices/pipeline', () => h.pipeline);
vi.mock('@/lib/competitor-keywords/generate', () => h.keywords);
vi.mock('@/lib/credits', () => h.credits);
vi.mock('@/lib/content-engine', async (orig) => {
  const actual = await orig<typeof import('@/lib/content-engine')>();
  h.engine.actual = actual;
  return {
    ...actual,
    ideateForWorkspace: (...args: unknown[]) => h.engine.ideate(...args),
    generateDraftPreviewCore: (...args: unknown[]) => h.engine.preview(...args),
    saveIdeaToPipelineCore: (...args: unknown[]) => h.engine.save(...args),
  };
});
// Only reached by the real ideateForWorkspace in the integration test.
vi.mock('@/lib/gemini', () => ({
  generateContentIdeasWithGemini: h.gemini.ideas,
  generateContentDraftWithGemini: h.gemini.draft,
}));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: vi.fn() }));
vi.mock('@/lib/framework-metadata-log', () => ({
  logFrameworkMetadata: vi.fn(),
  getLatestFrameworkMetadataForContentItem: vi.fn(),
}));
vi.mock('@/lib/app-settings', () => ({
  getIdeationMaxContentCount: vi.fn(async () => 10),
  getContentWordCountLimits: vi.fn(),
  getDefaultScheduleDelayHours: vi.fn(async () => 24),
}));
vi.mock('@/lib/humanize', () => ({ humanizeDraft: vi.fn() }));
vi.mock('@/lib/content-image', () => ({ generateImageOutcome: vi.fn() }));
vi.mock('@/lib/narrative/context', () => ({ loadStorylineContext: vi.fn(), storylinePromptBlock: vi.fn() }));

import { runFirstPost } from './run';

const RUN = 'fpr_ws1_1';
const ACTOR = { userId: 'u1', workspaceId: 'ws1' };

function chart(key: string) {
  return { chart_key: key, companies: [{ competitor_id: null }, { competitor_id: 'c1' }, { competitor_id: 'c2' }] };
}
const GOOD_MATRICES = {
  run_id: 'mr-old',
  competitor_basis: 'ACCEPTED',
  charts: [chart('a'), chart('b'), chart('c'), chart('d')],
};
const TWO_CHARTS = { ...GOOD_MATRICES, charts: [chart('a'), chart('b')] };
const KEYWORDS = {
  competitors: [{ domain: 'c1.com' }, { domain: 'c2.com' }],
  content_gaps: [{ topic: 'Audit checklists' }, { topic: 'Second' }],
};

function workspace(audienceInsights: unknown = null) {
  return {
    id: 'ws1',
    userId: 'u1',
    name: 'Acme',
    brandSummary: { valueProposition: 'We sell things' },
    contentLanguage: 'EN',
    audienceInsights,
  };
}

const IDEA = { topic: 'Why audits matter', angle: 'a', format: 'LinkedIn post', pillar: 'p', channel: 'linkedin' };

function rows() {
  return h.runLog.writeStepRow.mock.calls.map((c) => ({ action: c[0].action, ...c[0].detail }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.runLog.readRunStarted.mockResolvedValue({ runId: RUN, userId: 'u1', workspaceId: 'ws1', kind: 'start' });
  h.runLog.claimRun.mockResolvedValue(true);
  h.runLog.writeStepRow.mockResolvedValue(undefined);
  h.runLog.readRunRows.mockResolvedValue([]);
  h.prismaMock.workspace.findFirst.mockResolvedValue(workspace());
  h.prismaMock.matrixRun.findFirst.mockResolvedValue({ competitorSet: [{ competitorId: 'c1' }, { competitorId: 'c2' }] });
  h.prismaMock.matrixRun.findUnique.mockResolvedValue({ status: 'DONE', error: null });
  h.prismaMock.competitor.findMany.mockResolvedValue([
    { id: 'c1', userDecision: 'ACCEPTED' },
    { id: 'c2', userDecision: 'ACCEPTED' },
  ]);
  h.prismaMock.contentItem.findMany.mockResolvedValue([]);
  h.startRun.createMatrixRunRow.mockResolvedValue({ ok: true, runId: 'mr-new' });
  h.pipeline.runMatrixPipeline.mockResolvedValue(undefined);
  h.keywords.generateCompetitorKeywordsCore.mockResolvedValue({ ok: true, payload: KEYWORDS });
  h.engine.ideate.mockResolvedValue({ ideas: [IDEA] });
  h.engine.preview.mockResolvedValue({
    success: true,
    preview: 'one two three four five',
    verdict: { approved: true },
    verdictToken: 'tok',
  });
  h.engine.save.mockResolvedValue({ success: true, id: 'item-1', channel: 'linkedin', status: 'GENERATED' });
});

describe('runFirstPost: the full chain', () => {
  it('runs matrices (autoAxes 2) → keywords → idea → draft with the spec options, and writes the rows in order', async () => {
    h.prismaMock.workspace.findFirst
      .mockResolvedValueOnce(workspace())
      .mockResolvedValueOnce(workspace({ competitiveMatrices: GOOD_MATRICES }));

    await runFirstPost(RUN);

    expect(h.prismaMock.workspace.findFirst.mock.calls[0][0].where).toEqual({ id: 'ws1', userId: 'u1' });
    expect(h.startRun.createMatrixRunRow).toHaveBeenCalledWith({ userId: 'u1', workspace: workspace() });
    expect(h.pipeline.runMatrixPipeline).toHaveBeenCalledWith('mr-new', { autoAxes: 2 });
    expect(h.keywords.generateCompetitorKeywordsCore).toHaveBeenCalledWith(ACTOR);
    expect(h.engine.ideate).toHaveBeenCalledWith(ACTOR, {
      platform: 'linkedin',
      requestedIdeaCount: 1,
      selectionMode: 'auto',
      includeImages: false,
      autoInsertToCalendar: false,
    });
    expect(h.engine.preview).toHaveBeenCalledWith(ACTOR, IDEA);
    expect(h.engine.save).toHaveBeenCalledWith(
      ACTOR,
      { ...IDEA, auto_insert_to_calendar: false },
      { body: 'one two three four five', verdictToken: 'tok' },
    );

    const written = rows();
    expect(written.map((r) => `${r.action}:${r.step ?? ''}`)).toEqual([
      'FIRST_POST_STEP_DONE:matrices',
      'FIRST_POST_STEP_DONE:keywords',
      'FIRST_POST_STEP_DONE:idea',
      'FIRST_POST_STEP_DONE:draft',
      'FIRST_POST_RUN_FINISHED:',
    ]);
    expect(written.every((r) => r.runId === RUN)).toBe(true);
    expect(written[0].summary).toEqual({ charts: 4, competitors: 2 });
    expect(written[1].summary).toEqual({ competitors: 2, gaps: 2, topGap: 'Audit checklists' });
    expect(written[2].summary).toEqual({ topic: 'Why audits matter' });
    expect(written[3].summary).toEqual({ words: 5, approved: 1 });
    expect(typeof written[0].ms).toBe('number');
    expect(written[4]).toMatchObject({ contentItemId: 'item-1', approved: true });

    expect(h.credits.chargeCredits).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown run, or one someone else already claimed', async () => {
    h.runLog.readRunStarted.mockResolvedValueOnce(null);
    await runFirstPost('nope');
    h.runLog.claimRun.mockResolvedValueOnce(false);
    await runFirstPost(RUN);

    expect(h.runLog.writeStepRow).not.toHaveBeenCalled();
    expect(h.startRun.createMatrixRunRow).not.toHaveBeenCalled();
  });

  it('fails the first step as generic when the workspace is gone or not the run owner\'s', async () => {
    h.prismaMock.workspace.findFirst.mockResolvedValue(null);
    await runFirstPost(RUN);
    expect(rows()).toEqual([{ action: 'FIRST_POST_STEP_FAILED', runId: RUN, step: 'matrices', errorKind: 'generic' }]);
  });
});

describe('runFirstPost: skips what is already satisfied (retry)', () => {
  it('skips matrices when the gate is ok and not stale, and keywords when present, with stored summaries', async () => {
    h.prismaMock.workspace.findFirst.mockResolvedValue(
      workspace({ competitiveMatrices: GOOD_MATRICES, competitorKeywordsIntel: KEYWORDS }),
    );

    await runFirstPost(RUN);

    expect(h.startRun.createMatrixRunRow).not.toHaveBeenCalled();
    expect(h.keywords.generateCompetitorKeywordsCore).not.toHaveBeenCalled();
    const written = rows();
    expect(written.slice(0, 2)).toEqual([
      { action: 'FIRST_POST_STEP_SKIPPED', runId: RUN, step: 'matrices', summary: { charts: 4, competitors: 2 } },
      {
        action: 'FIRST_POST_STEP_SKIPPED',
        runId: RUN,
        step: 'keywords',
        summary: { competitors: 2, gaps: 2, topGap: 'Audit checklists' },
      },
    ]);
    expect(written.at(-1)?.action).toBe('FIRST_POST_RUN_FINISHED');
  });

  it('re-runs matrices when the competitor set moved since the last DONE run (stale)', async () => {
    h.prismaMock.competitor.findMany.mockResolvedValue([
      { id: 'c1', userDecision: 'ACCEPTED' },
      { id: 'c2', userDecision: 'ACCEPTED' },
      { id: 'c3', userDecision: 'ACCEPTED' },
    ]);
    h.prismaMock.workspace.findFirst.mockResolvedValue(
      workspace({ competitiveMatrices: GOOD_MATRICES, competitorKeywordsIntel: KEYWORDS }),
    );

    await runFirstPost(RUN);

    expect(h.pipeline.runMatrixPipeline).toHaveBeenCalledWith('mr-new', { autoAxes: 2 });
    expect(rows()[0]).toMatchObject({ action: 'FIRST_POST_STEP_DONE', step: 'matrices' });
  });
});

describe('runFirstPost: failures stop the run with a closed errorKind', () => {
  it('a keywords failure writes STEP_FAILED notEnoughCompetitorSignals and stops', async () => {
    h.prismaMock.workspace.findFirst.mockResolvedValue(workspace({ competitiveMatrices: GOOD_MATRICES }));
    h.keywords.generateCompetitorKeywordsCore.mockResolvedValue({ ok: false, errorKey: 'notEnoughCompetitorSignals' });

    await runFirstPost(RUN);

    expect(rows().map((r) => r.action)).toEqual(['FIRST_POST_STEP_SKIPPED', 'FIRST_POST_STEP_FAILED']);
    expect(rows()[1]).toEqual({
      action: 'FIRST_POST_STEP_FAILED',
      runId: RUN,
      step: 'keywords',
      errorKind: 'notEnoughCompetitorSignals',
    });
    expect(h.engine.ideate).not.toHaveBeenCalled();
  });

  it('maps the other keyword keys: keywordsAiFailed → aiUnavailable, anything else → generic', async () => {
    h.prismaMock.workspace.findFirst.mockResolvedValue(workspace({ competitiveMatrices: GOOD_MATRICES }));
    h.keywords.generateCompetitorKeywordsCore.mockResolvedValueOnce({ ok: false, errorKey: 'keywordsAiFailed' });
    await runFirstPost(RUN);
    h.keywords.generateCompetitorKeywordsCore.mockResolvedValueOnce({ ok: false, errorKey: 'keywordsFailed' });
    await runFirstPost(RUN);

    const failed = rows().filter((r) => r.action === 'FIRST_POST_STEP_FAILED');
    expect(failed.map((r) => r.errorKind)).toEqual(['aiUnavailable', 'generic']);
  });

  it('a FAILED matrix run maps through classifyRunError, never the raw text', async () => {
    h.prismaMock.matrixRun.findUnique.mockResolvedValue({
      status: 'FAILED',
      error: 'NOT_ENOUGH_EVIDENCE: 1 of 2 competitors have evidence to score',
    });

    await runFirstPost(RUN);

    expect(rows()).toEqual([
      { action: 'FIRST_POST_STEP_FAILED', runId: RUN, step: 'matrices', errorKind: 'notEnoughEvidence' },
    ]);
    expect(h.keywords.generateCompetitorKeywordsCore).not.toHaveBeenCalled();
  });

  it('a DONE matrix run whose charts still fail matricesGate is notEnoughAxes', async () => {
    h.prismaMock.workspace.findFirst
      .mockResolvedValueOnce(workspace())
      .mockResolvedValueOnce(workspace({ competitiveMatrices: TWO_CHARTS }));

    await runFirstPost(RUN);

    expect(rows()).toEqual([{ action: 'FIRST_POST_STEP_FAILED', runId: RUN, step: 'matrices', errorKind: 'notEnoughAxes' }]);
  });

  it('a matrix run that cannot be created fails the step as generic', async () => {
    h.startRun.createMatrixRunRow.mockResolvedValue({ ok: false, errorKey: 'matrixAlreadyRunning' });
    await runFirstPost(RUN);
    expect(rows()).toEqual([{ action: 'FIRST_POST_STEP_FAILED', runId: RUN, step: 'matrices', errorKind: 'generic' }]);
    expect(h.pipeline.runMatrixPipeline).not.toHaveBeenCalled();
  });

  it('an ideation error fails idea; an AI draft failure fails draft as aiUnavailable; a save error fails draft', async () => {
    h.prismaMock.workspace.findFirst.mockResolvedValue(
      workspace({ competitiveMatrices: GOOD_MATRICES, competitorKeywordsIntel: KEYWORDS }),
    );

    h.engine.ideate.mockResolvedValueOnce({ error: 'Failed to generate ideas.' });
    await runFirstPost(RUN);
    h.engine.preview.mockResolvedValueOnce({ error: 'AI generation failed' });
    await runFirstPost(RUN);
    h.engine.save.mockResolvedValueOnce({ error: 'Failed to save to pipeline.' });
    await runFirstPost(RUN);

    const failed = rows().filter((r) => r.action === 'FIRST_POST_STEP_FAILED');
    expect(failed.map((r) => `${r.step}:${r.errorKind}`)).toEqual(['idea:generic', 'draft:aiUnavailable', 'draft:generic']);
    expect(rows().some((r) => r.action === 'FIRST_POST_RUN_FINISHED')).toBe(false);
  });

  it('an unexpected throw is recorded as a generic failure of the step it was on', async () => {
    h.prismaMock.workspace.findFirst.mockResolvedValue(
      workspace({ competitiveMatrices: GOOD_MATRICES, competitorKeywordsIntel: KEYWORDS }),
    );
    h.engine.ideate.mockRejectedValue(new Error('boom: sk-secret in message'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runFirstPost(RUN);
    spy.mockRestore();

    expect(rows().at(-1)).toEqual({ action: 'FIRST_POST_STEP_FAILED', runId: RUN, step: 'idea', errorKind: 'generic' });
  });
});

describe('runFirstPost: other angle', () => {
  it('runs idea + draft only, steering away from every earlier first-post topic', async () => {
    h.runLog.readRunStarted.mockResolvedValue({ runId: 'fpr_ws1_2', userId: 'u1', workspaceId: 'ws1', kind: 'otherAngle' });
    h.prismaMock.workspace.findFirst.mockResolvedValue(
      workspace({ competitiveMatrices: GOOD_MATRICES, competitorKeywordsIntel: KEYWORDS }),
    );
    h.runLog.readRunRows.mockResolvedValue([
      { id: 'f1', action: 'FIRST_POST_RUN_FINISHED', detail: { runId: RUN, contentItemId: 'item-0', approved: true }, createdAt: new Date() },
    ]);
    h.prismaMock.contentItem.findMany.mockResolvedValue([{ topic: 'Why audits matter' }]);

    await runFirstPost('fpr_ws1_2');

    expect(h.prismaMock.contentItem.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ['item-0'] },
      workspaceId: 'ws1',
      userId: 'u1',
    });
    expect(h.startRun.createMatrixRunRow).not.toHaveBeenCalled();
    expect(h.keywords.generateCompetitorKeywordsCore).not.toHaveBeenCalled();
    const options = h.engine.ideate.mock.calls[0][1];
    expect(options).toMatchObject({
      platform: 'linkedin',
      requestedIdeaCount: 1,
      selectionMode: 'auto',
      includeImages: false,
      autoInsertToCalendar: false,
    });
    expect(options.steeringNotes).toContain('Why audits matter');
    expect(rows().map((r) => `${r.action}:${r.step ?? ''}`)).toEqual([
      'FIRST_POST_STEP_SKIPPED:matrices',
      'FIRST_POST_STEP_SKIPPED:keywords',
      'FIRST_POST_STEP_DONE:idea',
      'FIRST_POST_STEP_DONE:draft',
      'FIRST_POST_RUN_FINISHED:',
    ]);
  });
});

describe('runFirstPost with the real ideation gate (loadIdeationContext not mocked)', () => {
  beforeEach(() => {
    h.engine.ideate.mockImplementation((...args: unknown[]) =>
      (h.engine.actual!.ideateForWorkspace as (...a: unknown[]) => unknown)(...args),
    );
    h.gemini.ideas.mockResolvedValue({
      ideas: [{ topic: 'Real idea', angle: 'a', format: 'LinkedIn post', pillar: 'p' }],
      framework: { framework_id: 'pas', framework_name: 'PAS', framework_category: 'social', selection_mode: 'auto', selection_reason: 'r' },
      quality_scores: {},
      fallback_used: false,
      fallback_framework_id: null,
    });
  });

  it('the real gate refuses 2 charts: the idea step fails and the model is never called', async () => {
    // otherAngle skips matrices without checking, so only the real gate stands between 2 charts and ideation.
    h.runLog.readRunStarted.mockResolvedValue({ runId: 'fpr_ws1_2', userId: 'u1', workspaceId: 'ws1', kind: 'otherAngle' });
    const ws = workspace({ competitiveMatrices: TWO_CHARTS, competitorKeywordsIntel: KEYWORDS });
    h.prismaMock.workspace.findFirst.mockResolvedValue(ws);
    h.prismaMock.workspace.findUnique.mockResolvedValue(ws);

    await runFirstPost('fpr_ws1_2');

    expect(h.prismaMock.workspace.findUnique).toHaveBeenCalledWith({ where: { id: 'ws1', userId: 'u1' } });
    expect(h.gemini.ideas).not.toHaveBeenCalled();
    expect(rows().at(-1)).toEqual({ action: 'FIRST_POST_STEP_FAILED', runId: 'fpr_ws1_2', step: 'idea', errorKind: 'generic' });
  });

  it('the real gate passes 4 charts + keywords: the model gets the matrices, one LinkedIn idea, no calendar insert', async () => {
    const ws = workspace({ competitiveMatrices: GOOD_MATRICES, competitorKeywordsIntel: KEYWORDS });
    h.prismaMock.workspace.findFirst.mockResolvedValue(ws);
    h.prismaMock.workspace.findUnique.mockResolvedValue(ws);

    await runFirstPost(RUN);

    expect(h.gemini.ideas).toHaveBeenCalledTimes(1);
    const options = h.gemini.ideas.mock.calls[0][1];
    expect(options).toMatchObject({
      platform: 'linkedin',
      requestedIdeaCount: 1,
      includeImages: false,
      autoInsertToCalendar: false,
      competitorBasis: 'ACCEPTED',
    });
    expect(options.marketMatrices).toBe(GOOD_MATRICES);
    expect(h.engine.preview.mock.calls[0][1]).toMatchObject({ topic: 'Real idea', channel: 'linkedin' });
    expect(rows().at(-1)?.action).toBe('FIRST_POST_RUN_FINISHED');
  });
});

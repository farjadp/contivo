import { beforeEach, describe, expect, it, vi } from 'vitest';

// The per-agent "Review drafts before they publish" switch
// (AutopilotPolicy.requireReview, spec 2026-11-22 Decisions point 3).
// Off: a gate-approved draft stays SCHEDULED, exactly as before.
// On: it is held as GENERATED (the pipeline's finished-draft state, which
// nothing publishes) with its proposed slot. Either way the judge's provider
// and model are in the run log. Prisma, the engine, credits and the gate are
// mocked; no network, no database.

const { prismaMock, engine, evaluateDraftMock } = vi.hoisted(() => ({
  prismaMock: {
    autopilotPolicy: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    autopilotRun: { create: vi.fn(), update: vi.fn() },
    contentItem: { findMany: vi.fn(), update: vi.fn() },
    socialConnection: { findMany: vi.fn() },
    siteConnection: { count: vi.fn() },
  },
  engine: {
    loadIdeationContext: vi.fn(),
    ideateForWorkspace: vi.fn(),
    saveIdeaToPipelineCore: vi.fn(),
    generateDraftForItem: vi.fn(),
  },
  evaluateDraftMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/content-engine', () => engine);
vi.mock('./quality-gate', () => ({ evaluateDraft: evaluateDraftMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: vi.fn() }));
vi.mock('@/lib/narrative/context', () => ({ pickStorylineForWorkspace: vi.fn(async () => null) }));
vi.mock('@/lib/ai-usage', () => ({
  runWithAiContext: (_ctx: unknown, fn: () => unknown) => fn(),
  setAiContext: vi.fn(),
}));
vi.mock('@/lib/credits', () => ({
  AI_OPERATION_COST: { AUTOPILOT_IDEATION: 2, AUTOPILOT_DRAFT_ATTEMPT: 7 },
  InsufficientCreditsError: class extends Error {},
  canAfford: vi.fn(async () => true),
  chargeCredits: vi.fn(async () => 100),
  getCreditBalance: vi.fn(async () => 100),
}));
const SLOT = new Date('2026-11-24T15:00:00.000Z');
vi.mock('./schedule', () => ({ pickPublishSlots: vi.fn(() => [SLOT]) }));

import { InsufficientCreditsError, canAfford, chargeCredits, getCreditBalance } from '@/lib/credits';
import { CHANNEL_TO_PLATFORM } from './channels';
import { AUTOPILOT_RUN_ERROR } from './run-errors';
import { runPolicy } from './runner';

function policy(requireReview: boolean) {
  return {
    id: 'agent-1',
    userId: 'user-1',
    workspaceId: 'ws-1',
    enabled: true,
    channels: ['linkedin'],
    postsPerWeek: 1,
    timezone: 'America/Toronto',
    windowStartHour: 9,
    windowEndHour: 17,
    publishDays: [1, 2, 3, 4, 5],
    goal: null,
    topicHints: [],
    avoidTopics: [],
    storylineIds: [],
    requireReview,
  };
}

const APPROVED = {
  approved: true,
  rejectedBy: null,
  reasons: [],
  checks: [],
  scores: { brandFit: 9, factualSafety: 9, clarity: 9, storylineFit: null, evidenceDiscipline: null },
  judge: 'anthropic',
  judgeModel: 'claude-opus-5-5',
};

function runLog(): Array<Record<string, unknown>> {
  const call = prismaMock.autopilotRun.update.mock.calls.at(-1);
  return (call?.[0]?.data?.log ?? []) as Array<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.autopilotPolicy.update.mockResolvedValue({});
  prismaMock.autopilotRun.create.mockResolvedValue({ id: 'run-1' });
  prismaMock.autopilotRun.update.mockResolvedValue({});
  prismaMock.contentItem.findMany.mockResolvedValue([]);
  prismaMock.contentItem.update.mockResolvedValue({});
  prismaMock.socialConnection.findMany.mockResolvedValue([{ platform: CHANNEL_TO_PLATFORM.linkedin }]);
  prismaMock.siteConnection.count.mockResolvedValue(0);
  engine.loadIdeationContext.mockResolvedValue({ brandSummary: {}, workspace: { contentLanguage: 'en' } });
  engine.ideateForWorkspace.mockResolvedValue({ ideas: [{ topic: 'Plan content around real questions' }] });
  engine.saveIdeaToPipelineCore.mockResolvedValue({ id: 'item-1' });
  engine.generateDraftForItem.mockResolvedValue({ item: { content: 'A finished draft body.' } });
});

describe('runner: requireReview', () => {
  it('off: an approved draft keeps the scheduled path and is never touched after the gate', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(false));
    evaluateDraftMock.mockResolvedValue(APPROVED);

    const result = await runPolicy('agent-1');

    expect(result.status).toBe('SUCCEEDED');
    expect(result.itemsScheduled).toBe(1);
    // generateDraftForItem made it SCHEDULED; nothing moves it afterwards.
    expect(prismaMock.contentItem.update).not.toHaveBeenCalled();
    const scheduled = runLog().find((e) => e.step === 'scheduled');
    expect(scheduled).toMatchObject({ itemId: 'item-1', judge: 'anthropic', judgeModel: 'claude-opus-5-5' });
    expect(runLog().some((e) => e.step === 'held_for_review')).toBe(false);
  });

  it('on: an approved draft is held as GENERATED, keeps its proposed slot, and the run still succeeds', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(true));
    evaluateDraftMock.mockResolvedValue(APPROVED);

    const result = await runPolicy('agent-1');

    expect(prismaMock.contentItem.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.contentItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { status: 'GENERATED' },
    });
    expect(result.itemsScheduled).toBe(0);
    // A held draft fills its slot: not a failed run, no 3-hour retry that
    // would write more drafts for the same week.
    expect(result.status).toBe('SUCCEEDED');
    const held = runLog().find((e) => e.step === 'held_for_review');
    expect(held).toMatchObject({
      itemId: 'item-1',
      proposedSlot: SLOT.toISOString(),
      judge: 'anthropic',
      judgeModel: 'claude-opus-5-5',
    });
    expect(runLog().some((e) => e.step === 'scheduled')).toBe(false);
  });

  it('on: a held draft of this agent counts as occupying its slot on the next run', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(true));
    evaluateDraftMock.mockResolvedValue(APPROVED);

    await runPolicy('agent-1');

    const agentQuery = prismaMock.contentItem.findMany.mock.calls[0][0];
    expect(agentQuery.where).toMatchObject({
      agentId: 'agent-1',
      OR: [{ status: { in: ['SCHEDULED', 'PUBLISHING', 'PUBLISHED'] } }, { status: 'GENERATED', agentId: 'agent-1' }],
    });
  });

  it.each([false, true])('requireReview=%s: no judge available → draft pulled back to DRAFT, never scheduled', async (rr) => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(rr));
    evaluateDraftMock.mockResolvedValue({
      approved: false,
      rejectedBy: 'judge_unavailable',
      reasons: ['Quality judge unavailable — holding the draft rather than publishing it unreviewed.'],
      checks: [],
      scores: null,
      judge: 'unavailable',
      judgeModel: null,
    });

    const result = await runPolicy('agent-1');

    expect(prismaMock.contentItem.update).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: expect.objectContaining({ status: 'DRAFT', scheduledAtUtc: null }),
    });
    expect(result.itemsScheduled).toBe(0);
    expect(result.status).toBe('FAILED');
    expect(runLog().find((e) => e.step === 'gate_rejected')).toMatchObject({
      rejectedBy: 'judge_unavailable',
      judge: 'unavailable',
      judgeModel: null,
    });
  });
});

describe('runner: LinkedIn sign-in past its expiry', () => {
  const NOW = new Date('2026-11-22T12:00:00.000Z');

  it('skips the channel with the stable code, writes no status, and the run says why', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(false));
    prismaMock.socialConnection.findMany.mockResolvedValue([
      { platform: 'LINKEDIN', status: 'CONNECTED', tokenExpiresAt: new Date('2026-10-17T03:51:00Z') },
    ]);

    const result = await runPolicy('agent-1', { now: NOW });

    expect(result.status).toBe('SKIPPED');
    expect(result.reason).toBe('LINKEDIN_RECONNECT_REQUIRED');
    expect(runLog().find((e) => e.step === 'channel_skipped')).toMatchObject({
      channel: 'linkedin',
      code: 'LINKEDIN_RECONNECT_REQUIRED',
    });
    expect(engine.ideateForWorkspace).not.toHaveBeenCalled();
    // The API's 401 path owns status changes; the runner only reads.
    expect(prismaMock.socialConnection).not.toHaveProperty('update');
  });

  it('a token that is still valid publishes as before', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(false));
    evaluateDraftMock.mockResolvedValue(APPROVED);
    prismaMock.socialConnection.findMany.mockResolvedValue([
      { platform: 'LINKEDIN', status: 'CONNECTED', tokenExpiresAt: new Date('2026-11-25T00:00:00Z') },
    ]);

    const result = await runPolicy('agent-1', { now: NOW });

    expect(result.status).toBe('SUCCEEDED');
    expect(runLog().some((e) => e.step === 'channel_skipped')).toBe(false);
  });
});

// When a run stops for credits, the stored `error` is a stable code the UI
// translates, not an English sentence rendered verbatim in Persian.
describe('runner: out of credits', () => {
  function storedError(): unknown {
    return prismaMock.autopilotRun.update.mock.calls.at(-1)?.[0]?.data?.error;
  }

  it('below one run at the start: SKIPPED with OUT_OF_CREDITS, nothing ideated', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(false));
    vi.mocked(getCreditBalance).mockResolvedValueOnce(8);

    const result = await runPolicy('agent-1');

    expect(result.status).toBe('SKIPPED');
    expect(storedError()).toBe(AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS);
    expect(result.reason).toBe(AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS);
    expect(engine.ideateForWorkspace).not.toHaveBeenCalled();
    expect(runLog().find((e) => e.step === 'out_of_credits')).toMatchObject({ balance: 8, needed: 9 });
  });

  it('runs dry before the first draft: SKIPPED with OUT_OF_CREDITS_MID_RUN', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(false));
    // ideation affordable, the draft attempt is not
    vi.mocked(canAfford).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await runPolicy('agent-1');

    expect(result.status).toBe('SKIPPED');
    expect(storedError()).toBe(AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS_MID_RUN);
    expect(engine.generateDraftForItem).not.toHaveBeenCalled();
  });

  it('cannot afford ideation mid-run: reported as out of credits, not as a failed run', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(false));
    vi.mocked(canAfford).mockResolvedValueOnce(false);

    const result = await runPolicy('agent-1');

    expect(result.status).toBe('SKIPPED');
    expect(storedError()).toBe(AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS_MID_RUN);
  });

  it('balance raced away between check and charge: same code, not the English exception text', async () => {
    prismaMock.autopilotPolicy.findUnique.mockResolvedValue(policy(false));
    vi.mocked(chargeCredits).mockRejectedValueOnce(new InsufficientCreditsError(1, 2));

    const result = await runPolicy('agent-1');

    expect(result.status).toBe('SKIPPED');
    expect(storedError()).toBe(AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS_MID_RUN);
  });
});

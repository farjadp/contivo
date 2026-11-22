import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, activityLogMock, evaluateMock } = vi.hoisted(() => ({
  prismaMock: { contentItem: { findMany: vi.fn() } },
  activityLogMock: vi.fn(),
  evaluateMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => ({ writeActivityLog: activityLogMock }));
vi.mock('@/lib/autopilot/quality-gate', () => ({ evaluateDraft: evaluateMock }));
vi.mock('@/lib/narrative/context', () => ({ loadStorylineContext: vi.fn(async () => null) }));

import {
  enforceQualityGate,
  isBlockedVerdict,
  notCheckedVerdict,
  QualityGateBlockedError,
  runManualGate,
} from './quality-verdict';

const actor = { userId: 'user-a', workspaceId: 'ws-a' };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.contentItem.findMany.mockResolvedValue([{ content: 'An older post' }]);
});

describe('isBlockedVerdict', () => {
  it('never blocks an ungated item (null)', () => {
    expect(isBlockedVerdict(null)).toBe(false);
    expect(isBlockedVerdict(undefined)).toBe(false);
  });
  it('blocks a failed or not-checked verdict, and a malformed one', () => {
    expect(isBlockedVerdict({ approved: false, rejectedBy: 'low_score' })).toBe(true);
    expect(isBlockedVerdict(notCheckedVerdict('pipeline'))).toBe(true);
    expect(isBlockedVerdict({ nonsense: 1 })).toBe(true);
  });
  it('passes an approved verdict and an overridden fail', () => {
    expect(isBlockedVerdict({ approved: true })).toBe(false);
    expect(isBlockedVerdict({ approved: false, override: { userId: 'u', at: 'x' } })).toBe(false);
  });
});

describe('runManualGate', () => {
  it('calls the gate once with runner-equivalent context', async () => {
    evaluateMock.mockResolvedValue({
      approved: true,
      rejectedBy: null,
      reasons: [],
      checks: [],
      scores: null,
      judge: 'openai',
      judgeModel: 'm',
    });
    const v = await runManualGate({
      actor,
      workspace: { brandSummary: { industry: 'x' }, contentLanguage: 'FA' },
      content: 'Body',
      topic: 'Topic',
      channel: 'linkedin',
      excludeItemId: 'item-1',
      source: 'pipeline',
    });
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(evaluateMock.mock.calls[0][0]).toMatchObject({
      content: 'Body',
      topic: 'Topic',
      channel: 'linkedin',
      brandSummary: { industry: 'x' },
      recentContents: ['An older post'],
      language: 'FA',
      aiContext: actor,
    });
    expect(prismaMock.contentItem.findMany.mock.calls[0][0].where).toMatchObject({
      workspaceId: 'ws-a',
      id: { not: 'item-1' },
    });
    expect(v).toMatchObject({ approved: true, source: 'pipeline', judge: 'openai' });
  });

  it('stores a gate crash as gate_unavailable, never a pass', async () => {
    evaluateMock.mockRejectedValue(new Error('boom'));
    const v = await runManualGate({
      actor,
      workspace: { brandSummary: {} },
      content: 'Body',
      topic: 'T',
      channel: 'linkedin',
      source: 'preview',
    });
    expect(v).toMatchObject({ approved: false, rejectedBy: 'gate_unavailable' });
  });
});

describe('enforceQualityGate', () => {
  const blocked = { id: 'item-1', workspaceId: 'ws-a', qualityVerdict: { approved: false, rejectedBy: 'low_score', reasons: ['r'], judgeModel: 'm' } };

  it('does nothing for an ungated or approved item', async () => {
    expect(await enforceQualityGate({ item: { ...blocked, qualityVerdict: null }, userId: 'user-a' })).toBeNull();
    expect(await enforceQualityGate({ item: { ...blocked, qualityVerdict: { approved: true } }, userId: 'user-a' })).toBeNull();
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('refuses a blocked item without an override', async () => {
    await expect(enforceQualityGate({ item: blocked, userId: 'user-a' })).rejects.toBeInstanceOf(QualityGateBlockedError);
    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('records who overrode and when', async () => {
    const next = await enforceQualityGate({ item: blocked, userId: 'user-a', override: true });
    expect(next?.override?.userId).toBe('user-a');
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'QUALITY_GATE_OVERRIDDEN',
        workspaceId: 'ws-a',
        detail: expect.objectContaining({ itemId: 'item-1', rejectedBy: 'low_score', reasons: ['r'], judgeModel: 'm' }),
      }),
    );
  });
});

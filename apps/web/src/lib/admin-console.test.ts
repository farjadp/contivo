import { beforeEach, describe, expect, it, vi } from 'vitest';

// The admin "AI providers" card: failovers grouped per task over the last
// 24 h, answered-by counts per provider, live health merged with the table.
// No database: prisma and the AI layer are mocked.

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    aiProviderEvent: { findMany: vi.fn() },
    aiUsageLog: { groupBy: vi.fn() },
  },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/ai', () => ({
  PROVIDER_IDS: ['openai', 'anthropic', 'gemini'],
  getProviderHealthSnapshot: vi.fn(() => []),
  sanitizeAiMessage: (value: string) => value.replace(/sk-[a-z0-9-]+/gi, '[redacted]'),
}));
vi.mock('@/lib/app-settings', () => ({}));
vi.mock('@/lib/admin-state', () => ({}));
vi.mock('@/lib/framework-metadata-log', () => ({}));
vi.mock('@/lib/activity-log', () => ({}));
vi.mock('@/lib/competitor-counts', () => ({ COUNTED_COMPETITOR_WHERE: {} }));

import { getAdminAiProviders, summariseAiFailovers, type AiProviderEventRow } from './admin-console';

const NOW = new Date('2026-11-22T12:00:00Z');
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000);

function event(partial: Partial<AiProviderEventRow>): AiProviderEventRow {
  return {
    provider: 'openai',
    task: 'competitor_judge',
    errorClass: 'billing',
    status: 429,
    message: null,
    failedOverTo: 'anthropic',
    eventType: 'attempt_failed',
    createdAt: at(1),
    ...partial,
  };
}

const healthy = (provider: string) => ({
  provider,
  configured: true,
  healthy: true,
  coolingDownUntil: null,
  reason: null,
  lastErrorClass: null,
  lastErrorAt: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.aiProviderEvent.findMany.mockResolvedValue([]);
  prismaMock.aiUsageLog.groupBy.mockResolvedValue([]);
});

describe('summariseAiFailovers', () => {
  it('groups failovers, unrecovered attempts and all-unavailable per task', () => {
    const summary = summariseAiFailovers([
      event({ createdAt: at(1) }),
      event({ createdAt: at(3) }),
      event({ provider: 'anthropic', failedOverTo: 'gemini', createdAt: at(2) }),
      event({ provider: 'gemini', failedOverTo: null, createdAt: at(2) }),
      event({ eventType: 'all_unavailable', failedOverTo: null, createdAt: at(2) }),
      event({ task: 'content_draft', createdAt: at(5) }),
      event({ eventType: 'health_changed', task: 'content_draft' }),
    ]);

    expect(summary).toHaveLength(2);
    expect(summary[0]).toEqual({
      task: 'competitor_judge',
      failovers: 3,
      allUnavailable: 1,
      unrecovered: 1,
      routes: [
        { from: 'openai', to: 'anthropic', count: 2 },
        { from: 'anthropic', to: 'gemini', count: 1 },
      ],
      lastAt: at(1),
    });
    expect(summary[1]).toMatchObject({ task: 'content_draft', failovers: 1, allUnavailable: 0, unrecovered: 0 });
  });

  it('ignores health_changed events', () => {
    expect(summariseAiFailovers([event({ eventType: 'health_changed' })])).toEqual([]);
  });
});

describe('getAdminAiProviders', () => {
  it('reads only the last 24 h of events and usage', async () => {
    await getAdminAiProviders({ now: NOW, snapshot: () => [] });

    const since = at(24);
    expect(prismaMock.aiProviderEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { gte: since } } }),
    );
    expect(prismaMock.aiUsageLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ by: ['provider'], where: { createdAt: { gte: since } } }),
    );
  });

  it('merges live health with the newest recorded failure and counts answers per provider', async () => {
    prismaMock.aiProviderEvent.findMany.mockResolvedValue([
      event({ createdAt: at(1), message: 'no credits for key sk-proj-abc123' }),
      event({ createdAt: at(4), errorClass: 'rate_limit' }),
    ]);
    prismaMock.aiUsageLog.groupBy.mockResolvedValue([
      { provider: 'openai', _count: { _all: 2 }, _sum: { estimatedCostUsd: 0.01 } },
      { provider: 'anthropic', _count: { _all: 9 }, _sum: { estimatedCostUsd: 0.2 } },
      { provider: null, _count: { _all: 1 }, _sum: { estimatedCostUsd: null } },
    ]);
    const cooling = new Date(NOW.getTime() + 3_600_000);

    const result = await getAdminAiProviders({
      now: NOW,
      snapshot: () => [
        { ...healthy('openai'), healthy: false, coolingDownUntil: cooling, reason: 'billing', lastErrorClass: 'billing', lastErrorAt: at(6) },
        healthy('anthropic'),
        { ...healthy('gemini'), configured: false },
      ] as never,
    });

    expect(result.providers[0]).toEqual({
      provider: 'openai',
      configured: true,
      healthy: false,
      coolingDownUntil: cooling,
      reason: 'billing',
      lastErrorClass: 'billing',
      lastErrorAt: at(1),
      failedAttempts: 2,
    });
    expect(result.providers[2]).toMatchObject({ provider: 'gemini', configured: false, failedAttempts: 0 });
    expect(result.answeredBy).toEqual([
      { provider: 'anthropic', requests: 9, costUsd: 0.2 },
      { provider: 'openai', requests: 2, costUsd: 0.01 },
      { provider: null, requests: 1, costUsd: 0 },
    ]);
    expect(result.recentEvents[0].message).toBe('no credits for key [redacted]');
    expect(result.failoversByTask[0]).toMatchObject({ task: 'competitor_judge', failovers: 2 });
  });

  it('degrades instead of throwing when the events table or live health is unavailable', async () => {
    prismaMock.aiProviderEvent.findMany.mockRejectedValue(new Error('relation "ai_provider_events" does not exist'));

    const result = await getAdminAiProviders({
      now: NOW,
      snapshot: () => {
        throw new Error('runner failed');
      },
    });

    expect(result.eventsAvailable).toBe(false);
    expect(result.liveHealthAvailable).toBe(false);
    expect(result.usageAvailable).toBe(true);
    expect(result.providers.map((p) => p.healthy)).toEqual([null, null, null]);
    expect(result.failoversByTask).toEqual([]);
  });
});

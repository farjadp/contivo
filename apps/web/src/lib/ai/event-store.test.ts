import { describe, expect, it, vi } from 'vitest';

const findMany = vi.fn();
vi.mock('@/lib/db', () => ({ prisma: { aiProviderEvent: { findMany, create: vi.fn() } } }));

import { FORCED_MARKER, createAlertSink, createPrismaEventStore, type AiProviderEventRow } from './alert';

describe('createPrismaEventStore.latestCriticalSince', () => {
  it('never restores an AI_FORCE_FAIL row as a cool-down (where clause + row filter)', async () => {
    const at = new Date('2026-11-22T10:00:00Z');
    findMany.mockResolvedValueOnce([
      { provider: 'openai', errorClass: 'billing', createdAt: at, message: `${FORCED_MARKER} cooling down until …` },
      { provider: 'openai', errorClass: 'billing', createdAt: new Date(at.getTime() - 1000), message: `${FORCED_MARKER} forced billing failure` },
      { provider: 'gemini', errorClass: 'auth', createdAt: at, message: 'API key not valid' },
    ]);
    const events = await createPrismaEventStore().latestCriticalSince(new Date(at.getTime() - 900_000));
    expect(events).toEqual([{ provider: 'gemini', errorClass: 'auth', createdAt: at }]);
    expect(findMany.mock.calls[0][0].where.NOT).toEqual({ message: { startsWith: FORCED_MARKER } });
  });

  it('a forced failure marks its health_changed row too', () => {
    const rows: AiProviderEventRow[] = [];
    const sink = createAlertSink({
      store: { insert: async (row) => void rows.push(row), latestCriticalSince: async () => [] },
      sentry: { captureMessage: vi.fn() } as never,
      log: { error: vi.fn(), warn: vi.fn() },
    });
    sink.healthChanged({ provider: 'openai', change: 'billing', coolingDownUntil: Date.now() }, 'keywords', {}, true);
    sink.healthChanged({ provider: 'openai', change: 'billing', coolingDownUntil: Date.now() }, 'keywords', {});
    expect(rows[0].message?.startsWith(FORCED_MARKER)).toBe(true);
    expect(rows[1].message?.startsWith(FORCED_MARKER)).toBe(false);
  });
});

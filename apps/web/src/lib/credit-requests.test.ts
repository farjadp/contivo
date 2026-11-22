import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log', () => ({ ensureActivityLogTables: vi.fn() }));

import { AUTOPILOT_RUN_COST } from '@/lib/credit-costs';
import { rankLowCreditUsers, type LowCreditRow } from './credit-requests';

function row(over: Partial<LowCreditRow>): LowCreditRow {
  return {
    userId: 'u',
    email: 'u@example.com',
    name: null,
    balance: 0,
    ledgerRows: 1,
    lastRequestAt: null,
    lastAdminAdjustmentAt: null,
    ...over,
  };
}

const NOW = new Date('2026-11-22T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

describe('rankLowCreditUsers', () => {
  it('one run is ideation + one draft attempt', () => {
    expect(AUTOPILOT_RUN_COST).toBe(9);
  });

  it('keeps balances under one run and drops the rest unless they asked', () => {
    const ranked = rankLowCreditUsers(
      [
        row({ userId: 'nine', balance: 9 }),
        row({ userId: 'eight', balance: 8 }),
        row({ userId: 'zero', balance: 0 }),
        row({ userId: 'rich-asked', balance: 40, lastRequestAt: hoursAgo(2) }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.userId)).toEqual(['rich-asked', 'zero', 'eight']);
  });

  it('puts pending requests first, newest request first, then lowest balance', () => {
    const ranked = rankLowCreditUsers(
      [
        row({ userId: 'low-5', balance: 5 }),
        row({ userId: 'asked-old', balance: 3, lastRequestAt: hoursAgo(48) }),
        row({ userId: 'low-0', balance: 0 }),
        row({ userId: 'asked-new', balance: 7, lastRequestAt: hoursAgo(1) }),
      ],
      NOW,
    );
    expect(ranked.map((r) => r.userId)).toEqual(['asked-new', 'asked-old', 'low-0', 'low-5']);
    expect(ranked.map((r) => r.pending)).toEqual([true, true, false, false]);
  });

  it('a request answered by a later admin adjustment is no longer pending', () => {
    const [r] = rankLowCreditUsers(
      [row({ userId: 'handled', balance: 2, lastRequestAt: hoursAgo(10), lastAdminAdjustmentAt: hoursAgo(5) })],
      NOW,
    );
    expect(r.pending).toBe(false);
  });

  it('a request newer than the last adjustment is pending', () => {
    const [r] = rankLowCreditUsers(
      [row({ userId: 'again', balance: 2, lastRequestAt: hoursAgo(1), lastAdminAdjustmentAt: hoursAgo(30) })],
      NOW,
    );
    expect(r.pending).toBe(true);
  });

  it('a request older than seven days is not pending', () => {
    const ranked = rankLowCreditUsers(
      [
        row({ userId: 'stale-low', balance: 1, lastRequestAt: hoursAgo(24 * 8) }),
        row({ userId: 'stale-rich', balance: 50, lastRequestAt: hoursAgo(24 * 8) }),
      ],
      NOW,
    );
    expect(ranked.map((r) => [r.userId, r.pending])).toEqual([['stale-low', false]]);
  });
});

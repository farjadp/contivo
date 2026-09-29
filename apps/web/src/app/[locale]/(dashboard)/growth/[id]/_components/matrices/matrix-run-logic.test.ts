import { describe, expect, it } from 'vitest';

import type { MatrixStatus } from '@/app/actions/growth-matrices';
import {
  MATRIX_STAGE_ORDER,
  MAX_AXES_SELECTED,
  MAX_POLL_MS,
  POLL_INTERVAL_MS,
  basisNotice,
  canSubmitAxes,
  emptyStateReason,
  isMatrixRunActive,
  matricesStale,
  healedMatrices,
  runModel,
  selectChart,
  refusalDuplicatesRun,
  renameAxis,
  shouldKeepPolling,
  stageIndex,
  toggleAxis,
} from './matrix-run-logic';

const status = (over: Partial<MatrixStatus>): MatrixStatus => ({
  run: null,
  savedAxes: [],
  basis: 'ACCEPTED',
  competitorCount: 3,
  hasBrandSummary: true,
  stale: false,
  matrices: null,
  ...over,
});

const axis = (key: string) => ({
  key,
  x: { label: `${key} x`, low: 'lo', high: 'hi' },
  y: { label: `${key} y`, low: 'lo', high: 'hi' },
  rationale: 'why',
});

describe('constants', () => {
  it('polls every 3s for at most 15 minutes', () => {
    expect(POLL_INTERVAL_MS).toBe(3000);
    expect(MAX_POLL_MS).toBe(15 * 60 * 1000);
    expect(MATRIX_STAGE_ORDER).toEqual(['AXES', 'SCORE', 'SUMMARISE', 'SAVE']);
    expect(MAX_AXES_SELECTED).toBe(3);
  });
});

describe('isMatrixRunActive', () => {
  it('is true only for PENDING and RUNNING', () => {
    expect(isMatrixRunActive('PENDING')).toBe(true);
    expect(isMatrixRunActive('RUNNING')).toBe(true);
    for (const s of ['NEEDS_AXES', 'DONE', 'FAILED', null, undefined, 'x']) {
      expect(isMatrixRunActive(s)).toBe(false);
    }
  });
});

describe('shouldKeepPolling', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  it('stops with no run or a finished run', () => {
    expect(shouldKeepPolling(null, now)).toBe(false);
    expect(shouldKeepPolling({ status: 'DONE', startedAt: '2026-09-29T11:59:00Z' }, now)).toBe(false);
    expect(shouldKeepPolling({ status: 'NEEDS_AXES', startedAt: '2026-09-29T11:59:00Z' }, now)).toBe(false);
  });
  it('keeps going while active and inside the ceiling', () => {
    expect(shouldKeepPolling({ status: 'RUNNING', startedAt: '2026-09-29T11:59:00Z' }, now)).toBe(true);
  });
  it('gives up past the ceiling', () => {
    expect(shouldKeepPolling({ status: 'RUNNING', startedAt: '2026-09-29T11:40:00Z' }, now)).toBe(false);
  });
  it('keeps polling when the start time is unreadable', () => {
    expect(shouldKeepPolling({ status: 'PENDING', startedAt: 'nope' }, now)).toBe(true);
  });
});

describe('stageIndex', () => {
  it('maps known stages and -1 otherwise', () => {
    expect(stageIndex('AXES')).toBe(0);
    expect(stageIndex('SAVE')).toBe(3);
    expect(stageIndex('QUERIES')).toBe(-1);
    expect(stageIndex(null)).toBe(-1);
  });
});

describe('emptyStateReason', () => {
  it('names competitors first', () => {
    expect(emptyStateReason(status({ competitorCount: 0, hasBrandSummary: false }))).toBe('competitors');
    expect(emptyStateReason(status({ competitorCount: 0, basis: 'NONE' }))).toBe('competitors');
  });
  it('then the brand summary', () => {
    expect(emptyStateReason(status({ hasBrandSummary: false }))).toBe('brandSummary');
  });
  it('is null when a run can start', () => {
    expect(emptyStateReason(status({}))).toBeNull();
  });
});

describe('basisNotice', () => {
  it('is legacy without a run_id', () => {
    expect(basisNotice({ competitor_basis: 'ACCEPTED' })).toBe('legacy');
    expect(basisNotice({ run_id: '', competitor_basis: 'ACCEPTED' })).toBe('legacy');
    expect(basisNotice(null)).toBe('legacy');
    expect(basisNotice('junk')).toBe('legacy');
  });
  it('is unconfirmed for UNCONFIRMED_HIGH', () => {
    expect(basisNotice({ run_id: 'r1', competitor_basis: 'UNCONFIRMED_HIGH' })).toBe('unconfirmed');
  });
  it('is accepted otherwise', () => {
    expect(basisNotice({ run_id: 'r1', competitor_basis: 'ACCEPTED' })).toBe('accepted');
    expect(basisNotice({ run_id: 'r1' })).toBe('accepted');
  });
});

describe('axes selection', () => {
  it('toggles on and off', () => {
    expect(toggleAxis(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleAxis(['a', 'b'], 'a')).toEqual(['b']);
  });
  it('refuses a fourth', () => {
    expect(toggleAxis(['a', 'b', 'c'], 'd')).toEqual(['a', 'b', 'c']);
  });
  it('cannot submit with none', () => {
    expect(canSubmitAxes([])).toBe(false);
    expect(canSubmitAxes(['a'])).toBe(true);
    expect(canSubmitAxes(['a', 'b', 'c', 'd'])).toBe(false);
  });
  it('renames both labels and leaves low/high and key alone', () => {
    const renamed = renameAxis([axis('a'), axis('b')], 'a', { x: 'New X', y: 'New Y' });
    expect(renamed[0]).toEqual({
      ...axis('a'),
      x: { label: 'New X', low: 'lo', high: 'hi' },
      y: { label: 'New Y', low: 'lo', high: 'hi' },
    });
    expect(renamed[1]).toEqual(axis('b'));
  });
});

describe('refusalDuplicatesRun', () => {
  const failed = (id: string, errorKind: string | null) => ({ id, status: 'FAILED', errorKind });
  it('keeps the error when an old failed run is on screen', () => {
    expect(refusalDuplicatesRun(failed('old', 'dispatch'), 'old')).toBe(false);
    expect(refusalDuplicatesRun(failed('old', 'generic'), 'old')).toBe(false);
  });
  it('drops the error for a new dispatch-failed run', () => {
    expect(refusalDuplicatesRun(failed('new', 'dispatch'), 'old')).toBe(true);
    expect(refusalDuplicatesRun(failed('new', 'dispatch'), null)).toBe(true);
  });
  it('keeps the error for a new run that failed some other way, or a non-failed run', () => {
    expect(refusalDuplicatesRun(failed('new', 'generic'), 'old')).toBe(false);
    expect(refusalDuplicatesRun({ id: 'new', status: 'DONE', errorKind: null }, 'old')).toBe(false);
  });
  it('keeps the error with no run', () => {
    expect(refusalDuplicatesRun(null, 'old')).toBe(false);
  });
});

describe('matricesStale', () => {
  it('trusts the status, which compares the competitor set on read', () => {
    expect(matricesStale({ stale: true }, { stale: false })).toBe(true);
    expect(matricesStale({ stale: false }, { stale: true })).toBe(false);
  });
  it('falls back to the saved blob only when there is no status yet', () => {
    expect(matricesStale(null, { stale: true })).toBe(true);
    expect(matricesStale(null, {})).toBe(false);
  });
});

describe('selectChart', () => {
  const charts = [{ chart_key: 'a' }, { chart_key: 'b' }];
  it('returns the chart the user picked', () => {
    expect(selectChart(charts, 'b')).toEqual({ chart_key: 'b' });
  });
  it('falls back to the first chart when the picked key is not in this result', () => {
    // After the first run (key was a placeholder) or a regenerate over a legacy blob.
    expect(selectChart(charts, 'price_value_depth')).toEqual({ chart_key: 'a' });
  });
  it('is null with no charts', () => {
    expect(selectChart([], 'a')).toBeNull();
    expect(selectChart(undefined, 'a')).toBeNull();
  });
});

describe('runModel', () => {
  it('prefers the model the projection carries, then the legacy last-run model', () => {
    expect(runModel({ model: 'gpt-4.1', token_usage: { last_run: { model: 'old' } } })).toBe('gpt-4.1');
    expect(runModel({ model: null, token_usage: { last_run: { model: 'old' } } })).toBe('old');
    expect(runModel({})).toBeNull();
  });
});

describe('healedMatrices', () => {
  it('returns the status blob when it is from a different run than the one shown', () => {
    const healed = { run_id: 'r2', charts: [] };
    expect(healedMatrices({ run_id: 'r1', charts: [] }, healed)).toBe(healed);
    expect(healedMatrices(null, healed)).toBe(healed);
    expect(healedMatrices({ charts: [] }, healed)).toBe(healed);
  });
  it('is null when the run is the same or the status carries no current-pipeline blob', () => {
    expect(healedMatrices({ run_id: 'r1' }, { run_id: 'r1' })).toBeNull();
    expect(healedMatrices({ run_id: 'r1' }, null)).toBeNull();
    expect(healedMatrices({ run_id: 'r1' }, { charts: [] })).toBeNull();
  });
});

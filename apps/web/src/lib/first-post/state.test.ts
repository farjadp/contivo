import { describe, expect, it } from 'vitest';

import { deriveFirstPostState } from './state';
import {
  FIRST_POST_RUN_FINISHED,
  FIRST_POST_RUN_STARTED,
  FIRST_POST_STALE_MS,
  FIRST_POST_STEP_DONE,
  FIRST_POST_STEP_FAILED,
  FIRST_POST_STEP_SKIPPED,
  firstPostRunId,
  type FirstPostFacts,
  type FirstPostLogRow,
} from './types';

const WS = 'ws1';
const T0 = Date.parse('2026-11-23T10:00:00Z');
const MIN = 60_000;
const at = (minutes: number) => new Date(T0 + minutes * MIN);

let seq = 0;
const row = (action: string, detail: Record<string, unknown>, minutes: number, id?: string): FirstPostLogRow => ({
  id: id ?? `row_${++seq}`,
  action,
  detail,
  createdAt: at(minutes),
});

const started = (attempt: number, minutes: number) => {
  const runId = firstPostRunId(WS, attempt);
  return row(FIRST_POST_RUN_STARTED, { runId, attempt, accepted: 2 }, minutes, runId);
};
const done = (attempt: number, step: string, minutes: number, summary: Record<string, string | number> = {}) =>
  row(FIRST_POST_STEP_DONE, { runId: firstPostRunId(WS, attempt), step, ms: 1000, summary }, minutes);
const skipped = (attempt: number, step: string, minutes: number, summary?: Record<string, string | number>) =>
  row(FIRST_POST_STEP_SKIPPED, { runId: firstPostRunId(WS, attempt), step, ...(summary ? { summary } : {}) }, minutes);
const failed = (attempt: number, step: string, errorKind: string, minutes: number) =>
  row(FIRST_POST_STEP_FAILED, { runId: firstPostRunId(WS, attempt), step, errorKind }, minutes);
const finished = (attempt: number, contentItemId: string, approved: boolean, minutes: number) =>
  row(FIRST_POST_RUN_FINISHED, { runId: firstPostRunId(WS, attempt), contentItemId, approved }, minutes);

const facts = (overrides: Partial<FirstPostFacts> = {}): FirstPostFacts => ({
  accepted: 2,
  suggestions: 5,
  items: {},
  latestJobByItem: {},
  linkedIn: { connected: false },
  ...overrides,
});

describe('deriveFirstPostState', () => {
  it('is confirm with no run rows', () => {
    expect(deriveFirstPostState([], facts({ accepted: 1, suggestions: 7 }), at(0))).toEqual({
      phase: 'confirm',
      accepted: 1,
      suggestions: 7,
    });
  });

  it('is running on the first step right after the start', () => {
    expect(deriveFirstPostState([started(1, 0)], facts(), at(1))).toEqual({
      phase: 'running',
      runId: 'fpr_ws1_1',
      done: [],
      current: 'matrices',
      startedAt: at(0).toISOString(),
    });
  });

  it('reports finished and skipped steps with their stored summaries, and the next step as current', () => {
    const rows = [
      started(1, 0),
      skipped(1, 'matrices', 0.1, { charts: 4, competitors: 3 }),
      done(1, 'keywords', 1, { competitors: 3, gaps: 5, topGap: 'Pricing transparency' }),
    ];
    const state = deriveFirstPostState(rows, facts(), at(2));
    expect(state).toEqual({
      phase: 'running',
      runId: 'fpr_ws1_1',
      done: [
        { step: 'matrices', summary: { charts: 4, competitors: 3 }, skipped: true },
        { step: 'keywords', summary: { competitors: 3, gaps: 5, topGap: 'Pricing transparency' } },
      ],
      current: 'idea',
      startedAt: at(0).toISOString(),
    });
  });

  it('does not depend on the order the loader returns rows in', () => {
    const rows = [started(1, 0), done(1, 'matrices', 1, { charts: 4 }), done(1, 'keywords', 2)];
    expect(deriveFirstPostState([...rows].reverse(), facts(), at(3))).toEqual(
      deriveFirstPostState(rows, facts(), at(3)),
    );
  });

  it('drops summary values that are not strings or numbers', () => {
    const rows = [started(1, 0), done(1, 'matrices', 1, { charts: 4, bogus: { x: 1 } as unknown as number })];
    const state = deriveFirstPostState(rows, facts(), at(2));
    expect(state.phase === 'running' && state.done[0].summary).toEqual({ charts: 4 });
  });

  it('is failed with one retry left after the first failure of a step', () => {
    const rows = [started(1, 0), done(1, 'matrices', 1), failed(1, 'keywords', 'notEnoughCompetitorSignals', 2)];
    expect(deriveFirstPostState(rows, facts(), at(3))).toEqual({
      phase: 'failed',
      runId: 'fpr_ws1_1',
      done: [{ step: 'matrices', summary: {} }],
      failed: 'keywords',
      errorKind: 'notEnoughCompetitorSignals',
      retriesLeft: 1,
    });
  });

  it('has no retry left once the same step failed twice', () => {
    const rows = [
      started(1, 0),
      done(1, 'matrices', 1),
      failed(1, 'keywords', 'notEnoughCompetitorSignals', 2),
      started(2, 5),
      skipped(2, 'matrices', 5.1),
      failed(2, 'keywords', 'aiUnavailable', 6),
    ];
    const state = deriveFirstPostState(rows, facts(), at(7));
    expect(state).toMatchObject({ phase: 'failed', runId: 'fpr_ws1_2', failed: 'keywords', retriesLeft: 0 });
    expect(state.phase === 'failed' && state.errorKind).toBe('aiUnavailable');
  });

  it('keeps one retry when a different step failed before', () => {
    const rows = [
      started(1, 0),
      failed(1, 'matrices', 'notEnoughEvidence', 1),
      started(2, 5),
      done(2, 'matrices', 6),
      failed(2, 'keywords', 'generic', 7),
    ];
    expect(deriveFirstPostState(rows, facts(), at(8))).toMatchObject({ failed: 'keywords', retriesLeft: 1 });
  });

  it('reads an unknown error kind as generic', () => {
    const rows = [started(1, 0), failed(1, 'matrices', 'Error: 429 from provider', 1)];
    expect(deriveFirstPostState(rows, facts(), at(2))).toMatchObject({ phase: 'failed', errorKind: 'generic' });
  });

  it('pins a failure with no valid step on the step the run was on (dispatch)', () => {
    const rows = [
      started(1, 0),
      row(FIRST_POST_STEP_FAILED, { runId: firstPostRunId(WS, 1), errorKind: 'dispatch' }, 0.1),
    ];
    expect(deriveFirstPostState(rows, facts(), at(1))).toMatchObject({
      phase: 'failed',
      failed: 'matrices',
      errorKind: 'dispatch',
      retriesLeft: 1,
    });
  });

  it('turns 15 minutes of silence into a timedOut failure on the current step', () => {
    const rows = [started(1, 0), done(1, 'matrices', 1)];
    expect(deriveFirstPostState(rows, facts(), new Date(at(1).getTime() + FIRST_POST_STALE_MS - 1))).toMatchObject({
      phase: 'running',
      current: 'keywords',
    });
    expect(deriveFirstPostState(rows, facts(), new Date(at(1).getTime() + FIRST_POST_STALE_MS + 1))).toEqual({
      phase: 'failed',
      runId: 'fpr_ws1_1',
      done: [{ step: 'matrices', summary: {} }],
      failed: 'keywords',
      errorKind: 'timedOut',
      retriesLeft: 1,
    });
  });

  it('counts an earlier timed-out run as a failure of its step', () => {
    const rows = [started(1, 0), done(1, 'matrices', 1), started(2, 30), skipped(2, 'matrices', 30.1)];
    // Run 1 went silent on keywords and was superseded; run 2 now times out on keywords too.
    const state = deriveFirstPostState(rows, facts(), at(30.1 + 16));
    expect(state).toMatchObject({ phase: 'failed', runId: 'fpr_ws1_2', failed: 'keywords', retriesLeft: 0 });
  });

  it('is draft once the run finished, with the verdict and the LinkedIn state', () => {
    const rows = [
      started(1, 0),
      done(1, 'matrices', 1),
      done(1, 'keywords', 2),
      done(1, 'idea', 3),
      done(1, 'draft', 4),
      finished(1, 'ci1', false, 4),
    ];
    const linkedIn = { connected: true as const, accountName: 'Farjad P.D' };
    expect(
      deriveFirstPostState(
        rows,
        facts({ items: { ci1: { status: 'GENERATED', publishedAtUtc: null } }, linkedIn }),
        at(60),
      ),
    ).toEqual({ phase: 'draft', contentItemId: 'ci1', approved: false, linkedIn });
  });

  it('keeps a draft whose publish failed in the draft phase, so it can be published again', () => {
    const rows = [started(1, 0), finished(1, 'ci1', true, 4)];
    expect(
      deriveFirstPostState(rows, facts({ items: { ci1: { status: 'FAILED', publishedAtUtc: null } } }), at(5)),
    ).toMatchObject({ phase: 'draft', contentItemId: 'ci1', approved: true });
  });

  it('is publishing while the item is SCHEDULED or PUBLISHING', () => {
    const rows = [started(1, 0), finished(1, 'ci1', true, 4)];
    for (const status of ['SCHEDULED', 'PUBLISHING']) {
      expect(
        deriveFirstPostState(rows, facts({ items: { ci1: { status, publishedAtUtc: null } } }), at(5)),
      ).toEqual({ phase: 'publishing', contentItemId: 'ci1' });
    }
  });

  it('is published with the job URL once the item is PUBLISHED', () => {
    const rows = [started(1, 0), finished(1, 'ci1', true, 4)];
    const publishedAt = new Date('2026-11-23T10:06:00Z');
    expect(
      deriveFirstPostState(
        rows,
        facts({
          items: { ci1: { status: 'PUBLISHED', publishedAtUtc: publishedAt } },
          latestJobByItem: {
            ci1: { status: 'PUBLISHED', externalPostUrl: 'https://www.linkedin.com/feed/update/urn:li:share:1', publishedAtUtc: null },
          },
        }),
        at(10),
      ),
    ).toEqual({
      phase: 'published',
      contentItemId: 'ci1',
      url: 'https://www.linkedin.com/feed/update/urn:li:share:1',
      publishedAtUtc: publishedAt.toISOString(),
    });
  });

  it('never passes a non-http URL through, and falls back to the job publish time', () => {
    const rows = [started(1, 0), finished(1, 'ci1', true, 4)];
    const state = deriveFirstPostState(
      rows,
      facts({
        items: { ci1: { status: 'PUBLISHED', publishedAtUtc: null } },
        latestJobByItem: { ci1: { status: 'PUBLISHED', externalPostUrl: 'javascript:alert(1)', publishedAtUtc: '2026-11-23T10:07:00.000Z' } },
      }),
      at(10),
    );
    expect(state).toEqual({
      phase: 'published',
      contentItemId: 'ci1',
      url: null,
      publishedAtUtc: '2026-11-23T10:07:00.000Z',
    });
  });

  it('falls back to confirm when the finished run points at a deleted item', () => {
    const rows = [started(1, 0), finished(1, 'gone', true, 4)];
    expect(deriveFirstPostState(rows, facts({ accepted: 3, suggestions: 4 }), at(5))).toEqual({
      phase: 'confirm',
      accepted: 3,
      suggestions: 4,
    });
  });

  it('points at the newest finished item that still exists', () => {
    const rows = [started(1, 0), finished(1, 'old', true, 4), started(2, 10), finished(2, 'gone', true, 14)];
    expect(
      deriveFirstPostState(rows, facts({ items: { old: { status: 'GENERATED', publishedAtUtc: null } } }), at(20)),
    ).toMatchObject({ phase: 'draft', contentItemId: 'old' });
  });

  it('shows the newer draft after an Other angle run finished', () => {
    const rows = [started(1, 0), finished(1, 'a', true, 4), started(2, 10), finished(2, 'b', false, 12)];
    const items = { a: { status: 'GENERATED', publishedAtUtc: null }, b: { status: 'GENERATED', publishedAtUtc: null } };
    expect(deriveFirstPostState(rows, facts({ items }), at(20))).toMatchObject({
      phase: 'draft',
      contentItemId: 'b',
      approved: false,
    });
  });

  it('is running while an Other angle run is in progress after a draft', () => {
    const rows = [started(1, 0), finished(1, 'a', true, 4), started(2, 10), skipped(2, 'matrices', 10.1)];
    const items = { a: { status: 'GENERATED', publishedAtUtc: null } };
    expect(deriveFirstPostState(rows, facts({ items }), at(11))).toMatchObject({
      phase: 'running',
      runId: 'fpr_ws1_2',
      current: 'keywords',
    });
  });

  it('keeps an item that is publishing or published ahead of any later run', () => {
    const rows = [started(1, 0), finished(1, 'a', true, 4), started(2, 10)];
    const items = { a: { status: 'SCHEDULED', publishedAtUtc: null } };
    expect(deriveFirstPostState(rows, facts({ items }), at(11))).toEqual({ phase: 'publishing', contentItemId: 'a' });
  });

  it('ignores rows of other actions and rows without a run id', () => {
    const rows = [
      row('STEP_VIEWED', { tab: 'first-post' }, 0),
      row(FIRST_POST_STEP_DONE, { step: 'matrices' }, 1),
      row(FIRST_POST_RUN_FINISHED, { contentItemId: 'x', approved: true }, 2),
    ];
    expect(deriveFirstPostState(rows, facts({ items: { x: { status: 'GENERATED', publishedAtUtc: null } } }), at(3))).toEqual({
      phase: 'confirm',
      accepted: 2,
      suggestions: 5,
    });
  });
});

describe('firstPostRunId', () => {
  it('builds fpr_<workspace>_<attempt>', () => {
    expect(firstPostRunId('cmabc', 3)).toBe('fpr_cmabc_3');
  });
  it('refuses an attempt below 1 or a missing workspace', () => {
    expect(() => firstPostRunId('ws', 0)).toThrow();
    expect(() => firstPostRunId('ws', 1.5)).toThrow();
    expect(() => firstPostRunId('', 1)).toThrow();
  });
});

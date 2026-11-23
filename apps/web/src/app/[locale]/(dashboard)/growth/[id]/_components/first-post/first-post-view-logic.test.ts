import { describe, expect, it } from 'vitest';

import type { EvidenceItem } from '@/lib/competitors/types';
import type { FirstPostCompetitor, FirstPostState } from '@/lib/first-post/types';

import enTabs from '../../../../../../../../messages/en/tabs-a.json';
import faTabs from '../../../../../../../../messages/fa/tabs-a.json';

import {
  MIN_COMPETITORS,
  PUBLISH_FAST_POLL_MS,
  PUBLISH_FAST_WINDOW_MS,
  PUBLISH_SLOW_POLL_MS,
  RUN_POLL_MS,
  SCREEN_KEYS,
  WORD_BUDGETS,
  addTicked,
  canWriteFirstPost,
  connectFix,
  countWords,
  evidenceLine,
  initialTicked,
  isPublishSlow,
  needsManualAdd,
  publishPollDelay,
  publishedLink,
  removeTicked,
  runRows,
  screenWords,
  stepSummaryMessage,
} from './first-post-view-logic';

const ev = (kind: EvidenceItem['kind'], url: string): EvidenceItem => ({ id: 'abcd1234', kind, url });

const competitor = (id: string, userDecision: string | null, evidence: EvidenceItem[] = []): FirstPostCompetitor => ({
  id,
  name: `Co ${id}`,
  domain: `${id}.example`,
  userDecision,
  evidence,
});

describe('evidenceLine', () => {
  it('names the host of the first source, without www', () => {
    expect(
      evidenceLine([ev('site', 'https://own.example/about'), ev('citation', 'https://www.news.example/a'), ev('serp', 'https://b.example')]),
    ).toEqual({ kind: 'source', host: 'news.example' });
  });

  it('is an AI guess when there is no source, even with site pages', () => {
    expect(evidenceLine([ev('site', 'https://own.example/')])).toEqual({ kind: 'aiGuess' });
    expect(evidenceLine([])).toEqual({ kind: 'aiGuess' });
  });

  it('skips a source whose URL cannot be read', () => {
    expect(evidenceLine([ev('citation', 'not a url'), ev('serp', 'https://ok.example/x')])).toEqual({
      kind: 'source',
      host: 'ok.example',
    });
    expect(evidenceLine([ev('citation', 'javascript:alert(1)')])).toEqual({ kind: 'aiGuess' });
  });
});

describe('tick rules', () => {
  it('ticks only rows the user already accepted', () => {
    const ticked = initialTicked([
      competitor('a', 'ACCEPTED'),
      competitor('b', 'PENDING'),
      competitor('c', null),
      competitor('d', 'REJECTED'),
    ]);
    expect([...ticked]).toEqual(['a']);
  });

  it('a manual add arrives ticked; untick removes it', () => {
    const once = addTicked(new Set<string>(), 'm1');
    expect(once.has('m1')).toBe(true);
    expect(removeTicked(once, 'm1').has('m1')).toBe(false);
  });

  it('returns new sets, never mutating the old one', () => {
    const before = new Set(['a']);
    addTicked(before, 'b');
    removeTicked(before, 'a');
    expect([...before]).toEqual(['a']);
  });

  it('enables the button at 2 ticks with no save in flight', () => {
    expect(MIN_COMPETITORS).toBe(2);
    expect(canWriteFirstPost(1, 0)).toBe(false);
    expect(canWriteFirstPost(2, 0)).toBe(true);
    expect(canWriteFirstPost(5, 0)).toBe(true);
    expect(canWriteFirstPost(2, 1)).toBe(false);
  });

  it('opens the add field when fewer than 2 suggestions exist', () => {
    expect(needsManualAdd([])).toBe(true);
    expect(needsManualAdd([competitor('a', null)])).toBe(true);
    expect(needsManualAdd([competitor('a', null), competitor('b', null)])).toBe(false);
  });
});

describe('poll intervals', () => {
  it('polls the run every 3 s', () => {
    expect(RUN_POLL_MS).toBe(3000);
  });

  it('polls publishing every 3 s for 3 min, then every 15 s', () => {
    expect(PUBLISH_FAST_POLL_MS).toBe(3000);
    expect(PUBLISH_SLOW_POLL_MS).toBe(15000);
    expect(PUBLISH_FAST_WINDOW_MS).toBe(180000);
    expect(publishPollDelay(0)).toBe(3000);
    expect(publishPollDelay(179_999)).toBe(3000);
    expect(publishPollDelay(180_000)).toBe(15000);
    expect(publishPollDelay(600_000)).toBe(15000);
    expect(isPublishSlow(179_999)).toBe(false);
    expect(isPublishSlow(180_000)).toBe(true);
  });
});

describe('publishedLink', () => {
  it('passes only http(s) links, through safePostUrl', () => {
    expect(publishedLink('https://www.linkedin.com/feed/update/urn:li:share:1')).toBe(
      'https://www.linkedin.com/feed/update/urn:li:share:1',
    );
    expect(publishedLink('javascript:alert(1)')).toBeNull();
    expect(publishedLink(null)).toBeNull();
    expect(publishedLink('')).toBeNull();
  });
});

describe('connectFix', () => {
  it('starts OAuth for platforms with a web connect flow', () => {
    expect(connectFix('LINKEDIN', 'linkedin')).toEqual({ kind: 'oauth', platform: 'linkedin' });
    expect(connectFix(undefined, 'linkedin')).toEqual({ kind: 'oauth', platform: 'linkedin' });
    expect(connectFix('x', 'twitter')).toEqual({ kind: 'oauth', platform: 'x' });
  });

  it('sends everything else to Connections', () => {
    expect(connectFix('TELEGRAM', 'telegram')).toEqual({ kind: 'connections', tab: 'social' });
    expect(connectFix(undefined, 'blog')).toEqual({ kind: 'connections', tab: 'websites' });
    expect(connectFix('SITE', 'blog')).toEqual({ kind: 'connections', tab: 'websites' });
    expect(connectFix(null, 'linkedin')).toEqual({ kind: 'oauth', platform: 'linkedin' });
  });
});

describe('runRows', () => {
  it('marks done, current and pending rows of a running run', () => {
    const state: FirstPostState = {
      phase: 'running',
      runId: 'fpr_ws_1',
      startedAt: '2026-11-23T10:00:00Z',
      current: 'idea',
      done: [
        { step: 'matrices', summary: { charts: 4, competitors: 2 } },
        { step: 'keywords', summary: { gaps: 3 }, skipped: true },
      ],
    };
    expect(runRows(state).map((r) => [r.step, r.status])).toEqual([
      ['matrices', 'done'],
      ['keywords', 'done'],
      ['idea', 'current'],
      ['draft', 'pending'],
    ]);
    expect(runRows(state)[1].result?.skipped).toBe(true);
  });

  it('marks the failed step', () => {
    const state: FirstPostState = {
      phase: 'failed',
      runId: 'fpr_ws_1',
      done: [{ step: 'matrices', summary: {} }],
      failed: 'keywords',
      errorKind: 'notEnoughCompetitorSignals',
      retriesLeft: 1,
    };
    expect(runRows(state).map((r) => r.status)).toEqual(['done', 'failed', 'pending', 'pending']);
  });
});

describe('stepSummaryMessage', () => {
  it('uses only stored values and picks the variant they allow', () => {
    expect(stepSummaryMessage({ step: 'matrices', summary: { charts: 4, competitors: 2 } })).toEqual({
      key: 'matrices',
      values: { charts: 4, competitors: 2 },
    });
    expect(stepSummaryMessage({ step: 'matrices', summary: { charts: 4 } })).toEqual({
      key: 'matricesCharts',
      values: { charts: 4 },
    });
    expect(stepSummaryMessage({ step: 'keywords', summary: { gaps: 3, competitors: 2, topGap: 'Recovery week by week' } })).toEqual({
      key: 'keywordsTopGap',
      values: { gaps: 3, topGap: 'Recovery week by week' },
    });
    expect(stepSummaryMessage({ step: 'keywords', summary: { gaps: 3 } })).toEqual({ key: 'keywords', values: { gaps: 3 } });
    expect(stepSummaryMessage({ step: 'idea', summary: { topic: 'Week three' } })).toEqual({
      key: 'idea',
      values: { topic: 'Week three' },
    });
    expect(stepSummaryMessage({ step: 'draft', summary: { words: 180, approved: 1 } })).toEqual({
      key: 'draft',
      values: { words: 180 },
    });
  });

  it('says nothing when nothing is stored, and "already done" for a skipped step', () => {
    expect(stepSummaryMessage({ step: 'idea', summary: {} })).toBeNull();
    expect(stepSummaryMessage({ step: 'keywords', summary: { gaps: 'three' } })).toBeNull();
    expect(stepSummaryMessage({ step: 'keywords', summary: {}, skipped: true })).toEqual({ key: 'skipped', values: {} });
  });
});

describe('word budgets', () => {
  it('counts words, an ICU argument as one word', () => {
    expect(countWords('Write my first post')).toBe(4);
    expect(countWords('{count, number} picked · about {minutes, number} minutes')).toBe(5);
    expect(countWords('{n, plural, one {# chart} other {# charts}} ready')).toBe(2);
    expect(countWords('  ')).toBe(0);
  });

  for (const [locale, messages] of [
    ['en', enTabs],
    ['fa', faTabs],
  ] as const) {
    for (const screen of Object.keys(SCREEN_KEYS) as (keyof typeof SCREEN_KEYS)[]) {
      it(`${locale} ${screen} stays within ${WORD_BUDGETS[screen]} words`, () => {
        const words = screenWords(messages as unknown as Record<string, unknown>, screen);
        expect(words).toBeGreaterThan(0);
        expect(words).toBeLessThanOrEqual(WORD_BUDGETS[screen]);
      });
    }
  }
});

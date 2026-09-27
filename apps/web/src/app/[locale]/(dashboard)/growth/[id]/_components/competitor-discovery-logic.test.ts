import { describe, expect, it } from 'vitest';

import type { EvidenceItem } from '@/lib/competitors/types';
import {
  MAX_POLL_MS,
  REJECTION_REASON_CHIPS,
  domainHref,
  evidenceQueries,
  changesAcceptedSet,
  isRejectionReasonChip,
  isRunActive,
  isStaleForRows,
  mergeCompetitors,
  runOutcome,
  safeExternalHref,
  shouldKeepPolling,
  sortByConfidence,
  splitEvidence,
  stageIndex,
  competitorBasisNotice,
} from './competitor-discovery-logic';

const START = '2026-09-27T10:00:00.000Z';
const startMs = Date.parse(START);

describe('shouldKeepPolling', () => {
  it('polls while a run is PENDING or RUNNING', () => {
    expect(shouldKeepPolling({ status: 'PENDING', startedAt: START }, startMs + 1000)).toBe(true);
    expect(shouldKeepPolling({ status: 'RUNNING', startedAt: START }, startMs + 1000)).toBe(true);
  });

  it('stops on every terminal status', () => {
    for (const status of ['DONE', 'EMPTY', 'FAILED']) {
      expect(shouldKeepPolling({ status, startedAt: START }, startMs + 1000)).toBe(false);
    }
  });

  it('does not poll without a run', () => {
    expect(shouldKeepPolling(null, startMs)).toBe(false);
    expect(shouldKeepPolling(undefined, startMs)).toBe(false);
  });

  it('gives up after the client-side ceiling even if the run still says RUNNING', () => {
    expect(shouldKeepPolling({ status: 'RUNNING', startedAt: START }, startMs + MAX_POLL_MS - 1)).toBe(true);
    expect(shouldKeepPolling({ status: 'RUNNING', startedAt: START }, startMs + MAX_POLL_MS)).toBe(false);
  });

  it('treats an unparseable start time as still active rather than guessing it is stale', () => {
    expect(shouldKeepPolling({ status: 'RUNNING', startedAt: 'nope' }, startMs)).toBe(true);
  });
});

describe('isRunActive', () => {
  it('is true only for PENDING and RUNNING', () => {
    expect(isRunActive('PENDING')).toBe(true);
    expect(isRunActive('RUNNING')).toBe(true);
    expect(isRunActive('DONE')).toBe(false);
    expect(isRunActive(null)).toBe(false);
  });
});

describe('runOutcome', () => {
  const base = { stage: null, savedCount: 0, error: null, sourceStats: null };

  it('is none without a run or with an unknown status', () => {
    expect(runOutcome(null)).toEqual({ kind: 'none' });
    expect(runOutcome({ ...base, status: 'WEIRD' })).toEqual({ kind: 'none' });
  });

  it('reports the current stage and the queries while active', () => {
    expect(
      runOutcome({ ...base, status: 'RUNNING', stage: 'SEARCH', queries: ['a', 'b'], sourceStats: { queries: { count: 2, tokens: 10 } } }),
    ).toEqual({ kind: 'active', stage: 'SEARCH', queries: ['a', 'b'] });
  });

  it('drops a stage it does not know instead of showing the raw enum', () => {
    expect(runOutcome({ ...base, status: 'RUNNING', stage: 'SOMETHING' })).toEqual({
      kind: 'active',
      stage: null,
      queries: [],
    });
  });

  it('reports saved count on DONE, and the sites the enrich budget skipped', () => {
    expect(
      runOutcome({
        ...base,
        status: 'DONE',
        savedCount: 4,
        sourceStats: { enrich: { input: 20, enriched: 15, budgetExceeded: true, skipped: 5 } },
      }),
    ).toEqual({ kind: 'done', saved: 4, skippedSites: 5 });
  });

  it('ignores `skipped` when the budget was not exceeded', () => {
    expect(
      runOutcome({ ...base, status: 'DONE', savedCount: 1, sourceStats: { enrich: { input: 2, enriched: 2, skipped: 3 } } }),
    ).toEqual({ kind: 'done', saved: 1, skippedSites: 0 });
  });

  it('says how many queries an EMPTY run used, and the market the run itself searched', () => {
    const market = { country: 'IR', language: 'fa' as const };
    expect(runOutcome({ ...base, status: 'EMPTY', market, sourceStats: { queries: { count: 9, tokens: null } } })).toEqual({
      kind: 'empty',
      queryCount: 9,
      skippedSites: 0,
      market,
    });
    expect(runOutcome({ ...base, status: 'EMPTY', market, queries: ['a', 'b', 'c'] })).toMatchObject({ queryCount: 3 });
  });

  it('leaves the query count and market unknown on EMPTY when the run never recorded them', () => {
    expect(runOutcome({ ...base, status: 'EMPTY' })).toEqual({ kind: 'empty', queryCount: null, skippedSites: 0, market: null });
  });

  it('carries the error text on FAILED, and null for a blank one', () => {
    // Never the raw text: only the kind of failure, mapped to translated copy.
    const kind = (error: string | null) => runOutcome({ ...base, status: 'FAILED', error });
    expect(kind(' boom ')).toEqual({ kind: 'failed', errorKind: 'generic' });
    expect(kind('   ')).toEqual({ kind: 'failed', errorKind: 'generic' });
    expect(kind(null)).toEqual({ kind: 'failed', errorKind: 'generic' });
    expect(kind('TIMED_OUT')).toEqual({ kind: 'failed', errorKind: 'timedOut' });
    expect(kind('DISPATCH_FAILED: fetch failed (ECONNREFUSED)')).toEqual({ kind: 'failed', errorKind: 'dispatch' });
    expect(kind('JUDGE_UNAVAILABLE: Judge batch failed: 500 boom')).toEqual({ kind: 'failed', errorKind: 'judgeOutage' });
    expect(kind('JUDGE_UNAVAILABLE: Judge batch failed: 429 Rate limit reached')).toEqual({
      kind: 'failed',
      errorKind: 'rateLimited',
    });
    expect(kind('Search query failed for "x": 429 Too Many Requests')).toEqual({ kind: 'failed', errorKind: 'rateLimited' });
    // Configuration errors get the generic message, never their own text.
    expect(kind('OPENAI_API_KEY is not set — cannot generate discovery queries')).toEqual({
      kind: 'failed',
      errorKind: 'generic',
    });
  });
});

describe('stageIndex', () => {
  it('follows pipeline order', () => {
    expect(stageIndex('QUERIES')).toBe(0);
    expect(stageIndex('SAVE')).toBe(4);
    expect(stageIndex(null)).toBe(-1);
    expect(stageIndex('NOPE')).toBe(-1);
  });
});

describe('safeExternalHref', () => {
  it('allows absolute http and https URLs', () => {
    expect(safeExternalHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeExternalHref('http://example.com')).toBe('http://example.com/');
  });

  it('refuses every other scheme', () => {
    expect(safeExternalHref('javascript:alert(1)')).toBeNull();
    expect(safeExternalHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeExternalHref('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeExternalHref('ftp://example.com')).toBeNull();
    expect(safeExternalHref('vbscript:x')).toBeNull();
  });

  it('refuses relative, empty and non-string input', () => {
    expect(safeExternalHref('/path')).toBeNull();
    expect(safeExternalHref('example.com')).toBeNull();
    expect(safeExternalHref('')).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });

  it('refuses URLs carrying credentials', () => {
    expect(safeExternalHref('https://user:pass@example.com')).toBeNull();
  });
});

describe('domainHref', () => {
  it('builds an https homepage link from a bare domain', () => {
    expect(domainHref('example.com')).toBe('https://example.com/');
    expect(domainHref('Example.COM')).toBe('https://example.com/');
  });

  it('refuses anything that is not a bare hostname', () => {
    expect(domainHref('evil.com@example.com')).toBeNull();
    expect(domainHref('example.com/path')).toBeNull();
    expect(domainHref('example.com:8080')).toBeNull();
    expect(domainHref('javascript:alert(1)')).toBeNull();
    expect(domainHref('exa mple.com')).toBeNull();
    expect(domainHref('')).toBeNull();
    expect(domainHref(null)).toBeNull();
  });
});

const ev = (partial: Partial<EvidenceItem>): EvidenceItem => ({ id: 'x', kind: 'citation', url: 'https://a.com', ...partial });

describe('evidenceQueries', () => {
  it('returns distinct non-empty queries in first-seen order, case-insensitively', () => {
    expect(
      evidenceQueries([
        ev({ query: 'crm for clinics' }),
        ev({ query: '' }),
        ev({}),
        ev({ query: 'CRM for clinics' }),
        ev({ query: 'clinic software' }),
      ]),
    ).toEqual(['crm for clinics', 'clinic software']);
  });
});

describe('splitEvidence', () => {
  it('separates site pages from cited sources and drops duplicate urls', () => {
    const result = splitEvidence([
      ev({ id: '1', kind: 'citation', url: 'https://news.com/a' }),
      ev({ id: '2', kind: 'serp', url: 'https://news.com/a' }),
      ev({ id: '3', kind: 'serp', url: 'https://blog.com/b' }),
      ev({ id: '4', kind: 'site', url: 'https://rival.com/' }),
      ev({ id: '5', kind: 'site', url: 'https://rival.com/' }),
      ev({ id: '6', kind: 'citation', url: '' }),
    ]);
    expect(result.sources.map((e) => e.id)).toEqual(['1', '3']);
    expect(result.sitePages.map((e) => e.id)).toEqual(['4']);
  });
});

describe('sortByConfidence', () => {
  it('sorts high to low, unknown last, stable on ties', () => {
    const sorted = sortByConfidence([
      { id: 'a', confidence: 0.7 },
      { id: 'b', confidence: null },
      { id: 'c', confidence: 0.9 },
      { id: 'd', confidence: 0.7 },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['c', 'a', 'd', 'b']);
  });
});

describe('mergeCompetitors', () => {
  it('takes the server list, except rows whose own write is still in flight', () => {
    const server = [
      { id: '1', userDecision: 'PENDING' },
      { id: '2', userDecision: 'PENDING' },
    ];
    const local = [
      { id: '1', userDecision: 'ACCEPTED' },
      { id: '2', userDecision: 'ACCEPTED' },
    ];
    expect(mergeCompetitors(server, local, new Set(['2']))).toEqual([
      { id: '1', userDecision: 'PENDING' },
      { id: '2', userDecision: 'ACCEPTED' },
    ]);
    expect(mergeCompetitors(server, local, new Set())).toBe(server);
  });
});

describe('REJECTION_REASON_CHIPS', () => {
  it('only offers reasons the server action accepts', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../../../../../actions/growth-competitors.ts', import.meta.url), 'utf8'),
    );
    const match = source.match(/const REJECTION_REASONS = \[([^\]]*)\] as const/);
    expect(match).not.toBeNull();
    const allowed = [...(match?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    for (const chip of REJECTION_REASON_CHIPS) expect(allowed).toContain(chip);
    expect([...REJECTION_REASON_CHIPS].sort()).toEqual([...allowed].sort());
  });

  it('recognises only its own codes', () => {
    expect(isRejectionReasonChip('TOO_BIG')).toBe(true);
    expect(isRejectionReasonChip('OTHER')).toBe(false);
    expect(isRejectionReasonChip(null)).toBe(false);
  });
});

describe('changesAcceptedSet', () => {
  it('is true only when a decision moves into or out of ACCEPTED', () => {
    expect(changesAcceptedSet('PENDING', 'ACCEPTED')).toBe(true);
    expect(changesAcceptedSet('ACCEPTED', 'REJECTED')).toBe(true);
    expect(changesAcceptedSet('ACCEPTED', 'PENDING')).toBe(true);
    expect(changesAcceptedSet('PENDING', 'REJECTED')).toBe(false);
    expect(changesAcceptedSet('REJECTED', 'REJECTED')).toBe(false);
    expect(changesAcceptedSet('REJECTED', 'PENDING')).toBe(false);
  });
});

describe('isStaleForRows', () => {
  it('flags a response when any write completed while it was in flight', () => {
    expect(isStaleForRows(3, 3)).toBe(false);
    expect(isStaleForRows(3, 4)).toBe(true);
  });
});

describe('competitorBasisNotice (D8 label on Matrices, Keywords, Offerings)', () => {
  it('says nothing when there is no result yet, or it was built on accepted competitors', () => {
    expect(competitorBasisNotice(null)).toBe('none');
    expect(competitorBasisNotice(undefined)).toBe('none');
    expect(competitorBasisNotice({ competitor_basis: 'ACCEPTED', charts: [] })).toBe('none');
  });

  it('labels a result built on unconfirmed high-confidence candidates', () => {
    expect(competitorBasisNotice({ competitor_basis: 'UNCONFIRMED_HIGH' })).toBe('unconfirmed');
  });

  it('gives a legacy result with no basis the quieter "predates this check" note, not the unconfirmed one', () => {
    expect(competitorBasisNotice({ charts: [] })).toBe('legacy');
    expect(competitorBasisNotice({ competitor_basis: 'something-else' })).toBe('legacy');
  });
});

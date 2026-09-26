import { describe, expect, it } from 'vitest';

import {
  buildEvidenceIdMap,
  isStaleRun,
  mergeCandidateLists,
  parseStoredEvidence,
  reconcileEvidence,
  STALE_RUN_MINUTES,
} from './pipeline';
import type { Candidate, EvidenceItem } from './types';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    domain: 'sazito.com',
    frequency: 1,
    sources: ['WEB_SEARCH'],
    evidence: [],
    ...overrides,
  };
}

function evidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'aaaaaaaa',
    kind: 'citation',
    url: 'https://sazito.com/pricing',
    ...overrides,
  };
}

describe('mergeCandidateLists', () => {
  it('sums frequency for a domain found by two sources', () => {
    const webSearch = [candidate({ domain: 'sazito.com', frequency: 2, sources: ['WEB_SEARCH'] })];
    const serp = [candidate({ domain: 'sazito.com', frequency: 3, sources: ['SERP'] })];

    const merged = mergeCandidateLists([webSearch, serp]);

    expect(merged).toHaveLength(1);
    expect(merged[0].frequency).toBe(5);
  });

  it('unions sources for the same domain rather than keeping only the last one', () => {
    const webSearch = [candidate({ domain: 'sazito.com', sources: ['WEB_SEARCH'] })];
    const serp = [candidate({ domain: 'sazito.com', sources: ['SERP'] })];

    const merged = mergeCandidateLists([webSearch, serp]);

    expect(new Set(merged[0].sources)).toEqual(new Set(['WEB_SEARCH', 'SERP']));
  });

  it('does not duplicate a source that both lists already report for the same domain', () => {
    const webSearch = [candidate({ domain: 'sazito.com', sources: ['WEB_SEARCH'] })];
    const webSearchAgain = [candidate({ domain: 'sazito.com', sources: ['WEB_SEARCH'] })];

    const merged = mergeCandidateLists([webSearch, webSearchAgain]);

    expect(merged[0].sources).toEqual(['WEB_SEARCH']);
  });

  it('concatenates evidence from both sources', () => {
    const webSearch = [candidate({ domain: 'sazito.com', evidence: [evidenceItem({ id: 'one' })] })];
    const serp = [candidate({ domain: 'sazito.com', evidence: [evidenceItem({ id: 'two' })] })];

    const merged = mergeCandidateLists([webSearch, serp]);

    expect(merged[0].evidence.map((e) => e.id)).toEqual(['one', 'two']);
  });

  it('keeps domains that only one source found, untouched', () => {
    const webSearch = [candidate({ domain: 'sazito.com' })];
    const serp = [candidate({ domain: 'hesabshop.com' })];

    const merged = mergeCandidateLists([webSearch, serp]);

    expect(merged.map((c) => c.domain).sort()).toEqual(['hesabshop.com', 'sazito.com']);
  });

  it('merges three or more lists, order independent of which list runs first', () => {
    const a = [candidate({ domain: 'sazito.com', frequency: 1 })];
    const b: Candidate[] = [];
    const c = [candidate({ domain: 'sazito.com', frequency: 4 })];

    expect(mergeCandidateLists([a, b, c])[0].frequency).toBe(5);
    expect(mergeCandidateLists([c, b, a])[0].frequency).toBe(5);
  });
});

describe('buildEvidenceIdMap', () => {
  it('maps a normalised URL to its stored id', () => {
    const map = buildEvidenceIdMap([evidenceItem({ id: 'stored-1', url: 'https://sazito.com/pricing/' })]);
    expect(map.get('sazito.com/pricing')).toBe('stored-1');
  });

  it('skips items with no url', () => {
    const map = buildEvidenceIdMap([{ id: 'x', kind: 'citation', url: '' }]);
    expect(map.size).toBe(0);
  });
});

describe('reconcileEvidence', () => {
  it('reuses the stored id when a new item normalises to the same URL (trailing slash ignored)', () => {
    const existing = [evidenceItem({ id: 'stored-1', url: 'https://sazito.com/pricing/' })];
    const fresh = [evidenceItem({ id: 'freshly-minted', url: 'https://sazito.com/pricing' })];

    const result = reconcileEvidence(existing, fresh);

    expect(result[0].id).toBe('stored-1');
  });

  it('keeps the freshly minted id for a genuinely new URL', () => {
    const existing = [evidenceItem({ id: 'stored-1', url: 'https://sazito.com/pricing' })];
    const fresh = [evidenceItem({ id: 'freshly-minted', url: 'https://sazito.com/about' })];

    const result = reconcileEvidence(existing, fresh);

    expect(result[0].id).toBe('freshly-minted');
  });

  it('never re-points an existing id onto a different URL (no id collision)', () => {
    const existing = [
      evidenceItem({ id: 'stored-1', url: 'https://sazito.com/pricing' }),
      evidenceItem({ id: 'stored-2', url: 'https://sazito.com/about' }),
    ];
    const fresh = [
      evidenceItem({ id: 'x', url: 'https://sazito.com/pricing' }),
      evidenceItem({ id: 'y', url: 'https://sazito.com/about' }),
    ];

    const result = reconcileEvidence(existing, fresh);

    expect(result[0].id).toBe('stored-1');
    expect(result[1].id).toBe('stored-2');
  });

  it('preserves other fields of the new item (title, kind) while only overwriting id', () => {
    const existing = [evidenceItem({ id: 'stored-1', url: 'https://sazito.com/pricing' })];
    const fresh = [evidenceItem({ id: 'x', url: 'https://sazito.com/pricing', title: 'New title', kind: 'site' })];

    const result = reconcileEvidence(existing, fresh);

    expect(result[0]).toEqual({ id: 'stored-1', kind: 'site', url: 'https://sazito.com/pricing', title: 'New title' });
  });
});

describe('parseStoredEvidence', () => {
  it('round-trips a well-formed array', () => {
    const stored = [evidenceItem({ id: 'a' }), evidenceItem({ id: 'b', url: 'https://sazito.com/about' })];
    expect(parseStoredEvidence(stored).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('tolerates null, non-array, and malformed items instead of throwing', () => {
    expect(parseStoredEvidence(null)).toEqual([]);
    expect(parseStoredEvidence(undefined)).toEqual([]);
    expect(parseStoredEvidence('not an array')).toEqual([]);
    expect(parseStoredEvidence([{ id: 'ok', url: 'https://x.com' }, { url: 'missing-id' }, null, 42])).toEqual([
      { id: 'ok', kind: 'citation', url: 'https://x.com', title: undefined, snippet: undefined, query: undefined },
    ]);
  });
});

describe('isStaleRun', () => {
  const now = new Date('2026-09-26T12:00:00Z');

  it('is stale when RUNNING and older than the threshold', () => {
    const startedAt = new Date(now.getTime() - (STALE_RUN_MINUTES + 1) * 60 * 1000);
    expect(isStaleRun({ status: 'RUNNING', startedAt }, now, STALE_RUN_MINUTES)).toBe(true);
  });

  it('is stale when PENDING and older than the threshold', () => {
    const startedAt = new Date(now.getTime() - (STALE_RUN_MINUTES + 1) * 60 * 1000);
    expect(isStaleRun({ status: 'PENDING', startedAt }, now, STALE_RUN_MINUTES)).toBe(true);
  });

  it('is not stale when younger than the threshold', () => {
    const startedAt = new Date(now.getTime() - (STALE_RUN_MINUTES - 1) * 60 * 1000);
    expect(isStaleRun({ status: 'RUNNING', startedAt }, now, STALE_RUN_MINUTES)).toBe(false);
  });

  it('is never stale once finished, however old, so a real DONE/EMPTY/FAILED run is left alone', () => {
    const startedAt = new Date(now.getTime() - 1000 * 60 * 60 * 24);
    expect(isStaleRun({ status: 'DONE', startedAt }, now, STALE_RUN_MINUTES)).toBe(false);
    expect(isStaleRun({ status: 'FAILED', startedAt }, now, STALE_RUN_MINUTES)).toBe(false);
    expect(isStaleRun({ status: 'EMPTY', startedAt }, now, STALE_RUN_MINUTES)).toBe(false);
  });

  it('is exactly on the boundary: not stale at precisely the threshold', () => {
    const startedAt = new Date(now.getTime() - STALE_RUN_MINUTES * 60 * 1000);
    expect(isStaleRun({ status: 'RUNNING', startedAt }, now, STALE_RUN_MINUTES)).toBe(false);
  });
});

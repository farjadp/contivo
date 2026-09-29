import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { siteSignalsMock } = vi.hoisted(() => ({ siteSignalsMock: { collectSiteSignals: vi.fn() } }));
vi.mock('@/lib/competitors/site-signals', () => siteSignalsMock);

import {
  MATRIX_ENRICH_BUDGET_MS,
  MATRIX_ENRICH_CONCURRENCY,
  enrichEvidenceLessCompetitors,
  mergeEvidence,
  siteEvidenceItems,
} from './enrich';

const hash8 = (domain: string, text: string) =>
  createHash('sha256').update(`${domain}\n${text}`).digest('hex').slice(0, 8);

const signals = (domain: string, evidence: string) => ({ domain, pages_scanned: ['/'], evidence });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('constants', () => {
  it('shares a 60 s budget across competitors, three at a time', () => {
    expect(MATRIX_ENRICH_BUDGET_MS).toBe(60_000);
    expect(MATRIX_ENRICH_CONCURRENCY).toBe(3);
  });
});

describe('siteEvidenceItems', () => {
  it('turns each non-empty trimmed line into a site evidence item with a content id', () => {
    const items = siteEvidenceItems('rival.com', '  Invoicing for small shops  \n\n   \nPlans from $9 a month');
    expect(items).toEqual([
      {
        id: hash8('rival.com', 'Invoicing for small shops'),
        kind: 'site',
        url: 'https://rival.com',
        snippet: 'Invoicing for small shops',
      },
      {
        id: hash8('rival.com', 'Plans from $9 a month'),
        kind: 'site',
        url: 'https://rival.com',
        snippet: 'Plans from $9 a month',
      },
    ]);
    expect(items[0].id).toMatch(/^[0-9a-f]{8}$/);
  });

  it('caps at 12 lines and each line at 300 characters', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `${i} ${'x'.repeat(400)}`);
    const items = siteEvidenceItems('rival.com', lines.join('\n'));
    expect(items).toHaveLength(12);
    expect(items.every((item) => (item.snippet ?? '').length === 300)).toBe(true);
    expect(items[0].id).toBe(hash8('rival.com', items[0].snippet as string));
  });

  it('keeps one item per repeated line', () => {
    expect(siteEvidenceItems('rival.com', 'Same line\nSame line')).toHaveLength(1);
  });

  it('is empty for empty text', () => {
    expect(siteEvidenceItems('rival.com', '')).toEqual([]);
  });
});

describe('mergeEvidence', () => {
  it('appends new items after the existing ones, untouched, skipping ids already present', () => {
    const existing = [{ id: 'aaaa1111', kind: 'citation', url: 'https://x.com/a', title: 'kept as is', extra: 1 }];
    const merged = mergeEvidence(existing, [
      { id: 'aaaa1111', kind: 'site', url: 'https://x.com', snippet: 'dup' },
      { id: 'bbbb2222', kind: 'site', url: 'https://x.com', snippet: 'new' },
    ]);
    expect(merged).toEqual([existing[0], { id: 'bbbb2222', kind: 'site', url: 'https://x.com', snippet: 'new' }]);
  });

  it('treats a non-array stored value as empty', () => {
    expect(mergeEvidence(null, [{ id: 'b', kind: 'site', url: 'u', snippet: 's' }])).toHaveLength(1);
  });
});

describe('enrichEvidenceLessCompetitors', () => {
  const withEvidence = {
    id: 'c1',
    domain: 'has.com',
    evidence: [{ id: 'e1', kind: 'serp', url: 'https://has.com', title: 'Has', snippet: 'Real' }],
  };

  it('reads only the sites of competitors with no citable evidence, with the shared deadline', async () => {
    siteSignalsMock.collectSiteSignals.mockImplementation(async (domain: string) => signals(domain, 'We sell widgets'));
    const now = () => 1_000;
    const result = await enrichEvidenceLessCompetitors(
      [
        withEvidence,
        { id: 'c2', domain: 'https://www.None.com/about', evidence: [] },
        // stored items with no text are nothing a score can cite
        { id: 'c3', domain: 'blank.com', evidence: [{ id: 'e9', kind: 'citation', url: 'https://blank.com' }] },
      ],
      { deadline: 61_000, now },
    );

    expect(siteSignalsMock.collectSiteSignals).toHaveBeenCalledTimes(2);
    const [domain, options] = siteSignalsMock.collectSiteSignals.mock.calls[0];
    expect(domain).toBe('none.com');
    expect(options.deadline).toBe(61_000);
    expect(options.now).toBe(now);
    expect(options.paths[0]).toBe('/');

    expect([...result.keys()]).toEqual(['c2', 'c3']);
    expect(result.get('c2')).toEqual([
      { id: hash8('none.com', 'We sell widgets'), kind: 'site', url: 'https://none.com', snippet: 'We sell widgets' },
    ]);
  });

  it('starts no further site once the deadline has passed', async () => {
    let clock = 0;
    siteSignalsMock.collectSiteSignals.mockImplementation(async (domain: string) => {
      await Promise.resolve();
      clock = 100;
      return signals(domain, 'line');
    });
    const result = await enrichEvidenceLessCompetitors(
      [
        { id: 'a', domain: 'a.com', evidence: [] },
        { id: 'b', domain: 'b.com', evidence: [] },
        { id: 'c', domain: 'c.com', evidence: [] },
        { id: 'd', domain: 'd.com', evidence: [] },
      ],
      { deadline: 50, now: () => clock },
    );
    // three start at clock 0 (concurrency 3); the fourth sees the deadline passed
    expect(siteSignalsMock.collectSiteSignals).toHaveBeenCalledTimes(3);
    expect(result.has('d')).toBe(false);
  });

  it('leaves out a site that yields nothing, fails, or has no domain, without failing the rest', async () => {
    siteSignalsMock.collectSiteSignals.mockImplementation(async (domain: string) => {
      if (domain === 'down.com') throw new Error('ECONNREFUSED');
      if (domain === 'empty.com') return signals(domain, '');
      return signals(domain, 'Readable');
    });
    const result = await enrichEvidenceLessCompetitors(
      [
        { id: 'down', domain: 'down.com', evidence: [] },
        { id: 'empty', domain: 'empty.com', evidence: [] },
        { id: 'nodomain', domain: null, evidence: [] },
        { id: 'ok', domain: 'ok.com', evidence: [] },
      ],
      { deadline: 60_000, now: () => 0 },
    );
    expect([...result.keys()]).toEqual(['ok']);
    expect(siteSignalsMock.collectSiteSignals).toHaveBeenCalledTimes(3);
  });

  it('reads nothing when every competitor already has evidence', async () => {
    const result = await enrichEvidenceLessCompetitors([withEvidence], { deadline: 60_000, now: () => 0 });
    expect(result.size).toBe(0);
    expect(siteSignalsMock.collectSiteSignals).not.toHaveBeenCalled();
  });
});

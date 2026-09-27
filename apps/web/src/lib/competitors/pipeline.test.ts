import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks for runDiscoveryPipeline / reapStaleRuns tests further down. These
// don't affect the pure-helper tests above them — mergeCandidateLists,
// reconcileEvidence, etc. never touch prisma or any of these modules.
//
// vi.hoisted is required here: vi.mock factories are hoisted above all
// imports (including this file's own), so a factory can only reference
// something also produced through vi.hoisted, never an ordinary
// module-scope `const`.
// ---------------------------------------------------------------------------
const { prismaMock, activityLogMock, queriesMock, searchMock, judgeMock, scoringMock } = vi.hoisted(() => ({
  prismaMock: {
    discoveryRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    competitor: {
      update: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  activityLogMock: { writeActivityLog: vi.fn() },
  queriesMock: { buildBrandBrief: vi.fn(), generateQueries: vi.fn() },
  searchMock: { harvestFromWebSearch: vi.fn(), harvestFromSerp: vi.fn() },
  judgeMock: { enrichCandidates: vi.fn(), judgeCandidates: vi.fn() },
  scoringMock: { rankAndKeep: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log', () => activityLogMock);
vi.mock('./queries', () => queriesMock);
vi.mock('./search', () => searchMock);
vi.mock('./judge', () => judgeMock);
vi.mock('./scoring', () => scoringMock);

import {
  buildEvidenceIdMap,
  isStaleRun,
  mergeCandidateLists,
  parseStoredEvidence,
  reapStaleRuns,
  reconcileEvidence,
  runDiscoveryPipeline,
  STALE_RUN_MINUTES,
} from './pipeline';
import type { Candidate, EvidenceItem, ScoredCandidate } from './types';

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

// ---------------------------------------------------------------------------
// runDiscoveryPipeline / reapStaleRuns — @/lib/db (and the other stage
// modules) mocked per the mocks declared at the top of this file.
// ---------------------------------------------------------------------------

function scoredCandidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    domain: 'example.com',
    frequency: 1,
    sources: ['WEB_SEARCH'],
    evidence: [],
    siteTitle: null,
    siteEvidence: '',
    pageLanguage: 'en',
    name: 'Example',
    isCompetitor: true,
    labels: ['BUSINESS'],
    type: 'DIRECT',
    scaleMatch: true,
    judgeConfidence: 0.8,
    reason: 'reason',
    positioning: null,
    keyFeatures: [],
    description: 'desc',
    finalConfidence: 0.8,
    ...overrides,
  };
}

function baseRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run1',
    userId: 'user1',
    workspace: {
      id: 'ws1',
      name: 'Acme',
      websiteUrl: null,
      brandSummary: null,
      targetCountry: null,
      targetLanguage: 'en',
      competitors: [] as unknown[],
    },
    ...overrides,
  };
}

/** Find the `prisma.discoveryRun.update({ data: { status, ... } })` call matching `status`, on a plain `vi.fn()` mock (untyped, so `.mock.calls` is `any[][]`). */
function findCallByStatus(mockFn: { mock: { calls: any[][] } }, status: string): { data: Record<string, any> } | undefined {
  const call = mockFn.mock.calls.find((c) => c[0]?.data?.status === status);
  return call ? call[0] : undefined;
}

describe('runDiscoveryPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    queriesMock.buildBrandBrief.mockReturnValue({
      companyName: 'Acme',
      ownDomain: null,
      summary: '',
      valueProposition: '',
      industry: '',
      audience: '',
      market: { country: null, language: 'en' },
      acceptedCompetitors: [],
      rejectedCompetitors: [],
      knownDomains: [],
    });
    queriesMock.generateQueries.mockResolvedValue({ queries: ['q1'], tokens: 10 });
    searchMock.harvestFromWebSearch.mockResolvedValue({ candidates: [], tokens: 5, errors: [] });
    searchMock.harvestFromSerp.mockResolvedValue({ candidates: [], tokens: 0, errors: [] });
    judgeMock.enrichCandidates.mockResolvedValue({ enriched: [], skipped: 0, budgetExceeded: false });
    judgeMock.judgeCandidates.mockResolvedValue({ judged: [], tokens: 20 });
    scoringMock.rankAndKeep.mockReturnValue([]);

    prismaMock.discoveryRun.findUnique.mockResolvedValue(baseRun());
    prismaMock.discoveryRun.update.mockResolvedValue({});
    prismaMock.discoveryRun.findMany.mockResolvedValue([]);
    // The PENDING -> RUNNING claim at the top of runDiscoveryPipeline
    // succeeds by default, so every existing test in this block still
    // exercises the pipeline; the one test that cares about the
    // already-not-PENDING bail-out overrides this to `{ count: 0 }` itself.
    prismaMock.discoveryRun.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.competitor.update.mockImplementation((args: unknown) => Promise.resolve({ op: 'update', args }));
    prismaMock.competitor.create.mockImplementation((args: unknown) => Promise.resolve({ op: 'create', args }));
    prismaMock.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops));
  });

  it('does nothing when the run is no longer PENDING (e.g. startCompetitorDiscovery already marked it FAILED after a dispatch error)', async () => {
    // The claim is `updateMany({ where: { id, status: 'PENDING' } })`, not
    // an unconditional `update` — a row already moved out of PENDING by
    // something else (the dispatch-failure path in
    // startCompetitorDiscovery, or reapStaleRuns) must not be picked back
    // up and run to DONE, which would both contradict what the action
    // already told the user and consume quota for a run that "failed"
    // according to the row the user was shown.
    prismaMock.discoveryRun.updateMany.mockResolvedValue({ count: 0 });

    await expect(runDiscoveryPipeline('run1')).resolves.toBeUndefined();

    expect(prismaMock.discoveryRun.updateMany).toHaveBeenCalledWith({
      where: { id: 'run1', status: 'PENDING' },
      data: { status: 'RUNNING' },
    });
    // Nothing past the claim ran: no stage was set, nothing was saved, and
    // no FAILED/DONE/EMPTY write happened either — the row is left exactly
    // as whatever already changed it out of PENDING.
    expect(prismaMock.discoveryRun.update).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('never throws to its caller, and lands the run FAILED with the error recorded, when JUDGE rejects mid-run', async () => {
    judgeMock.judgeCandidates.mockRejectedValue(new Error('judge exploded'));

    await expect(runDiscoveryPipeline('run1')).resolves.toBeUndefined();

    const failedCall = findCallByStatus(prismaMock.discoveryRun.update, 'FAILED');
    expect(failedCall).toBeTruthy();
    expect(failedCall!.data.error).toBe('judge exploded');
    expect(failedCall!.data.finishedAt).toBeInstanceOf(Date);
    // The run never got to SAVE, so nothing was (or could have been) saved —
    // savedCount must not be asserted to any nonzero value here.
    expect(failedCall!.data.savedCount).toBeUndefined();
  });

  it('never throws to its caller, and lands the run FAILED, when SEARCH itself cannot even start (mid-SEARCH failure)', async () => {
    // Simulate the SEARCH stage transition itself failing (e.g. the DB
    // write that advances `stage` to 'SEARCH' fails) — a real "mid-SEARCH"
    // failure that isn't swallowed by the Promise.allSettled around the
    // two harvest calls, since it happens before either of them run.
    prismaMock.discoveryRun.update.mockImplementation((args: { data: Record<string, unknown> }) => {
      if (args.data.stage === 'SEARCH') throw new Error('lost DB connection advancing to SEARCH');
      return Promise.resolve({});
    });

    await expect(runDiscoveryPipeline('run1')).resolves.toBeUndefined();

    // The mocked discoveryRun.update throws synchronously rather than
    // rejecting, so the FAILED write itself goes through the same mock and
    // would throw too — proving the *outer* catch's own nested try/catch
    // (for when even the failure-recording write fails) is what kept this
    // from escaping. Nothing more to assert on the row itself in this
    // case; the promise resolving at all is the property under test.
  });

  it('never writes a userDecision key when updating an existing competitor', async () => {
    const existingCompetitor = {
      id: 'comp1',
      domain: 'existing.com',
      userDecision: 'ACCEPTED',
      evidence: [],
    };
    prismaMock.discoveryRun.findUnique.mockResolvedValue(
      baseRun({
        workspace: {
          id: 'ws1',
          name: 'Acme',
          websiteUrl: null,
          brandSummary: null,
          targetCountry: null,
          targetLanguage: 'en',
          competitors: [existingCompetitor],
        },
      }),
    );
    scoringMock.rankAndKeep.mockReturnValue([scoredCandidate({ domain: 'existing.com' })]);

    await runDiscoveryPipeline('run1');

    expect(prismaMock.competitor.create).not.toHaveBeenCalled();
    expect(prismaMock.competitor.update).toHaveBeenCalledTimes(1);
    const [{ data }] = prismaMock.competitor.update.mock.calls[0];
    expect(data).not.toHaveProperty('userDecision');
  });

  it('bundles every SAVE write into one $transaction call, and on success sets savedCount to exactly what was written', async () => {
    scoringMock.rankAndKeep.mockReturnValue([
      scoredCandidate({ domain: 'new1.com' }),
      scoredCandidate({ domain: 'new2.com' }),
    ]);

    await runDiscoveryPipeline('run1');

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0][0]).toHaveLength(2);
    expect(prismaMock.competitor.create).toHaveBeenCalledTimes(2);

    const doneCall = findCallByStatus(prismaMock.discoveryRun.update, 'DONE');
    expect(doneCall!.data.savedCount).toBe(2);
  });

  it('leaves savedCount untouched (never a stale nonzero value) when the SAVE transaction itself fails outright', async () => {
    scoringMock.rankAndKeep.mockReturnValue([
      scoredCandidate({ domain: 'new1.com' }),
      scoredCandidate({ domain: 'new2.com' }),
    ]);
    prismaMock.$transaction.mockRejectedValue(new Error('DB connection lost mid-save'));

    await expect(runDiscoveryPipeline('run1')).resolves.toBeUndefined();

    // The transaction is offered every write bundled together, never one
    // write at a time outside a transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.$transaction.mock.calls[0][0]).toHaveLength(2);

    const failedCall = findCallByStatus(prismaMock.discoveryRun.update, 'FAILED');
    expect(failedCall).toBeTruthy();
    expect(failedCall!.data.error).toContain('DB connection lost mid-save');
    // This is the property the transaction fix exists for: since the
    // transaction rejected, nothing was actually committed, and the FAILED
    // write must not claim otherwise by setting savedCount to anything —
    // the row's savedCount stays at whatever it already was (0), matching
    // the real, unwritten state.
    expect(failedCall!.data).not.toHaveProperty('savedCount');
  });

  it('rounds confidence to three decimals before writing', async () => {
    scoringMock.rankAndKeep.mockReturnValue([
      scoredCandidate({ domain: 'new1.com', finalConfidence: 0.9500000000000001 }),
    ]);

    await runDiscoveryPipeline('run1');

    const [{ data }] = prismaMock.competitor.create.mock.calls[0];
    expect(data.confidence).toBe(0.95);
  });

  it('marks tokens incomplete when a harvest promise rejects outright, not just when one resolves with tokens: null', async () => {
    searchMock.harvestFromWebSearch.mockRejectedValue(new Error('network blew up'));

    await runDiscoveryPipeline('run1');

    const doneCall = findCallByStatus(prismaMock.discoveryRun.update, 'DONE') ??
      findCallByStatus(prismaMock.discoveryRun.update, 'EMPTY');
    expect(doneCall).toBeTruthy();
    const sourceStats = doneCall!.data.sourceStats as Record<string, unknown>;
    expect(sourceStats.tokensIncomplete).toBe(true);
  });

  it('passes each competitor row\'s updatedAt into buildBrandBrief, so the rejection cap keeps the most recent ones', async () => {
    // 25 reasoned rejections in the order loadRun returns them (createdAt
    // asc), each re-decided later than the one before it. Without updatedAt
    // the brief's sort falls back to input order and keeps the OLDEST 20
    // (rej-0..rej-19); with it, it keeps the newest 20 (rej-5..rej-24).
    const base = Date.UTC(2026, 8, 1);
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      name: `Rejected ${i}`,
      domain: `rej-${i}.com`,
      userDecision: 'REJECTED',
      rejectionReason: 'TOO_BIG',
      evidence: [],
      updatedAt: new Date(base + i * 60_000),
    }));
    prismaMock.discoveryRun.findUnique.mockResolvedValue(
      baseRun({
        workspace: {
          id: 'ws1',
          name: 'Acme',
          websiteUrl: null,
          brandSummary: null,
          targetCountry: null,
          targetLanguage: 'en',
          competitors: rows,
        },
      }),
    );

    await runDiscoveryPipeline('run1');

    expect(queriesMock.buildBrandBrief).toHaveBeenCalledTimes(1);
    const input = queriesMock.buildBrandBrief.mock.calls[0][0] as {
      competitors: Array<{ domain: string; updatedAt?: Date }>;
    };
    expect(input.competitors.map((c) => c.updatedAt)).toEqual(rows.map((r) => r.updatedAt));

    // And the real brief built from exactly what the pipeline passed keeps
    // the newest rejections, not the oldest.
    const actual = await vi.importActual<typeof import('./queries')>('./queries');
    const brief = actual.buildBrandBrief(input as Parameters<typeof actual.buildBrandBrief>[0]);
    const kept = brief.rejectedCompetitors.map((r) => r.domain);
    expect(kept).toHaveLength(actual.MAX_REJECTED_IN_BRIEF);
    expect(kept[0]).toBe('rej-24.com');
    expect(kept).not.toContain('rej-0.com');
    expect(kept).not.toContain('rej-4.com');
  });

  it('excludes the workspace\'s own domain and every existing competitor domain from SEARCH, rejected ones included, even when a rejection carries no reason', async () => {
    // A reason-less rejection (no code, or a legacy free-text value) is left
    // out of brief.rejectedCompetitors — see queries.ts — but its domain
    // must still reach brief.knownDomains and, from there, the exclude set
    // SEARCH is given. This is what stops a removed company from being
    // resurfaced on the next run even when it carries no rejection reason.
    queriesMock.buildBrandBrief.mockReturnValue({
      companyName: 'Acme',
      ownDomain: 'acme.com',
      summary: '',
      valueProposition: '',
      industry: '',
      audience: '',
      market: { country: null, language: 'en' },
      acceptedCompetitors: [],
      rejectedCompetitors: [],
      knownDomains: ['accepted.com', 'reasonless-reject.com', 'coded-reject.com'],
    });
    prismaMock.discoveryRun.findUnique.mockResolvedValue(
      baseRun({
        workspace: {
          id: 'ws1',
          name: 'Acme',
          websiteUrl: 'https://acme.com',
          brandSummary: null,
          targetCountry: null,
          targetLanguage: 'en',
          competitors: [],
        },
      }),
    );

    await runDiscoveryPipeline('run1');

    expect(searchMock.harvestFromWebSearch).toHaveBeenCalledTimes(1);
    const [, , webExclude] = searchMock.harvestFromWebSearch.mock.calls[0];
    const [, , serpExclude] = searchMock.harvestFromSerp.mock.calls[0];
    for (const exclude of [webExclude, serpExclude]) {
      expect(exclude).toBeInstanceOf(Set);
      expect(exclude.has('acme.com')).toBe(true);
      expect(exclude.has('accepted.com')).toBe(true);
      expect(exclude.has('reasonless-reject.com')).toBe(true);
      expect(exclude.has('coded-reject.com')).toBe(true);
    }
  });
});

describe('reapStaleRuns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.discoveryRun.updateMany.mockResolvedValue({ count: 0 });
  });

  it('reaps only the in-flight runs old enough to be stale, leaving fresh ones alone', async () => {
    const now = Date.now();
    prismaMock.discoveryRun.findMany.mockResolvedValue([
      { id: 'stale-1', status: 'RUNNING', startedAt: new Date(now - (STALE_RUN_MINUTES + 5) * 60 * 1000) },
      { id: 'fresh-1', status: 'PENDING', startedAt: new Date(now - 1 * 60 * 1000) },
    ]);

    await reapStaleRuns('ws1');

    expect(prismaMock.discoveryRun.updateMany).toHaveBeenCalledTimes(1);
    const [{ where, data }] = prismaMock.discoveryRun.updateMany.mock.calls[0];
    expect(where.id.in).toEqual(['stale-1']);
    expect(data.status).toBe('FAILED');
    expect(data.error).toBe('TIMED_OUT');
  });

  it('does nothing when there is nothing stale', async () => {
    prismaMock.discoveryRun.findMany.mockResolvedValue([
      { id: 'fresh-1', status: 'RUNNING', startedAt: new Date() },
    ]);

    await reapStaleRuns('ws1');

    expect(prismaMock.discoveryRun.updateMany).not.toHaveBeenCalled();
  });
});

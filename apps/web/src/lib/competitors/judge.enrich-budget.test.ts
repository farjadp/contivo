import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Candidate } from './types';

// ---------------------------------------------------------------------------
// Same rationale as judge.fetch.test.ts: a real HTTP server for these tests
// can only listen on 127.0.0.1, which `isBlockedAddress` exists to reject,
// so the network guard is mocked open here. This file only exercises
// `enrichCandidates`'s overall wall-clock budget — the fetch mechanics
// themselves (redirects, capping, deadlines) are covered there.
// ---------------------------------------------------------------------------
vi.mock('./network-guard', () => ({
  isBlockedAddress: () => false,
  isHostnameSafeToFetch: async () => true,
}));

const { enrichCandidates, ENRICH_BUDGET_MS } = await import('./judge');

function makeCandidates(domain: string, count: number): Candidate[] {
  return Array.from({ length: count }, () => ({
    domain,
    frequency: 1,
    sources: ['WEB_SEARCH'],
    evidence: [],
  }));
}

/**
 * A server that answers the homepage after `delayMs`, with just enough
 * signal-bearing HTML for `buildEnrichedCandidate` to keep the candidate,
 * and answers every other scanned path immediately with 404 (so a single
 * candidate's total time is dominated by the one delayed homepage fetch,
 * not by all seven paths `collectWebsiteEvidence` tries).
 */
function startSlowHomepageServer(delayMs: number): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === undefined) {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><title>Slow Example Homepage</title><body>hello there evidence</body></html>');
      }, delayMs);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('enrichCandidates: overall wall-clock budget', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it('exports a named default budget', () => {
    expect(ENRICH_BUDGET_MS).toBe(90_000);
  });

  it(
    'stops starting new fetches once the budget is spent, lets in-flight ones finish, and reports the skip',
    async () => {
      // Each candidate's homepage takes 60ms; the budget is a tiny 30ms —
      // real, but nowhere near the 90s default, so this test finishes in
      // well under a second rather than actually waiting on the budget.
      const { server, port } = await startSlowHomepageServer(60);
      servers.push(server);

      const domain = `127.0.0.1:${port}`;
      // 6 candidates against ENRICH_CONCURRENCY (5, not exported): the
      // first 5 all start together, comfortably inside the 30ms budget,
      // and take 60ms each. The 6th is only picked up once one of those
      // finishes — by which point 60ms has elapsed and the 30ms budget is
      // long gone, so it must be skipped rather than started.
      const candidates = makeCandidates(domain, 6);

      const result = await enrichCandidates(candidates, { budgetMs: 30 });

      expect(result.budgetExceeded).toBe(true);
      expect(result.skipped).toBeGreaterThan(0);
      expect(result.enriched.length + result.skipped).toBe(candidates.length);
      expect(result.enriched.length).toBeLessThan(candidates.length);
    },
    5000,
  );

  it('never reports a budget overrun when every fetch finishes well inside it', async () => {
    const { server, port } = await startSlowHomepageServer(1);
    servers.push(server);

    const domain = `127.0.0.1:${port}`;
    const candidates = makeCandidates(domain, 3);

    const result = await enrichCandidates(candidates, { budgetMs: 5000 });

    expect(result.budgetExceeded).toBe(false);
    expect(result.skipped).toBe(0);
    expect(result.enriched.length).toBe(3);
  });

  it('accepts an injected clock instead of wall time, so a test can simulate the budget passing without any real delay', async () => {
    const { server, port } = await startSlowHomepageServer(0);
    servers.push(server);

    const domain = `127.0.0.1:${port}`;
    const candidates = makeCandidates(domain, 2);

    // A clock that never advances, paired with a zero-length budget: the
    // deadline is `now() + 0`, so the very first check (`now() >=
    // deadline`) is already true. Every candidate must be skipped, with
    // zero real delay and without depending on any actual fetch timing.
    const frozenClock = () => 1_000_000;

    const result = await enrichCandidates(candidates, { budgetMs: 0, now: frozenClock });

    expect(result.budgetExceeded).toBe(true);
    expect(result.skipped).toBe(2);
    expect(result.enriched).toEqual([]);
  });
});

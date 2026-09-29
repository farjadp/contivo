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

const { collectWebsiteEvidence, DISCOVERY_EVIDENCE_PATHS, enrichCandidates, ENRICH_BUDGET_MS, MAX_SITE_EVIDENCE_CHARS } =
  await import('./judge');

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

describe('collectWebsiteEvidence: per-path deadline and evidence cap', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  function startCountingServer(body: string, delayMs: number): Promise<{ server: http.Server; port: number; hits: string[] }> {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(body);
      }, delayMs);
    });
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        resolve({ server, port: (server.address() as AddressInfo).port, hits });
      });
    });
  }

  it('stops before the next path once the deadline has passed, instead of running every path', async () => {
    const { server, port, hits } = await startCountingServer(
      '<html><title>Page title here</title><body><h1>Some heading text</h1></body></html>',
      0,
    );
    servers.push(server);

    // A clock that jumps past the deadline after the first path is read.
    let t = 0;
    const now = () => t;
    const pending = collectWebsiteEvidence(`127.0.0.1:${port}`, { deadline: 10, now });
    // Advance the clock as soon as the first request lands.
    const timer = setInterval(() => {
      if (hits.length >= 1) t = 100;
    }, 1);
    const result = await pending;
    clearInterval(timer);

    expect(DISCOVERY_EVIDENCE_PATHS.length).toBeGreaterThan(1);
    expect(hits).toEqual(['/']);
    expect(result.pages).toHaveLength(1);
  });

  it('reads nothing at all when the deadline is already past', async () => {
    const { server, port, hits } = await startCountingServer('<html><title>x title</title></html>', 0);
    servers.push(server);

    const result = await collectWebsiteEvidence(`127.0.0.1:${port}`, { deadline: 0, now: () => 1 });

    expect(hits).toEqual([]);
    expect(result.pages).toEqual([]);
  });

  it(`caps one candidate's evidence at ${MAX_SITE_EVIDENCE_CHARS} characters however long the pages are`, async () => {
    const longLine = (i: number) => `<p>${'evidence '.repeat(200)} line ${i}</p>`;
    const body = `<html><body>${Array.from({ length: 30 }, (_, i) => longLine(i)).join('')}</body></html>`;
    const { server, port } = await startCountingServer(body, 0);
    servers.push(server);

    const result = await collectWebsiteEvidence(`127.0.0.1:${port}`);

    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.evidence.length).toBe(MAX_SITE_EVIDENCE_CHARS);
  });
});

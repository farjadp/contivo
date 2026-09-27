import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// The real `isBlockedAddress` is used throughout, so the pinned DNS lookup in
// judge.ts refuses loopback exactly as it does in production.
//
// The only thing stubbed is `isHostnameSafeToFetch`, the cheap up-front
// check, and only so the tests can reach a real local server at all:
//   - "127.0.0.1…" plays the part of a PUBLIC site (a test server can only
//     listen on loopback). Node does not run a DNS lookup for an IP literal,
//     so the pinned lookup never sees it either.
//   - "localhost…" passes the up-front check too, to prove the pinned lookup
//     — the layer plain `fetch()` never had — refuses it on its own.
// Every other hostname (redirect targets included) gets the real check.
// ---------------------------------------------------------------------------
vi.mock('./network-guard', async () => {
  const actual = await vi.importActual<typeof import('./network-guard')>('./network-guard');
  return {
    isBlockedAddress: actual.isBlockedAddress,
    isHostnameSafeToFetch: async (hostname: string) =>
      hostname.startsWith('127.0.0.1') || hostname.startsWith('localhost')
        ? true
        : actual.isHostnameSafeToFetch(hostname),
  };
});

const { collectSiteSignals, MAX_SITE_SIGNAL_CHARS } = await import('./site-signals');

const PAGE = (text: string) =>
  `<html><head><title>${text} title</title></head><body><h1>${text} heading line</h1><p>${text} paragraph text here</p></body></html>`;

type Started = { server: http.Server; port: number; hits: string[] };

function startServer(handler: http.RequestListener): Promise<Started> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, hits });
    });
  });
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe('collectSiteSignals (Keywords / Offerings site reader)', () => {
  it('reads a normal page through the hardened client', async () => {
    const started = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE('Public'));
    });
    servers.push(started.server);

    const result = await collectSiteSignals(`127.0.0.1:${started.port}`, { paths: ['/'], linesPerPage: 10, maxLines: 10 });

    expect(result.pages_scanned).toEqual(['/']);
    expect(result.evidence).toContain('Public heading line');
  });

  it('refuses a domain that resolves to a private (loopback) address, without ever connecting', async () => {
    const started = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(PAGE('Internal'));
    });
    servers.push(started.server);

    const result = await collectSiteSignals(`localhost:${started.port}`, {
      paths: ['/', '/pricing'],
      linesPerPage: 10,
      maxLines: 10,
    });

    expect(result.pages_scanned).toEqual([]);
    expect(result.evidence).toBe('');
    expect(started.hits).toEqual([]);
  });

  it('refuses a public page that redirects to a private address (metadata endpoint or loopback name)', async () => {
    const internal = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(PAGE('Secret'));
    });
    servers.push(internal.server);

    const publicSite = await startServer((req, res) => {
      if (req.url === '/') {
        res.writeHead(200);
        res.end(PAGE('Home'));
        return;
      }
      if (req.url === '/pricing') {
        res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      }
      res.writeHead(302, { Location: `http://internal.localhost:${internal.port}/admin` });
      res.end();
    });
    servers.push(publicSite.server);

    const result = await collectSiteSignals(`127.0.0.1:${publicSite.port}`, {
      paths: ['/', '/pricing', '/about'],
      linesPerPage: 10,
      maxLines: 100,
    });

    // The redirecting paths were requested, and refused at the next hop.
    expect(publicSite.hits).toEqual(expect.arrayContaining(['/', '/pricing', '/about']));
    expect(result.pages_scanned).toEqual(['/']);
    expect(result.evidence).not.toContain('Secret');
    expect(internal.hits).toEqual([]);
  });

  it(`caps the evidence at ${MAX_SITE_SIGNAL_CHARS} characters`, async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `<p>${'word '.repeat(30)} number ${i}</p>`).join('');
    const started = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(`<html><body>${lines}</body></html>`);
    });
    servers.push(started.server);

    const result = await collectSiteSignals(`127.0.0.1:${started.port}`, {
      paths: ['/'],
      linesPerPage: 150,
      maxLines: 500,
    });

    expect(result.evidence.length).toBe(MAX_SITE_SIGNAL_CHARS);
  });

  describe('overall time budget (deadline / now)', () => {
    it('stops reading further paths once the deadline has passed, without waiting for it in real time', async () => {
      const started = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PAGE('Slow'));
      });
      servers.push(started.server);

      // An injected clock that is already past the deadline on its very
      // first read: proves the budget is enforced without any real wait.
      const now = () => 1_000;
      const result = await collectSiteSignals(`127.0.0.1:${started.port}`, {
        paths: ['/', '/pricing', '/about'],
        linesPerPage: 10,
        maxLines: 100,
        deadline: 500,
        now,
      });

      expect(started.hits).toEqual([]);
      expect(result.pages_scanned).toEqual([]);
      expect(result.evidence).toBe('');
    });

    it('reads pages normally while the injected clock is still under the deadline', async () => {
      const started = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PAGE('Fast'));
      });
      servers.push(started.server);

      const now = () => 0; // always well under the deadline
      const result = await collectSiteSignals(`127.0.0.1:${started.port}`, {
        paths: ['/'],
        linesPerPage: 10,
        maxLines: 10,
        deadline: 60_000,
        now,
      });

      expect(started.hits).toEqual(['/']);
      expect(result.pages_scanned).toEqual(['/']);
      expect(result.evidence).toContain('Fast heading line');
    });

    it('stops mid-loop once a fake clock crosses the deadline between paths', async () => {
      const started = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(PAGE('Mid'));
      });
      servers.push(started.server);

      // Advances past the deadline after the first path is checked, so the
      // second and third paths are never fetched — proving the deadline is
      // re-checked before every path, not just once up front.
      let calls = 0;
      const now = () => (calls++ === 0 ? 0 : 10_000);

      const result = await collectSiteSignals(`127.0.0.1:${started.port}`, {
        paths: ['/', '/pricing', '/about'],
        linesPerPage: 10,
        maxLines: 100,
        deadline: 5_000,
        now,
      });

      expect(started.hits).toEqual(['/']);
      expect(result.pages_scanned).toEqual(['/']);
    });
  });
});

describe('Keywords and Offerings read competitor sites only through collectSiteSignals', () => {
  // Server actions cannot be unit-tested without a request context, so this
  // pins the wiring itself: neither file may regain its own fetcher, a
  // followed redirect, or an unbounded HTML regex.
  for (const file of ['growth-keywords.ts', 'growth-offerings.ts']) {
    it(file, () => {
      const source = readFileSync(path.join(__dirname, '../../app/actions', file), 'utf8');
      expect(source).toContain("from '@/lib/competitors/site-signals'");
      expect(source).toMatch(/collectSiteSignals\(/);
      expect(source).not.toMatch(/redirect:\s*'follow'/);
      expect(source).not.toMatch(/\[\\s\\S\]\*\?/);
      // The only fetch left in each file is the OpenAI call.
      const fetchTargets = [...source.matchAll(/fetch\(\s*([^,)]+)/g)].map((m) => m[1].trim());
      expect(fetchTargets.every((target) => target.startsWith("'https://api.openai.com/"))).toBe(true);
    });
  }

  // Fix-wave re-review: "Overall time budget for the Keywords and Offerings
  // site reads" — each collection loop must own a wall-clock budget and
  // stop starting new fetches once it is spent, not just cap one fetch.
  for (const file of ['growth-keywords.ts', 'growth-offerings.ts']) {
    it(`${file} gives its site-read loop a named overall budget and honors it in the loop`, () => {
      const source = readFileSync(path.join(__dirname, '../../app/actions', file), 'utf8');
      // A named, module-scoped budget constant in milliseconds.
      expect(source).toMatch(/const \w*ENRICH_BUDGET_MS\w* = \d[\d_]*;/);
      // The loop checks the deadline before starting each site, not only
      // inside collectSiteSignals's own per-path loop.
      expect(source).toMatch(/if \(now\(\) >= deadline\) break;/);
      // The deadline (and the same injectable `now`) is threaded into every
      // collectSiteSignals call, not computed fresh per call.
      expect(source).toMatch(/\{\s*deadline,\s*now\s*\}/);
    });
  }
});

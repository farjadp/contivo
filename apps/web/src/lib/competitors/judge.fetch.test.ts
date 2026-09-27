import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// `isBlockedAddress`/`isHostnameSafeToFetch` are exhaustively tested in
// network-guard.test.ts. Mocking them here isolates what THIS file tests —
// the fetch mechanics themselves (redirects, hop limit, capping, the shared
// https/http validation) — from that blocking logic, which would otherwise
// reject every request this file makes: a real HTTP server for these tests
// can only ever listen on 127.0.0.1, and 127.0.0.1 is loopback — exactly
// what `isBlockedAddress` exists to block. `isHostnameSafeToFetch` below is
// a `vi.fn()` so individual tests can still make it reject a specific
// hostname, to prove per-hop revalidation actually happens.
// ---------------------------------------------------------------------------
// `vi.mock` factories are hoisted above all imports (including this file's
// own), so the mock function they reference must come from `vi.hoisted` —
// an ordinary top-level `const` here would be a temporal-dead-zone
// ReferenceError at the point the factory actually runs.
const { isHostnameSafeToFetchMock } = vi.hoisted(() => ({
  isHostnameSafeToFetchMock: vi.fn(async (hostname: string) => hostname !== 'blocked.invalid.test'),
}));

vi.mock('./network-guard', () => ({
  isBlockedAddress: () => false,
  isHostnameSafeToFetch: (hostname: string) => isHostnameSafeToFetchMock(hostname),
}));

const { fetchHtmlForDomain, fetchSafeUrl, FETCH_TIMEOUT_MS, MAX_REDIRECTS, readCappedBody } = await import('./judge');

function startServer(handler: http.RequestListener): Promise<{ server: http.Server; port: number; hits: () => number }> {
  let hitCount = 0;
  const server = http.createServer((req, res) => {
    hitCount += 1;
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port, hits: () => hitCount });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('readCappedBody', () => {
  function makeStream(chunks: string[]): IncomingMessage {
    let i = 0;
    return new Readable({
      read() {
        if (i < chunks.length) {
          this.push(Buffer.from(chunks[i++]));
        } else {
          this.push(null);
        }
      },
    }) as unknown as IncomingMessage;
  }

  it('returns the full body when it is under the cap', async () => {
    const result = await readCappedBody(makeStream(['hello ', 'world']), 1000);
    expect(result).toBe('hello world');
  });

  it('stops at the cap, mid-chunk, and never reads past it', async () => {
    const result = await readCappedBody(makeStream(['aaaa', 'bbbbbbbb', 'cccc']), 6);
    expect(result).toBe('aaaabb');
    expect(result.length).toBe(6);
  });

  it('rejects when the stream itself errors', async () => {
    const stream = new Readable({
      read() {
        this.destroy(new Error('boom'));
      },
    }) as unknown as IncomingMessage;

    await expect(readCappedBody(stream, 1000)).rejects.toThrow('boom');
  });
});

describe('fetchSafeUrl / fetchHtmlForDomain: redirects, hop limit, capping', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    isHostnameSafeToFetchMock.mockClear();
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it('returns the body of a plain 200 response', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>hello</html>');
    });
    servers.push(server);

    const result = await fetchSafeUrl(`http://127.0.0.1:${port}/`, MAX_REDIRECTS);

    expect(result).toBe('<html>hello</html>');
  });

  it('follows a redirect chain up to the limit and returns the final body', async () => {
    const { server, port } = await startServer((req, res) => {
      const n = Number(req.url?.split('/').pop() ?? '0');
      if (n < MAX_REDIRECTS) {
        res.writeHead(302, { Location: `/hop/${n + 1}` });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end('done');
    });
    servers.push(server);

    const result = await fetchSafeUrl(`http://127.0.0.1:${port}/hop/0`, MAX_REDIRECTS);

    expect(result).toBe('done');
  });

  it('gives up once the redirect chain exceeds the hop limit, rather than following forever', async () => {
    const { server, port } = await startServer((req, res) => {
      const n = Number(req.url?.split('/').pop() ?? '0');
      // Always redirects one more hop than was asked for — the chain
      // never reaches a terminal 200 within MAX_REDIRECTS hops.
      res.writeHead(302, { Location: `/hop/${n + 1}` });
      res.end();
    });
    servers.push(server);

    const result = await fetchSafeUrl(`http://127.0.0.1:${port}/hop/0`, MAX_REDIRECTS);

    expect(result).toBeNull();
  });

  it('re-validates the destination hostname of every redirect hop, not just the first request', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(302, { Location: 'http://blocked.invalid.test/somewhere' });
      res.end();
    });
    servers.push(server);

    const result = await fetchSafeUrl(`http://127.0.0.1:${port}/`, MAX_REDIRECTS);

    expect(result).toBeNull();
    // Proves the redirect target's hostname was actually checked, not
    // skipped because the first hop already passed.
    expect(isHostnameSafeToFetchMock).toHaveBeenCalledWith('blocked.invalid.test');
  });

  it('caps the body it reads even when the server sends more than the limit', async () => {
    const oneMegabyte = 'x'.repeat(1024 * 1024);
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(oneMegabyte);
    });
    servers.push(server);

    const result = await fetchSafeUrl(`http://127.0.0.1:${port}/`, MAX_REDIRECTS);

    // MAX_RESPONSE_BYTES is 256KB; the server sent 1MB.
    expect(result).not.toBeNull();
    expect((result as string).length).toBeLessThanOrEqual(256 * 1024);
  });

  it(
    'abandons a server that trickles bytes forever, at the overall deadline, rather than hanging indefinitely',
    async () => {
      // A server that writes a few bytes just inside the socket-idle
      // window, forever, defeats an *idle* timeout (it resets on every
      // byte) but must not defeat an *overall* deadline. This is the
      // regression this test guards: round 2 replaced round 1's
      // `AbortSignal.timeout` with only an idle `timeout` option, and a
      // server exactly like this one kept a read open past 8 seconds.
      const { server, port } = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        const interval = setInterval(() => {
          if (res.destroyed) {
            clearInterval(interval);
            return;
          }
          res.write('.');
        }, 500); // well inside FETCH_TIMEOUT_MS, so an idle-only timer never fires
        res.socket?.on('close', () => clearInterval(interval));
      });
      servers.push(server);

      const startedAt = Date.now();
      const result = await fetchSafeUrl(`http://127.0.0.1:${port}/`, MAX_REDIRECTS);
      const elapsed = Date.now() - startedAt;

      // Abandoned at (or shortly after) the overall deadline, not left
      // open indefinitely. Generous upper bound (deadline + 3s) for CI
      // scheduling noise, while still failing loud if this regresses to
      // "never times out at all".
      expect(elapsed).toBeLessThan(FETCH_TIMEOUT_MS + 3000);
      expect(elapsed).toBeGreaterThanOrEqual(FETCH_TIMEOUT_MS - 500);
      // The body never reached a terminal size — it was abandoned mid-read,
      // not completed and then truncated by the byte cap.
      expect(result).toBeNull();
    },
    FETCH_TIMEOUT_MS + 5000,
  );

  it('fetchHtmlForDomain never attempts either https or http when the hostname fails validation', async () => {
    // `mockImplementationOnce` rather than `mockImplementation`: the latter
    // would leak into every later test in this file, since `afterEach`
    // below only clears call history, not a custom implementation.
    isHostnameSafeToFetchMock.mockImplementationOnce(async () => false);

    const result = await fetchHtmlForDomain('blocked.invalid.test', '/');

    expect(result).toBeNull();
    // Called once (the shared up-front check), not once per scheme — there
    // is one validation gating both candidate URLs, not a separate,
    // possibly-weaker check per scheme.
    expect(isHostnameSafeToFetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetchHtmlForDomain tries https then http, both against a real server, and returns on the first success', async () => {
    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('<html>found via http</html>');
    });
    servers.push(server);

    // There's no local https server here (setting one up needs a cert);
    // fetchHtmlForDomain's https attempt fails to connect, and it falls
    // through to the http candidate the way it would in production
    // against a site with no TLS.
    const result = await fetchHtmlForDomain(`127.0.0.1:${port}`, '/');

    expect(result).toEqual({ url: `http://127.0.0.1:${port}/`, html: '<html>found via http</html>' });
  });
});

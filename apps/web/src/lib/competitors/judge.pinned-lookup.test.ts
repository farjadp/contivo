import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// This file exists to exercise the one path judge.fetch.test.ts's mocking
// strategy accidentally skipped: every request in that file targets the IP
// literal `127.0.0.1`, and Node's `net` module never calls a custom `lookup`
// function for an IP literal — only for an actual hostname. `pinnedLookup`
// (judge.ts) was therefore never executed by any test, and shipped with a
// bug that broke every real-hostname fetch (see below).
//
// `node:dns`'s `promises.lookup` is mocked here so a fake hostname
// (`competitor.test`) resolves to `127.0.0.1` without needing real DNS
// infrastructure — this is what makes Node's http/https stack actually
// invoke `pinnedLookup`. `isBlockedAddress` is mocked to `() => false` (the
// same bypass judge.fetch.test.ts already uses) purely so the *loopback*
// address this fake hostname resolves to doesn't trip the guard — it is a
// stand-in for "some real public address", not something this file is
// asserting about. `isBlockedAddress` itself is exhaustively tested for
// real in network-guard.test.ts.
// ---------------------------------------------------------------------------
const { dnsLookupMock, isBlockedAddressMock } = vi.hoisted(() => ({
  dnsLookupMock: vi.fn(),
  isBlockedAddressMock: vi.fn<(address: string) => boolean>(() => false),
}));

vi.mock('node:dns', () => ({
  promises: { lookup: dnsLookupMock },
}));

vi.mock('./network-guard', () => ({
  isBlockedAddress: (address: string) => isBlockedAddressMock(address),
  isHostnameSafeToFetch: async () => true,
}));

const { fetchSafeUrl } = await import('./judge');

function startServer(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
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

describe('pinnedLookup: the actual DNS-resolution path for a real hostname', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    dnsLookupMock.mockReset();
    isBlockedAddressMock.mockReset();
    isBlockedAddressMock.mockImplementation(() => false);
    await Promise.all(servers.splice(0).map(closeServer));
  });

  // Before the fix, this exact test failed: `pinnedLookup` answered every
  // lookup in the single-address form regardless of what Node asked for,
  // and Node ≥ 20's `autoSelectFamily` (on by default) calls a custom
  // `lookup` with `{ all: true }` and requires the array form back.
  // Reproduced directly (not asserted from memory) before this fix landed:
  //
  //   $ node -e "... pinnedLookup answering in the single-address form ..."
  //   ERROR: Invalid IP address: undefined ERR_INVALID_IP_ADDRESS
  //
  // and via this very test, which returned `null` (a real page was never
  // fetched) instead of the server's actual body — see the fix-round
  // report for that failing run's output. It is a straightforward
  // regression test now that the fix is in.
  it('fetching a real hostname succeeds end to end through the pinned lookup', async () => {
    dnsLookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('<html>hello from a hostname fetch</html>');
    });
    servers.push(server);

    const result = await fetchSafeUrl(`http://competitor.test:${port}/`, 3);

    expect(result).toBe('<html>hello from a hostname fetch</html>');
    // Proves the request actually went through our lookup, not around it.
    expect(dnsLookupMock).toHaveBeenCalledWith('competitor.test', expect.objectContaining({ all: true }));
  });

  it('a hostname resolving only to a blocked address is refused by the pinned lookup itself, not by the earlier isHostnameSafeToFetch check', async () => {
    // isHostnameSafeToFetch is mocked to always return true in this file —
    // this test's assertion can only pass if pinnedLookup's own validation
    // is what refused the connection.
    dnsLookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    const { server, port } = await startServer((_req, res) => {
      res.writeHead(200);
      res.end('should never be reached');
    });
    servers.push(server);

    // isBlockedAddress is mocked to `() => false` by default in this file,
    // which would defeat this test — so this one test switches in the real
    // implementation instead.
    const real = await vi.importActual<typeof import('./network-guard')>('./network-guard');
    isBlockedAddressMock.mockImplementation(real.isBlockedAddress);

    const result = await fetchSafeUrl(`http://blocked-host.test:${port}/`, 3);

    expect(result).toBeNull();
  });

  it('a lookup error (e.g. NXDOMAIN) fails closed rather than throwing out of fetchSafeUrl', async () => {
    dnsLookupMock.mockRejectedValue(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }));

    const result = await fetchSafeUrl('http://does-not-exist.test/', 3);

    expect(result).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

import { isBlockedAddress } from './network-guard';

describe('isBlockedAddress', () => {
  describe('blocks every named range', () => {
    it.each([
      ['IPv4 loopback', '127.0.0.1'],
      ['IPv4 loopback, end of range', '127.255.255.255'],
      ['IPv4 "this network"', '0.0.0.0'],
      ['IPv4 link-local', '169.254.169.254'], // the canonical cloud-metadata address
      ['IPv4 CGNAT (RFC 6598)', '100.64.0.1'],
      ['IPv4 RFC1918 10/8', '10.0.0.1'],
      ['IPv4 RFC1918 172.16/12', '172.16.0.1'],
      ['IPv4 RFC1918 172.16/12, upper edge', '172.31.255.255'],
      ['IPv4 RFC1918 192.168/16', '192.168.1.1'],
      ['IPv6 loopback', '::1'],
      ['IPv6 unspecified', '::'],
      ['IPv6 link-local', 'fe80::1'],
      ['IPv6 link-local, upper edge of fe80::/10', 'febf::1'],
      ['IPv6 unique-local (fc00::/7)', 'fd00::1'],
      ['IPv4-mapped IPv6 loopback', '::ffff:127.0.0.1'],
      ['IPv4-mapped IPv6 RFC1918', '::ffff:10.0.0.1'],
      ['IPv4-compatible IPv6 (deprecated form) private address', '::192.168.1.1'],
      // The bug a previous version of this function had: the same
      // IPv4-mapped loopback address as above, but in its hex-group form
      // instead of dotted-quad. `::ffff:127.0.0.1`, `::ffff:7f00:1` and
      // the fully-expanded `0:0:0:0:0:ffff:7f00:1` are the exact same
      // address; a check that only recognised the dotted-quad spelling let
      // this one through.
      ['IPv4-mapped IPv6 loopback, hex-group form', '::ffff:7f00:1'],
      ['IPv4-mapped IPv6 loopback, fully expanded hex-group form', '0:0:0:0:0:ffff:7f00:1'],
      ['IPv4-mapped IPv6 RFC1918, hex-group form', '::ffff:a00:1'], // 10.0.0.1
      ['IPv4 benchmarking (RFC 2544)', '198.18.0.1'],
      ['IPv4 benchmarking (RFC 2544), upper half of the /15', '198.19.255.255'],
      ['IPv4 IETF protocol assignments (RFC 6890)', '192.0.0.1'],
      ['IPv4 multicast', '224.0.0.1'],
      ['IPv4 reserved (240/4)', '240.0.0.1'],
      ['IPv4 reserved (240/4), broadcast', '255.255.255.255'],
      ['IPv6 multicast (ff00::/8)', 'ff02::1'], // all-nodes link-local multicast
      ['IPv6 NAT64 well-known prefix (64:ff9b::/96)', '64:ff9b::192.168.1.1'],
      ['IPv6 NAT64 well-known prefix, hex-group form', '64:ff9b::c0a8:101'],
    ])('%s (%s)', (_label, address) => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  });

  describe('allows genuinely public addresses', () => {
    it.each([
      ['a public IPv4 address', '8.8.8.8'],
      ['a public IPv4 address just outside 172.16/12', '172.32.0.1'],
      ['a public IPv4 address just below the benchmarking block', '198.17.255.255'],
      ['a public IPv4 address just above the benchmarking block', '198.20.0.0'],
      ['a public IPv4 address just outside the IETF-protocol-assignments /24', '192.0.1.0'],
      ['a public IPv6 address', '2606:4700:4700::1111'],
      ['a public IPv6 address that merely starts with the same byte as multicast', 'fe00::1'], // ff00::/8, not fe..
    ])('%s (%s)', (_label, address) => {
      expect(isBlockedAddress(address)).toBe(false);
    });
  });

  it('fails closed for a value that is not a literal IP address at all', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true);
    expect(isBlockedAddress('localhost')).toBe(true);
  });
});

describe('isHostnameSafeToFetch', () => {
  it('is false when DNS resolution throws (e.g. NXDOMAIN)', async () => {
    vi.resetModules();
    vi.doMock('node:dns', () => ({
      promises: { lookup: vi.fn().mockRejectedValue(new Error('ENOTFOUND')) },
    }));
    const { isHostnameSafeToFetch } = await import('./network-guard');
    await expect(isHostnameSafeToFetch('this-domain-does-not-exist.invalid')).resolves.toBe(false);
    vi.doUnmock('node:dns');
    vi.resetModules();
  });

  it('is false when every resolved address is blocked', async () => {
    vi.resetModules();
    vi.doMock('node:dns', () => ({
      promises: { lookup: vi.fn().mockResolvedValue([{ address: '127.0.0.1', family: 4 }]) },
    }));
    const { isHostnameSafeToFetch } = await import('./network-guard');
    await expect(isHostnameSafeToFetch('sneaky.example')).resolves.toBe(false);
    vi.doUnmock('node:dns');
    vi.resetModules();
  });

  it('is false when even one of several resolved addresses is blocked', async () => {
    vi.resetModules();
    vi.doMock('node:dns', () => ({
      promises: {
        lookup: vi.fn().mockResolvedValue([
          { address: '8.8.8.8', family: 4 },
          { address: '10.0.0.5', family: 4 },
        ]),
      },
    }));
    const { isHostnameSafeToFetch } = await import('./network-guard');
    await expect(isHostnameSafeToFetch('mixed.example')).resolves.toBe(false);
    vi.doUnmock('node:dns');
    vi.resetModules();
  });

  it('is true when every resolved address is public', async () => {
    vi.resetModules();
    vi.doMock('node:dns', () => ({
      promises: { lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]) },
    }));
    const { isHostnameSafeToFetch } = await import('./network-guard');
    await expect(isHostnameSafeToFetch('example.com')).resolves.toBe(true);
    vi.doUnmock('node:dns');
    vi.resetModules();
  });
});

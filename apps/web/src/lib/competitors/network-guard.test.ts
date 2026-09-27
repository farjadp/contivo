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
    ])('%s (%s)', (_label, address) => {
      expect(isBlockedAddress(address)).toBe(true);
    });
  });

  describe('allows genuinely public addresses', () => {
    it.each([
      ['a public IPv4 address', '8.8.8.8'],
      ['a public IPv4 address just outside 172.16/12', '172.32.0.1'],
      ['a public IPv6 address', '2606:4700:4700::1111'],
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

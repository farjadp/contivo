import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// SSRF guard for customer-supplied URLs (revalidate URL). DNS is mocked so the
// tests never leave the machine.

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('node:dns', () => ({ default: { lookup: lookupMock }, lookup: lookupMock }));

import {
  BlockedOutboundAddressError,
  checkOutboundUrl,
  checkOutboundUrlSyntax,
  guardedLookup,
  isBlockedAddress,
} from './safe-outbound-url';

type Addr = { address: string; family: number };
function resolvesTo(...addresses: Addr[]) {
  lookupMock.mockImplementation((_h: string, _o: unknown, cb: (e: Error | null, a: Addr[]) => void) =>
    cb(null, addresses),
  );
}
const v4 = (address: string): Addr => ({ address, family: 4 });
const v6 = (address: string): Addr => ({ address, family: 6 });

beforeEach(() => {
  lookupMock.mockReset();
  vi.stubEnv('NODE_ENV', 'production');
});
afterEach(() => vi.unstubAllEnvs());

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fe80::1%en0',
    'fd12:3456::1', // Railway private network range
    'fd00:ec2::254', // AWS IMDS over IPv6
    'fc00::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1', // same, hex form (what URL() normalises to)
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe', // NAT64 of 169.254.169.254
    '2002:0a00:0001::1', // 6to4 of 10.0.0.1
    'ff02::1',
    'not-an-ip',
  ])('blocks %s', (addr) => {
    expect(isBlockedAddress(addr)).toBe(true);
  });

  it.each(['76.76.21.21', '8.8.8.8', '172.32.0.1', '2606:4700::6810:84e5', '::ffff:8.8.8.8'])(
    'allows public %s',
    (addr) => {
      expect(isBlockedAddress(addr)).toBe(false);
    },
  );
});

describe('checkOutboundUrlSyntax', () => {
  it.each([
    ['ftp://example.com/x', 'scheme'],
    ['not a url', 'invalid'],
    ['http://example.com/x', 'httpsRequired'],
    ['https://user:pass@example.com/x', 'credentials'],
    ['https://localhost/x', 'blockedHost'],
    ['https://contivo-api.railway.internal/x', 'blockedHost'],
    ['https://printer.local/x', 'blockedHost'],
    ['https://redis/x', 'blockedHost'],
    ['https://127.0.0.1/x', 'blockedHost'],
    ['https://169.254.169.254/latest/meta-data', 'blockedHost'],
    ['https://[::1]/x', 'blockedHost'],
    ['https://[::ffff:127.0.0.1]/x', 'blockedHost'],
    ['https://2130706433/x', 'blockedHost'], // decimal 127.0.0.1, URL() normalises it
    ['https://0x7f.1/x', 'blockedHost'],
  ])('%s → %s', (url, reason) => {
    expect(checkOutboundUrlSyntax(url)).toEqual({ ok: false, reason });
  });

  it('allows http outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(checkOutboundUrlSyntax('http://example.com/x').ok).toBe(true);
  });
});

describe('checkOutboundUrl (DNS)', () => {
  it('passes Contivo’s own revalidate URL when it resolves publicly', async () => {
    resolvesTo(v4('66.33.22.11'));
    const r = await checkOutboundUrl('https://www.contivo.app/api/blog/revalidate');
    expect(r.ok).toBe(true);
    expect(lookupMock.mock.calls[0]?.[0]).toBe('www.contivo.app');
  });

  it('blocks a public name that resolves to a private address', async () => {
    resolvesTo(v4('10.0.0.5'));
    expect(await checkOutboundUrl('https://evil.example.com/hook')).toEqual({ ok: false, reason: 'blockedHost' });
  });

  it('blocks when any one of several answers is private', async () => {
    resolvesTo(v4('8.8.8.8'), v6('fd12::1'));
    expect(await checkOutboundUrl('https://mixed.example.com/hook')).toEqual({ ok: false, reason: 'blockedHost' });
  });

  it('reports an unresolvable host', async () => {
    lookupMock.mockImplementation((_h: string, _o: unknown, cb: (e: Error) => void) => cb(new Error('ENOTFOUND')));
    expect(await checkOutboundUrl('https://nope.example.com/x')).toEqual({ ok: false, reason: 'unresolvable' });
  });

  it('does not resolve IP literals', async () => {
    expect((await checkOutboundUrl('https://8.8.8.8/x')).ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('guardedLookup (connect-time re-check, DNS rebinding)', () => {
  function run(options: { all?: boolean; family?: number }) {
    return new Promise<{ err: Error | null; rest: unknown[] }>((resolve) => {
      guardedLookup('rebind.example.com', options as never, ((err: Error | null, ...rest: unknown[]) =>
        resolve({ err, rest })) as never);
    });
  }

  it('refuses a private answer at connect time', async () => {
    resolvesTo(v4('127.0.0.1'));
    const { err } = await run({});
    expect(err).toBeInstanceOf(BlockedOutboundAddressError);
  });

  it('returns the first public address', async () => {
    resolvesTo(v4('8.8.8.8'));
    expect(await run({})).toEqual({ err: null, rest: ['8.8.8.8', 4] });
  });

  it('returns all addresses when asked', async () => {
    resolvesTo(v4('8.8.8.8'), v6('2606:4700::1'));
    expect(await run({ all: true })).toEqual({ err: null, rest: [[v4('8.8.8.8'), v6('2606:4700::1')]] });
  });
});

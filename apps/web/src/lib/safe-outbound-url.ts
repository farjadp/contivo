/**
 * Guard for server-side requests to URLs a customer typed in (SSRF).
 *
 * A customer-supplied URL (today: the site connection's revalidate URL) is
 * called from our servers on every publish and every edit. Without this guard
 * it can point at Railway's private network (*.railway.internal), the cloud
 * metadata service (169.254.169.254), localhost or any RFC 1918 / ULA address.
 *
 * Two layers:
 *  1. `checkOutboundUrl` — parse, scheme, no credentials, hostname rules, and
 *     every address the name resolves to must be public. Used at save time
 *     (clear error) and again before each request.
 *  2. `safeOutboundPost` — makes the request with node:http(s) and a `lookup`
 *     hook that re-checks the addresses the socket actually connects to. That
 *     closes DNS rebinding (name public at check time, private at connect
 *     time). Redirects are never followed: a 3xx is returned as a status.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

export type OutboundUrlError =
  | 'invalid'
  | 'scheme'
  | 'httpsRequired'
  | 'credentials'
  | 'blockedHost'
  | 'unresolvable';

export type OutboundUrlCheck = { ok: true; url: URL } | { ok: false; reason: OutboundUrlError };

export class BlockedOutboundAddressError extends Error {
  readonly address: string;

  constructor(address: string) {
    super(`Outbound request to a non-public address was blocked (${address})`);
    this.name = 'BlockedOutboundAddressError';
    this.address = address;
  }
}

export const DEFAULT_OUTBOUND_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Address classification

const blocked = new net.BlockList();
// IPv4 — special-purpose registry (RFC 6890 and successors).
for (const [netAddr, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(netAddr, prefix, 'ipv4');
}
// IPv6. IPv4-mapped / NAT64 / 6to4 are unwrapped and checked as IPv4 below.
for (const [netAddr, prefix] of [
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID…)
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local (Railway private network uses fd12::/16)
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(netAddr, prefix, 'ipv6');
}

/** Expands an IPv6 literal (no brackets, no zone) to 8 hextets, or null. */
function expandIPv6(address: string): number[] | null {
  let addr = address.toLowerCase();
  // Trailing dotted IPv4 (e.g. ::ffff:10.0.0.1) → two hextets.
  const dotted = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const v4 = dotted[2]!;
    if (net.isIPv4(v4) === false) return null;
    const [a, b, c, d] = v4.split('.').map(Number) as [number, number, number, number];
    addr = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return out.some(Number.isNaN) ? null : out;
}

function v4FromHextets(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * True when the address is not a public unicast address. Unknown input counts
 * as blocked: the guard fails closed.
 */
export function isBlockedAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, '').split('%')[0]!;
  if (net.isIPv4(bare)) return blocked.check(bare, 'ipv4');
  if (!net.isIPv6(bare)) return true;

  const h = expandIPv6(bare);
  if (!h) return true;
  const zeros = (n: number) => h.slice(0, n).every((x) => x === 0);
  // IPv4-mapped ::ffff:a.b.c.d
  if (zeros(5) && h[5] === 0xffff) return blocked.check(v4FromHextets(h[6]!, h[7]!), 'ipv4');
  // NAT64 64:ff9b::/96 — embeds an IPv4 address.
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return blocked.check(v4FromHextets(h[6]!, h[7]!), 'ipv4');
  }
  // 6to4 2002::/16 — embeds an IPv4 address in hextets 1–2.
  if (h[0] === 0x2002) return blocked.check(v4FromHextets(h[1]!, h[2]!), 'ipv4');
  return blocked.check(bare, 'ipv6');
}

// ---------------------------------------------------------------------------
// URL check

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.home.arpa', '.arpa'];

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function lookupAll(hostname: string): Promise<dns.LookupAddress[]> {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

/** Syntax, scheme, credentials and hostname rules only — no DNS. */
export function checkOutboundUrlSyntax(raw: string): OutboundUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'scheme' };
  if (url.protocol === 'http:' && isProduction()) return { ok: false, reason: 'httpsRequired' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'invalid' };
  const literal = host.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    return isBlockedAddress(literal) ? { ok: false, reason: 'blockedHost' } : { ok: true, url };
  }
  if (host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'blockedHost' };
  }
  return { ok: true, url };
}

/**
 * Full check: syntax rules plus every address the hostname resolves to must
 * be public. A single private address in the answer fails the whole URL.
 */
export async function checkOutboundUrl(raw: string): Promise<OutboundUrlCheck> {
  const syntax = checkOutboundUrlSyntax(raw);
  if (!syntax.ok) return syntax;
  const literal = syntax.url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) return syntax;

  let addresses: dns.LookupAddress[];
  try {
    addresses = await lookupAll(syntax.url.hostname);
  } catch {
    return { ok: false, reason: 'unresolvable' };
  }
  if (addresses.length === 0) return { ok: false, reason: 'unresolvable' };
  if (addresses.some((a) => isBlockedAddress(a.address))) return { ok: false, reason: 'blockedHost' };
  return syntax;
}

/**
 * `lookup` for the socket: resolves, refuses any non-public answer, and hands
 * the checked addresses to the connection. Exported for tests.
 */
export const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true, family: options.family }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad || addresses.length === 0) {
      return callback(new BlockedOutboundAddressError(bad?.address ?? hostname), '', 0);
    }
    if (options.all) {
      // Node's typings model only the single-address form of the callback.
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
      return;
    }
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
};

// ---------------------------------------------------------------------------
// Request

export type SafePostResult =
  | { ok: true; status: number }
  | { ok: false; status: number; reason: OutboundUrlError | 'redirect' | 'httpError' | 'network' | 'timeout' };

/**
 * POSTs to a customer-supplied URL. Never follows redirects, never reads more
 * than the status line, aborts after `timeoutMs`. Never throws.
 */
export async function safeOutboundPost(
  rawUrl: string,
  init: { headers?: Record<string, string>; body?: string; timeoutMs?: number },
): Promise<SafePostResult> {
  const check = await checkOutboundUrl(rawUrl);
  if (!check.ok) return { ok: false, status: 0, reason: check.reason };

  const url = check.url;
  const client = url.protocol === 'https:' ? https : http;
  const body = init.body ?? '';
  const timeoutMs = init.timeoutMs ?? DEFAULT_OUTBOUND_TIMEOUT_MS;

  return new Promise<SafePostResult>((resolve) => {
    let settled = false;
    const finish = (r: SafePostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const req = client.request(
      url,
      {
        method: 'POST',
        headers: { ...init.headers, 'Content-Length': Buffer.byteLength(body).toString() },
        lookup: guardedLookup,
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        res.resume();
        req.destroy();
        if (status >= 300 && status < 400) finish({ ok: false, status, reason: 'redirect' });
        else if (status >= 200 && status < 300) finish({ ok: true, status });
        else finish({ ok: false, status, reason: 'httpError' });
      },
    );

    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, status: 0, reason: 'timeout' });
    }, timeoutMs);

    req.on('error', (err) => {
      finish({
        ok: false,
        status: 0,
        reason: err instanceof BlockedOutboundAddressError ? 'blockedHost' : 'network',
      });
    });
    req.end(body);
  });
}

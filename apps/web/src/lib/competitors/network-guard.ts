import { isIPv4, isIPv6 } from 'node:net';
import { promises as dns } from 'node:dns';

/**
 * `collectWebsiteEvidence` (`judge.ts`) fetches whatever domain search
 * citations or a manual "add competitor" submission hand it, server-side,
 * with the app's own egress. `normalizeCandidateDomain` (`domains.ts`)
 * rejects IP *literals*, but a hostname is not a literal: a domain whose A
 * record points at `127.0.0.1`, an RFC1918 address, or a link-local
 * address passes that check untouched, and a public host can 302 a
 * follow-redirect straight to one of those too. This module is the actual
 * address check, kept pure and separately testable — the caller resolves a
 * hostname, hands each resolved address to `isBlockedAddress`, and refuses
 * to fetch at all if even one comes back blocked.
 *
 * This does not close every variant of this class of bug. In particular it
 * is not resistant to a DNS-rebinding attack where the name resolves to a
 * safe address for this check and a different, unsafe one microseconds
 * later when `fetch()` itself resolves it again — closing that fully would
 * mean pinning the connection to the address this module already resolved
 * (a custom `undici`/`http.Agent` dispatcher), which is a materially
 * bigger change than this fix. What this closes is the case the finding
 * actually described: a hostname that resolves directly to an internal
 * address, or a redirect chain that leads to one.
 */

const IPV4_LOOPBACK: [string, number] = ['127.0.0.0', 8];
const IPV4_THIS_NETWORK: [string, number] = ['0.0.0.0', 8];
const IPV4_LINK_LOCAL: [string, number] = ['169.254.0.0', 16];
const IPV4_CGNAT: [string, number] = ['100.64.0.0', 10]; // RFC 6598
const IPV4_RFC1918: Array<[string, number]> = [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
];

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  IPV4_LOOPBACK,
  IPV4_THIS_NETWORK,
  IPV4_LINK_LOCAL,
  IPV4_CGNAT,
  ...IPV4_RFC1918,
];

function ipv4ToInt(ip: string): number {
  return ip
    .split('.')
    .reduce((acc, octet) => ((acc << 8) + (Number(octet) & 0xff)) >>> 0, 0);
}

function ipv4InRange(ip: string, [base, prefixBits]: [string, number]): boolean {
  const mask = prefixBits === 0 ? 0 : (0xffffffff << (32 - prefixBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

/**
 * True when `address` (a literal IPv4 or IPv6 address, as returned by DNS
 * resolution — never a hostname) falls in a range that must never be
 * fetched server-side: loopback, link-local, RFC1918 private space, CGNAT
 * (RFC 6598), IPv6 unique-local, and the IPv4-mapped/IPv4-compatible IPv6
 * forms of any of the above. Anything that is not a recognisable IPv4 or
 * IPv6 literal is treated as blocked too — this function only ever says
 * "this specific address is known safe", never "I couldn't tell, so
 * assume yes".
 */
export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) {
    return BLOCKED_IPV4_RANGES.some((range) => ipv4InRange(address, range));
  }

  if (isIPv6(address)) {
    const lower = address.toLowerCase();

    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true; // loopback
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true; // unspecified

    // Link-local fe80::/10 — first hextet in fe80..febf.
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
    // Unique-local fc00::/7 — first hextet in fc00..fdff.
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;

    // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible
    // (::a.b.c.d) forms both embed a literal IPv4 address — validate that
    // address with the same rules rather than duplicating them.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);

    return false;
  }

  // Not a literal IPv4 or IPv6 address at all — fail closed.
  return true;
}

const DNS_LOOKUP_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS lookup timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Resolves `hostname` and returns `true` only when it resolved to at least
 * one address and every resolved address is outside every blocked range.
 * Fails closed: a hostname that cannot be resolved, that resolves to zero
 * addresses, or where resolution itself errors or times out, is treated as
 * unsafe rather than "couldn't check, so allow it".
 */
export async function isHostnameSafeToFetch(hostname: string): Promise<boolean> {
  try {
    const records = await withTimeout(dns.lookup(hostname, { all: true, verbatim: true }), DNS_LOOKUP_TIMEOUT_MS);
    if (records.length === 0) return false;
    return records.every((record) => !isBlockedAddress(record.address));
  } catch {
    return false;
  }
}

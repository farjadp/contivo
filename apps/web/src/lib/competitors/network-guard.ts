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
const IPV4_BENCHMARKING: [string, number] = ['198.18.0.0', 15]; // RFC 2544
const IPV4_IETF_PROTOCOL_ASSIGNMENTS: [string, number] = ['192.0.0.0', 24]; // RFC 6890
const IPV4_MULTICAST: [string, number] = ['224.0.0.0', 4];
const IPV4_RESERVED: [string, number] = ['240.0.0.0', 4];

const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  IPV4_LOOPBACK,
  IPV4_THIS_NETWORK,
  IPV4_LINK_LOCAL,
  IPV4_CGNAT,
  ...IPV4_RFC1918,
  IPV4_BENCHMARKING,
  IPV4_IETF_PROTOCOL_ASSIGNMENTS,
  IPV4_MULTICAST,
  IPV4_RESERVED,
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
 * Expands any valid IPv6 literal to exactly 8 lowercase 4-hex-digit groups
 * (no `::` shorthand, no embedded IPv4 dotted-quad — canonicalizing via
 * `new URL` collapses every representation of the same address, including
 * an embedded IPv4 tail, to one consistent hex-group form first: `::ffff:
 * 127.0.0.1`, `::ffff:7f00:1` and `0:0:0:0:0:ffff:7f00:1` all normalize to
 * the same `::ffff:7f00:1` before this function ever sees them). Returns
 * `null` if `address` is not a valid IPv6 literal.
 *
 * This is what a previous version of `isBlockedAddress` got wrong: it only
 * pattern-matched the *dotted-quad* mapped/compatible forms
 * (`::ffff:a.b.c.d`), so the equally valid hex-group form of the very same
 * address (`::ffff:7f00:1`, or the fully-expanded
 * `0:0:0:0:0:ffff:7f00:1`) sailed through unrecognised as an IPv4-mapped
 * loopback address.
 */
function expandIPv6(address: string): string[] | null {
  let canonical: string;
  try {
    // `new URL` requires brackets around a literal IPv6 host, and itself
    // rejects anything that isn't one.
    canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  } catch {
    return null;
  }

  const [head, tail] = canonical.includes('::') ? canonical.split('::') : [canonical, undefined];
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];

  if (!canonical.includes('::')) {
    return headGroups.length === 8 ? headGroups : null;
  }

  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  return [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
}

function hexGroupToByte(group: string, half: 'high' | 'low'): number {
  const value = parseInt(group || '0', 16);
  return half === 'high' ? (value >> 8) & 0xff : value & 0xff;
}

/**
 * True when `address` (a literal IPv4 or IPv6 address, as returned by DNS
 * resolution — never a hostname) falls in a range that must never be
 * fetched server-side: IPv4 loopback, "this network", link-local, CGNAT
 * (RFC 6598), all three RFC1918 private blocks, the RFC2544 benchmarking
 * block, the RFC6890 IETF-protocol-assignments block, multicast and the
 * reserved 240/4 block; IPv6 loopback, unspecified, link-local (fe80::/10),
 * unique-local (fc00::/7), multicast (ff00::/8), the NAT64 well-known
 * prefix (64:ff9b::/96), and the IPv4-mapped/IPv4-compatible IPv6 forms of
 * any of the above IPv4 ranges, in every representation those forms can
 * take. Anything that is not a recognisable IPv4 or IPv6 literal is
 * treated as blocked too — this function only ever says "this specific
 * address is known safe", never "I couldn't tell, so assume yes".
 */
export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) {
    return BLOCKED_IPV4_RANGES.some((range) => ipv4InRange(address, range));
  }

  if (isIPv6(address)) {
    const groups = expandIPv6(address);
    if (!groups) return true; // couldn't parse a value net.isIPv6 already accepted — fail closed

    if (groups.every((g) => g === '0')) return true; // :: (unspecified)
    if (groups.slice(0, 7).every((g) => g === '0') && groups[7] === '1') return true; // ::1 (loopback)

    const first = parseInt(groups[0], 16);
    if (first >= 0xfe80 && first <= 0xfebf) return true; // link-local fe80::/10
    if (first >= 0xfc00 && first <= 0xfdff) return true; // unique-local fc00::/7
    if (first >= 0xff00 && first <= 0xffff) return true; // multicast ff00::/8

    // NAT64 well-known prefix 64:ff9b::/96 — first 96 bits (6 groups) fixed.
    if (
      parseInt(groups[0], 16) === 0x0064 &&
      parseInt(groups[1], 16) === 0xff9b &&
      groups.slice(2, 6).every((g) => g === '0')
    ) {
      return true;
    }

    // IPv4-mapped (::ffff:0:0/96, i.e. groups 0-4 zero, group 5 = ffff) and
    // the deprecated IPv4-compatible (::0.0.0.0/96, groups 0-5 all zero)
    // forms both embed a literal IPv4 address in the last two groups —
    // validate that address with the same IPv4 rules rather than
    // duplicating them.
    const isMapped = groups.slice(0, 5).every((g) => g === '0') && groups[5] === 'ffff';
    const isCompatible = groups.slice(0, 6).every((g) => g === '0');
    if (isMapped || isCompatible) {
      const embeddedIPv4 = [
        hexGroupToByte(groups[6], 'high'),
        hexGroupToByte(groups[6], 'low'),
        hexGroupToByte(groups[7], 'high'),
        hexGroupToByte(groups[7], 'low'),
      ].join('.');
      return isBlockedAddress(embeddedIPv4);
    }

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

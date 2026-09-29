import { parse } from 'tldts';

/**
 * Hosts that mirror another site's stats under their own domain, e.g.
 * `sazito.com.atlaq.com`. Live search surfaces these instead of the real
 * company often enough that dropping them loses genuine competitors — the
 * Iranian store-builder query returned its best candidates only this way.
 */
const STAT_MIRROR_SUFFIXES = [
  'atlaq.com',
  'usitestat.com',
  'cutestat.com',
  'clearwebstats.com',
  'sitescorechecker.com',
  'webrate.org',
  'whtop.com',
  'hypestat.com',
];

/** Never a competitor, whatever the query. */
const EXCLUDED_DOMAINS = new Set([
  'google.com', 'bing.com', 'duckduckgo.com', 'yahoo.com',
  't.me', 'telegram.me', 'telegram.org', 'whatsapp.com',
  'linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com',
  'youtube.com', 'reddit.com', 'pinterest.com', 'tiktok.com',
  'wikipedia.org', 'wikimedia.org', 'archive.org',
  'github.com', 'docker.com', 'hub.docker.com', 'gitlab.com', 'npmjs.com',
  'builtwith.com', 'w3techs.com', 'wappalyzer.com', 'similarweb.com',
  'semrush.com', 'ahrefs.com', 'trustpilot.com', 'medium.com',
  'amazonaws.com', 'googleapis.com', 'cloudfront.net', 'webflow.io',
  ...STAT_MIRROR_SUFFIXES,
]);

export function isExcludedDomain(domain: string): boolean {
  return EXCLUDED_DOMAINS.has(domain.toLowerCase().trim());
}

function hostnameOf(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Turn a search-result URL into the registrable domain of the company behind
 * it, or null when it is not a company domain at all.
 */
export function normalizeCandidateDomain(input: string): string | null {
  const hostname = hostnameOf(input);
  if (!hostname) return null;

  // A stat mirror carries the real domain as the prefix of its own host.
  const mirror = STAT_MIRROR_SUFFIXES.find((suffix) => hostname.endsWith(`.${suffix}`));
  const target = mirror ? hostname.slice(0, -(mirror.length + 1)) : hostname;

  const parsed = parse(target.startsWith('www.') ? target.slice(4) : target);
  if (!parsed.domain || parsed.isIp) return null;

  const domain = parsed.domain.toLowerCase();
  if (isExcludedDomain(domain)) return null;
  return domain;
}

/**
 * Normalize a URL for equality comparison across discovery reruns.
 *
 * Unlike {@link normalizeCandidateDomain}, this keeps the path and query and
 * does NOT apply the exclusion list — it is used to match evidence items
 * (whatever their source) across runs, not to decide what counts as a
 * competitor.
 *
 * Return shape: `<lowercased host>[:port]<path><query>`, with no scheme, no
 * fragment, and no trailing slash on the path (except the bare root `/`).
 * This is deliberately not a valid URL string — it exists only for `===`
 * comparison between two normalized values.
 *
 * When `input` cannot be parsed as a URL (even after assuming an `https://`
 * prefix), this returns the trimmed original input unchanged. That is a
 * best-effort fallback, not a normalized form — callers should not expect it
 * to match a differently-formatted version of the same unparseable string.
 */
export function normalizeEvidenceUrl(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return raw;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return raw;
  }

  const host = url.hostname.toLowerCase();
  const port = url.port ? `:${url.port}` : '';
  let path = url.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  return `${host}${port}${path}${url.search}`;
}

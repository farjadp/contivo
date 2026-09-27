import { extractSignalsFromHtml, fetchHtmlForDomain } from './judge';

/**
 * Reads a handful of pages from a competitor's (or the workspace's own)
 * website for the Keywords and Offerings features, through the same hardened
 * client discovery uses (`fetchHtmlForDomain` in ./judge):
 *
 *   - DNS is resolved once and pinned, and every resolved address is checked
 *     against the private/loopback/link-local/ULA blocklist
 *     (`isBlockedAddress`), so a domain cannot point this server at its own
 *     network or a cloud metadata endpoint;
 *   - redirects are followed by hand, and every hop is re-validated the same
 *     way, so a public page cannot bounce the request somewhere private;
 *   - each response is capped at 256KB and bounded by a wall-clock deadline;
 *   - the HTML is parsed with the bounded patterns of `extractSignalsFromHtml`,
 *     never the unbounded (measured cubic) regexes these features used to
 *     carry, which one hostile page could use to freeze the whole process.
 *
 * Both features previously fetched with plain `fetch({ redirect: 'follow' })`
 * and read the full body. On Railway (one long-lived Node process) that was
 * an SSRF into the private network and a site-wide event-loop DoS.
 */

/** Matches the cap the downstream prompts were already built around. */
export const MAX_SITE_SIGNAL_CHARS = 12_000;

export type SiteSignalOptions = {
  /** Paths to try, in order, e.g. ['/', '/pricing']. */
  paths: string[];
  /** Lines kept from each page. */
  linesPerPage: number;
  /** Stop scanning further paths once this many lines are collected. */
  maxLines: number;
};

export type SiteSignals = {
  domain: string;
  /** The paths that returned readable content. */
  pages_scanned: string[];
  /** Newline-joined signal lines, at most MAX_SITE_SIGNAL_CHARS characters. */
  evidence: string;
};

export async function collectSiteSignals(domain: string, options: SiteSignalOptions): Promise<SiteSignals> {
  const pagesScanned: string[] = [];
  const lines: string[] = [];

  if (!domain) return { domain, pages_scanned: pagesScanned, evidence: '' };

  for (const path of options.paths) {
    const response = await fetchHtmlForDomain(domain, path);
    if (!response) continue;

    const signals = extractSignalsFromHtml(response.html);
    if (signals.length === 0) continue;

    pagesScanned.push(path);
    lines.push(...signals.slice(0, options.linesPerPage));
    if (lines.length >= options.maxLines) break;
  }

  return {
    domain,
    pages_scanned: pagesScanned,
    evidence: lines.join('\n').slice(0, MAX_SITE_SIGNAL_CHARS),
  };
}

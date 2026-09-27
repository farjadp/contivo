/**
 * Pure decisions behind the competitor discovery UI, kept out of the
 * components so they can be unit-tested without a DOM. Nothing here talks to
 * the server; the components call the actions in
 * `@/app/actions/growth-competitors` and hand the results to these helpers.
 */

import type { EvidenceItem, SourceStats } from '@/lib/competitors/types';

export const POLL_INTERVAL_MS = 3000;

/**
 * A browser-side ceiling on how long one tab keeps polling a single run.
 * `reapStaleRuns` (STALE_RUN_MINUTES = 10) is what actually ends a dead run
 * server-side, and `getDiscoveryStatus` calls it on every poll, so a stuck
 * run normally turns FAILED well before this. This only stops a tab from
 * polling forever if that ever stops being true.
 */
export const MAX_POLL_MS = 15 * 60 * 1000;

export const STAGE_ORDER = ['QUERIES', 'SEARCH', 'ENRICH', 'JUDGE', 'SAVE'] as const;
export type DiscoveryStage = (typeof STAGE_ORDER)[number];

export function isKnownStage(stage: string | null | undefined): stage is DiscoveryStage {
  return typeof stage === 'string' && (STAGE_ORDER as readonly string[]).includes(stage);
}

/**
 * The rejection reasons offered as chips. They must be a subset of
 * `REJECTION_REASONS` in the actions file, which rejects anything else.
 * `OTHER` is left out on purpose: it tells the next run nothing that
 * skipping the reason doesn't.
 */
export const REJECTION_REASON_CHIPS = ['NOT_A_COMPETITOR', 'WRONG_SCALE', 'DUPLICATE', 'ALREADY_KNOWN'] as const;
export type RejectionReasonChip = (typeof REJECTION_REASON_CHIPS)[number];

export function isRunActive(status: string | null | undefined): boolean {
  return status === 'PENDING' || status === 'RUNNING';
}

/**
 * Whether the panel should schedule another status poll. Polls only while a
 * run is PENDING or RUNNING, and never past MAX_POLL_MS from the run's start.
 */
export function shouldKeepPolling(
  run: { status: string; startedAt: string } | null | undefined,
  nowMs: number,
): boolean {
  if (!run || !isRunActive(run.status)) return false;
  const started = Date.parse(run.startedAt);
  if (Number.isNaN(started)) return true;
  return nowMs - started < MAX_POLL_MS;
}

export type RunOutcome =
  | { kind: 'none' }
  | { kind: 'active'; stage: DiscoveryStage | null; queryCount: number | null }
  | { kind: 'done'; saved: number; skippedSites: number }
  | { kind: 'empty'; queryCount: number | null; skippedSites: number }
  | { kind: 'failed'; error: string | null };

function queryCountOf(stats: SourceStats | null): number | null {
  const count = stats?.queries?.count;
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : null;
}

/** How many candidate sites the enrich stage never read because its time budget ran out. */
function skippedSitesOf(stats: SourceStats | null): number {
  const enrich = stats?.enrich;
  if (!enrich?.budgetExceeded) return 0;
  const skipped = enrich.skipped;
  return typeof skipped === 'number' && Number.isFinite(skipped) && skipped > 0 ? skipped : 0;
}

/** Maps the latest run to the message the run panel shows. */
export function runOutcome(
  run: { status: string; stage: string | null; savedCount: number; error: string | null; sourceStats: SourceStats | null } | null,
): RunOutcome {
  if (!run) return { kind: 'none' };
  switch (run.status) {
    case 'PENDING':
    case 'RUNNING':
      return {
        kind: 'active',
        stage: isKnownStage(run.stage) ? run.stage : null,
        queryCount: queryCountOf(run.sourceStats),
      };
    case 'DONE':
      return { kind: 'done', saved: run.savedCount, skippedSites: skippedSitesOf(run.sourceStats) };
    case 'EMPTY':
      return { kind: 'empty', queryCount: queryCountOf(run.sourceStats), skippedSites: skippedSitesOf(run.sourceStats) };
    case 'FAILED':
      return { kind: 'failed', error: run.error && run.error.trim() ? run.error.trim() : null };
    default:
      return { kind: 'none' };
  }
}

/** Index of the current stage in STAGE_ORDER, or -1 before the first stage has been written. */
export function stageIndex(stage: string | null | undefined): number {
  return isKnownStage(stage) ? STAGE_ORDER.indexOf(stage) : -1;
}

/**
 * Returns an href only for an absolute http(s) URL. Evidence URLs come from
 * third-party search results and websites; a `javascript:`, `data:` or
 * relative URL is shown as text, never as a link.
 */
export function safeExternalHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

/**
 * A link to a competitor's homepage built from its stored domain. Rejects
 * anything that does not parse back to exactly that hostname, so a domain
 * field holding a path, credentials or a different host never becomes a
 * link somewhere else.
 */
export function domainHref(domain: string | null | undefined): string | null {
  if (typeof domain !== 'string') return null;
  const host = domain.trim().toLowerCase();
  if (!host || /[\s/\\@?#:]/.test(host)) return null;
  const href = safeExternalHref(`https://${host}`);
  if (!href) return null;
  return new URL(href).hostname === host ? href : null;
}

/** Distinct, non-empty search queries that surfaced a competitor, in first-seen order. */
export function evidenceQueries(evidence: EvidenceItem[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of evidence) {
    const query = typeof item.query === 'string' ? item.query.trim() : '';
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}

/**
 * Splits evidence into what other pages said (search citations and results)
 * and the competitor's own pages that were read. One entry per URL.
 */
export function splitEvidence(evidence: EvidenceItem[]): { sources: EvidenceItem[]; sitePages: EvidenceItem[] } {
  const sources: EvidenceItem[] = [];
  const sitePages: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    if (typeof item.url !== 'string' || !item.url) continue;
    const key = `${item.kind === 'site' ? 'site' : 'src'}|${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.kind === 'site') sitePages.push(item);
    else sources.push(item);
  }
  return { sources, sitePages };
}

/** Highest confidence first; unknown confidence last; ties keep their original order. */
export function sortByConfidence<T extends { confidence: number | null }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ca = a.item.confidence;
      const cb = b.item.confidence;
      if (ca == null && cb == null) return a.index - b.index;
      if (ca == null) return 1;
      if (cb == null) return -1;
      return cb - ca || a.index - b.index;
    })
    .map(({ item }) => item);
}

/**
 * Merges a fresh competitor list from the server with local state, keeping
 * the local copy of any row whose own write is still in flight, so a poll
 * that lands mid-save cannot flip a decision back on screen.
 */
export function mergeCompetitors<T extends { id: string }>(server: T[], local: T[], inFlightIds: ReadonlySet<string>): T[] {
  if (inFlightIds.size === 0) return server;
  const localById = new Map(local.map((item) => [item.id, item]));
  return server.map((item) => (inFlightIds.has(item.id) ? localById.get(item.id) ?? item : item));
}

/**
 * Reads the sites of competitors that have nothing stored to score them on
 * (spec §15 E1), so a matrix never places a company from no evidence at all.
 *
 * Every item is real text read from the competitor's own site through the
 * hardened client in `@/lib/competitors/site-signals`; nothing is written here
 * and nothing is invented. A site that cannot be read, or yields nothing,
 * simply produces no items: the pipeline then leaves that competitor out.
 */
import { createHash } from 'node:crypto';

import { collectSiteSignals } from '@/lib/competitors/site-signals';
import type { EvidenceItem } from '@/lib/competitors/types';
import { runWithConcurrency } from '@/lib/run-with-concurrency';

import { competitorEvidence } from './bundle';

/** One wall-clock budget shared by every site read in a run. */
export const MATRIX_ENRICH_BUDGET_MS = 60_000;
export const MATRIX_ENRICH_CONCURRENCY = 3;

const MAX_LINES = 12;
const MAX_LINE = 300;
/** Where a company says what it sells, to whom, and for how much. */
const PATHS = ['/', '/about', '/pricing', '/features'];
const LINES_PER_PAGE = 6;

/** Lower-case, no protocol, no `www.`, no path. */
function normaliseDomain(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
}

/**
 * One evidence item per signal line: trimmed, empties dropped, at most 12
 * lines of at most 300 characters. The id is the first 8 hex of
 * sha256(domain + '\n' + text), so the same line on a later read is the same
 * item.
 */
export function siteEvidenceItems(domain: string, evidence: string): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const seen = new Set<string>();
  for (const raw of evidence.split('\n')) {
    if (items.length >= MAX_LINES) break;
    const text = raw.trim().slice(0, MAX_LINE);
    if (!text) continue;
    const id = createHash('sha256').update(`${domain}\n${text}`).digest('hex').slice(0, 8);
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, kind: 'site', url: `https://${domain}`, snippet: text });
  }
  return items;
}

/**
 * Appends `additions` to a competitor's stored evidence JSON. Existing entries
 * are kept exactly as stored, and an addition whose id is already there is
 * skipped, so no stored id ever changes meaning.
 */
export function mergeEvidence(stored: unknown, additions: EvidenceItem[]): unknown[] {
  const existing: unknown[] = Array.isArray(stored) ? [...stored] : [];
  const ids = new Set<string>();
  for (const entry of existing) {
    if (entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).id === 'string') {
      ids.add((entry as Record<string, unknown>).id as string);
    }
  }
  for (const item of additions) {
    if (ids.has(item.id)) continue;
    ids.add(item.id);
    existing.push(item);
  }
  return existing;
}

/**
 * For each competitor with no citable stored evidence, reads its site and
 * returns the evidence items found, keyed by competitor id. Competitors that
 * already have evidence, have no domain, could not be read, or yielded nothing
 * are absent from the map. `deadline` is shared: once it passes, no further
 * site is started, and each read stops between pages.
 */
export async function enrichEvidenceLessCompetitors(
  competitors: Array<{ id: string; domain: string | null; evidence: unknown }>,
  budget: { deadline: number; now: () => number },
): Promise<Map<string, EvidenceItem[]>> {
  const targets = competitors.filter((c) => competitorEvidence(c.evidence).length === 0);
  const found = await runWithConcurrency(targets, MATRIX_ENRICH_CONCURRENCY, async (competitor) => {
    const domain = normaliseDomain(competitor.domain);
    if (!domain || budget.now() >= budget.deadline) return null;
    try {
      const signals = await collectSiteSignals(domain, {
        paths: PATHS,
        linesPerPage: LINES_PER_PAGE,
        maxLines: MAX_LINES,
        deadline: budget.deadline,
        now: budget.now,
      });
      const items = siteEvidenceItems(domain, signals.evidence);
      return items.length > 0 ? { id: competitor.id, items } : null;
    } catch (error) {
      // An unreadable site is not a failed run: that competitor just has no evidence.
      console.warn('enrichEvidenceLessCompetitors: could not read', domain, error instanceof Error ? error.message : error);
      return null;
    }
  });

  const result = new Map<string, EvidenceItem[]>();
  for (const entry of found) if (entry) result.set(entry.id, entry.items);
  return result;
}

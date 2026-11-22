import { runAiTask, type AiCallContext } from '@/lib/ai';

import { normalizeCandidateDomain } from './domains';
import { tokensFromUsage } from './queries';
import { describeAiFailure } from './run-errors';
import { newEvidenceId } from './types';
import type { Candidate, EvidenceItem, TargetMarket } from './types';

const CONCURRENCY = 4;
const MAX_EVIDENCE_PER_DOMAIN = 6;

/**
 * What one `web_search` query produced, already reduced to the two things
 * that matter: the URLs the model actually cited (`citations`, from
 * `message` output items' `content[].annotations[]`) and the raw, noisy
 * source list (`sourceUrls`, from `web_search_call.action.sources[].url`).
 *
 * This split is the whole point of the rebuild: `citations` is the only
 * thing allowed to create a candidate; `sourceUrls` may only raise the
 * frequency of a domain a citation already produced.
 */
export type QueryHarvestResult = {
  query: string;
  citations: Array<{ url: string; title?: string }>;
  sourceUrls: string[];
};

/**
 * Pure merge: turn per-query search findings into `Candidate` records.
 *
 * Exported (not just used internally) so it can be unit-tested without a
 * network call — the network call is a thin wrapper that builds
 * `QueryHarvestResult[]` and hands it to this function.
 */
export function mergeQueryResults(
  results: QueryHarvestResult[],
  exclude: Set<string>,
): Candidate[] {
  // Domain -> per-query flags, built up across two passes (see below).
  const byDomain = new Map<
    string,
    { queriesSeen: Set<string>; evidence: EvidenceItem[] }
  >();

  const ensure = (domain: string) => {
    let entry = byDomain.get(domain);
    if (!entry) {
      entry = { queriesSeen: new Set(), evidence: [] };
      byDomain.set(domain, entry);
    }
    return entry;
  };

  // Pass 1: fold every query's citations into byDomain first, regardless of
  // query order. A domain can only exist here because a citation put it
  // there — this is the one and only place an entry is created.
  for (const result of results) {
    for (const citation of result.citations) {
      const domain = normalizeCandidateDomain(citation.url);
      if (!domain || exclude.has(domain)) continue;

      const entry = ensure(domain);
      entry.queriesSeen.add(result.query);
      if (entry.evidence.length < MAX_EVIDENCE_PER_DOMAIN) {
        entry.evidence.push({
          id: newEvidenceId(),
          kind: 'citation',
          url: citation.url,
          title: citation.title,
          query: result.query,
        });
      }
    }
  }

  // Pass 2: now that every citation-produced domain exists in byDomain
  // regardless of which query cited it, raise frequency from the raw
  // source lists. Query order no longer matters — a domain cited only in
  // a *later* query still gets credit for a *source-only* appearance in
  // an earlier one, because we only look at byDomain's final state here,
  // not at what had been seen so far when each query was processed.
  for (const result of results) {
    for (const sourceUrl of result.sourceUrls) {
      const domain = normalizeCandidateDomain(sourceUrl);
      if (!domain || exclude.has(domain)) continue;
      if (!byDomain.has(domain)) continue; // sources never create a candidate

      byDomain.get(domain)!.queriesSeen.add(result.query);
    }
  }

  const candidates: Candidate[] = [];
  for (const [domain, entry] of byDomain) {
    candidates.push({
      domain,
      frequency: entry.queriesSeen.size,
      sources: ['WEB_SEARCH'],
      evidence: entry.evidence,
    });
  }
  return candidates;
}

/**
 * Wall-clock bound on one web-search call. Live searches took 17-98 s, so
 * this leaves headroom while still ending a hung call long before the
 * reaper; without it only undici's default 300 s timeouts applied.
 */
export const SEARCH_REQUEST_TIMEOUT_MS = 150_000;

/** The instruction each provider's web-search call answers. */
export function buildSearchPrompt(query: string): string {
  return `Search the web for: "${query}". List the companies or products that offer this, each with its website. Be brief.`;
}

async function runOneQuery(
  query: string,
  market: TargetMarket,
  ctx: AiCallContext | undefined,
): Promise<{ result: QueryHarvestResult; tokens: number | null } | { error: string }> {
  try {
    // The search model comes from env inside the layer (OPENAI_SEARCH_MODEL
    // for OpenAI); each provider maps `webSearch` to its own search tool.
    const result = await runAiTask(
      'competitor_web_search',
      {
        prompt: buildSearchPrompt(query),
        output: { kind: 'text' },
        webSearch: market.country ? { country: market.country } : {},
        timeoutMs: SEARCH_REQUEST_TIMEOUT_MS,
      },
      ctx,
    );

    if (!result.ok) {
      return { error: describeAiFailure(`Search query failed for "${query}"`, result) };
    }
    if (!result.webSearch) {
      // The provider answered without searching: that is not "no
      // competitors", so it must not pass for an empty result.
      return { error: `Search query for "${query}" returned no web search results (${result.provider})` };
    }
    if (result.webSearch.citations.length === 0) {
      // Citations are the only thing that may create a candidate, so a search
      // that cites nothing contributes nothing. Counting it as success let a
      // provider that searches but does not cite (Claude, live 22 Nov: 9
      // sources, 0 citations) end every run EMPTY — "no competitors in your
      // market" — when the cause was the provider. As an error, a run where
      // every query does this ends FAILED (SEARCH_UNAVAILABLE, uncharged).
      return {
        error: `Search query for "${query}" returned no citations (${result.provider}, ${result.webSearch.sourceUrls.length} sources)`,
      };
    }

    // The query label is ours: the provider's own `webSearch.query` may be ''.
    return {
      result: { query, citations: result.webSearch.citations, sourceUrls: result.webSearch.sourceUrls },
      tokens: tokensFromUsage(result.usage),
    };
  } catch (error) {
    return { error: `Search query threw for "${query}": ${(error as Error).message}` };
  }
}

/** Run `tasks` with at most `concurrency` in flight at once, preserving order of settlement collection. */
async function runWithConcurrency<T>(items: string[], concurrency: number, task: (item: string) => Promise<T>): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function harvestFromWebSearch(
  queries: string[],
  market: TargetMarket,
  exclude: Set<string>,
  ctx?: AiCallContext,
): Promise<{ candidates: Candidate[]; tokens: number | null; errors: string[] }> {
  const outcomes = await runWithConcurrency(queries, CONCURRENCY, (query) => runOneQuery(query, market, ctx));

  const errors: string[] = [];
  const queryResults: QueryHarvestResult[] = [];
  let tokenSum: number | null = null;
  let sawReadableUsage = false;

  for (const outcome of outcomes) {
    if ('error' in outcome) {
      errors.push(outcome.error);
      continue;
    }
    queryResults.push(outcome.result);
    if (outcome.tokens != null) {
      sawReadableUsage = true;
      tokenSum = (tokenSum ?? 0) + outcome.tokens;
    }
  }

  // The sum is null only when nothing readable came back at all; otherwise
  // it is the sum of whatever usage figures could be read (see the
  // `readTokenUsage` doc comment in ./queries for why null must never
  // collapse into 0).
  const tokens = sawReadableUsage ? tokenSum : null;

  const candidates = mergeQueryResults(queryResults, exclude);

  return { candidates, tokens, errors };
}

/**
 * The signature matches `harvestFromWebSearch` so the pipeline can call both
 * the same way; the parameters are named only in the type because this stub
 * does not read them yet.
 */
export const harvestFromSerp: (
  queries: string[],
  market: TargetMarket,
  exclude: Set<string>,
) => Promise<{ candidates: Candidate[]; tokens: number | null; errors: string[] }> = async () => {
  // The SERP source (DataForSEO) is not built yet, so it stays off. A source
  // that has not been built is off, not failed: it reports no error whether
  // or not DataForSEO credentials exist (an error here put "SERP source not
  // implemented yet" into every run's sourceStats once credentials were set).
  // Returning nothing is the honest answer; mock data would poison discovery.
  // This stub never attempts a request, so zero tokens is a known fact here,
  // not an unread usage figure, and must not be reported as `null`.
  return { candidates: [], tokens: 0, errors: [] };
};

import { normalizeCandidateDomain } from './domains';
import { readTokenUsage } from './queries';
import { sanitizeUpstreamText } from './redact';
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

type OpenAiAnnotation = { url?: unknown; title?: unknown };
type OpenAiContentItem = { annotations?: OpenAiAnnotation[] };
type OpenAiMessageItem = { type: 'message'; content?: OpenAiContentItem[] };
type OpenAiWebSearchCallItem = {
  type: 'web_search_call';
  action?: { sources?: Array<{ url?: unknown }> };
};
type OpenAiOutputItem = OpenAiMessageItem | OpenAiWebSearchCallItem | { type: string };

function extractQueryHarvest(query: string, data: unknown): QueryHarvestResult {
  const output = Array.isArray((data as { output?: unknown })?.output)
    ? ((data as { output: OpenAiOutputItem[] }).output)
    : [];

  const citations: Array<{ url: string; title?: string }> = [];
  const sourceUrls: string[] = [];

  for (const item of output) {
    if (item.type === 'message') {
      const content = (item as OpenAiMessageItem).content ?? [];
      for (const block of content) {
        for (const annotation of block.annotations ?? []) {
          if (typeof annotation.url === 'string' && annotation.url) {
            citations.push({
              url: annotation.url,
              title: typeof annotation.title === 'string' ? annotation.title : undefined,
            });
          }
        }
      }
    } else if (item.type === 'web_search_call') {
      const sources = (item as OpenAiWebSearchCallItem).action?.sources ?? [];
      for (const source of sources) {
        if (typeof source.url === 'string' && source.url) {
          sourceUrls.push(source.url);
        }
      }
    }
  }

  return { query, citations, sourceUrls };
}

/**
 * Wall-clock bound on one web-search call. Live searches took 17-98 s, so
 * this leaves headroom while still ending a hung call long before the
 * reaper; without it only undici's default 300 s timeouts applied.
 */
export const SEARCH_REQUEST_TIMEOUT_MS = 150_000;

async function runOneQuery(
  query: string,
  market: TargetMarket,
  apiKey: string,
): Promise<{ result: QueryHarvestResult; tokens: number | null } | { error: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: AbortSignal.timeout(SEARCH_REQUEST_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_SEARCH_MODEL || 'gpt-5-mini',
        tools: [
          {
            type: 'web_search',
            search_context_size: 'low',
            ...(market.country ? { user_location: { type: 'approximate', country: market.country } } : {}),
          },
        ],
        include: ['web_search_call.action.sources'],
        input: `Search the web for: "${query}". List the companies or products that offer this, each with its website. Be brief.`,
      }),
    });

    if (!res.ok) {
      return { error: `Search query failed for "${query}": ${res.status} ${sanitizeUpstreamText(await res.text())}` };
    }

    const data = await res.json();
    return { result: extractQueryHarvest(query, data), tokens: readTokenUsage(data) };
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
): Promise<{ candidates: Candidate[]; tokens: number | null; errors: string[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — cannot harvest from web search');
  }

  const outcomes = await runWithConcurrency(queries, CONCURRENCY, (query) => runOneQuery(query, market, apiKey));

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

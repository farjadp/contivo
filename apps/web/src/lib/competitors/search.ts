import { hasDataForSeoCredentials } from '../dataforseo';
import { normalizeCandidateDomain } from './domains';
import { readTokenUsage } from './queries';
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
  // Domain -> per-query flags, built up query by query.
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

  // Only a domain that has appeared in at least one citation, ever, is
  // allowed to exist as a candidate. Track that separately from
  // queriesSeen (which also counts source-only appearances) so a
  // source-only domain can never sneak in.
  const hasCitation = new Set<string>();

  for (const result of results) {
    const citationDomainsThisQuery = new Set<string>();

    for (const citation of result.citations) {
      const domain = normalizeCandidateDomain(citation.url);
      if (!domain || exclude.has(domain)) continue;

      hasCitation.add(domain);
      citationDomainsThisQuery.add(domain);

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

    for (const sourceUrl of result.sourceUrls) {
      const domain = normalizeCandidateDomain(sourceUrl);
      if (!domain || exclude.has(domain)) continue;
      if (citationDomainsThisQuery.has(domain)) continue; // already counted this query
      if (!byDomain.has(domain)) continue; // sources never create a candidate

      // A domain a citation produced in some other query — this query's
      // appearance in the raw source list only raises its frequency.
      ensure(domain).queriesSeen.add(result.query);
    }
  }

  const candidates: Candidate[] = [];
  for (const [domain, entry] of byDomain) {
    if (!hasCitation.has(domain)) continue; // defensive; should already be excluded above
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

async function runOneQuery(
  query: string,
  market: TargetMarket,
  apiKey: string,
): Promise<{ result: QueryHarvestResult; tokens: number | null } | { error: string }> {
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
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
      return { error: `Search query failed for "${query}": ${res.status} ${await res.text()}` };
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

export async function harvestFromSerp(
  _queries: string[],
  _market: TargetMarket,
  _exclude: Set<string>,
): Promise<{ candidates: Candidate[]; tokens: number | null; errors: string[] }> {
  // DataForSEO has no credentials in production and its client currently
  // returns fabricated keywords and SERP rows when they are missing, so this
  // source stays off until that is fixed. Returning nothing is the honest
  // answer; returning mock data would poison discovery.
  if (!hasDataForSeoCredentials()) {
    return { candidates: [], tokens: null, errors: [] };
  }
  return { candidates: [], tokens: null, errors: ['SERP source not implemented yet'] };
}

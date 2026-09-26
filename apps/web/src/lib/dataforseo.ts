/**
 * DataForSEO API Client
 *
 * Provides typed, authenticated HTTP access to DataForSEO APIs.
 * Credentials are loaded from DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars.
 * Never call these functions from the browser — server-only.
 *
 * Usage:
 *   const { items, dataSource } = await fetchDomainKeywords('hubspot.com', 200);
 *   const { items } = await fetchSerpResults('content marketing tools');
 *
 * Provenance is not optional. Every call returns `dataSource`, and a caller must
 * decide what to do with 'MOCK' rather than being handed invented numbers that
 * look real. This module used to fall back to generated data whenever a request
 * failed *or* NODE_ENV was 'development', unlabelled, and that fabricated data
 * flowed into stored keyword intelligence, matrices and eventually published
 * content. Now:
 *   - a failed or unauthenticated request throws DataForSEOError;
 *   - sample data is produced only when DATAFORSEO_MOCK=1 is set deliberately;
 *   - sample data is always labelled 'MOCK' and must never be persisted.
 */

const DATAFORSEO_BASE = 'https://api.dataforseo.com';

// ----- Auth ---------------------------------------------------------------

function buildBasicAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new DataForSEOError(
      'MISSING_CREDENTIALS',
      'DataForSEO credentials are missing. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in your environment.',
    );
  }
  const encoded = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${encoded}`;
}

// ----- Errors and provenance ------------------------------------------------

export class DataForSEOError extends Error {
  readonly reason: 'MISSING_CREDENTIALS' | 'REQUEST_FAILED';

  constructor(reason: 'MISSING_CREDENTIALS' | 'REQUEST_FAILED', message: string) {
    super(message);
    this.name = 'DataForSEOError';
    this.reason = reason;
  }
}

/** Where a result came from. 'MOCK' data is generated locally and is not real. */
export type DataForSEODataSource = 'LIVE' | 'MOCK';

export type DataForSEOResult<T> = {
  items: T[];
  dataSource: DataForSEODataSource;
};

/**
 * Sample data is an explicit opt-in, never a silent consequence of a failure or
 * of running locally. Set DATAFORSEO_MOCK=1 to work on the UI without a key.
 */
export function isMockModeEnabled(): boolean {
  return process.env.DATAFORSEO_MOCK === '1';
}

export function hasDataForSeoCredentials(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

// ----- Types ---------------------------------------------------------------

export type DataForSEOKeyword = {
  keyword: string;
  search_volume: number;
  keyword_difficulty: number;
  competition: number; // 0.0–1.0
  ranking_position: number | null;
  ranking_url: string | null;
};

export type DataForSEOSerpItem = {
  rank_absolute: number;
  title: string;
  url: string;
  description: string | null;
  domain: string;
};

// ----- Internal fetch helper -----------------------------------------------

async function dataForSeoPost<T = unknown>(
  path: string,
  body: unknown,
): Promise<T> {
  const url = `${DATAFORSEO_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildBasicAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    // Server-only fetch — no caching
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new DataForSEOError(
      'REQUEST_FAILED',
      `DataForSEO API error ${res.status} at ${path}: ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  // DataForSEO wraps everything in tasks[].result[]
  if (data?.status_code !== 20000) {
    throw new DataForSEOError(
      'REQUEST_FAILED',
      `DataForSEO task error: ${data?.status_message || 'unknown error'}`,
    );
  }
  return data as T;
}

// ----- Module 1: Domain Keywords -------------------------------------------

/**
 * Fetch top N keywords for a given competitor domain.
 * Uses the DataForSEO Labs - domain_keywords/live endpoint.
 *
 * @param domain  Plain domain, e.g. "hubspot.com"
 * @param limit   Maximum rows to retrieve (default 200)
 */
export async function fetchDomainKeywords(
  domain: string,
  limit = 200,
): Promise<DataForSEOResult<DataForSEOKeyword>> {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

  if (isMockModeEnabled()) {
    console.warn('[DataForSEO] DATAFORSEO_MOCK=1 — returning generated sample keywords for', cleanDomain);
    return { items: generateMockKeywords(cleanDomain, limit), dataSource: 'MOCK' };
  }

  const payload = [
    {
      target: cleanDomain,
      location_code: 2840, // United States
      language_code: 'en',
      limit,
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    },
  ];

  // No try/catch: a DataForSEOError propagates so the caller can tell the user
  // that the lookup failed. Swallowing it here is what produced silent mocks.
  const data: any = await dataForSeoPost(
    '/v3/dataforseo_labs/google/domain_keywords/live',
    payload,
  );

  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items ?? [];

  const mapped = items
    .map((item: any): DataForSEOKeyword => ({
      keyword: String(item?.keyword_data?.keyword || item?.keyword || ''),
      search_volume: Number(item?.keyword_data?.keyword_info?.search_volume ?? 0),
      keyword_difficulty: Number(item?.keyword_data?.keyword_properties?.keyword_difficulty ?? 0),
      competition: Number(item?.keyword_data?.keyword_info?.competition ?? 0),
      ranking_position: item?.ranked_serp_element?.serp_item?.rank_absolute ?? null,
      ranking_url: item?.ranked_serp_element?.serp_item?.url ?? null,
    }))
    .filter((kw) => kw.keyword.length > 0);

  return { items: mapped, dataSource: 'LIVE' };
}

// ----- Module 2: SERP Results ----------------------------------------------

/**
 * Fetch the top 10 organic SERP results for a keyword.
 * Uses the DataForSEO SERP - google/organic/live endpoint.
 *
 * @param keyword  Target keyword, e.g. "content marketing tools"
 */
export async function fetchSerpResults(
  keyword: string,
): Promise<DataForSEOResult<DataForSEOSerpItem>> {
  if (isMockModeEnabled()) {
    console.warn('[DataForSEO] DATAFORSEO_MOCK=1 — returning generated sample SERP for', keyword);
    return { items: generateMockSerp(keyword), dataSource: 'MOCK' };
  }

  const payload = [
    {
      keyword,
      location_code: 2840, // United States
      language_code: 'en',
      depth: 10,
      se_domain: 'google.com',
    },
  ];

  // See fetchDomainKeywords: errors propagate rather than becoming fake data.
  const data: any = await dataForSeoPost(
    '/v3/serp/google/organic/live/regular',
    payload,
  );

  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items ?? [];

  const mapped = items
    .filter((item: any) => item?.type === 'organic')
    .slice(0, 10)
    .map((item: any): DataForSEOSerpItem => ({
      rank_absolute: Number(item?.rank_absolute ?? 0),
      title: String(item?.title || ''),
      url: String(item?.url || ''),
      description: item?.description ? String(item.description) : null,
      domain: String(item?.domain || ''),
    }));

  return { items: mapped, dataSource: 'LIVE' };
}

// ----- Sample data generators ----------------------------------------------
//
// Reachable only through DATAFORSEO_MOCK=1. Everything below is invented: the
// volumes come from Math.sin and the SERP is a fixed list of US marketing
// sites. Callers label it 'MOCK' and must never write it to the database.

function generateMockKeywords(domain: string, limit: number): DataForSEOKeyword[] {
  const seed = domain.length;
  const count = Math.min(limit, 25 + (seed % 20)); // Generates 25-45 keywords per domain
  const result: DataForSEOKeyword[] = [];
  
  const topics = ['software', 'platform', 'tool', 'service', 'app', 'solution', 'management', 'system'];
  const modifiers = ['best', 'top', 'enterprise', 'free', 'cheap', 'online', 'cloud', 'b2b'];
  
  const baseParts = domain.split('.')[0].split('-');

  for (let i = 0; i < count; i++) {
    const isBranded = i < 3;
    let keyword = '';
    
    if (isBranded) {
      keyword = `${baseParts.join(' ')} ${i === 0 ? '' : ['login', 'pricing', 'reviews'][i % 3]}`.trim();
    } else {
      const topic = topics[(seed + i) % topics.length];
      const mod = modifiers[(seed * i) % modifiers.length];
      const part = baseParts[i % baseParts.length];
      keyword = `${mod} ${part} ${topic}`;
    }

    result.push({
      keyword,
      search_volume: Math.floor(100 + (Math.sin(i * seed) + 1) * 4500),
      keyword_difficulty: Math.floor(20 + (Math.cos(i) + 1) * 35),
      competition: Number((0.2 + (Math.sin(i * 3) + 1) * 0.4).toFixed(2)),
      ranking_position: Math.floor(1 + (Math.abs(Math.sin(i * seed)) * 50)),
      ranking_url: `https://${domain}/${keyword.replace(/\s+/g, '-')}`,
    });
  }
  
  // Sort by search volume descending just like real API
  return result.sort((a, b) => b.search_volume - a.search_volume);
}

function generateMockSerp(keyword: string): DataForSEOSerpItem[] {
  const result: DataForSEOSerpItem[] = [];
  const domains = ['hubspot.com', 'g2.com', 'capterra.com', 'forbes.com', 'techcrunch.com', 'medium.com', 'blog.intercom.com', 'zapier.com/blog', 'nerdwallet.com', 'shopify.com/blog'];
  
  for (let i = 0; i < 10; i++) {
    const domain = domains[i % domains.length];
    result.push({
      rank_absolute: i + 1,
      title: `${i === 0 ? 'The Ultimate Guide to' : 'Top 10'} ${keyword.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} | ${domain.split('.')[0].toUpperCase()}`,
      url: `https://${domain}/${keyword.replace(/\s+/g, '-')}-guide`,
      description: `Learn everything you need to know about ${keyword} in our comprehensive overview. Compare top tools, find pricing, and improve your strategy today.`,
      domain,
    });
  }
  return result;
}

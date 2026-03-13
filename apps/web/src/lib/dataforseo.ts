/**
 * DataForSEO API Client
 *
 * Provides typed, authenticated HTTP access to DataForSEO APIs.
 * Credentials are loaded from DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD env vars.
 * Never call these functions from the browser — server-only.
 *
 * Usage:
 *   const keywords = await fetchDomainKeywords('hubspot.com', 200);
 *   const serp = await fetchSerpResults('content marketing tools');
 */

const DATAFORSEO_BASE = 'https://api.dataforseo.com';

// ----- Auth ---------------------------------------------------------------

function buildBasicAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error(
      'DataForSEO credentials are missing. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in your environment.',
    );
  }
  const encoded = Buffer.from(`${login}:${password}`).toString('base64');
  return `Basic ${encoded}`;
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
    throw new Error(
      `DataForSEO API error ${res.status} at ${path}: ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  // DataForSEO wraps everything in tasks[].result[]
  if (data?.status_code !== 20000) {
    throw new Error(
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
): Promise<DataForSEOKeyword[]> {
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();

  const payload = [
    {
      target: cleanDomain,
      location_code: 2840, // United States
      language_code: 'en',
      limit,
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
    },
  ];

  let data: any;
  try {
    data = await dataForSeoPost(
      '/v3/dataforseo_labs/google/domain_keywords/live',
      payload,
    );
  } catch (err) {
    console.error('[DataForSEO] fetchDomainKeywords error:', err);
    return [];
  }

  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items ?? [];

  return items.map((item: any): DataForSEOKeyword => ({
    keyword: String(item?.keyword_data?.keyword || item?.keyword || ''),
    search_volume: Number(item?.keyword_data?.keyword_info?.search_volume ?? 0),
    keyword_difficulty: Number(item?.keyword_data?.keyword_properties?.keyword_difficulty ?? 0),
    competition: Number(item?.keyword_data?.keyword_info?.competition ?? 0),
    ranking_position: item?.ranked_serp_element?.serp_item?.rank_absolute ?? null,
    ranking_url: item?.ranked_serp_element?.serp_item?.url ?? null,
  })).filter((kw) => kw.keyword.length > 0);
}

// ----- Module 3: SERP Results ----------------------------------------------

/**
 * Fetch the top 10 organic SERP results for a keyword.
 * Uses the DataForSEO SERP - google/organic/live endpoint.
 *
 * @param keyword  Target keyword, e.g. "content marketing tools"
 */
export async function fetchSerpResults(
  keyword: string,
): Promise<DataForSEOSerpItem[]> {
  const payload = [
    {
      keyword,
      location_code: 2840, // United States
      language_code: 'en',
      depth: 10,
      se_domain: 'google.com',
    },
  ];

  let data: any;
  try {
    data = await dataForSeoPost(
      '/v3/serp/google/organic/live/regular',
      payload,
    );
  } catch (err) {
    console.error('[DataForSEO] fetchSerpResults error:', err);
    return [];
  }

  const items: any[] =
    data?.tasks?.[0]?.result?.[0]?.items ?? [];

  return items
    .filter((item: any) => item?.type === 'organic')
    .slice(0, 10)
    .map((item: any): DataForSEOSerpItem => ({
      rank_absolute: Number(item?.rank_absolute ?? 0),
      title: String(item?.title || ''),
      url: String(item?.url || ''),
      description: item?.description ? String(item.description) : null,
      domain: String(item?.domain || ''),
    }));
}

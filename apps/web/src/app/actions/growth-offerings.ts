'use server';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { writeActivityLog } from '@/lib/activity-log';

type TokenUsageRun = {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
};

type TokenUsage = {
  runs: number;
  lifetime_prompt_tokens: number;
  lifetime_completion_tokens: number;
  lifetime_total_tokens: number;
  last_run: TokenUsageRun | null;
};

type OfferingItem = {
  name: string;
  normalized_name: string;
  type: 'product' | 'service' | 'solution' | 'platform_module' | 'package';
  description: string;
  target_audience: string;
  problem_solved: string;
  value_proposition: string;
  source_pages: string[];
  related_keywords: string[];
  aliases: string[];
  pricing_signal: string;
  feature_signal: string;
  cta_signal: string;
  confidence_score: number;
};

type CompanyOfferings = {
  company_name: string;
  website: string;
  offerings: OfferingItem[];
  summary: {
    offering_count: number;
    main_business_model_guess: string;
    main_offering_focus: string;
    primary_offering: string;
    secondary_offering: string;
    core_revenue_model_guess: string;
    main_positioning_angle: string;
    main_offer_focus: string;
    product_service_ratio: string;
  };
};

type OfferComparisonAnalysis = {
  common_market_offerings: string[];
  client_unique_offerings: string[];
  competitor_common_offerings: string[];
  client_missing_offerings: string[];
  positioning_insight: string;
  offer_gap_opportunity: string;
};

type ComparisonSummary = {
  client_focus: string;
  competitor_patterns: string[];
  white_space_opportunities: string[];
  offer_clarity_insight: string;
  market_offer_pattern: string;
  offer_gap_opportunity: string;
};

export type ProductsServicesPayload = {
  generated_at: string;
  source: 'AI' | 'MANUAL';
  ai_estimated: boolean;
  client_offerings: CompanyOfferings;
  competitor_offerings: Array<{
    competitor_name: string;
    website: string;
    offerings: OfferingItem[];
    summary: CompanyOfferings['summary'];
  }>;
  comparison_summary: ComparisonSummary;
  comparison_analysis: OfferComparisonAnalysis;
  token_usage: TokenUsage;
};

function trimTo(value: string | null | undefined, max = 500): string {
  return String(value || '').trim().slice(0, max);
}

function normalizeDomain(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutProtocol = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return withoutProtocol.split('/')[0]?.toLowerCase().trim() || '';
}

function normalizeWebsite(value: string | null | undefined): string {
  const domain = normalizeDomain(value);
  return domain ? `https://${domain}` : '';
}

function sanitizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function stripCodeFences(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function toNonNegativeInt(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.55;
  return Math.max(0.3, Math.min(1, parsed));
}

function emptyTokenUsage(): TokenUsage {
  return {
    runs: 0,
    lifetime_prompt_tokens: 0,
    lifetime_completion_tokens: 0,
    lifetime_total_tokens: 0,
    last_run: null,
  };
}

function normalizeTokenUsage(value: any): TokenUsage {
  const raw = value && typeof value === 'object' ? value : {};
  const lastRunRaw = raw.last_run && typeof raw.last_run === 'object' ? raw.last_run : null;
  return {
    runs: toNonNegativeInt(raw.runs),
    lifetime_prompt_tokens: toNonNegativeInt(raw.lifetime_prompt_tokens),
    lifetime_completion_tokens: toNonNegativeInt(raw.lifetime_completion_tokens),
    lifetime_total_tokens: toNonNegativeInt(raw.lifetime_total_tokens),
    last_run: lastRunRaw
      ? {
          model: trimTo(lastRunRaw.model, 120) || 'unknown',
          prompt_tokens: toNonNegativeInt(lastRunRaw.prompt_tokens),
          completion_tokens: toNonNegativeInt(lastRunRaw.completion_tokens),
          total_tokens: toNonNegativeInt(lastRunRaw.total_tokens),
          created_at: trimTo(lastRunRaw.created_at, 80) || new Date().toISOString(),
        }
      : null,
  };
}

function appendTokenUsage(
  current: TokenUsage | null | undefined,
  usage:
    | {
        model: string;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }
    | null,
): TokenUsage {
  const base = normalizeTokenUsage(current);
  if (!usage) return base;
  return {
    runs: base.runs + 1,
    lifetime_prompt_tokens: base.lifetime_prompt_tokens + toNonNegativeInt(usage.prompt_tokens),
    lifetime_completion_tokens: base.lifetime_completion_tokens + toNonNegativeInt(usage.completion_tokens),
    lifetime_total_tokens: base.lifetime_total_tokens + toNonNegativeInt(usage.total_tokens),
    last_run: {
      model: trimTo(usage.model, 120) || 'unknown',
      prompt_tokens: toNonNegativeInt(usage.prompt_tokens),
      completion_tokens: toNonNegativeInt(usage.completion_tokens),
      total_tokens: toNonNegativeInt(usage.total_tokens),
      created_at: new Date().toISOString(),
    },
  };
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function normalizeOfferingType(value: string | null | undefined): OfferingItem['type'] {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'service') return 'service';
  if (normalized === 'solution') return 'solution';
  if (normalized === 'platform_module' || normalized === 'platform module' || normalized === 'module') {
    return 'platform_module';
  }
  if (normalized === 'package') return 'package';
  return 'product';
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 60);
}

function uniqueList(values: unknown, max: number): string[] {
  const source = Array.isArray(values) ? values : [];
  const set = new Set<string>();
  const out: string[] = [];
  for (const value of source) {
    const item = trimTo(String(value || ''), 120);
    if (!item) continue;
    const key = item.toLowerCase();
    if (set.has(key)) continue;
    set.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function extractSignalsFromHtml(html: string): string[] {
  const out: string[] = [];

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) out.push(sanitizeText(decodeHtmlEntities(title)));

  const description =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];
  if (description) out.push(sanitizeText(decodeHtmlEntities(description)));

  const regex = /<(h1|h2|h3|a|li)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const text = sanitizeText(decodeHtmlEntities(String(match[2] || '').replace(/<[^>]+>/g, ' ')));
    if (text.length >= 8) out.push(text);
    if (out.length >= 260) break;
    match = regex.exec(html);
  }

  const unique = new Set<string>();
  const filtered: string[] = [];
  for (const line of out) {
    const key = line.toLowerCase();
    if (!line || key.length < 6) continue;
    if (unique.has(key)) continue;
    unique.add(key);
    filtered.push(line);
    if (filtered.length >= 180) break;
  }
  return filtered;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(7000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function collectOfferingSignals(website: string): Promise<{
  domain: string;
  pages_scanned: string[];
  evidence: string;
}> {
  const domain = normalizeDomain(website);
  const paths = [
    '/',
    '/products',
    '/product',
    '/services',
    '/solutions',
    '/features',
    '/pricing',
    '/use-cases',
    '/about',
    '/platform',
    '/resources',
  ];

  const pages_scanned: string[] = [];
  const evidenceLines: string[] = [];

  for (const path of paths) {
    const url = `https://${domain}${path}`;
    const html = await fetchHtml(url);
    if (!html) continue;
    const lines = extractSignalsFromHtml(html);
    if (lines.length === 0) continue;
    pages_scanned.push(path);
    evidenceLines.push(...lines.slice(0, 50));
    if (evidenceLines.length >= 350) break;
  }

  return {
    domain,
    pages_scanned,
    evidence: evidenceLines.join('\n').slice(0, 12000),
  };
}

function pickCompetitors(workspace: any): Array<{
  name: string;
  domain: string;
  type: string;
  description: string;
}> {
  const all = Array.isArray(workspace?.competitors) ? workspace.competitors : [];
  const accepted = all.filter((item: any) => item.userDecision === 'ACCEPTED');
  const fallback = all.filter((item: any) => item.userDecision !== 'REJECTED');
  const source = accepted.length > 0 ? accepted : fallback;

  return source
    .map((item: any) => ({
      name: trimTo(item.name, 120),
      domain: normalizeDomain(item.domain),
      type: String(item.type || 'DIRECT'),
      description: trimTo(item.description, 280),
    }))
    .filter((item: { name: string; domain: string }) => item.name && item.domain)
    .slice(0, 8);
}

function defaultSummary(overr?: Partial<CompanyOfferings['summary']>): CompanyOfferings['summary'] {
  return {
    offering_count: overr?.offering_count || 0,
    main_business_model_guess: overr?.main_business_model_guess || 'unknown',
    main_offering_focus: overr?.main_offering_focus || 'unknown',
    primary_offering: overr?.primary_offering || '',
    secondary_offering: overr?.secondary_offering || '',
    core_revenue_model_guess: overr?.core_revenue_model_guess || 'unknown',
    main_positioning_angle: overr?.main_positioning_angle || 'unknown',
    main_offer_focus: overr?.main_offer_focus || 'unknown',
    product_service_ratio: overr?.product_service_ratio || 'unknown',
  };
}

function defaultComparisonSummary(): ComparisonSummary {
  return {
    client_focus: '',
    competitor_patterns: [],
    white_space_opportunities: [],
    offer_clarity_insight: '',
    market_offer_pattern: '',
    offer_gap_opportunity: '',
  };
}

function defaultComparisonAnalysis(): OfferComparisonAnalysis {
  return {
    common_market_offerings: [],
    client_unique_offerings: [],
    competitor_common_offerings: [],
    client_missing_offerings: [],
    positioning_insight: '',
    offer_gap_opportunity: '',
  };
}

function normalizeOfferingItem(item: any): OfferingItem | null {
  const name = trimTo(item?.name, 120);
  if (!name) return null;

  const normalized_name = trimTo(item?.normalized_name, 90) || normalizeName(name);
  return {
    name,
    normalized_name,
    type: normalizeOfferingType(item?.type),
    description: trimTo(item?.description, 460),
    target_audience: trimTo(item?.target_audience, 180),
    problem_solved: trimTo(item?.problem_solved, 220),
    value_proposition: trimTo(item?.value_proposition, 220),
    source_pages: uniqueList(item?.source_pages, 10),
    related_keywords: uniqueList(item?.related_keywords, 14),
    aliases: uniqueList(item?.aliases, 8),
    pricing_signal: trimTo(item?.pricing_signal, 180),
    feature_signal: trimTo(item?.feature_signal, 180),
    cta_signal: trimTo(item?.cta_signal, 180),
    confidence_score: clampConfidence(item?.confidence_score),
  };
}

function normalizeCompanyOfferings(raw: any, fallback: { companyName: string; website: string }): CompanyOfferings {
  const offeringsRaw = Array.isArray(raw?.offerings) ? raw.offerings : [];
  const offerings: OfferingItem[] = [];
  const seen = new Set<string>();

  for (const item of offeringsRaw) {
    const normalized = normalizeOfferingItem(item);
    if (!normalized) continue;
    const key = `${normalized.normalized_name}:${normalized.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    offerings.push(normalized);
    if (offerings.length >= 24) break;
  }

  const summaryRaw = raw?.summary && typeof raw.summary === 'object' ? raw.summary : {};
  return {
    company_name: trimTo(raw?.company_name, 120) || fallback.companyName,
    website: normalizeWebsite(raw?.website || fallback.website),
    offerings,
    summary: defaultSummary({
      offering_count: offerings.length,
      main_business_model_guess: trimTo(summaryRaw.main_business_model_guess, 140),
      main_offering_focus: trimTo(summaryRaw.main_offering_focus, 160),
      primary_offering: trimTo(summaryRaw.primary_offering, 120),
      secondary_offering: trimTo(summaryRaw.secondary_offering, 120),
      core_revenue_model_guess: trimTo(summaryRaw.core_revenue_model_guess, 160),
      main_positioning_angle: trimTo(summaryRaw.main_positioning_angle, 160),
      main_offer_focus: trimTo(summaryRaw.main_offer_focus, 160),
      product_service_ratio: trimTo(summaryRaw.product_service_ratio, 120),
    }),
  };
}

function buildExtractionPrompt(input: {
  client: {
    company_name: string;
    website: string;
    brand_summary: any;
    pages_scanned: string[];
    evidence: string;
  };
  competitors: Array<{
    competitor_name: string;
    website: string;
    type: string;
    description: string;
    pages_scanned: string[];
    evidence: string;
  }>;
}): string {
  return `
You are a product and service intelligence analyst.

Task:
Extract products/services/solutions/offerings for the client and competitors from visible website signals only.
Do not hallucinate hidden offerings.

Required extraction steps:
1) Scan important pages
2) Identify distinct offerings
3) Classify each offering
4) Write neutral 2-4 sentence description
5) Extract supporting signals
6) Normalize aliases and duplicate naming
7) Output structured JSON

Input:
${JSON.stringify(input, null, 2)}

Rules:
- no vague one-line company summaries
- no invented offerings
- confidence should drop if evidence is weak
- keep outputs reusable for comparison

Output JSON only with this schema:
{
  "client_offerings": {
    "company_name": "",
    "website": "",
    "offerings": [
      {
        "name": "",
        "normalized_name": "",
        "type": "product|service|solution|platform_module|package",
        "description": "",
        "target_audience": "",
        "problem_solved": "",
        "value_proposition": "",
        "source_pages": [],
        "related_keywords": [],
        "aliases": [],
        "pricing_signal": "",
        "feature_signal": "",
        "cta_signal": "",
        "confidence_score": 0.0
      }
    ],
    "summary": {
      "offering_count": 0,
      "main_business_model_guess": "",
      "main_offering_focus": "",
      "primary_offering": "",
      "secondary_offering": "",
      "core_revenue_model_guess": "",
      "main_positioning_angle": "",
      "main_offer_focus": "",
      "product_service_ratio": ""
    }
  },
  "competitor_offerings": [
    {
      "competitor_name": "",
      "website": "",
      "offerings": [],
      "summary": {
        "offering_count": 0,
        "main_business_model_guess": "",
        "main_offering_focus": "",
        "primary_offering": "",
        "secondary_offering": "",
        "core_revenue_model_guess": "",
        "main_positioning_angle": "",
        "main_offer_focus": "",
        "product_service_ratio": ""
      }
    }
  ],
  "comparison_summary": {
    "client_focus": "",
    "competitor_patterns": [],
    "white_space_opportunities": [],
    "offer_clarity_insight": "",
    "market_offer_pattern": "",
    "offer_gap_opportunity": ""
  }
}
`;
}

function buildComparisonPrompt(input: {
  client_offerings: CompanyOfferings;
  competitor_offerings: Array<{
    competitor_name: string;
    website: string;
    offerings: OfferingItem[];
    summary: CompanyOfferings['summary'];
  }>;
}): string {
  return `
You are a product positioning analyst.

You have structured products/services data for client and competitors.
Compare them and identify overlap, gaps, and differentiation.

Input:
${JSON.stringify(input, null, 2)}

Output JSON only:
{
  "common_market_offerings": [],
  "client_unique_offerings": [],
  "competitor_common_offerings": [],
  "client_missing_offerings": [],
  "positioning_insight": "",
  "offer_gap_opportunity": ""
}
`;
}

async function callOpenAiJson(
  prompt: string,
): Promise<{
  parsed: any | null;
  usage: {
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  } | null;
} | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1';

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Be precise. Use only evidence provided. Return only valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      console.error('OpenAI offerings request error:', await res.text());
      return null;
    }

    const data = await res.json();
    const usage = {
      model,
      prompt_tokens: toNonNegativeInt(data?.usage?.prompt_tokens),
      completion_tokens: toNonNegativeInt(data?.usage?.completion_tokens),
      total_tokens: toNonNegativeInt(data?.usage?.total_tokens),
    };
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return { parsed: null, usage };
    }

    try {
      return { parsed: JSON.parse(stripCodeFences(content)), usage };
    } catch (parseError) {
      console.error('OpenAI offerings JSON parse error:', parseError);
      return { parsed: null, usage };
    }
  } catch (error) {
    console.error('OpenAI offerings call failed:', error);
    return null;
  }
}

function fallbackPayload(input: {
  clientName: string;
  clientWebsite: string;
  competitors: Array<{ name: string; domain: string }>;
}): ProductsServicesPayload {
  const client_offerings: CompanyOfferings = {
    company_name: input.clientName,
    website: normalizeWebsite(input.clientWebsite),
    offerings: [],
    summary: defaultSummary({
      main_business_model_guess: 'unknown',
      main_offering_focus: 'Insufficient public evidence',
    }),
  };

  const competitor_offerings = input.competitors.map((item) => ({
    competitor_name: item.name,
    website: normalizeWebsite(item.domain),
    offerings: [] as OfferingItem[],
    summary: defaultSummary({
      main_business_model_guess: 'unknown',
      main_offering_focus: 'Insufficient public evidence',
    }),
  }));

  return {
    generated_at: new Date().toISOString(),
    source: 'AI',
    ai_estimated: true,
    client_offerings,
    competitor_offerings,
    comparison_summary: defaultComparisonSummary(),
    comparison_analysis: defaultComparisonAnalysis(),
    token_usage: emptyTokenUsage(),
  };
}

function normalizePayload(raw: any, fallbackInput: {
  clientName: string;
  clientWebsite: string;
  competitors: Array<{ name: string; domain: string }>;
}): ProductsServicesPayload {
  const fallback = fallbackPayload(fallbackInput);

  const client_offerings = normalizeCompanyOfferings(raw?.client_offerings, {
    companyName: fallbackInput.clientName,
    website: fallbackInput.clientWebsite,
  });

  const competitorRaw = Array.isArray(raw?.competitor_offerings) ? raw.competitor_offerings : [];
  const competitor_offerings: ProductsServicesPayload['competitor_offerings'] = [];
  const seenDomains = new Set<string>();

  for (const comp of competitorRaw) {
    const website = normalizeWebsite(comp?.website);
    const domain = normalizeDomain(website);
    if (!domain || seenDomains.has(domain)) continue;
    seenDomains.add(domain);

    const company = normalizeCompanyOfferings(
      { company_name: comp?.competitor_name, website, offerings: comp?.offerings, summary: comp?.summary },
      { companyName: trimTo(comp?.competitor_name, 120) || domain, website },
    );

    competitor_offerings.push({
      competitor_name: company.company_name,
      website: company.website,
      offerings: company.offerings,
      summary: company.summary,
    });
  }

  for (const expected of fallbackInput.competitors) {
    const domain = normalizeDomain(expected.domain);
    if (!domain || seenDomains.has(domain)) continue;
    competitor_offerings.push({
      competitor_name: expected.name,
      website: normalizeWebsite(domain),
      offerings: [],
      summary: defaultSummary({
        main_business_model_guess: 'unknown',
        main_offering_focus: 'Insufficient public evidence',
      }),
    });
  }

  const summaryRaw = raw?.comparison_summary && typeof raw.comparison_summary === 'object'
    ? raw.comparison_summary
    : {};

  return {
    ...fallback,
    client_offerings,
    competitor_offerings,
    comparison_summary: {
      client_focus: trimTo(summaryRaw.client_focus, 220),
      competitor_patterns: uniqueList(summaryRaw.competitor_patterns, 10),
      white_space_opportunities: uniqueList(summaryRaw.white_space_opportunities, 10),
      offer_clarity_insight: trimTo(summaryRaw.offer_clarity_insight, 260),
      market_offer_pattern: trimTo(summaryRaw.market_offer_pattern, 260),
      offer_gap_opportunity: trimTo(summaryRaw.offer_gap_opportunity, 260),
    },
  };
}

function normalizeComparisonAnalysis(raw: any): OfferComparisonAnalysis {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    common_market_offerings: uniqueList(src.common_market_offerings, 20),
    client_unique_offerings: uniqueList(src.client_unique_offerings, 20),
    competitor_common_offerings: uniqueList(src.competitor_common_offerings, 20),
    client_missing_offerings: uniqueList(src.client_missing_offerings, 20),
    positioning_insight: trimTo(src.positioning_insight, 320),
    offer_gap_opportunity: trimTo(src.offer_gap_opportunity, 320),
  };
}

function mergeOfferingsInAudienceInsights(currentAudienceInsights: any, payload: ProductsServicesPayload): any {
  const current = currentAudienceInsights && typeof currentAudienceInsights === 'object' ? currentAudienceInsights : {};
  return {
    ...current,
    productsServicesIntel: payload,
  };
}

export async function generateWorkspaceProductsServicesIntel(workspaceId: string) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  if (!workspaceId) return { error: 'Workspace ID is required' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
      include: { competitors: true },
    });
    if (!workspace) return { error: 'Workspace not found' };

    const competitors = pickCompetitors(workspace);
    if (competitors.length < 1) {
      return { error: 'At least 1 competitor is required before offerings analysis.' };
    }

    const clientSignals = await collectOfferingSignals(workspace.websiteUrl || '');
    if (!clientSignals.evidence) {
      return { error: 'Could not collect enough signals from client website.' };
    }

    const competitorSignals = [];
    for (const competitor of competitors) {
      const signal = await collectOfferingSignals(competitor.domain);
      if (!signal.evidence) continue;
      competitorSignals.push({
        competitor_name: competitor.name,
        website: normalizeWebsite(competitor.domain),
        type: competitor.type,
        description: competitor.description,
        pages_scanned: signal.pages_scanned,
        evidence: signal.evidence,
      });
    }

    if (competitorSignals.length === 0) {
      return { error: 'Could not collect enough signals from competitor websites.' };
    }

    const extractionPrompt = buildExtractionPrompt({
      client: {
        company_name: workspace.name,
        website: normalizeWebsite(workspace.websiteUrl || ''),
        brand_summary: workspace.brandSummary || {},
        pages_scanned: clientSignals.pages_scanned,
        evidence: clientSignals.evidence,
      },
      competitors: competitorSignals,
    });

    const extractResult = await callOpenAiJson(extractionPrompt);
    let payload =
      extractResult?.parsed != null
        ? normalizePayload(extractResult.parsed, {
            clientName: workspace.name,
            clientWebsite: workspace.websiteUrl || '',
            competitors: competitors.map((item) => ({ name: item.name, domain: item.domain })),
          })
        : fallbackPayload({
            clientName: workspace.name,
            clientWebsite: workspace.websiteUrl || '',
            competitors: competitors.map((item) => ({ name: item.name, domain: item.domain })),
          });

    const comparePrompt = buildComparisonPrompt({
      client_offerings: payload.client_offerings,
      competitor_offerings: payload.competitor_offerings,
    });
    const compareResult = await callOpenAiJson(comparePrompt);
    payload.comparison_analysis = normalizeComparisonAnalysis(compareResult?.parsed);

    const previousTokenUsage = normalizeTokenUsage(
      (workspace.audienceInsights as any)?.productsServicesIntel?.token_usage,
    );
    const withExtractUsage = appendTokenUsage(previousTokenUsage, extractResult?.usage || null);
    payload.token_usage = appendTokenUsage(withExtractUsage, compareResult?.usage || null);
    payload.generated_at = new Date().toISOString();
    payload.source = 'AI';
    payload.ai_estimated = true;

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        audienceInsights: mergeOfferingsInAudienceInsights(workspace.audienceInsights, payload),
      },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'PRODUCTS_SERVICES_INTEL_GENERATED',
      detail: {
        clientOfferings: payload.client_offerings.offerings.length,
        competitorCount: payload.competitor_offerings.length,
        totalTokens: payload.token_usage.last_run?.total_tokens || 0,
      },
    });

    return { success: true, payload };
  } catch (error) {
    console.error('generateWorkspaceProductsServicesIntel failed:', error);
    return { error: 'Could not generate products and services intelligence right now.' };
  }
}

export async function saveWorkspaceProductsServicesIntelEdits(
  workspaceId: string,
  payload: ProductsServicesPayload,
) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  if (!workspaceId) return { error: 'Workspace ID is required' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
    });
    if (!workspace) return { error: 'Workspace not found' };

    const normalized = normalizePayload(payload, {
      clientName: workspace.name,
      clientWebsite: workspace.websiteUrl || '',
      competitors: [],
    });
    normalized.source = 'MANUAL';
    normalized.ai_estimated = true;
    normalized.token_usage = normalizeTokenUsage(
      payload?.token_usage || (workspace.audienceInsights as any)?.productsServicesIntel?.token_usage,
    );

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        audienceInsights: mergeOfferingsInAudienceInsights(workspace.audienceInsights, normalized),
      },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'PRODUCTS_SERVICES_INTEL_EDITED',
      detail: {
        clientOfferings: normalized.client_offerings.offerings.length,
        competitorCount: normalized.competitor_offerings.length,
      },
    });

    return { success: true, payload: normalized };
  } catch (error) {
    console.error('saveWorkspaceProductsServicesIntelEdits failed:', error);
    return { error: 'Could not save products and services intelligence edits.' };
  }
}

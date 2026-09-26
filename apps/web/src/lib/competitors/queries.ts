import type { TargetMarket } from './types';

export type BrandBrief = {
  companyName: string;
  ownDomain: string | null;
  summary: string;
  valueProposition: string;
  industry: string;
  audience: string;
  market: TargetMarket;
  acceptedCompetitors: Array<{ name: string; domain: string | null }>;
  rejectedCompetitors: Array<{ name: string; domain: string | null; reason: string | null }>;
  knownDomains: string[];
};

export const MAX_QUERIES = 8;

/** Trim to a max length, coercing anything but a real string to ''. */
function trimTo(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeDomain(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withoutProtocol = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const domain = withoutProtocol.split('/')[0]?.toLowerCase().trim();
  return domain || null;
}

export function buildBrandBrief(input: {
  workspace: {
    name: string;
    websiteUrl: string | null;
    brandSummary: unknown;
    targetCountry: string | null;
    targetLanguage: string;
  };
  competitors: Array<{
    name: string;
    domain: string | null;
    userDecision: string | null;
    rejectionReason: string | null;
  }>;
}): BrandBrief {
  const summaryObj =
    input.workspace.brandSummary && typeof input.workspace.brandSummary === 'object'
      ? (input.workspace.brandSummary as Record<string, unknown>)
      : {};

  const summary = trimTo(summaryObj.businessSummary) || trimTo(summaryObj.heroMessage);
  const valueProposition = trimTo(summaryObj.valueProposition);
  const industry = trimTo(summaryObj.industry);
  const audience = trimTo(summaryObj.audience);

  const acceptedCompetitors: Array<{ name: string; domain: string | null }> = [];
  const rejectedCompetitors: Array<{ name: string; domain: string | null; reason: string | null }> = [];
  const knownDomains: string[] = [];

  for (const competitor of input.competitors) {
    if (competitor.domain) knownDomains.push(competitor.domain);

    if (competitor.userDecision === 'ACCEPTED') {
      acceptedCompetitors.push({ name: competitor.name, domain: competitor.domain });
    } else if (competitor.userDecision === 'REJECTED') {
      rejectedCompetitors.push({
        name: competitor.name,
        domain: competitor.domain,
        reason: competitor.rejectionReason ?? null,
      });
    }
  }

  const language: TargetMarket['language'] = input.workspace.targetLanguage === 'fa' ? 'fa' : 'en';

  return {
    companyName: input.workspace.name,
    ownDomain: normalizeDomain(input.workspace.websiteUrl),
    summary,
    valueProposition,
    industry,
    audience,
    market: { country: input.workspace.targetCountry, language },
    acceptedCompetitors,
    rejectedCompetitors,
    knownDomains,
  };
}

function buildQueryGenerationPrompt(brief: BrandBrief): string {
  const languageName = brief.market.language === 'fa' ? 'Persian' : 'English';
  const country = brief.market.country || 'no specific country';
  const competitorNames = brief.acceptedCompetitors.map((c) => c.name).filter(Boolean);

  const lines = [
    `Write ${MAX_QUERIES} web search queries that would surface companies competing with this business.`,
    `Write every query in ${languageName}. The searcher is located in ${country}.`,
    'Cover these kinds, one or two each:',
    '1. the product category plus the market',
    '2. the problem the audience is trying to solve, in their own words',
    '3. "alternatives to X" for each confirmed competitor listed below',
    '4. "X vs" for each confirmed competitor listed below',
    'Kinds 3 and 4 only apply when confirmed competitors are listed.',
    'Do not name the company itself. Do not write questions about the company.',
    'Return {"queries": ["..."]}',
    '',
    `Company name: ${brief.companyName}`,
    `Summary: ${brief.summary}`,
    `Value proposition: ${brief.valueProposition}`,
    `Industry: ${brief.industry}`,
    `Audience: ${brief.audience}`,
    `Market: ${country} / ${languageName}`,
    `Confirmed competitors: ${competitorNames.length ? competitorNames.join(', ') : 'none'}`,
  ];

  return lines.join('\n');
}

/**
 * Read `usage.total_tokens` out of a chat-completions response body.
 *
 * Returns `null` — not `0` — when the field is missing or malformed. A
 * missing usage field is a provider metadata quirk, not a zero-token run,
 * and this project's cost ceiling (`DiscoveryRun.tokensUsed`) must be able
 * to tell "really zero" apart from "unknown"; collapsing the two would
 * silently understate spend the way the fallback data this repo already
 * regretted once did.
 */
export function readTokenUsage(data: unknown): number | null {
  const raw = (data as { usage?: { total_tokens?: unknown } })?.usage?.total_tokens;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export async function generateQueries(brief: BrandBrief): Promise<{ queries: string[]; tokens: number | null }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — cannot generate discovery queries');
  }

  const model = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1';
  const prompt = buildQueryGenerationPrompt(brief);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are precise and factual. Return only valid JSON.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI query generation failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('OpenAI query generation returned no content');
  }

  const tokens = readTokenUsage(data);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`OpenAI query generation returned invalid JSON: ${(error as Error).message}`);
  }

  const rawQueries = Array.isArray((parsed as Record<string, unknown>)?.queries)
    ? ((parsed as Record<string, unknown>).queries as unknown[])
    : [];

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const item of rawQueries) {
    const query = typeof item === 'string' ? item.trim() : '';
    if (!query) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    if (queries.length >= MAX_QUERIES) break;
  }

  return { queries, tokens };
}

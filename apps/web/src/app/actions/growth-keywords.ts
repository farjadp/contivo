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

type IntentDistribution = {
  informational: number;
  commercial: number;
  product: number;
  educational: number;
};

type KeywordCluster = {
  cluster: string;
  keywords: string[];
};

type StrategySignals = {
  content_themes: string[];
  content_goal: string;
  funnel_distribution: {
    top_of_funnel: string[];
    middle_of_funnel: string[];
    bottom_of_funnel: string[];
  };
  content_formats: string[];
  strategic_strength: string;
  strategic_weakness: string;
};

export type CompetitorKeywordIntel = {
  competitor: string;
  domain: string;
  primary_keywords: string[];
  secondary_keywords: string[];
  keyword_clusters: KeywordCluster[];
  intent_distribution: IntentDistribution;
  content_strategy: {
    main_goal: string;
    secondary_goals: string[];
    content_focus: string;
    publishing_style: string;
  };
  strategy_signals: StrategySignals;
  data_quality_notes: string[];
};

export type ContentGapOpportunity = {
  topic: string;
  competitor_weakness: string;
  audience_importance: string;
};

export type KeywordHeatmapRow = {
  keyword: string;
  coverage: Record<string, boolean>;
};

export type CompetitorKeywordsPayload = {
  generated_at: string;
  source: 'AI' | 'MANUAL';
  ai_estimated: boolean;
  competitors: CompetitorKeywordIntel[];
  content_gaps: ContentGapOpportunity[];
  keyword_heatmap: {
    keywords: string[];
    rows: KeywordHeatmapRow[];
    competitor_domains: string[];
  };
  token_usage: TokenUsage;
};

function trimTo(value: string | null | undefined, max = 400): string {
  return String(value || '').trim().slice(0, max);
}

function normalizeDomain(value: string | null | undefined): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withoutProtocol = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  return withoutProtocol.split('/')[0]?.toLowerCase().trim() || '';
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

function extractPageSignals(html: string): string[] {
  const lines: string[] = [];

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) lines.push(sanitizeText(decodeHtmlEntities(title)));

  const description =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];
  if (description) lines.push(sanitizeText(decodeHtmlEntities(description)));

  const headingRegex = /<(h1|h2|h3|a)[^>]*>([\s\S]*?)<\/\1>/gi;
  let headingMatch: RegExpExecArray | null = headingRegex.exec(html);
  while (headingMatch) {
    const text = sanitizeText(
      decodeHtmlEntities(String(headingMatch[2] || '').replace(/<[^>]+>/g, ' ')),
    );
    if (text.length >= 12) lines.push(text);
    headingMatch = headingRegex.exec(html);
    if (lines.length > 220) break;
  }

  const unique = new Set<string>();
  const filtered: string[] = [];
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (!line || normalized.length < 8) continue;
    if (unique.has(normalized)) continue;
    unique.add(normalized);
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
      signal: AbortSignal.timeout(6000),
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

async function collectCompetitorSignals(domain: string): Promise<{
  domain: string;
  pages_scanned: string[];
  evidence: string;
}> {
  const normalizedDomain = normalizeDomain(domain);
  const paths = ['/', '/blog', '/resources', '/use-cases', '/pricing', '/learn'];
  const scanned: string[] = [];
  const evidenceLines: string[] = [];

  for (const path of paths) {
    const url = `https://${normalizedDomain}${path}`;
    const html = await fetchHtml(url);
    if (!html) continue;

    const lines = extractPageSignals(html);
    if (lines.length === 0) continue;
    scanned.push(path);
    evidenceLines.push(...lines.slice(0, 55));
    if (evidenceLines.length >= 320) break;
  }

  const compact = evidenceLines.join('\n').slice(0, 12000);
  return {
    domain: normalizedDomain,
    pages_scanned: scanned,
    evidence: compact,
  };
}

function pickCompetitors(workspace: any): Array<{
  name: string;
  domain: string;
  type: string;
  description: string;
  category: string;
  audience: string;
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
      category: trimTo(item.category, 100),
      audience: trimTo(item.audienceGuess, 140),
    }))
    .filter((item: { name: string; domain: string }) => item.name && item.domain)
    .slice(0, 8);
}

function buildKeywordAnalysisPrompt(input: {
  targetCompany: string;
  targetDomain: string;
  brandSummary: any;
  competitorSignals: Array<{
    name: string;
    domain: string;
    type: string;
    description: string;
    category: string;
    audience: string;
    pages_scanned: string[];
    evidence: string;
  }>;
}): string {
  return `
You are an SEO and content intelligence analyst.

Goal: find how competitors actually run content strategy, not just random keyword lists.

You must apply 3 layers:
1) keyword extraction
2) topic clustering
3) content strategy inference

Then generate content gaps across all competitors and a keyword overlap heatmap.

Target company:
${JSON.stringify(
    {
      company: input.targetCompany,
      domain: input.targetDomain,
      brand_summary: input.brandSummary,
    },
    null,
    2,
  )}

Competitor evidence:
${JSON.stringify(input.competitorSignals, null, 2)}

Rules:
- only use visible terms/signals from provided evidence
- do not hallucinate hidden pages or unseen claims
- if evidence is weak, say so in data_quality_notes
- use structured output only (JSON)

For each competitor output:
- competitor
- domain
- primary_keywords (top 20)
- secondary_keywords (20-40)
- keyword_clusters (array of { cluster, keywords[] })
- intent_distribution { informational, commercial, product, educational } (sum near 100)
- content_strategy { main_goal, secondary_goals, content_focus, publishing_style }
- strategy_signals {
    content_themes,
    content_goal,
    funnel_distribution { top_of_funnel, middle_of_funnel, bottom_of_funnel },
    content_formats,
    strategic_strength,
    strategic_weakness
  }
- data_quality_notes (array)

Across all competitors output:
- content_gaps (10 opportunities):
  each item = { topic, competitor_weakness, audience_importance }
- keyword_heatmap:
  {
    keywords: array of 10-18 strategic keywords,
    rows: [
      {
        keyword: string,
        coverage: {
          "<domain1>": true/false,
          "<domain2>": true/false
        }
      }
    ]
  }

Return JSON only with this schema:
{
  "competitors": [],
  "content_gaps": [],
  "keyword_heatmap": {
    "keywords": [],
    "rows": []
  }
}
`;
}

async function callOpenAiKeywords(
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
            content:
              'You are rigorous about evidence and uncertainty. Return only valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      console.error('OpenAI competitor keyword analysis error:', await res.text());
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
      return {
        parsed: JSON.parse(stripCodeFences(content)),
        usage,
      };
    } catch (parseError) {
      console.error('OpenAI competitor keyword JSON parse failed:', parseError);
      return { parsed: null, usage };
    }
  } catch (error) {
    console.error('OpenAI competitor keyword request failed:', error);
    return null;
  }
}

function uniqueKeywordList(values: unknown, limit: number): string[] {
  const source = Array.isArray(values) ? values : [];
  const set = new Set<string>();
  const out: string[] = [];

  for (const value of source) {
    const keyword = trimTo(String(value || ''), 70).toLowerCase();
    if (!keyword || keyword.length < 3) continue;
    if (set.has(keyword)) continue;
    set.add(keyword);
    out.push(keyword);
    if (out.length >= limit) break;
  }
  return out;
}

function normalizeIntentDistribution(value: any): IntentDistribution {
  const raw = value && typeof value === 'object' ? value : {};
  const info = toNonNegativeInt(raw.informational);
  const comm = toNonNegativeInt(raw.commercial);
  const prod = toNonNegativeInt(raw.product);
  const edu = toNonNegativeInt(raw.educational);
  const sum = info + comm + prod + edu;

  if (sum === 0) {
    return { informational: 55, commercial: 20, product: 15, educational: 10 };
  }

  return {
    informational: Math.round((info / sum) * 100),
    commercial: Math.round((comm / sum) * 100),
    product: Math.round((prod / sum) * 100),
    educational: Math.round((edu / sum) * 100),
  };
}

function normalizeKeywordClusters(value: any): KeywordCluster[] {
  const source = Array.isArray(value) ? value : [];
  const clusters: KeywordCluster[] = [];
  const seen = new Set<string>();

  for (const item of source) {
    const clusterName = trimTo(item?.cluster || item?.name, 80);
    if (!clusterName) continue;
    const clusterKey = clusterName.toLowerCase();
    if (seen.has(clusterKey)) continue;
    seen.add(clusterKey);
    clusters.push({
      cluster: clusterName,
      keywords: uniqueKeywordList(item?.keywords, 12),
    });
    if (clusters.length >= 8) break;
  }

  return clusters;
}

function normalizeStrategySignals(value: any): StrategySignals {
  const raw = value && typeof value === 'object' ? value : {};
  const funnel = raw.funnel_distribution && typeof raw.funnel_distribution === 'object'
    ? raw.funnel_distribution
    : {};

  return {
    content_themes: uniqueKeywordList(raw.content_themes, 8),
    content_goal: trimTo(raw.content_goal, 120),
    funnel_distribution: {
      top_of_funnel: uniqueKeywordList(funnel.top_of_funnel, 8),
      middle_of_funnel: uniqueKeywordList(funnel.middle_of_funnel, 8),
      bottom_of_funnel: uniqueKeywordList(funnel.bottom_of_funnel, 8),
    },
    content_formats: uniqueKeywordList(raw.content_formats, 8),
    strategic_strength: trimTo(raw.strategic_strength, 280),
    strategic_weakness: trimTo(raw.strategic_weakness, 280),
  };
}

function buildKeywordHeatmap(competitors: CompetitorKeywordIntel[]): {
  keywords: string[];
  rows: KeywordHeatmapRow[];
  competitor_domains: string[];
} {
  const domains = competitors.map((item) => item.domain);
  const frequency = new Map<string, number>();
  const perDomain = new Map<string, Set<string>>();

  for (const competitor of competitors) {
    const domainSet = new Set<string>([
      ...competitor.primary_keywords,
      ...competitor.secondary_keywords,
      ...competitor.keyword_clusters.flatMap((cluster) => cluster.keywords),
    ]);
    perDomain.set(competitor.domain, domainSet);

    for (const keyword of domainSet) {
      frequency.set(keyword, (frequency.get(keyword) || 0) + 1);
    }
  }

  const keywords = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16)
    .map(([keyword]) => keyword);

  const rows: KeywordHeatmapRow[] = keywords.map((keyword) => {
    const coverage: Record<string, boolean> = {};
    for (const domain of domains) {
      coverage[domain] = perDomain.get(domain)?.has(keyword) || false;
    }
    return { keyword, coverage };
  });

  return {
    keywords,
    rows,
    competitor_domains: domains,
  };
}

function fallbackKeywordPayload(input: {
  competitors: Array<{ name: string; domain: string; evidence: string }>;
}): CompetitorKeywordsPayload {
  const normalizedCompetitors: CompetitorKeywordIntel[] = input.competitors.map((item) => {
    const tokens = item.evidence
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4)
      .slice(0, 80);
    const primary = uniqueKeywordList(tokens.slice(0, 24), 12);
    const secondary = uniqueKeywordList(tokens.slice(12, 80), 24);

    return {
      competitor: item.name,
      domain: item.domain,
      primary_keywords: primary,
      secondary_keywords: secondary,
      keyword_clusters: [
        {
          cluster: 'Estimated Theme',
          keywords: primary.slice(0, 8),
        },
      ],
      intent_distribution: { informational: 55, commercial: 20, product: 15, educational: 10 },
      content_strategy: {
        main_goal: 'traffic generation',
        secondary_goals: ['product education'],
        content_focus: 'Estimated from limited evidence',
        publishing_style: 'Not enough data from public pages',
      },
      strategy_signals: {
        content_themes: primary.slice(0, 5),
        content_goal: 'SEO traffic',
        funnel_distribution: {
          top_of_funnel: primary.slice(0, 3),
          middle_of_funnel: secondary.slice(0, 3),
          bottom_of_funnel: secondary.slice(3, 6),
        },
        content_formats: ['blog articles', 'product pages'],
        strategic_strength: 'Has visible recurring terms in navigation and page headings.',
        strategic_weakness: 'Score estimated from limited evidence.',
      },
      data_quality_notes: ['score estimated from limited evidence', 'inferred from messaging, not explicit proof'],
    };
  });

  return {
    generated_at: new Date().toISOString(),
    source: 'AI',
    ai_estimated: true,
    competitors: normalizedCompetitors,
    content_gaps: [
      {
        topic: 'Strategic content planning for teams',
        competitor_weakness: 'Competitors emphasize tools more than planning frameworks.',
        audience_importance: 'Teams need process clarity before scaling content production.',
      },
    ],
    keyword_heatmap: buildKeywordHeatmap(normalizedCompetitors),
    token_usage: emptyTokenUsage(),
  };
}

function normalizePayloadFromAi(raw: any, input: {
  competitorSignals: Array<{ name: string; domain: string }>;
}): CompetitorKeywordsPayload {
  const sourceCompetitors = Array.isArray(raw?.competitors) ? raw.competitors : [];
  const domainSet = new Set(input.competitorSignals.map((item) => item.domain));
  const normalized: CompetitorKeywordIntel[] = [];
  const seen = new Set<string>();

  for (const item of sourceCompetitors) {
    const competitor = trimTo(item?.competitor || item?.name, 120);
    const domain = normalizeDomain(item?.domain || item?.website);
    if (!competitor || !domain || !domainSet.has(domain)) continue;
    if (seen.has(domain)) continue;
    seen.add(domain);

    normalized.push({
      competitor,
      domain,
      primary_keywords: uniqueKeywordList(item?.primary_keywords, 20),
      secondary_keywords: uniqueKeywordList(item?.secondary_keywords, 40),
      keyword_clusters: normalizeKeywordClusters(item?.keyword_clusters),
      intent_distribution: normalizeIntentDistribution(item?.intent_distribution),
      content_strategy: {
        main_goal: trimTo(item?.content_strategy?.main_goal, 120),
        secondary_goals: uniqueKeywordList(item?.content_strategy?.secondary_goals, 8),
        content_focus: trimTo(item?.content_strategy?.content_focus, 280),
        publishing_style: trimTo(item?.content_strategy?.publishing_style, 280),
      },
      strategy_signals: normalizeStrategySignals(item?.strategy_signals),
      data_quality_notes: uniqueKeywordList(item?.data_quality_notes, 8),
    });
  }

  for (const source of input.competitorSignals) {
    if (normalized.some((item) => item.domain === source.domain)) continue;
    normalized.push({
      competitor: source.name,
      domain: source.domain,
      primary_keywords: [],
      secondary_keywords: [],
      keyword_clusters: [],
      intent_distribution: { informational: 55, commercial: 20, product: 15, educational: 10 },
      content_strategy: {
        main_goal: 'unknown',
        secondary_goals: [],
        content_focus: 'Insufficient evidence',
        publishing_style: 'Insufficient evidence',
      },
      strategy_signals: {
        content_themes: [],
        content_goal: 'unknown',
        funnel_distribution: {
          top_of_funnel: [],
          middle_of_funnel: [],
          bottom_of_funnel: [],
        },
        content_formats: [],
        strategic_strength: 'Not enough data',
        strategic_weakness: 'Not enough data',
      },
      data_quality_notes: ['insufficient evidence'],
    });
  }

  const rawGaps = Array.isArray(raw?.content_gaps) ? raw.content_gaps : [];
  const contentGaps: ContentGapOpportunity[] = rawGaps
    .map((item: any) => ({
      topic: trimTo(item?.topic, 120),
      competitor_weakness: trimTo(item?.competitor_weakness, 260),
      audience_importance: trimTo(item?.audience_importance, 260),
    }))
    .filter((item: ContentGapOpportunity) => item.topic && item.competitor_weakness && item.audience_importance)
    .slice(0, 10);

  const heatmap = buildKeywordHeatmap(normalized);

  return {
    generated_at: new Date().toISOString(),
    source: 'AI',
    ai_estimated: true,
    competitors: normalized,
    content_gaps: contentGaps,
    keyword_heatmap: heatmap,
    token_usage: emptyTokenUsage(),
  };
}

function mergeCompetitorKeywordsInAudienceInsights(currentAudienceInsights: any, payload: CompetitorKeywordsPayload): any {
  const current = currentAudienceInsights && typeof currentAudienceInsights === 'object' ? currentAudienceInsights : {};
  return {
    ...current,
    competitorKeywordsIntel: payload,
  };
}

export async function generateWorkspaceCompetitorKeywords(workspaceId: string) {
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
    if (competitors.length < 2) {
      return { error: 'At least 2 reviewed competitors are required.' };
    }

    const competitorSignals = [];
    for (const competitor of competitors) {
      const signals = await collectCompetitorSignals(competitor.domain);
      if (!signals.evidence) continue;
      competitorSignals.push({
        ...competitor,
        pages_scanned: signals.pages_scanned,
        evidence: signals.evidence,
      });
    }

    if (competitorSignals.length < 2) {
      return { error: 'Could not collect enough competitor website signals.' };
    }

    const prompt = buildKeywordAnalysisPrompt({
      targetCompany: workspace.name,
      targetDomain: normalizeDomain(workspace.websiteUrl || ''),
      brandSummary: workspace.brandSummary || {},
      competitorSignals,
    });

    const openAiResult = await callOpenAiKeywords(prompt);
    const payload =
      openAiResult?.parsed != null
        ? normalizePayloadFromAi(openAiResult.parsed, { competitorSignals })
        : fallbackKeywordPayload({
            competitors: competitorSignals.map((item) => ({
              name: item.name,
              domain: item.domain,
              evidence: item.evidence,
            })),
          });

    const existingTokenUsage = normalizeTokenUsage(
      (workspace.audienceInsights as any)?.competitorKeywordsIntel?.token_usage,
    );
    payload.token_usage = appendTokenUsage(existingTokenUsage, openAiResult?.usage || null);

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        audienceInsights: mergeCompetitorKeywordsInAudienceInsights(workspace.audienceInsights, payload),
      },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'COMPETITOR_KEYWORDS_GENERATED',
      detail: {
        competitors: payload.competitors.length,
        gaps: payload.content_gaps.length,
        promptTokens: payload.token_usage.last_run?.prompt_tokens || 0,
        completionTokens: payload.token_usage.last_run?.completion_tokens || 0,
        totalTokens: payload.token_usage.last_run?.total_tokens || 0,
      },
    });

    return { success: true, payload };
  } catch (error) {
    console.error('generateWorkspaceCompetitorKeywords failed:', error);
    return { error: 'Could not analyze competitor keywords right now.' };
  }
}

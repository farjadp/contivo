/**
 * Brand memory, content ideas, drafts and SERP analysis.
 *
 * Every model call goes through the AI provider failover layer (`@/lib/ai`,
 * spec docs/superpowers/specs/2026-11-22-ai-provider-failover-design.md):
 * content chain Gemini → OpenAI → Claude, usage logged by the layer.
 *
 * When the whole chain fails these functions return null. They used to return
 * template text built from the brand profile ("fallbackDraft",
 * "fallbackPositioning", a regex brand extraction, heuristic ideas) that looked
 * exactly like a real generation — the same silent-fallback pattern that hid a
 * dead Gemini model for months, at content level. Callers show "unavailable".
 */

import {
  runAiTask,
  type AiCallContext,
  type AiFailure,
  type AiOutput,
  type AiTask,
  type ProviderId,
} from '@/lib/ai';
import {
  type FrameworkId,
  type FrameworkQualityScores,
  type FrameworkSelectionInput,
  FRAMEWORK_LABELS,
  getFallbackFramework,
  getFrameworkGuidance,
  normalizeQualityScores,
  selectFramework,
  shouldUseFallback,
} from '@/lib/framework-engine';
import {
  adjustWordCountForLanguage,
  DEFAULT_CONTENT_LANGUAGE,
  languageInstructions,
  type ContentLanguage,
} from '@/lib/content-language';

/** Per attempt (spec §Timeouts): JSON and short prose. */
const JSON_TIMEOUT_MS = 60_000;
/** Per attempt: long drafts and large JSON (an idea list, a full rewrite). */
const LONG_TIMEOUT_MS = 120_000;

function sanitizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number(code);
      if (Number.isNaN(value)) return '';
      return String.fromCharCode(value);
    });
}

function urlToDomainRoot(url: string): string {
  try {
    const withProtocol = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const hostname = new URL(withProtocol).hostname.replace(/^www\./, '');
    return hostname.split('.')[0] || 'brand';
  } catch {
    return 'brand';
  }
}

// ---------------------------------------------------------------------------
// Transport: the failover layer
// ---------------------------------------------------------------------------

function logUnavailable(scope: string, task: AiTask, result: AiFailure): void {
  console.error(
    `[${scope}] AI ${result.kind} for ${task} (first error: ${result.firstErrorClass}); returning null, nothing generated`,
  );
}

async function runText(
  scope: string,
  task: AiTask,
  request: { system: string; prompt: string; timeoutMs: number },
  ctx?: AiCallContext,
): Promise<{ text: string; provider: ProviderId } | null> {
  const result = await runAiTask(task, { ...request, output: { kind: 'text' } }, ctx);
  if (!result.ok) {
    logUnavailable(scope, task, result);
    return null;
  }
  const text = result.text.trim();
  return text ? { text, provider: result.provider } : null;
}

async function runJson<T>(
  scope: string,
  task: AiTask,
  request: { system: string; prompt: string; timeoutMs: number; output?: AiOutput },
  ctx?: AiCallContext,
): Promise<{ data: T; provider: ProviderId } | null> {
  const { output = { kind: 'json_object' }, ...rest } = request;
  const result = await runAiTask(task, { ...rest, output }, ctx);
  if (!result.ok) {
    logUnavailable(scope, task, result);
    return null;
  }
  if (result.json === undefined || result.json === null) return null;
  return { data: result.json as T, provider: result.provider };
}

type Schema = Record<string, unknown>;
const STRING: Schema = { type: 'string' };
const NUMBER: Schema = { type: 'number' };
const STRING_ARRAY: Schema = { type: 'array', items: STRING };

/** OpenAI strict mode needs every property required and no extras; the layer validates the same for all providers. */
function strictObject(properties: Record<string, Schema>): Schema {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
const SCRAPE_JUNK_PATTERNS: RegExp[] = [
  /^(home|loading|menu|navigation|skip to content)$/i,
  /^(login|log in|sign in|sign up|register)$/i,
  /^(privacy policy|terms( of service)?|cookie(s)?|all rights reserved)$/i,
  /^(learn more|read more|view more|submit|cancel|search)$/i,
  /^(next|previous|back)$/i,
  /^(open menu|close menu)$/i,
  /^(copyright|powered by)\b/i,
];

/*
  Punctuation, symbols, digits and spaces only. This used to be /^[\W_]+$/,
  and without the `u` flag \W matches every non-ASCII letter, so every line
  of a Persian page was dropped as junk and a Persian-only site scraped to
  nothing (or to its stray Latin lines).
*/
const NO_LETTERS = /^[\p{P}\p{S}\p{N}\s_]+$/u;

function isScrapeJunkLine(value: string): boolean {
  const text = sanitizeText(value);
  if (!text) return true;
  if (text.length < 18) return true;
  if (NO_LETTERS.test(text)) return true;
  if (SCRAPE_JUNK_PATTERNS.some((pattern) => pattern.test(text))) return true;

  const lower = text.toLowerCase();
  if (/(javascript required|enable javascript|accept cookies|cookie preferences)/.test(lower)) return true;
  if (/^\d+$/.test(text)) return true;
  if (text.split(' ').length < 3) return true;

  return false;
}

function extractMetaContent(html: string, attrName: string, attrValue: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]*${attrName}\\s*=\\s*["']${attrValue}["'][^>]*content\\s*=\\s*["']([^"']+)["'][^>]*>`,
      'i',
    ),
    new RegExp(
      `<meta[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*${attrName}\\s*=\\s*["']${attrValue}["'][^>]*>`,
      'i',
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return sanitizeText(decodeHtmlEntities(match[1]));
    }
  }

  return null;
}

/** Brand fields the idea normaliser reads. Missing stays empty: no invented defaults. */
function normalizeBrandSummary(brandSummary: any): { valueProposition: string; pillars: string[] } {
  const valueProposition = sanitizeText(String(brandSummary?.valueProposition || ''));
  const pillars = Array.isArray(brandSummary?.pillars)
    ? brandSummary.pillars.map((pillar: unknown) => sanitizeText(String(pillar))).filter(Boolean)
    : [];
  return { valueProposition, pillars };
}

const BAND_LABEL = ['low', 'mid', 'high'] as const;

function whiteSpaceNote(ws: any): string | null {
  if (!ws || typeof ws !== 'object') return null;
  const x = BAND_LABEL[Number(ws.xBand)];
  const y = BAND_LABEL[Number(ws.yBand)];
  if (!x || !y) return null;
  const dist = Number(ws.nearestCompetitorDistance);
  const tail = Number.isFinite(dist) ? `; nearest competitor is ${Math.round(dist * 10) / 10} away` : '';
  return `Open space at ${x} on the x axis and ${y} on the y axis${tail}`;
}

export function summarizeMarketMetricContext(
  marketMatrices: any,
  competitorBasis?: 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'UNKNOWN',
): string {
  const charts = Array.isArray(marketMatrices?.charts) ? marketMatrices.charts : [];
  const summary = {
    ...(competitorBasis === 'UNCONFIRMED_HIGH'
      ? {
          competitor_set_note:
            'The competitor set behind these charts is unconfirmed by the user; treat comparisons as provisional.',
        }
      : competitorBasis === 'UNKNOWN'
        ? {
            competitor_set_note:
              'These charts predate the evidence rule, so their competitor set was never verified; treat comparisons as provisional.',
          }
        : {}),
    strongest_differentiation_opportunity: sanitizeText(
      String(marketMatrices?.strongest_differentiation_opportunity || ''),
    ).slice(0, 320),
    cross_chart_summary: sanitizeText(String(marketMatrices?.cross_chart_summary || '')).slice(0, 420),
    charts: charts.slice(0, 5).map((chart: any) => {
      const companies = Array.isArray(chart?.companies) ? chart.companies : [];
      const topSignals = companies
        .filter((company: any) => String(company?.type || '').toUpperCase() !== 'TARGET')
        .sort(
          (a: any, b: any) =>
            Number(b?.confidence_score || 0) - Number(a?.confidence_score || 0),
        )
        .slice(0, 4)
        .map((company: any) => ({
          name: sanitizeText(String(company?.name || '')).slice(0, 80),
          type: sanitizeText(String(company?.type || '')).slice(0, 24).toLowerCase(),
          x_score: Number(company?.x_score || 0),
          y_score: Number(company?.y_score || 0),
          x_reason: sanitizeText(String(company?.x_reason || '')).slice(0, 180),
          y_reason: sanitizeText(String(company?.y_reason || '')).slice(0, 180),
          confidence: Number(company?.confidence_score || 0),
        }));

      const angles = (Array.isArray(chart?.content_angles) ? chart.content_angles : [])
        .slice(0, 4)
        .map((a: any) => ({
          angle: sanitizeText(String(a?.angle || '')).slice(0, 200),
          audience_segment: sanitizeText(String(a?.audience_segment || '')).slice(0, 80),
        }))
        .filter((a: any) => a.angle);
      const wsNote = whiteSpaceNote(chart?.white_space);

      return {
        chart_name: sanitizeText(String(chart?.chart_name || '')).slice(0, 90),
        x_axis: sanitizeText(String(chart?.axes?.x || '')).slice(0, 40),
        y_axis: sanitizeText(String(chart?.axes?.y || '')).slice(0, 40),
        market_pattern: sanitizeText(String(chart?.summary?.market_pattern || '')).slice(0, 260),
        positioning_opportunity: sanitizeText(
          String(chart?.summary?.positioning_opportunity || ''),
        ).slice(0, 260),
        top_competitor_signals: topSignals,
        ...(angles.length > 0 ? { content_angles: angles } : {}),
        ...(wsNote ? { white_space_note: wsNote } : {}),
      };
    }),
  };

  return JSON.stringify(summary, null, 2);
}

function summarizeCompetitorKeywordContext(competitorKeywordsIntel: any): string {
  const competitors = Array.isArray(competitorKeywordsIntel?.competitors)
    ? competitorKeywordsIntel.competitors
    : [];
  const contentGaps = Array.isArray(competitorKeywordsIntel?.content_gaps)
    ? competitorKeywordsIntel.content_gaps
    : [];

  const clusterCounts = new Map<string, number>();
  for (const competitor of competitors) {
    const clusters = Array.isArray(competitor?.keyword_clusters) ? competitor.keyword_clusters : [];
    for (const cluster of clusters) {
      const name = sanitizeText(String(cluster?.cluster || '')).toLowerCase();
      if (!name) continue;
      clusterCounts.set(name, (clusterCounts.get(name) || 0) + 1);
    }
  }

  const topClusters = Array.from(clusterCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cluster, count]) => ({
      cluster,
      competitor_count: count,
    }));

  const summary = {
    competitors: competitors.slice(0, 8).map((competitor: any) => ({
      competitor: sanitizeText(String(competitor?.competitor || '')).slice(0, 80),
      domain: sanitizeText(String(competitor?.domain || '')).slice(0, 120),
      primary_keywords: Array.isArray(competitor?.primary_keywords)
        ? competitor.primary_keywords
            .slice(0, 8)
            .map((keyword: unknown) => sanitizeText(String(keyword)).slice(0, 60))
        : [],
      keyword_clusters: Array.isArray(competitor?.keyword_clusters)
        ? competitor.keyword_clusters.slice(0, 4).map((cluster: any) => ({
            cluster: sanitizeText(String(cluster?.cluster || '')).slice(0, 80),
            keywords: Array.isArray(cluster?.keywords)
              ? cluster.keywords
                  .slice(0, 5)
                  .map((keyword: unknown) => sanitizeText(String(keyword)).slice(0, 60))
              : [],
          }))
        : [],
      content_goal: sanitizeText(String(competitor?.content_strategy?.main_goal || '')).slice(0, 120),
      strategic_strength: sanitizeText(
        String(competitor?.strategy_signals?.strategic_strength || ''),
      ).slice(0, 200),
      strategic_weakness: sanitizeText(
        String(competitor?.strategy_signals?.strategic_weakness || ''),
      ).slice(0, 200),
    })),
    top_keyword_clusters: topClusters,
    content_gaps: contentGaps.slice(0, 10).map((gap: any) => ({
      topic: sanitizeText(String(gap?.topic || '')).slice(0, 120),
      competitor_weakness: sanitizeText(String(gap?.competitor_weakness || '')).slice(0, 200),
      audience_importance: sanitizeText(String(gap?.audience_importance || '')).slice(0, 200),
    })),
  };

  return JSON.stringify(summary, null, 2);
}

function deriveMarketAnchor(marketMatrices: any): string {
  const strongest = sanitizeText(String(marketMatrices?.strongest_differentiation_opportunity || ''));
  if (strongest) return strongest.slice(0, 200);

  const charts = Array.isArray(marketMatrices?.charts) ? marketMatrices.charts : [];
  for (const chart of charts) {
    const opportunity = sanitizeText(String(chart?.summary?.positioning_opportunity || ''));
    if (opportunity) return opportunity.slice(0, 200);
  }

  return 'Positioning opportunity inferred from market metric signals.';
}

function deriveKeywordAnchor(competitorKeywordsIntel: any): string {
  const contentGaps = Array.isArray(competitorKeywordsIntel?.content_gaps)
    ? competitorKeywordsIntel.content_gaps
    : [];
  for (const gap of contentGaps) {
    const topic = sanitizeText(String(gap?.topic || ''));
    if (topic) return `Content gap: ${topic.slice(0, 170)}`;
  }

  const competitors = Array.isArray(competitorKeywordsIntel?.competitors)
    ? competitorKeywordsIntel.competitors
    : [];
  for (const competitor of competitors) {
    const clusters = Array.isArray(competitor?.keyword_clusters) ? competitor.keyword_clusters : [];
    for (const cluster of clusters) {
      const clusterName = sanitizeText(String(cluster?.cluster || ''));
      if (clusterName) return `Keyword cluster signal: ${clusterName.slice(0, 160)}`;
    }
  }

  return 'Competitor keyword and content intent signals.';
}

export async function scrapeUrl(url: string): Promise<string | null> {
  try {
    let targetUrl = url;
    if (!/^https?:\/\//i.test(url)) {
      targetUrl = `https://${url}`;
    }

    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) return null;

    const html = await res.text();
    const title = sanitizeText(
      decodeHtmlEntities(
        html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || urlToDomainRoot(url).replace(/[-_]+/g, ' '),
      ),
    );
    const metaDescription =
      extractMetaContent(html, 'name', 'description') ||
      extractMetaContent(html, 'property', 'og:description') ||
      '';

    const content = decodeHtmlEntities(
      html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '\n')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '\n')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '\n')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '\n')
        .replace(/<template\b[^<]*(?:(?!<\/template>)<[^<]*)*<\/template>/gi, '\n')
        .replace(/<(br|p|div|section|article|header|footer|li|h1|h2|h3|h4|h5|h6|tr|td|th)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\r/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/[ ]{2,}/g, ' '),
    );

    const unique = new Set<string>();
    const lines: string[] = [];

    const candidates = [title, metaDescription, ...content.split('\n').map((line) => sanitizeText(line))];
    for (const candidate of candidates) {
      const line = sanitizeText(candidate);
      if (isScrapeJunkLine(line)) continue;
      const normalizedKey = line.toLowerCase();
      if (unique.has(normalizedKey)) continue;
      unique.add(normalizedKey);
      lines.push(line);
      if (lines.length >= 220) break;
    }

    if (lines.length === 0) return null;

    return lines.join('\n').slice(0, 20000);
  } catch (error) {
    console.error('Scraping error:', error);
    return null;
  }
}

interface BrandExtraction {
  heroMessage: string;
  extractedCta: string;
  industry: string;
  businessSummary: string;
  audience: string;
  tone: string;
  valueProposition: string;
  pillars: string[];
  persona: {
    title: string;
    description: string;
  };
}

/** A model value that is only scrape debris ("Read more", "©", "") counts as missing. */
function cleanModelValue(value: unknown): string {
  const text = sanitizeText(String(value ?? ''));
  if (!text || NO_LETTERS.test(text)) return '';
  if (SCRAPE_JUNK_PATTERNS.some((pattern) => pattern.test(text))) return '';
  return text;
}

const BRAND_EXTRACTION_SCHEMA = strictObject({
  heroMessage: STRING,
  extractedCta: STRING,
  industry: STRING,
  businessSummary: STRING,
  audience: STRING,
  tone: STRING,
  valueProposition: STRING,
  pillars: STRING_ARRAY,
  persona: strictObject({ title: STRING, description: STRING }),
});

/**
 * Cleans the model's extraction. A field the model left empty stays empty —
 * it used to be filled from a regex guess at the page ("Business Services",
 * "Get Started", "General business audience") that was then saved as brand
 * memory. Null when nothing usable came back at all.
 */
function normalizeBrandExtraction(candidate: Partial<BrandExtraction> | null): BrandExtraction | null {
  const safe = candidate || {};
  const result: BrandExtraction = {
    heroMessage: cleanModelValue(safe.heroMessage),
    extractedCta: cleanModelValue(safe.extractedCta),
    industry: cleanModelValue(safe.industry),
    businessSummary: cleanModelValue(safe.businessSummary),
    audience: cleanModelValue(safe.audience),
    tone: cleanModelValue(safe.tone),
    valueProposition: cleanModelValue(safe.valueProposition),
    pillars: (Array.isArray(safe.pillars) ? safe.pillars : []).map(cleanModelValue).filter(Boolean).slice(0, 5),
    persona: {
      title: cleanModelValue(safe.persona?.title),
      description: cleanModelValue(safe.persona?.description),
    },
  };
  if (!result.businessSummary && !result.valueProposition && !result.industry) return null;
  return result;
}

export async function analyzeWebsiteWithGemini(
  url: string,
  htmlText: string,
  /*
    The site being read may be in any language; this is the language the
    extracted brand memory is WRITTEN IN, because every draft afterwards is
    built from it. A Persian workspace whose brand memory is in English
    produces Persian posts arguing an English-phrased position, which is how
    a translated-feeling product happens even when every visible label is
    Persian.
  */
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
  ctx?: AiCallContext,
): Promise<BrandExtraction | null> {
  const prompt = `
You are an expert Brand Strategist and Marketing Analyst.
I am providing you with the scraped text from a company's website (${url}).

${languageInstructions(language)}
The JSON KEYS stay exactly as listed below, in English. Only the VALUES are
written in the language above.

Your goal is to extract key marketing intelligence and output ONLY a valid JSON object matching the requested schema. Do not include markdown formatting or commentary. Just output the raw JSON.

Website Text:
"""
${htmlText}
"""

Please return a JSON object with EXACTLY these keys:
- "heroMessage": The main headline or hero text found on the homepage.
- "extractedCta": The primary Call to Action (e.g., "Start Free Trial", "Book a Demo").
- "industry": An educated guess of their industry (e.g., "B2B SaaS", "E-commerce").
- "businessSummary": A 1-2 sentence summary of exactly what the business does.
- "audience": A description of their target audience based on the copy.
- "tone": 3-4 comma-separated adjectives describing their brand tone (e.g., "Professional, analytical, bold").
- "valueProposition": What is their main unique value proposition?
- "pillars": An array of 3 strings representing suggested content marketing pillars (e.g., ["Industry Insights", ...]).
- "persona": An object with "title" (e.g., "Growth Leader") and "description" (1 sentence about the persona).
`;

  const result = await runJson<Partial<BrandExtraction>>(
    'analyzeWebsiteWithGemini',
    'website_analysis',
    {
      system: 'You are an expert Brand Strategist. Return only valid JSON for the requested schema.',
      prompt,
      timeoutMs: JSON_TIMEOUT_MS,
      output: { kind: 'json_schema', name: 'brand_extraction', schema: BRAND_EXTRACTION_SCHEMA },
    },
    ctx,
  );
  if (!result) return null;
  const extraction = normalizeBrandExtraction(result.data);
  if (!extraction) {
    console.error(`[analyzeWebsiteWithGemini] ${result.provider} answered with no usable brand fields for ${url}; returning null`);
  }
  return extraction;
}

export interface ContentIdea {
  topic: string;
  angle: string;
  format: string;
  pillar: string;
  brand_anchor?: string;
  market_anchor?: string;
  keyword_anchor?: string;
  include_images?: boolean;
  image_count?: number;
  image_briefs?: string[];
  auto_insert_to_calendar?: boolean;
  framework_id?: FrameworkId;
  framework_name?: string;
  framework_category?: string;
  selection_mode?: string;
  selection_reason?: string;
  quality_scores?: FrameworkQualityScores;
  fallback_used?: boolean;
  fallback_framework_id?: FrameworkId | null;
}

export type IdeationRequestOptions = FrameworkSelectionInput & {
  /**
   * The language the ideas — titles, angles, hooks — come back in. Ideas are
   * what the drafts are written from, so an English idea list produces an
   * English-shaped Persian post: the topic survives translation, the phrasing
   * does not.
   */
  language?: ContentLanguage;
  requestedIdeaCount?: number;
  maxIdeaCount?: number;
  includeImages?: boolean;
  imageCount?: number;
  autoInsertToCalendar?: boolean;
  marketMatrices?: any;
  /** Which competitor set the matrices were built on (see matricesGate). */
  competitorBasis?: 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'UNKNOWN';
  competitorKeywordsIntel?: any;
  /** Free-form operator guidance (e.g. Autopilot topic hints / avoid list). */
  steeringNotes?: string | null;
};

export interface ContentIdeasResult {
  ideas: ContentIdea[];
  framework: {
    framework_id: FrameworkId;
    framework_name: string;
    framework_category: string;
    selection_mode: string;
    selection_reason: string;
  };
  quality_scores: FrameworkQualityScores;
  fallback_used: boolean;
  fallback_framework_id: FrameworkId | null;
}

function normalizeIdeas(
  candidate: unknown,
  brandSummary: any,
  count = 5,
  mediaConfig?: { includeImages: boolean; imageCount: number; autoInsertToCalendar: boolean },
  anchorDefaults?: { brandAnchor: string; marketAnchor: string; keywordAnchor: string },
): ContentIdea[] {
  const source = Array.isArray(candidate) ? candidate : [];
  const normalized = normalizeBrandSummary(brandSummary);
  const formats = ['LinkedIn Post', 'Blog Article', 'Email Newsletter', 'Twitter Thread', 'LinkedIn Carousel'];
  const includeImages = Boolean(mediaConfig?.includeImages);
  const imageCount = Math.max(1, Math.min(3, Number(mediaConfig?.imageCount || 1)));
  const autoInsertToCalendar = Boolean(mediaConfig?.autoInsertToCalendar);

  const result: ContentIdea[] = [];
  for (const item of source) {
    const topic = sanitizeText(String((item as any)?.topic || ''));
    const angle = sanitizeText(String((item as any)?.angle || ''));
    const format = sanitizeText(String((item as any)?.format || ''));
    const pillar = sanitizeText(String((item as any)?.pillar || ''));
    const brandAnchor = sanitizeText(
      String((item as any)?.brand_anchor || anchorDefaults?.brandAnchor || ''),
    );
    const marketAnchor = sanitizeText(
      String((item as any)?.market_anchor || anchorDefaults?.marketAnchor || ''),
    );
    const keywordAnchor = sanitizeText(
      String((item as any)?.keyword_anchor || anchorDefaults?.keywordAnchor || ''),
    );
    if (!topic || !angle) continue;

    result.push({
      topic: topic.slice(0, 160),
      angle: angle.slice(0, 320),
      format: format || formats[result.length] || 'LinkedIn Post',
      pillar:
        pillar ||
        (normalized.pillars.length > 0 ? normalized.pillars[result.length % normalized.pillars.length] : '') ||
        'General',
      brand_anchor: brandAnchor.slice(0, 200),
      market_anchor: marketAnchor.slice(0, 200),
      keyword_anchor: keywordAnchor.slice(0, 200),
      include_images: includeImages,
      image_count: includeImages ? imageCount : 0,
      image_briefs:
        includeImages && Array.isArray((item as any)?.image_briefs)
          ? (item as any).image_briefs
              .map((entry: unknown) => sanitizeText(String(entry || '')))
              .filter(Boolean)
              .slice(0, imageCount)
          : [],
      auto_insert_to_calendar: autoInsertToCalendar,
    });

    if (result.length >= count) break;
  }

  // Only what the model wrote. A short list used to be padded with template
  // ideas built from the brand pillars, indistinguishable from real ones.
  return result.slice(0, count);
}

function buildIdeasPrompt(input: {
  brandSummary: any;
  marketMetricContext: string;
  competitorKeywordContext: string;
  frameworkId: FrameworkId;
  frameworkName: string;
  frameworkCategory: string;
  selectionReason: string;
  requestedIdeaCount: number;
  includeImages: boolean;
  imageCount: number;
  autoInsertToCalendar: boolean;
  goal: string;
  platform: string;
  funnelStage: string;
  steeringNotes?: string | null;
  language: ContentLanguage;
}): string {
  return `
You are Contivo Framework Engine.
Generate high-quality content ideas using the selected framework and return ONLY valid JSON.

${languageInstructions(input.language)}
The JSON KEYS stay exactly as specified in English. Only the VALUES — titles,
angles, hooks, rationales — are written in the language above.

Brand Strategy Profile:
${JSON.stringify(input.brandSummary, null, 2)}

Market Metric Context (must-use):
${input.marketMetricContext}

Competitor Keywords Context (must-use):
${input.competitorKeywordContext}

Framework Selection:
- framework_id: ${input.frameworkId}
- framework_name: ${input.frameworkName}
- framework_category: ${input.frameworkCategory}
- selection_reason: ${input.selectionReason}
- framework_guidance: ${getFrameworkGuidance(input.frameworkId)}

Content request context:
- goal: ${input.goal}
- platform: ${input.platform}
- funnel_stage: ${input.funnelStage}
- requested_idea_count: ${input.requestedIdeaCount}
- include_images: ${input.includeImages}
- image_count: ${input.imageCount} (max 3; first image should be cover)
- auto_insert_to_calendar: ${input.autoInsertToCalendar} (mock behavior for now)
${input.steeringNotes ? `\nOperator steering (must respect):\n${input.steeringNotes}\n` : ''}
Output schema:
{
  "ideas": [
    {
      "topic": "",
      "angle": "",
      "format": "",
      "pillar": "",
      "brand_anchor": "",
      "market_anchor": "",
      "keyword_anchor": "",
      "image_briefs": []
    }
  ],
  "quality_scores": {
    "brand_fit": 0,
    "audience_fit": 0,
    "goal_fit": 0,
    "platform_fit": 0,
    "clarity_usefulness": 0,
    "overall_score": 0
  }
}

Rules:
- every idea must be grounded in all three sources: Brand Strategy + Market Metric + Competitor Keywords
- do not produce ideas that cannot cite concrete anchors
- ideas must be specific, not generic
- avoid fluff and broad clichés
- keep each angle practical and audience-relevant
- score realistically; do not inflate confidence
- include concise anchor evidence in brand_anchor, market_anchor, keyword_anchor
- if include_images=true: add image_briefs array sized to image_count, with first brief intended as cover image
`;
}

function applyIdeaMeta(
  ideas: ContentIdea[],
  meta: {
    frameworkId: FrameworkId;
    frameworkName: string;
    frameworkCategory: string;
    selectionMode: string;
    selectionReason: string;
    qualityScores: FrameworkQualityScores;
    fallbackUsed: boolean;
    fallbackFrameworkId: FrameworkId | null;
  },
): ContentIdea[] {
  return ideas.map((idea) => ({
    ...idea,
    framework_id: meta.frameworkId,
    framework_name: meta.frameworkName,
    framework_category: meta.frameworkCategory,
    selection_mode: meta.selectionMode,
    selection_reason: meta.selectionReason,
    quality_scores: meta.qualityScores,
    fallback_used: meta.fallbackUsed,
    fallback_framework_id: meta.fallbackFrameworkId,
  }));
}

const IDEAS_SCHEMA = strictObject({
  ideas: {
    type: 'array',
    minItems: 1,
    items: strictObject({
      topic: STRING,
      angle: STRING,
      format: STRING,
      pillar: STRING,
      brand_anchor: STRING,
      market_anchor: STRING,
      keyword_anchor: STRING,
      image_briefs: STRING_ARRAY,
    }),
  },
  quality_scores: strictObject({
    brand_fit: NUMBER,
    audience_fit: NUMBER,
    goal_fit: NUMBER,
    platform_fit: NUMBER,
    clarity_usefulness: NUMBER,
    overall_score: NUMBER,
  }),
});

async function generateIdeasWithFramework(
  brandSummary: any,
  frameworkSelection: ReturnType<typeof selectFramework>,
  requestedIdeaCount: number,
  mediaConfig: {
    includeImages: boolean;
    imageCount: number;
    autoInsertToCalendar: boolean;
  },
  context: {
    goal: string;
    platform: string;
    funnelStage: string;
    steeringNotes?: string | null;
    language: ContentLanguage;
  },
  intelligenceContext: {
    marketMetricContext: string;
    competitorKeywordContext: string;
    defaultBrandAnchor: string;
    defaultMarketAnchor: string;
    defaultKeywordAnchor: string;
  },
  ctx?: AiCallContext,
): Promise<{
  ideas: ContentIdea[];
  qualityScores: FrameworkQualityScores;
  provider: ProviderId;
} | null> {
  const prompt = buildIdeasPrompt({
    brandSummary,
    marketMetricContext: intelligenceContext.marketMetricContext,
    competitorKeywordContext: intelligenceContext.competitorKeywordContext,
    frameworkId: frameworkSelection.framework_id,
    frameworkName: frameworkSelection.framework_name,
    frameworkCategory: frameworkSelection.framework_category,
    selectionReason: frameworkSelection.selection_reason,
    requestedIdeaCount,
    includeImages: mediaConfig.includeImages,
    imageCount: mediaConfig.imageCount,
    autoInsertToCalendar: mediaConfig.autoInsertToCalendar,
    goal: context.goal,
    platform: context.platform,
    funnelStage: context.funnelStage,
    steeringNotes: context.steeringNotes,
    language: context.language,
  });

  const result = await runJson<{ ideas?: unknown; quality_scores?: Partial<FrameworkQualityScores> }>(
    'generateIdeasWithFramework',
    'content_ideas',
    {
      system: 'You are Contivo Framework Engine. Return only valid JSON using the exact schema.',
      prompt,
      timeoutMs: LONG_TIMEOUT_MS,
      output: { kind: 'json_schema', name: 'content_ideas', schema: IDEAS_SCHEMA },
    },
    ctx,
  );
  if (!result) return null;

  const ideas = normalizeIdeas(result.data.ideas, brandSummary, requestedIdeaCount, mediaConfig, {
    brandAnchor: intelligenceContext.defaultBrandAnchor,
    marketAnchor: intelligenceContext.defaultMarketAnchor,
    keywordAnchor: intelligenceContext.defaultKeywordAnchor,
  });
  if (ideas.length === 0) {
    console.error(`[generateIdeasWithFramework] ${result.provider} returned no usable ideas; returning null`);
    return null;
  }
  return { ideas, qualityScores: normalizeQualityScores(result.data.quality_scores), provider: result.provider };
}

export async function generateContentIdeasWithGemini(
  brandSummary: any,
  options?: IdeationRequestOptions,
  ctx?: AiCallContext,
): Promise<ContentIdeasResult | null> {
  const marketMatrices = options?.marketMatrices;
  const competitorKeywordsIntel = options?.competitorKeywordsIntel;
  if (!marketMatrices || !competitorKeywordsIntel) {
    console.warn('generateContentIdeasWithGemini: required intelligence context is missing.');
    return null;
  }

  const maxIdeaCount = Math.max(1, Math.min(20, Number(options?.maxIdeaCount || 10)));
  const requestedIdeaCount = Math.max(1, Math.min(maxIdeaCount, Number(options?.requestedIdeaCount || 5)));
  const includeImages = Boolean(options?.includeImages);
  const imageCount = Math.max(1, Math.min(3, Number(options?.imageCount || 1)));
  const autoInsertToCalendar = options?.autoInsertToCalendar !== false;
  const language = options?.language ?? DEFAULT_CONTENT_LANGUAGE;
  const selection = selectFramework({
    goal: options?.goal,
    platform: options?.platform,
    funnelStage: options?.funnelStage,
    selectionMode: options?.selectionMode,
    manualFrameworkId: options?.manualFrameworkId,
    audience: options?.audience,
  });

  const goal = String(options?.goal || 'authority');
  const platform = String(options?.platform || 'linkedin');
  const funnelStage = String(options?.funnelStage || 'AUTO');
  const steeringNotes = String(options?.steeringNotes || '').trim().slice(0, 1200) || null;
  const normalizedBrand = normalizeBrandSummary(brandSummary);
  const intelligenceContext = {
    marketMetricContext: summarizeMarketMetricContext(marketMatrices, options?.competitorBasis),
    competitorKeywordContext: summarizeCompetitorKeywordContext(competitorKeywordsIntel),
    defaultBrandAnchor: normalizedBrand.valueProposition
      ? `Brand signal: ${normalizedBrand.valueProposition.slice(0, 180)}`
      : '',
    defaultMarketAnchor: `Market signal: ${deriveMarketAnchor(marketMatrices)}`,
    defaultKeywordAnchor: `Keyword signal: ${deriveKeywordAnchor(competitorKeywordsIntel)}`,
  };

  const primary = await generateIdeasWithFramework(
    brandSummary,
    selection,
    requestedIdeaCount,
    {
      includeImages,
      imageCount,
      autoInsertToCalendar,
    },
    { goal, platform, funnelStage, steeringNotes, language },
    intelligenceContext,
    ctx,
  );

  if (primary) {
    let fallbackUsed = false;
    let fallbackFrameworkId: FrameworkId | null = null;
    let selectedIdeas = primary.ideas;
    let selectedScores = primary.qualityScores;
    let selectedFramework = selection;

    if (shouldUseFallback(primary.qualityScores)) {
      const fallbackId = getFallbackFramework(selection.framework_id);
      if (fallbackId) {
        const fallbackSelection = selectFramework({
          selectionMode: 'manual',
          manualFrameworkId: fallbackId,
          goal,
          platform,
          funnelStage,
        });
        const fallbackResult = await generateIdeasWithFramework(
          brandSummary,
          fallbackSelection,
          requestedIdeaCount,
          {
            includeImages,
            imageCount,
            autoInsertToCalendar,
          },
          { goal, platform, funnelStage, steeringNotes, language },
          intelligenceContext,
          ctx,
        );
        if (fallbackResult && fallbackResult.qualityScores.overall_score >= primary.qualityScores.overall_score) {
          fallbackUsed = true;
          fallbackFrameworkId = fallbackId;
          selectedIdeas = fallbackResult.ideas;
          selectedScores = fallbackResult.qualityScores;
          selectedFramework = fallbackSelection;
        }
      }
    }

    const ideasWithMeta = applyIdeaMeta(selectedIdeas, {
      frameworkId: selectedFramework.framework_id,
      frameworkName: selectedFramework.framework_name,
      frameworkCategory: selectedFramework.framework_category,
      selectionMode: selectedFramework.selection_mode,
      selectionReason: selectedFramework.selection_reason,
      qualityScores: selectedScores,
      fallbackUsed,
      fallbackFrameworkId,
    });

    return {
      ideas: ideasWithMeta,
      framework: {
        framework_id: selectedFramework.framework_id,
        framework_name: selectedFramework.framework_name,
        framework_category: selectedFramework.framework_category,
        selection_mode: selectedFramework.selection_mode,
        selection_reason: selectedFramework.selection_reason,
      },
      quality_scores: selectedScores,
      fallback_used: fallbackUsed,
      fallback_framework_id: fallbackFrameworkId,
    };
  }

  // The chain failed or returned no usable ideas. There used to be a set of
  // template ideas here with made-up quality scores (6.44) presented as real.
  return null;
}

export async function generateContentDraftWithGemini(
  brandSummary: any,
  topic: string,
  context: string,
  channel: string,
  frameworkContext?: {
    frameworkId?: string | null;
    selectionReason?: string | null;
    wordCount?: {
      platform?: string | null;
      min?: number | null;
      max?: number | null;
      target?: number | null;
    } | null;
  },
  /**
   * The storyline block this draft must advance, already rendered. Passed as
   * its own argument rather than folded into `context` because it is a
   * constraint the quality gate will hold the draft to, not background colour.
   */
  storylineBlock?: string | null,
  /** The workspace's content language. See lib/content-language.ts. */
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
  ctx?: AiCallContext,
): Promise<string | null> {
  const frameworkId = String(frameworkContext?.frameworkId || '').trim();
  const frameworkGuide =
    frameworkId && frameworkId in FRAMEWORK_LABELS
      ? getFrameworkGuidance(frameworkId as FrameworkId)
      : '';
  /*
    The configured ranges are English word counts. Persian says the same thing
    in fewer words, so holding it to an English range makes the model pad —
    and padding is precisely what the quality gate rejects.
  */
  const wordCountTarget = adjustWordCountForLanguage(
    Number(frameworkContext?.wordCount?.target || 0),
    language,
  );
  const wordCountMin = adjustWordCountForLanguage(
    Number(frameworkContext?.wordCount?.min || 0),
    language,
  );
  const wordCountMax = adjustWordCountForLanguage(
    Number(frameworkContext?.wordCount?.max || 0),
    language,
  );
  const wordCountPlatform = String(frameworkContext?.wordCount?.platform || channel || '').trim();
  const hasWordCountRange =
    Number.isFinite(wordCountMin) &&
    Number.isFinite(wordCountMax) &&
    wordCountMin > 0 &&
    wordCountMax >= wordCountMin;
  const hasWordCountTarget =
    Number.isFinite(wordCountTarget) &&
    wordCountTarget > 0 &&
    (!hasWordCountRange || (wordCountTarget >= wordCountMin && wordCountTarget <= wordCountMax));
  const wordCountLine = hasWordCountTarget
    ? `Target Word Count: ${Math.floor(wordCountTarget)}`
    : 'Target Word Count: not specified';
  const wordCountRangeLine = hasWordCountRange
    ? `Allowed Word Range (${wordCountPlatform || 'default'}): ${Math.floor(wordCountMin)} to ${Math.floor(wordCountMax)} words`
    : 'Allowed Word Range: use reasonable channel defaults';

  const prompt = `
You are an expert Copywriter and Content Marketer.
Your task is to write a high-converting, engaging post for the requested channel.

${languageInstructions(language)}

Brand Strategy Profile:
${JSON.stringify(brandSummary, null, 2)}

Topic: ${topic}
Additional Context/Angle: ${context}
Target Channel: ${channel}
${storylineBlock ? `\n${storylineBlock}\n` : ''}
Framework Preference: ${frameworkId || 'none'}
Framework Reason: ${String(frameworkContext?.selectionReason || '').trim() || 'not provided'}
Framework Guidance: ${frameworkGuide || 'Use the best structure for the channel and goal.'}
${wordCountLine}
${wordCountRangeLine}

Instructions:
1. Write the content in the tone specified in the brand profile.
2. Structure it appropriately for the channel (e.g., shorter for Twitter, formatted with spacing for LinkedIn, longer form for Blog).
3. Do not include commentary like "Here is the post," just write the post itself.
4. If it is a social post, include 2-3 relevant hashtags at the end.
5. If "Additional Context/Angle" includes USER_NOTES or USER_SOURCE_TEXT, prioritize those user-provided sources.
6. Do not invent claims that conflict with user-provided sources.
7. Respect the target word count and keep output inside the allowed word range.
${
  storylineBlock
    ? `8. This post must ADVANCE the storyline's claim. Being on-topic is not enough — argue for it. You do not have to state it outright.
9. You may only point at the evidence listed. If the evidence list is empty, argue from reasoning and observation and never imply customers, results or case studies. A reviewer scores this and rejects the post if you overreach.`
    : ''
}
`;

  const result = await runText(
    'generateContentDraftWithGemini',
    'content_draft',
    {
      system: 'You are an expert copywriter. Output only the final content with no preface.',
      prompt,
      timeoutMs: LONG_TIMEOUT_MS,
    },
    ctx,
  );
  // Null when the chain fails. This used to return fallbackDraft(): a
  // "Topic: … Audience: … Practical next step: 1) Clarify the single outcome"
  // template that was saved, scheduled and published as if it were written.
  return result?.text ?? null;
}

/** Channel-specific shape for one-off generation with no brand profile. */
const INSTANT_CHANNEL_BRIEF: Record<string, string> = {
  linkedin:
    'A LinkedIn post of 150-300 words. Open with a hook line, use short paragraphs separated by blank lines, close with a question or invitation. End with 2-3 relevant hashtags.',
  twitter:
    'An X/Twitter thread of 5-7 numbered tweets. Each tweet must be 280 characters or fewer. The first tweet has to earn the scroll-stop on its own.',
  instagram:
    'An Instagram caption: a strong first line, a short value body with line breaks, and a clear call to action. Finish with 5-10 relevant hashtags.',
  email:
    'A marketing email. Start with a line "Subject: <subject line>", then the body: concise, one idea, one call to action.',
  blog:
    'A blog post outline: a title, a line starting "Meta: " with the meta description, an intro hook, 5-7 H2 sections each with 3 bullets, and a conclusion.',
};

/**
 * Generates one piece of content with no workspace behind it (Instant Content).
 *
 * Returns `null` when the whole provider chain fails — the caller charges
 * credits for the result, so it must be able to tell a real generation from
 * a failure and refuse to bill for the latter.
 */
export async function generateInstantDraft(input: {
  topic: string;
  channel: string;
  tone?: string | null;
  /** Instant Content has no workspace, so this comes from the UI locale. */
  language?: ContentLanguage;
  ctx?: AiCallContext;
}): Promise<{ content: string; provider: ProviderId } | null> {
  const channel = String(input.channel || 'linkedin').toLowerCase();
  const brief = INSTANT_CHANNEL_BRIEF[channel] ?? INSTANT_CHANNEL_BRIEF.linkedin;
  const tone = String(input.tone || 'professional').trim();

  const language = input.language ?? DEFAULT_CONTENT_LANGUAGE;

  const prompt = `
You are an expert copywriter and content marketer.

${languageInstructions(language)}

Topic: ${input.topic}
Channel: ${channel}
Tone: ${tone}

What to write:
${brief}

Rules:
1. Write in the ${tone} tone throughout.
2. Output only the content itself — no preface, no "Here is your post", no commentary.
3. Do not invent statistics, client names, case studies or first-person anecdotes. If you need an example, frame it as a hypothetical.
4. Do not use em dashes as a stylistic tic, and avoid stock AI openers like "In today's fast-paced world".

Where the LANGUAGE section above gives its own rules on punctuation, register
or stock phrases, those win: they are written for that language, and these
four are written for English.
`;

  const result = await runText(
    'generateInstantDraft',
    'instant_draft',
    {
      system: 'You are an expert copywriter. Output only the final content, with no preface.',
      prompt,
      timeoutMs: LONG_TIMEOUT_MS,
    },
    input.ctx,
  );
  return result ? { content: result.text, provider: result.provider } : null;
}

export interface CompetitorExtraction {
  name: string;
  domain: string;
  description: string;
  category: string;
  audienceGuess: string;
}

const COMPETITORS_SCHEMA = strictObject({
  competitors: {
    type: 'array',
    minItems: 1,
    items: strictObject({
      name: STRING,
      domain: STRING,
      description: STRING,
      category: STRING,
      audienceGuess: STRING,
    }),
  },
});

/**
 * Null when the chain fails or no competitor came back. It used to return []
 * on failure, which a caller cannot tell apart from "this brand has none".
 */
export async function discoverCompetitorsWithGemini(
  brandSummary: any,
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
  ctx?: AiCallContext,
): Promise<CompetitorExtraction[] | null> {
  const prompt = `
You are an expert Market Analyst. Determine 5 to 8 potential competitors for the following brand.

${languageInstructions(language)}
The JSON KEYS stay exactly as listed below, in English. Only the VALUES are
written in the language above.

Company names and domains are proper nouns and stay in their own script.

Output ONLY a JSON object of the form {"competitors": [...]} matching the required schema. Do not use markdown formatting.

Brand Strategy Profile:
${JSON.stringify(brandSummary, null, 2)}

Required Schema: "competitors" is an array of objects, where each object has these keys:
- "name": Company name.
- "domain": The website domain (e.g., "acme.com").
- "description": A 1-2 sentence description of what they do.
- "category": The market category they belong to.
- "audienceGuess": A description of their target audience.
`;

  const result = await runJson<{ competitors?: unknown }>(
    'discoverCompetitorsWithGemini',
    'legacy_competitors',
    {
      system:
        'You are an expert market analyst. Return only a JSON object of the form {"competitors": [...]}, where the array holds the real competitors in the schema described.',
      prompt,
      timeoutMs: JSON_TIMEOUT_MS,
      output: { kind: 'json_schema', name: 'legacy_competitors', schema: COMPETITORS_SCHEMA },
    },
    ctx,
  );
  const list = Array.isArray(result?.data?.competitors) ? (result.data.competitors as CompetitorExtraction[]) : [];
  return list.length > 0 ? list : null;
}

export interface PositioningInsights {
  positioningOpportunity: string;
  messagingDifferentiation: string;
}

const POSITIONING_SCHEMA = strictObject({ positioningOpportunity: STRING, messagingDifferentiation: STRING });

/**
 * Null when the chain fails. It used to return fallbackPositioning(): "Most of
 * the N competitors appear to compete on similar claims…" built from a
 * template, not from the competitors.
 */
export async function generatePositioningInsights(
  brandSummary: any,
  competitors: any[],
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
  ctx?: AiCallContext,
): Promise<PositioningInsights | null> {
  const prompt = `
You are an expert Brand Strategist and Marketing Analyst.
Review the following user brand's preliminary profile and a list of their validated competitors in the market.

${languageInstructions(language)}
The JSON KEYS stay exactly as listed below, in English. Only the VALUES are
written in the language above.

User Brand Profile:
${JSON.stringify(brandSummary, null, 2)}

Validated Competitors:
${JSON.stringify(competitors, null, 2)}

Analyze the competitors to identify gaps and opportunities. Output ONLY a raw JSON object matching the requested schema. Do not use markdown.

Required Schema:
- "positioningOpportunity": A 2-sentence description of where the user's brand can uniquely position itself (e.g. "Most competitors focus on feature depth. Your opportunity: simplicity and speed.").
- "messagingDifferentiation": A sharp, 1-2 sentence recommendation for differentiation (e.g. "Competitors emphasize automation. Your messaging should emphasize strategic thinking.").
`;

  const result = await runJson<PositioningInsights>(
    'generatePositioningInsights',
    'positioning',
    {
      system: 'You are an expert brand strategist. Return only valid JSON with the required keys.',
      prompt,
      timeoutMs: JSON_TIMEOUT_MS,
      output: { kind: 'json_schema', name: 'positioning', schema: POSITIONING_SCHEMA },
    },
    ctx,
  );
  if (!result) return null;
  const positioningOpportunity = sanitizeText(String(result.data.positioningOpportunity || ''));
  const messagingDifferentiation = sanitizeText(String(result.data.messagingDifferentiation || ''));
  if (!positioningOpportunity || !messagingDifferentiation) return null;
  return { positioningOpportunity, messagingDifferentiation };
}

// ─── SEO Intelligence: SERP Analysis ─────────────────────────────────────────

type SerpItem = {
  rank_absolute: number;
  title: string;
  url: string;
  description: string | null;
  domain: string;
};

/**
 * Analyze top SERP results with Gemini to extract content strategy insights.
 * Called from the seo-intelligence server action after DataForSEO returns results.
 *
 * @param keyword    The target keyword phrase
 * @param serpItems  Top 10 organic SERP results from DataForSEO
 */
export async function analyzeSerpResultsWithGemini(
  keyword: string,
  serpItems: SerpItem[],
  language: ContentLanguage = DEFAULT_CONTENT_LANGUAGE,
  ctx?: AiCallContext,
): Promise<string | null> {
  const serpList = serpItems
    .map(
      (item, idx) =>
        `${idx + 1}. [Rank ${item.rank_absolute}] ${item.title}\n   URL: ${item.url}\n   Domain: ${item.domain}\n   Snippet: ${item.description || 'N/A'}`,
    )
    .join('\n\n');

  const prompt = `You are an expert SEO content strategist.

${languageInstructions(language)}
The six section HEADINGS below keep their English names so the report parses.
Everything you write under them is in the language above. The keyword itself,
the URLs and the domains are quoted as they appear in the search results and
are never translated.

Analyze the following top ${serpItems.length} Google search results for the keyword: "${keyword}"

TOP SERP RESULTS:
${serpList}

Based on this analysis, generate a structured SERP Insight Report with these exact sections:

1. **Content Pattern** — What is the dominant format? (listicle, how-to, comparison, etc.)
2. **Average Content Depth** — Estimate word count range typical for these results
3. **Main Topics Covered** — List 5-7 core topics/subtopics that appear across results
4. **Missing Angles** — List 3-5 specific content angles NOT being served by current results
5. **Differentiation Opportunity** — A single concrete content idea that would stand out from all current results and serve the searcher's intent better
6. **Recommended Title** — A specific, compelling article title for a piece targeting this keyword

Keep your analysis specific, actionable, and grounded in what you actually see in the SERP data.`;

  const result = await runText(
    'analyzeSerpResultsWithGemini',
    'serp_analysis',
    {
      system: 'You are an SEO content strategist. Be specific, data-driven, and actionable.',
      prompt,
      timeoutMs: JSON_TIMEOUT_MS,
    },
    ctx,
  );
  return result?.text ?? null;
}

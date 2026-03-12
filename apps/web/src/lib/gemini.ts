import { getGeminiModel } from '@/lib/app-settings';
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

interface GeminiCallResult {
  ok: boolean;
  status: number;
  text: string | null;
}

interface OpenAiCallResult {
  ok: boolean;
  status: number;
  text: string | null;
}

const DEFAULT_OPENAI_MODEL = 'gpt-4.1';
const GEMINI_COOLDOWN_FALLBACK_MS = 60_000;
let geminiCooldownUntil = 0;
let geminiCooldownReason: string | null = null;

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

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pickByRegex(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function toTitleCase(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
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

async function callGemini(prompt: string, expectJson: boolean): Promise<GeminiCallResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, text: null };
  }

  if (geminiCooldownUntil > Date.now()) {
    return { ok: false, status: 429, text: null };
  }

  const model = await getGeminiModel();

  try {
    const body: Record<string, unknown> = {
      contents: [{ parts: [{ text: prompt }] }],
    };

    if (expectJson) {
      body.generationConfig = { responseMimeType: 'application/json' };
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errorBody = await res.text();
      console.error('Gemini API Request Error:', errorBody);

      if (res.status === 429 || res.status === 503) {
        let cooldownMs = GEMINI_COOLDOWN_FALLBACK_MS;
        const retryDelayMatch = errorBody.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
        if (retryDelayMatch?.[1]) {
          const parsed = Number(retryDelayMatch[1]);
          if (Number.isFinite(parsed) && parsed > 0) {
            cooldownMs = parsed * 1000;
          }
        }
        geminiCooldownUntil = Date.now() + cooldownMs;
        geminiCooldownReason = `status=${res.status} cooldown=${Math.ceil(cooldownMs / 1000)}s`;
        console.warn(`Gemini temporary cooldown enabled: ${geminiCooldownReason}`);
      }

      return { ok: false, status: res.status, text: null };
    }

    geminiCooldownUntil = 0;
    geminiCooldownReason = null;

    const data = await res.json();
    const resultText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!resultText || typeof resultText !== 'string') {
      return { ok: false, status: res.status, text: null };
    }

    return { ok: true, status: res.status, text: resultText };
  } catch (error) {
    console.error('Gemini request failed:', error);
    return { ok: false, status: -1, text: null };
  }
}

async function callOpenAi(
  prompt: string,
  expectJson: boolean,
  systemPrompt?: string,
): Promise<OpenAiCallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 0, text: null };
  }

  const model = process.env.OPENAI_DEFAULT_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        {
          role: 'system',
          content: systemPrompt || 'You are precise, factual, and follow output format exactly.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    };

    if (expectJson) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error('OpenAI API Request Error:', await res.text());
      return { ok: false, status: res.status, text: null };
    }

    const data = await res.json();
    const resultText = data?.choices?.[0]?.message?.content;
    if (!resultText || typeof resultText !== 'string') {
      return { ok: false, status: res.status, text: null };
    }

    return { ok: true, status: res.status, text: resultText };
  } catch (error) {
    console.error('OpenAI request failed:', error);
    return { ok: false, status: -1, text: null };
  }
}

function safeJsonParse<T>(raw: string): T | null {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function logFallback(scope: string, geminiStatus: number, openAiStatus?: number): void {
  const geminiUnavailable = geminiStatus === 429 || geminiStatus === 503 || geminiStatus === 0;
  const openAiUnavailable = openAiStatus === 429 || openAiStatus === 503 || openAiStatus === 0;

  if (geminiUnavailable && openAiStatus === undefined) {
    const cooldownHint =
      geminiCooldownUntil > Date.now()
        ? ` (cooldown active for ~${Math.ceil((geminiCooldownUntil - Date.now()) / 1000)}s${geminiCooldownReason ? `, ${geminiCooldownReason}` : ''})`
        : '';
    console.warn(`${scope}: Gemini unavailable (${geminiStatus})${cooldownHint}. Using heuristic fallback output.`);
    return;
  }

  if (openAiStatus !== undefined && !openAiUnavailable) {
    return;
  }

  if (geminiUnavailable && openAiUnavailable) {
    console.warn(
      `${scope}: Gemini (${geminiStatus}) and OpenAI (${openAiStatus}) unavailable. Using heuristic fallback output.`,
    );
    return;
  }

  if (openAiStatus !== undefined) {
    console.warn(
      `${scope}: Gemini (${geminiStatus}) and OpenAI (${openAiStatus}) returned invalid responses. Using heuristic fallback output.`,
    );
    return;
  }

  console.warn(`${scope}: Gemini returned an invalid response (${geminiStatus}). Using heuristic fallback output.`);
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

function isScrapeJunkLine(value: string): boolean {
  const text = sanitizeText(value);
  if (!text) return true;
  if (text.length < 18) return true;
  if (/^[\W_]+$/.test(text)) return true;
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

function inferIndustry(text: string): string {
  const lower = text.toLowerCase();
  const rules: Array<{ keywords: string[]; label: string }> = [
    { keywords: ['saas', 'software', 'platform', 'api', 'automation'], label: 'Technology & SaaS' },
    { keywords: ['ecommerce', 'shop', 'store', 'checkout', 'cart'], label: 'E-commerce' },
    { keywords: ['agency', 'marketing', 'campaign', 'brand'], label: 'Marketing Services' },
    { keywords: ['clinic', 'doctor', 'patient', 'health'], label: 'Healthcare' },
    { keywords: ['finance', 'fintech', 'bank', 'payments', 'accounting'], label: 'Finance & Fintech' },
    { keywords: ['education', 'course', 'learning', 'students'], label: 'Education' },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => lower.includes(keyword))) {
      return rule.label;
    }
  }

  return 'Business Services';
}

function inferAudience(text: string, industry: string): string {
  const lower = text.toLowerCase();
  const explicitAudience =
    pickByRegex(lower, [
      /for\s+([a-z0-9\s,&-]{8,80})/i,
      /built for\s+([a-z0-9\s,&-]{8,80})/i,
      /helping\s+([a-z0-9\s,&-]{8,80})/i,
    ]) || '';

  if (explicitAudience) {
    return toTitleCase(explicitAudience.replace(/[.,;:!?]+$/, ''));
  }

  if (industry === 'Technology & SaaS') return 'Founders, operators, and growth teams';
  if (industry === 'E-commerce') return 'E-commerce operators and online shoppers';
  if (industry === 'Marketing Services') return 'Marketing leads and business owners';
  if (industry === 'Healthcare') return 'Patients and healthcare providers';
  if (industry === 'Finance & Fintech') return 'Finance teams and digital-first businesses';
  if (industry === 'Education') return 'Learners, educators, and training teams';

  return 'General business audience';
}

function inferTone(text: string): string {
  const lower = text.toLowerCase();
  const tones: string[] = [];

  if (/(trusted|secure|reliable|proven)/.test(lower)) tones.push('trustworthy');
  if (/(fast|instant|quick|speed)/.test(lower)) tones.push('fast-paced');
  if (/(simple|easy|clarity|straightforward)/.test(lower)) tones.push('clear');
  if (/(innovative|future|next-gen|modern)/.test(lower)) tones.push('innovative');
  if (/(premium|luxury|best-in-class)/.test(lower)) tones.push('premium');

  if (tones.length < 3) {
    tones.push('professional', 'practical', 'confident');
  }

  return Array.from(new Set(tones)).slice(0, 4).join(', ');
}

function inferCta(text: string): string {
  const direct = pickByRegex(text, [
    /\b(start free trial)\b/i,
    /\b(book a demo)\b/i,
    /\b(get started)\b/i,
    /\b(contact us)\b/i,
    /\b(request a demo)\b/i,
    /\b(sign up)\b/i,
    /\b(try for free)\b/i,
  ]);

  return direct || 'Get Started';
}

function inferHero(sentences: string[]): string {
  const candidate = sentences.find((s) => s.length >= 25 && s.length <= 160);
  if (candidate) return candidate;
  if (sentences[0]) return sentences[0].slice(0, 160);
  return 'Helping businesses grow with clearer strategy and execution.';
}

function inferValueProposition(sentences: string[]): string {
  const candidate = sentences.find((sentence) =>
    /(help|enable|empower|improve|optimi[sz]e|grow|save|scale|automate|transform)/i.test(sentence),
  );

  if (candidate) return candidate.slice(0, 220);
  if (sentences[1]) return sentences[1].slice(0, 220);
  return 'Delivers practical outcomes with a simpler, faster path to results.';
}

function inferPillars(industry: string): string[] {
  if (industry === 'Technology & SaaS') return ['Industry Insights', 'Product Education', 'Customer Success Stories'];
  if (industry === 'E-commerce') return ['Product Discovery', 'Buyer Education', 'Brand Trust & Social Proof'];
  if (industry === 'Marketing Services') return ['Growth Playbooks', 'Case Studies', 'Market Trends'];
  if (industry === 'Healthcare') return ['Patient Education', 'Expert Guidance', 'Service Trust Signals'];
  if (industry === 'Finance & Fintech') return ['Financial Education', 'Risk & Compliance Clarity', 'Operational Efficiency'];
  if (industry === 'Education') return ['Learning Tips', 'Program Outcomes', 'Community Stories'];
  return ['Industry Education', 'Practical How-Tos', 'Proof of Results'];
}

function fallbackBrandExtraction(url: string, htmlText: string): BrandExtraction {
  const cleaned = sanitizeText(htmlText);
  const sentences = splitSentences(cleaned);
  const industry = inferIndustry(cleaned);
  const audience = inferAudience(cleaned, industry);
  const domainRoot = toTitleCase(urlToDomainRoot(url).replace(/[-_]+/g, ' '));
  const heroMessage = inferHero(sentences);
  const valueProposition = inferValueProposition(sentences);
  const businessSummary =
    (sentences.slice(0, 2).join(' ').slice(0, 280) || `${domainRoot} offers services in ${industry}.`).trim();

  return {
    heroMessage,
    extractedCta: inferCta(cleaned),
    industry,
    businessSummary,
    audience,
    tone: inferTone(cleaned),
    valueProposition,
    pillars: inferPillars(industry),
    persona: {
      title: industry === 'Technology & SaaS' ? 'Growth & Product Leader' : 'Business Decision Maker',
      description: `A practical buyer evaluating ${domainRoot}'s solution for measurable outcomes and lower execution risk.`,
    },
  };
}

function normalizeBrandSummary(brandSummary: any): {
  industry: string;
  audience: string;
  tone: string;
  valueProposition: string;
  pillars: string[];
  businessSummary: string;
} {
  const industry = String(brandSummary?.industry || 'Business Services');
  const audience = String(brandSummary?.audience || 'General business audience');
  const tone = String(brandSummary?.tone || 'Professional, practical, confident');
  const valueProposition = String(
    brandSummary?.valueProposition || 'Delivers clear outcomes with less complexity and faster execution.',
  );
  const pillars = Array.isArray(brandSummary?.pillars) && brandSummary.pillars.length > 0
    ? brandSummary.pillars.map((pillar: unknown) => String(pillar))
    : inferPillars(industry);
  const businessSummary = String(
    brandSummary?.businessSummary || `A company operating in ${industry} for ${audience}.`,
  );

  return { industry, audience, tone, valueProposition, pillars, businessSummary };
}

function fallbackIdeas(brandSummary: any): ContentIdea[] {
  const normalized = normalizeBrandSummary(brandSummary);
  const formats = ['LinkedIn Post', 'Blog Article', 'Email Newsletter', 'Twitter Thread', 'LinkedIn Carousel'];

  return normalized.pillars.slice(0, 5).map((pillar, index) => ({
    topic: `${pillar}: Practical playbook for ${normalized.audience}`,
    angle: `Break down one high-impact challenge in ${normalized.industry} and show a clear execution path. Tie it back to: ${normalized.valueProposition}`,
    format: formats[index] || 'LinkedIn Post',
    pillar,
  }));
}

function summarizeMarketMetricContext(marketMatrices: any): string {
  const charts = Array.isArray(marketMatrices?.charts) ? marketMatrices.charts : [];
  const summary = {
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

      return {
        chart_name: sanitizeText(String(chart?.chart_name || '')).slice(0, 90),
        x_axis: sanitizeText(String(chart?.axes?.x || '')).slice(0, 40),
        y_axis: sanitizeText(String(chart?.axes?.y || '')).slice(0, 40),
        market_pattern: sanitizeText(String(chart?.summary?.market_pattern || '')).slice(0, 260),
        positioning_opportunity: sanitizeText(
          String(chart?.summary?.positioning_opportunity || ''),
        ).slice(0, 260),
        top_competitor_signals: topSignals,
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

function fallbackDraft(brandSummary: any, topic: string, context: string, channel: string): string {
  const normalized = normalizeBrandSummary(brandSummary);
  const hashtags = [
    `#${normalized.industry.replace(/[^a-z0-9]+/gi, '')}`,
    '#Growth',
    '#Marketing',
  ];

  const intro = `Topic: ${topic}\nAudience: ${normalized.audience}\nTone: ${normalized.tone}`;
  const body = `Most teams in ${normalized.industry} lose momentum because execution is fragmented.\n\n${normalized.businessSummary}\n\nPractical next step:\n1) Clarify the single outcome for this week.\n2) Prioritize one channel and one message.\n3) Measure response and iterate quickly.`;
  const close = context
    ? `\n\nContext to include: ${context}\n\n${hashtags.join(' ')}`
    : `\n\n${hashtags.join(' ')}`;

  if (String(channel).toUpperCase().includes('EMAIL')) {
    return `${intro}\n\n${body}\n\nReply with your biggest blocker and we can share a focused plan.${close}`;
  }

  if (String(channel).toUpperCase().includes('BLOG')) {
    return `${topic}\n\n${body}\n\nWhy this works:\n- It reduces noise\n- It tightens feedback loops\n- It creates repeatable growth${close}`;
  }

  return `${intro}\n\n${body}${close}`;
}

function fallbackCompetitors(brandSummary: any): CompetitorExtraction[] {
  // Avoid synthetic competitor entries. Real competitors should come from model/search actions.
  void brandSummary;
  return [];
}

function fallbackPositioning(brandSummary: any, competitors: any[]): PositioningInsights {
  const normalized = normalizeBrandSummary(brandSummary);
  const competitorCount = Array.isArray(competitors) ? competitors.length : 0;

  return {
    positioningOpportunity: `Most of the ${competitorCount || 'current'} competitors appear to compete on similar claims. Your opportunity is to own a clearer promise around ${normalized.valueProposition.toLowerCase()}.`,
    messagingDifferentiation: `Lead with concrete outcomes for ${normalized.audience} and show a simple, low-friction path to value. Avoid generic category claims and emphasize specific proof points.`,
  };
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

function normalizeBrandExtraction(
  candidate: Partial<BrandExtraction> | null,
  url: string,
  htmlText: string,
): BrandExtraction {
  const fallback = fallbackBrandExtraction(url, htmlText);
  const safe = candidate || {};

  const heroMessage = sanitizeText(String(safe.heroMessage || ''));
  const extractedCta = sanitizeText(String(safe.extractedCta || ''));
  const industry = sanitizeText(String(safe.industry || ''));
  const businessSummary = sanitizeText(String(safe.businessSummary || ''));
  const audience = sanitizeText(String(safe.audience || ''));
  const tone = sanitizeText(String(safe.tone || ''));
  const valueProposition = sanitizeText(String(safe.valueProposition || ''));

  const pillarsRaw = Array.isArray(safe.pillars) ? safe.pillars : [];
  const pillars = pillarsRaw
    .map((item) => sanitizeText(String(item)))
    .filter((item) => !isScrapeJunkLine(item))
    .slice(0, 5);

  const personaTitle = sanitizeText(String(safe.persona?.title || ''));
  const personaDescription = sanitizeText(String(safe.persona?.description || ''));

  return {
    heroMessage: heroMessage && !isScrapeJunkLine(heroMessage) ? heroMessage : fallback.heroMessage,
    extractedCta: extractedCta && !isScrapeJunkLine(extractedCta) ? extractedCta : fallback.extractedCta,
    industry: industry || fallback.industry,
    businessSummary:
      businessSummary && !isScrapeJunkLine(businessSummary) ? businessSummary : fallback.businessSummary,
    audience: audience && !isScrapeJunkLine(audience) ? audience : fallback.audience,
    tone: tone || fallback.tone,
    valueProposition:
      valueProposition && !isScrapeJunkLine(valueProposition)
        ? valueProposition
        : fallback.valueProposition,
    pillars: pillars.length > 0 ? pillars : fallback.pillars,
    persona: {
      title: personaTitle || fallback.persona.title,
      description: personaDescription || fallback.persona.description,
    },
  };
}

export async function analyzeWebsiteWithGemini(url: string, htmlText: string): Promise<BrandExtraction | null> {
  const prompt = `
You are an expert Brand Strategist and Marketing Analyst.
I am providing you with the scraped text from a company's website (${url}).

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

  const gemini = await callGemini(prompt, true);
  if (gemini.ok && gemini.text) {
    const parsed = safeJsonParse<BrandExtraction>(gemini.text);
    if (parsed) return normalizeBrandExtraction(parsed, url, htmlText);
  }

  const openAi = await callOpenAi(
    prompt,
    true,
    'You are an expert Brand Strategist. Return only valid JSON for the requested schema.',
  );
  if (openAi.ok && openAi.text) {
    const parsed = safeJsonParse<BrandExtraction>(openAi.text);
    if (parsed) return normalizeBrandExtraction(parsed, url, htmlText);
  }

  logFallback('analyzeWebsiteWithGemini', gemini.status, openAi.status);
  return normalizeBrandExtraction(null, url, htmlText);
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
  requestedIdeaCount?: number;
  maxIdeaCount?: number;
  includeImages?: boolean;
  imageCount?: number;
  autoInsertToCalendar?: boolean;
  marketMatrices?: any;
  competitorKeywordsIntel?: any;
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
  const fallback = fallbackIdeas(brandSummary);
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
      pillar: pillar || normalized.pillars[result.length % normalized.pillars.length] || 'General',
      brand_anchor:
        brandAnchor || `Brand signal: ${sanitizeText(normalized.valueProposition).slice(0, 160)}`,
      market_anchor:
        marketAnchor || `Market signal: ${sanitizeText(anchorDefaults?.marketAnchor || '').slice(0, 160)}`,
      keyword_anchor:
        keywordAnchor || `Keyword signal: ${sanitizeText(anchorDefaults?.keywordAnchor || '').slice(0, 160)}`,
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

  if (result.length >= count) return result.slice(0, count);

  const needed = count - result.length;
  return [
    ...result,
    ...fallback.slice(0, needed).map((idea) => ({
      ...idea,
      brand_anchor: anchorDefaults?.brandAnchor || `Brand signal: ${normalized.valueProposition}`,
      market_anchor: anchorDefaults?.marketAnchor || 'Market signal inferred from competitive matrices.',
      keyword_anchor:
        anchorDefaults?.keywordAnchor || 'Keyword signal inferred from competitor keyword analysis.',
      include_images: includeImages,
      image_count: includeImages ? imageCount : 0,
      image_briefs: [],
      auto_insert_to_calendar: autoInsertToCalendar,
    })),
  ];
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
}): string {
  return `
You are Contivo Framework Engine.
Generate high-quality content ideas using the selected framework and return ONLY valid JSON.

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

async function generateIdeasWithFramework(
  brandSummary: any,
  frameworkSelection: ReturnType<typeof selectFramework>,
  requestedIdeaCount: number,
  mediaConfig: {
    includeImages: boolean;
    imageCount: number;
    autoInsertToCalendar: boolean;
  },
  context: { goal: string; platform: string; funnelStage: string },
  intelligenceContext: {
    marketMetricContext: string;
    competitorKeywordContext: string;
    defaultBrandAnchor: string;
    defaultMarketAnchor: string;
    defaultKeywordAnchor: string;
  },
): Promise<{
  ideas: ContentIdea[];
  qualityScores: FrameworkQualityScores;
  geminiStatus: number;
  openAiStatus: number;
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
  });

  const gemini = await callGemini(prompt, true);
  if (gemini.ok && gemini.text) {
    const parsed = safeJsonParse<{ ideas?: unknown; quality_scores?: Partial<FrameworkQualityScores> }>(gemini.text);
    if (parsed?.ideas) {
      return {
        ideas: normalizeIdeas(parsed.ideas, brandSummary, requestedIdeaCount, mediaConfig, {
          brandAnchor: intelligenceContext.defaultBrandAnchor,
          marketAnchor: intelligenceContext.defaultMarketAnchor,
          keywordAnchor: intelligenceContext.defaultKeywordAnchor,
        }),
        qualityScores: normalizeQualityScores(parsed.quality_scores),
        geminiStatus: gemini.status,
        openAiStatus: 0,
      };
    }
  }

  const openAi = await callOpenAi(
    prompt,
    true,
    'You are Contivo Framework Engine. Return only valid JSON using the exact schema.',
  );
  if (openAi.ok && openAi.text) {
    const parsed = safeJsonParse<{ ideas?: unknown; quality_scores?: Partial<FrameworkQualityScores> }>(openAi.text);
    if (parsed?.ideas) {
      return {
        ideas: normalizeIdeas(parsed.ideas, brandSummary, requestedIdeaCount, mediaConfig, {
          brandAnchor: intelligenceContext.defaultBrandAnchor,
          marketAnchor: intelligenceContext.defaultMarketAnchor,
          keywordAnchor: intelligenceContext.defaultKeywordAnchor,
        }),
        qualityScores: normalizeQualityScores(parsed.quality_scores),
        geminiStatus: gemini.status,
        openAiStatus: openAi.status,
      };
    }
  }

  logFallback('generateIdeasWithFramework', gemini.status, openAi.status);
  return null;
}

export async function generateContentIdeasWithGemini(
  brandSummary: any,
  options?: IdeationRequestOptions,
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
  const normalizedBrand = normalizeBrandSummary(brandSummary);
  const intelligenceContext = {
    marketMetricContext: summarizeMarketMetricContext(marketMatrices),
    competitorKeywordContext: summarizeCompetitorKeywordContext(competitorKeywordsIntel),
    defaultBrandAnchor: `Brand signal: ${sanitizeText(normalizedBrand.valueProposition).slice(0, 180)}`,
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
    { goal, platform, funnelStage },
    intelligenceContext,
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
          { goal, platform, funnelStage },
          intelligenceContext,
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

  const fallbackScores = normalizeQualityScores({
    brand_fit: 6.6,
    audience_fit: 6.4,
    goal_fit: 6.5,
    platform_fit: 6.4,
    clarity_usefulness: 6.3,
    overall_score: 6.44,
  });
  const fallbackIdeasList = applyIdeaMeta(
    fallbackIdeas(brandSummary)
      .slice(0, requestedIdeaCount)
      .map((idea) => ({
        ...idea,
        brand_anchor: intelligenceContext.defaultBrandAnchor,
        market_anchor: intelligenceContext.defaultMarketAnchor,
        keyword_anchor: intelligenceContext.defaultKeywordAnchor,
      })),
    {
      frameworkId: selection.framework_id,
      frameworkName: selection.framework_name,
      frameworkCategory: selection.framework_category,
      selectionMode: selection.selection_mode,
      selectionReason: `${selection.selection_reason} Generated via heuristic fallback.`,
      qualityScores: fallbackScores,
      fallbackUsed: false,
      fallbackFrameworkId: null,
    },
  );
  const fallbackWithMedia = fallbackIdeasList.map((idea) => ({
    ...idea,
    include_images: includeImages,
    image_count: includeImages ? imageCount : 0,
    image_briefs: [],
    auto_insert_to_calendar: autoInsertToCalendar,
  }));

  return {
    ideas: fallbackWithMedia,
    framework: {
      framework_id: selection.framework_id,
      framework_name: selection.framework_name,
      framework_category: selection.framework_category,
      selection_mode: selection.selection_mode,
      selection_reason: `${selection.selection_reason} Generated via heuristic fallback.`,
    },
    quality_scores: fallbackScores,
    fallback_used: false,
    fallback_framework_id: null,
  };
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
): Promise<string | null> {
  const frameworkId = String(frameworkContext?.frameworkId || '').trim();
  const frameworkGuide =
    frameworkId && frameworkId in FRAMEWORK_LABELS
      ? getFrameworkGuidance(frameworkId as FrameworkId)
      : '';
  const wordCountTarget = Number(frameworkContext?.wordCount?.target || 0);
  const wordCountMin = Number(frameworkContext?.wordCount?.min || 0);
  const wordCountMax = Number(frameworkContext?.wordCount?.max || 0);
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

Brand Strategy Profile:
${JSON.stringify(brandSummary, null, 2)}

Topic: ${topic}
Additional Context/Angle: ${context}
Target Channel: ${channel}
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
`;

  const gemini = await callGemini(prompt, false);
  if (gemini.ok && gemini.text) {
    return gemini.text;
  }

  const openAi = await callOpenAi(
    prompt,
    false,
    'You are an expert copywriter. Output only the final content with no preface.',
  );
  if (openAi.ok && openAi.text) {
    return openAi.text;
  }

  logFallback('generateContentDraftWithGemini', gemini.status, openAi.status);
  return fallbackDraft(brandSummary, topic, context, channel);
}

export interface CompetitorExtraction {
  name: string;
  domain: string;
  description: string;
  category: string;
  audienceGuess: string;
}

export async function discoverCompetitorsWithGemini(brandSummary: any): Promise<CompetitorExtraction[] | null> {
  const prompt = `
You are an expert Market Analyst. Determine 5 to 8 potential competitors for the following brand. 
Output ONLY a raw JSON array matching the required schema. Do not use markdown formatting.

Brand Strategy Profile:
${JSON.stringify(brandSummary, null, 2)}

Required Schema: An array of objects, where each object has these keys:
- "name": Company name.
- "domain": The website domain (e.g., "acme.com").
- "description": A 1-2 sentence description of what they do.
- "category": The market category they belong to.
- "audienceGuess": A description of their target audience.
`;

  const gemini = await callGemini(prompt, true);
  if (gemini.ok && gemini.text) {
    const parsed = safeJsonParse<CompetitorExtraction[]>(gemini.text);
    if (parsed && parsed.length > 0) return parsed;
  }

  const openAi = await callOpenAi(
    prompt,
    true,
    'You are an expert market analyst. Return only a valid JSON array of real competitors.',
  );
  if (openAi.ok && openAi.text) {
    const parsed = safeJsonParse<CompetitorExtraction[]>(openAi.text);
    if (parsed && parsed.length > 0) return parsed;
  }

  logFallback('discoverCompetitorsWithGemini', gemini.status, openAi.status);
  return fallbackCompetitors(brandSummary);
}

export interface PositioningInsights {
  positioningOpportunity: string;
  messagingDifferentiation: string;
}

export async function generatePositioningInsights(
  brandSummary: any,
  competitors: any[],
): Promise<PositioningInsights | null> {
  const prompt = `
You are an expert Brand Strategist and Marketing Analyst.
Review the following user brand's preliminary profile and a list of their validated competitors in the market.

User Brand Profile:
${JSON.stringify(brandSummary, null, 2)}

Validated Competitors:
${JSON.stringify(competitors, null, 2)}

Analyze the competitors to identify gaps and opportunities. Output ONLY a raw JSON object matching the requested schema. Do not use markdown.

Required Schema:
- "positioningOpportunity": A 2-sentence description of where the user's brand can uniquely position itself (e.g. "Most competitors focus on feature depth. Your opportunity: simplicity and speed.").
- "messagingDifferentiation": A sharp, 1-2 sentence recommendation for differentiation (e.g. "Competitors emphasize automation. Your messaging should emphasize strategic thinking.").
`;

  const gemini = await callGemini(prompt, true);
  if (gemini.ok && gemini.text) {
    const parsed = safeJsonParse<PositioningInsights>(gemini.text);
    if (parsed) return parsed;
  }

  const openAi = await callOpenAi(
    prompt,
    true,
    'You are an expert brand strategist. Return only valid JSON with the required keys.',
  );
  if (openAi.ok && openAi.text) {
    const parsed = safeJsonParse<PositioningInsights>(openAi.text);
    if (parsed) return parsed;
  }

  logFallback('generatePositioningInsights', gemini.status, openAi.status);
  return fallbackPositioning(brandSummary, competitors);
}

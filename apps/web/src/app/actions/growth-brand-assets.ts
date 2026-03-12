'use server';

import { randomUUID } from 'node:crypto';

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

export type BrandAssetStatus = 'pending_review' | 'approved' | 'rejected';
export type BrandAssetSource = 'ai_scraped' | 'manual' | 'uploaded';

export type BrandAsset = {
  id: string;
  asset_type: string;
  asset_category:
    | 'visual_identity'
    | 'messaging'
    | 'voice_and_tone'
    | 'products_and_services'
    | 'audience'
    | 'strategy_assets'
    | 'uploaded_files';
  title: string;
  content: string;
  source: BrandAssetSource;
  source_url: string;
  confidence_score: number;
  status: BrandAssetStatus;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

type BrandAssetGroups = {
  visual_identity: BrandAsset[];
  messaging: BrandAsset[];
  voice_and_tone: BrandAsset[];
  products_and_services: BrandAsset[];
  audience: BrandAsset[];
  strategy_assets: BrandAsset[];
  uploaded_files: BrandAsset[];
};

const CATEGORY_MAP: Array<[keyof BrandAssetGroups, BrandAsset['asset_category']]> = [
  ['visual_identity', 'visual_identity'],
  ['messaging', 'messaging'],
  ['voice_and_tone', 'voice_and_tone'],
  ['products_and_services', 'products_and_services'],
  ['audience', 'audience'],
  ['strategy_assets', 'strategy_assets'],
  ['uploaded_files', 'uploaded_files'],
];

export type BrandAssetsPayload = {
  generated_at: string;
  source: 'AI' | 'MANUAL';
  review_required: boolean;
  summary: {
    brand_clarity_score: number;
    asset_count: number;
    review_required: boolean;
  };
  brand_assets: BrandAssetGroups;
  versions: Array<{
    id: string;
    generated_at: string;
    source: 'AI' | 'MANUAL';
    summary: {
      brand_clarity_score: number;
      asset_count: number;
      review_required: boolean;
    };
  }>;
  token_usage: TokenUsage;
};

function trimTo(value: unknown, max = 500): string {
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

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
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

function clampScore(value: unknown, min = 0, max = 10): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
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

function extractSignalsFromHtml(html: string): string[] {
  const out: string[] = [];

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) out.push(sanitizeText(decodeHtmlEntities(title)));

  const description =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];
  if (description) out.push(sanitizeText(decodeHtmlEntities(description)));

  const regex = /<(h1|h2|h3|a|li|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const text = sanitizeText(decodeHtmlEntities(String(match[2] || '').replace(/<[^>]+>/g, ' ')));
    if (text.length >= 8) out.push(text);
    if (out.length >= 300) break;
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
    if (filtered.length >= 220) break;
  }
  return filtered;
}

function normalizeHexColor(value: string): string | null {
  const raw = String(value || '').trim().toLowerCase();
  const match = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`;
  }
  return raw;
}

function resolveUrl(raw: string, pageUrl: string): string {
  const source = String(raw || '').trim().replace(/&amp;/g, '&');
  if (!source || source.startsWith('data:')) return '';
  try {
    if (source.startsWith('//')) return `https:${source}`;
    return new URL(source, pageUrl).toString();
  } catch {
    return '';
  }
}

function isLikelyImageUrl(url: string): boolean {
  return /\.(svg|png|jpe?g|webp|gif|ico)(\?|$)/i.test(url);
}

function isNeutralColor(hex: string): boolean {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return false;
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  const range = Math.max(r, g, b) - Math.min(r, g, b);
  return range <= 8;
}

function pickPaletteFromFrequency(colorFrequency: Map<string, number>): string[] {
  const sorted = [...colorFrequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color]) => color)
    .filter((color) => color !== '#ffffff' && color !== '#000000');
  const nonNeutral = sorted.filter((color) => !isNeutralColor(color));
  const neutral = sorted.filter((color) => isNeutralColor(color));
  return [...nonNeutral.slice(0, 6), ...neutral.slice(0, 2)].slice(0, 8);
}

function extractVisualDetections(html: string, pageUrl: string): {
  logoUrls: string[];
  faviconUrl: string | null;
  colorCounts: Record<string, number>;
} {
  const logoSet = new Set<string>();
  const colorCounts: Record<string, number> = {};
  let faviconUrl: string | null = null;

  const colorMatches = html.match(/#(?:[0-9a-fA-F]{3}){1,2}\b/g) || [];
  for (const match of colorMatches) {
    const normalized = normalizeHexColor(match);
    if (!normalized) continue;
    colorCounts[normalized] = (colorCounts[normalized] || 0) + 1;
  }

  const iconRegex = /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
  let iconMatch: RegExpExecArray | null = iconRegex.exec(html);
  while (iconMatch) {
    const resolved = resolveUrl(iconMatch[1] || '', pageUrl);
    if (resolved && !faviconUrl) faviconUrl = resolved;
    if (resolved && isLikelyImageUrl(resolved)) logoSet.add(resolved);
    iconMatch = iconRegex.exec(html);
  }

  const ogImageRegex = /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image|og:logo)["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
  let ogMatch: RegExpExecArray | null = ogImageRegex.exec(html);
  while (ogMatch) {
    const resolved = resolveUrl(ogMatch[1] || '', pageUrl);
    if (resolved && isLikelyImageUrl(resolved)) logoSet.add(resolved);
    ogMatch = ogImageRegex.exec(html);
  }

  const imgRegex = /<img[^>]*>/gi;
  let imgMatch: RegExpExecArray | null = imgRegex.exec(html);
  while (imgMatch) {
    const tag = imgMatch[0] || '';
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1] || '';
    const alt = (tag.match(/\salt=["']([^"']+)["']/i)?.[1] || '').toLowerCase();
    const classOrId = `${tag.match(/\sclass=["']([^"']+)["']/i)?.[1] || ''} ${
      tag.match(/\sid=["']([^"']+)["']/i)?.[1] || ''
    }`.toLowerCase();
    const srcLower = src.toLowerCase();
    const isLogoLike =
      /logo|brand|mark|icon|favicon/.test(alt) ||
      /logo|brand|mark|icon|favicon/.test(classOrId) ||
      /logo|brand|mark|icon|favicon/.test(srcLower);
    if (isLogoLike) {
      const resolved = resolveUrl(src, pageUrl);
      if (resolved && isLikelyImageUrl(resolved)) logoSet.add(resolved);
    }
    imgMatch = imgRegex.exec(html);
  }

  const genericLogoRegex = /(?:src|href)=["']([^"']*(?:logo|brandmark|favicon)[^"']*\.(?:svg|png|jpg|jpeg|webp|ico)[^"']*)["']/gi;
  let genericMatch: RegExpExecArray | null = genericLogoRegex.exec(html);
  while (genericMatch) {
    const resolved = resolveUrl(genericMatch[1] || '', pageUrl);
    if (resolved && isLikelyImageUrl(resolved)) logoSet.add(resolved);
    genericMatch = genericLogoRegex.exec(html);
  }

  return {
    logoUrls: [...logoSet].slice(0, 20),
    faviconUrl,
    colorCounts,
  };
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

async function collectBrandAssetSignals(website: string): Promise<{
  domain: string;
  pages_scanned: string[];
  textual_evidence: string;
  visual_evidence: string;
  palette_colors: string[];
  logo_urls: string[];
  favicon_url: string | null;
}> {
  const domain = normalizeDomain(website);
  const paths = [
    '/',
    '/about',
    '/products',
    '/services',
    '/solutions',
    '/features',
    '/pricing',
    '/use-cases',
    '/platform',
  ];

  const pages_scanned: string[] = [];
  const textLines: string[] = [];
  const visualLines: string[] = [];
  const logoSet = new Set<string>();
  const colorFrequency = new Map<string, number>();
  let faviconUrl: string | null = null;

  for (const path of paths) {
    const url = `https://${domain}${path}`;
    const html = await fetchHtml(url);
    if (!html) continue;

    const lines = extractSignalsFromHtml(html);
    const visuals = extractVisualDetections(html, url);
    const visualCount = Object.keys(visuals.colorCounts).length + visuals.logoUrls.length + Number(Boolean(visuals.faviconUrl));
    if (lines.length === 0 && visualCount === 0) continue;

    pages_scanned.push(path);
    textLines.push(...lines.slice(0, 50));

    for (const logoUrl of visuals.logoUrls) {
      if (!logoSet.has(logoUrl)) {
        logoSet.add(logoUrl);
        visualLines.push(`logo_url: ${logoUrl}`);
      }
    }
    if (!faviconUrl && visuals.faviconUrl) faviconUrl = visuals.faviconUrl;
    if (visuals.faviconUrl) visualLines.push(`favicon: ${visuals.faviconUrl}`);
    for (const [color, count] of Object.entries(visuals.colorCounts)) {
      colorFrequency.set(color, (colorFrequency.get(color) || 0) + count);
    }
    if (textLines.length >= 420) break;
  }

  const paletteColors = pickPaletteFromFrequency(colorFrequency);
  for (const color of paletteColors) {
    visualLines.push(`brand_color: ${color}`);
  }
  if (faviconUrl) logoSet.add(faviconUrl);

  return {
    domain,
    pages_scanned,
    textual_evidence: textLines.join('\n').slice(0, 20000),
    visual_evidence: visualLines.join('\n').slice(0, 5000),
    palette_colors: paletteColors,
    logo_urls: [...logoSet].slice(0, 12),
    favicon_url: faviconUrl,
  };
}

function buildPrompt(input: {
  companyName: string;
  website: string;
  brandSummary: any;
  offeringsIntel: any;
  pagesScanned: string[];
  textualEvidence: string;
  visualEvidence: string;
  paletteColors: string[];
  logoCandidates: string[];
  faviconUrl: string | null;
}): string {
  return `
You are a brand intelligence analyst.

Task:
Analyze website evidence and extract a structured brand asset library used for content/design consistency.
Do not hallucinate or invent unsupported claims.
Only use visible evidence.

Input:
${JSON.stringify(input, null, 2)}

Rules:
- mark all AI extracted assets with status "pending_review"
- keep confidence lower when evidence is weak
- keep assets concise and reusable
- do not return generic summary paragraphs as asset content

Return JSON only:
{
  "brand_assets": {
    "visual_identity": [],
    "messaging": [],
    "voice_and_tone": [],
    "products_and_services": [],
    "audience": [],
    "strategy_assets": []
  },
  "summary": {
    "brand_clarity_score": 0,
    "asset_count": 0,
    "review_required": true
  }
}

Each asset item:
{
  "asset_type": "",
  "asset_category": "visual_identity|messaging|voice_and_tone|products_and_services|audience|strategy_assets",
  "title": "",
  "content": "",
  "source_url": "",
  "confidence_score": 0.0,
  "status": "pending_review",
  "is_primary": false
}
`;
}

async function callOpenAiJson(prompt: string): Promise<{
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
            content: 'Be precise. Use only provided evidence. Return only valid JSON.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.15,
      }),
    });

    if (!res.ok) {
      console.error('OpenAI brand assets request error:', await res.text());
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
    } catch (error) {
      console.error('OpenAI brand assets parse error:', error);
      return { parsed: null, usage };
    }
  } catch (error) {
    console.error('OpenAI brand assets call failed:', error);
    return null;
  }
}

function emptyGroups(): BrandAssetGroups {
  return {
    visual_identity: [],
    messaging: [],
    voice_and_tone: [],
    products_and_services: [],
    audience: [],
    strategy_assets: [],
    uploaded_files: [],
  };
}

function buildVersionTrail(previous: BrandAssetsPayload | null): BrandAssetsPayload['versions'] {
  return [
    ...(previous?.versions || []),
    ...(previous
      ? [
          {
            id: randomUUID(),
            generated_at: previous.generated_at,
            source: previous.source,
            summary: previous.summary,
          },
        ]
      : []),
  ].slice(-20);
}

function normalizeCategory(value: unknown): BrandAsset['asset_category'] {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'visual_identity') return 'visual_identity';
  if (normalized === 'messaging') return 'messaging';
  if (normalized === 'voice_and_tone') return 'voice_and_tone';
  if (normalized === 'products_and_services' || normalized === 'offers') return 'products_and_services';
  if (normalized === 'audience') return 'audience';
  if (normalized === 'strategy_assets' || normalized === 'strategy') return 'strategy_assets';
  if (normalized === 'uploaded_files' || normalized === 'uploaded_reference') return 'uploaded_files';
  return 'messaging';
}

function normalizeStatus(value: unknown): BrandAssetStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'approved') return 'approved';
  if (normalized === 'rejected') return 'rejected';
  return 'pending_review';
}

function normalizeSource(value: unknown): BrandAssetSource {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'manual') return 'manual';
  if (normalized === 'uploaded') return 'uploaded';
  return 'ai_scraped';
}

function normalizeAssetItem(
  item: any,
  fallbackCategory: BrandAsset['asset_category'],
  sourceDefault: BrandAssetSource,
): BrandAsset | null {
  const title = trimTo(item?.title, 140);
  const content = trimTo(item?.content, 900);
  if (!title && !content) return null;

  const now = new Date().toISOString();
  return {
    id: trimTo(item?.id, 80) || randomUUID(),
    asset_type: trimTo(item?.asset_type, 80) || 'brand_note',
    asset_category: normalizeCategory(item?.asset_category || fallbackCategory),
    title: title || trimTo(item?.asset_type, 80) || 'Untitled asset',
    content,
    source: normalizeSource(item?.source || sourceDefault),
    source_url: trimTo(item?.source_url, 280),
    confidence_score: clampConfidence(item?.confidence_score),
    status: normalizeStatus(item?.status),
    is_primary: Boolean(item?.is_primary),
    created_at: trimTo(item?.created_at, 80) || now,
    updated_at: now,
  };
}

function normalizeAssetsPayload(raw: any, previous: BrandAssetsPayload | null): BrandAssetsPayload {
  const groups = emptyGroups();
  const rawGroups = raw?.brand_assets && typeof raw.brand_assets === 'object' ? raw.brand_assets : {};
  const now = new Date().toISOString();

  for (const [groupKey, category] of CATEGORY_MAP.filter(([key]) => key !== 'uploaded_files')) {
    const source = Array.isArray(rawGroups?.[groupKey]) ? rawGroups[groupKey] : [];
    const normalized: BrandAsset[] = [];
    const seen = new Set<string>();

    for (const item of source) {
      const candidate = normalizeAssetItem(item, category, 'ai_scraped');
      if (!candidate) continue;
      const dedupeKey = `${candidate.asset_type}:${candidate.title}:${candidate.content}`.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      normalized.push({
        ...candidate,
        status: 'pending_review',
        source: 'ai_scraped',
      });
      if (normalized.length >= 40) break;
    }

    groups[groupKey] = normalized;
  }

  if (previous?.brand_assets?.uploaded_files?.length) {
    groups.uploaded_files = previous.brand_assets.uploaded_files.map((item) => ({
      ...item,
      updated_at: now,
    }));
  }

  const assetCount = Object.values(groups).reduce((acc, arr) => acc + arr.length, 0);
  const summaryRaw = raw?.summary && typeof raw.summary === 'object' ? raw.summary : {};

  return {
    generated_at: now,
    source: 'AI',
    review_required: true,
    summary: {
      brand_clarity_score: clampScore(summaryRaw.brand_clarity_score, 0, 10),
      asset_count: assetCount,
      review_required: true,
    },
    brand_assets: groups,
    versions: buildVersionTrail(previous),
    token_usage: emptyTokenUsage(),
  };
}

function enrichVisualIdentityAssets(
  payload: BrandAssetsPayload,
  detections: {
    paletteColors: string[];
    logoUrls: string[];
    faviconUrl: string | null;
  },
): BrandAssetsPayload {
  const now = new Date().toISOString();
  const visualAssets = [...payload.brand_assets.visual_identity];
  const existingColorSet = new Set(
    visualAssets
      .map((asset) => normalizeHexColor(`${asset.content}`.match(/#([0-9a-f]{3}|[0-9a-f]{6})\b/i)?.[0] || ''))
      .filter(Boolean) as string[],
  );
  const existingLogoSet = new Set(
    visualAssets
      .map((asset) => `${asset.source_url} ${asset.content}`.match(/https?:\/\/[^\s"')]+/i)?.[0]?.toLowerCase() || '')
      .filter(Boolean),
  );

  let colorIndex = 1;
  for (const color of detections.paletteColors.slice(0, 8)) {
    const normalized = normalizeHexColor(color);
    if (!normalized || existingColorSet.has(normalized)) continue;
    visualAssets.push({
      id: randomUUID(),
      asset_type: 'color',
      asset_category: 'visual_identity',
      title: `Brand Color ${colorIndex}`,
      content: normalized,
      source: 'ai_scraped',
      source_url: '',
      confidence_score: 0.72,
      status: 'pending_review',
      is_primary: false,
      created_at: now,
      updated_at: now,
    });
    colorIndex += 1;
    existingColorSet.add(normalized);
  }

  const logoCandidates = [...detections.logoUrls];
  if (detections.faviconUrl) logoCandidates.push(detections.faviconUrl);
  let logoIndex = 1;
  for (const logoUrl of logoCandidates.slice(0, 8)) {
    const normalized = String(logoUrl || '').trim().toLowerCase();
    if (!normalized || existingLogoSet.has(normalized)) continue;
    const isFavicon = /\.ico(\?|$)/i.test(normalized) || normalized.includes('favicon');
    visualAssets.push({
      id: randomUUID(),
      asset_type: isFavicon ? 'favicon' : 'logo',
      asset_category: 'visual_identity',
      title: isFavicon ? 'Brand Favicon' : `Detected Logo ${logoIndex}`,
      content: '',
      source: 'ai_scraped',
      source_url: logoUrl,
      confidence_score: isFavicon ? 0.78 : 0.8,
      status: 'pending_review',
      is_primary: logoIndex === 1 && !isFavicon,
      created_at: now,
      updated_at: now,
    });
    if (!isFavicon) logoIndex += 1;
    existingLogoSet.add(normalized);
  }

  const nextAssets = visualAssets.slice(0, 80);
  const nextGroups = {
    ...payload.brand_assets,
    visual_identity: nextAssets,
  };
  const nextCount = Object.values(nextGroups).reduce((acc, list) => acc + list.length, 0);

  return {
    ...payload,
    brand_assets: nextGroups,
    summary: {
      ...payload.summary,
      asset_count: nextCount,
    },
  };
}

function normalizeManualAssetsPayload(raw: any, previous: BrandAssetsPayload | null): BrandAssetsPayload {
  const groups = emptyGroups();
  const rawGroups = raw?.brand_assets && typeof raw.brand_assets === 'object' ? raw.brand_assets : {};
  const now = new Date().toISOString();

  for (const [groupKey, category] of CATEGORY_MAP) {
    const source = Array.isArray(rawGroups?.[groupKey]) ? rawGroups[groupKey] : [];
    const normalized: BrandAsset[] = [];
    const seen = new Set<string>();

    for (const item of source) {
      const defaultSource: BrandAssetSource = groupKey === 'uploaded_files' ? 'uploaded' : 'manual';
      const candidate = normalizeAssetItem(item, category, defaultSource);
      if (!candidate) continue;

      const dedupeKey = `${candidate.asset_type}:${candidate.title}:${candidate.content}`.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      normalized.push({
        ...candidate,
        source: normalizeSource(item?.source || defaultSource),
        status: normalizeStatus(item?.status),
      });
      if (normalized.length >= 80) break;
    }

    groups[groupKey] = normalized;
  }

  const assetCount = Object.values(groups).reduce((acc, arr) => acc + arr.length, 0);
  const pendingReviewCount = Object.values(groups).reduce(
    (acc, arr) => acc + arr.filter((item) => item.status === 'pending_review').length,
    0,
  );
  const summaryRaw = raw?.summary && typeof raw.summary === 'object' ? raw.summary : {};
  const previousSummary = previous?.summary || null;

  return {
    generated_at: now,
    source: 'MANUAL',
    review_required: pendingReviewCount > 0,
    summary: {
      brand_clarity_score: clampScore(
        summaryRaw.brand_clarity_score ?? previousSummary?.brand_clarity_score ?? 0,
        0,
        10,
      ),
      asset_count: assetCount,
      review_required: pendingReviewCount > 0,
    },
    brand_assets: groups,
    versions: buildVersionTrail(previous),
    token_usage: normalizeTokenUsage(raw?.token_usage || previous?.token_usage),
  };
}

function mergeBrandAssetsInAudienceInsights(currentAudienceInsights: any, payload: BrandAssetsPayload): any {
  const current = currentAudienceInsights && typeof currentAudienceInsights === 'object' ? currentAudienceInsights : {};
  return {
    ...current,
    brandAssets: payload,
  };
}

export async function generateWorkspaceBrandAssets(workspaceId: string) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  if (!workspaceId) return { error: 'Workspace ID is required' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
    });
    if (!workspace) return { error: 'Workspace not found' };
    if (!workspace.websiteUrl) return { error: 'Workspace has no website URL.' };

    const signals = await collectBrandAssetSignals(workspace.websiteUrl);
    if (!signals.textual_evidence) {
      return { error: 'Could not collect enough website evidence for brand assets extraction.' };
    }

    const previousPayload = ((workspace.audienceInsights as any)?.brandAssets as BrandAssetsPayload) || null;
    const prompt = buildPrompt({
      companyName: workspace.name,
      website: normalizeWebsite(workspace.websiteUrl),
      brandSummary: workspace.brandSummary || {},
      offeringsIntel: (workspace.audienceInsights as any)?.productsServicesIntel || null,
      pagesScanned: signals.pages_scanned,
      textualEvidence: signals.textual_evidence,
      visualEvidence: signals.visual_evidence,
      paletteColors: signals.palette_colors,
      logoCandidates: signals.logo_urls,
      faviconUrl: signals.favicon_url,
    });

    const result = await callOpenAiJson(prompt);
    if (!result?.parsed) {
      return { error: 'AI could not produce brand assets from current evidence.' };
    }

    const payload = enrichVisualIdentityAssets(
      normalizeAssetsPayload(result.parsed, previousPayload),
      {
        paletteColors: signals.palette_colors,
        logoUrls: signals.logo_urls,
        faviconUrl: signals.favicon_url,
      },
    );
    const previousUsage = normalizeTokenUsage(previousPayload?.token_usage);
    payload.token_usage = appendTokenUsage(previousUsage, result.usage || null);

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        audienceInsights: mergeBrandAssetsInAudienceInsights(workspace.audienceInsights, payload),
      },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'BRAND_ASSETS_GENERATED',
      detail: {
        assetCount: payload.summary.asset_count,
        pagesScanned: signals.pages_scanned.length,
        totalTokens: payload.token_usage.last_run?.total_tokens || 0,
      },
    });

    return { success: true, payload };
  } catch (error) {
    console.error('generateWorkspaceBrandAssets failed:', error);
    return { error: 'Could not generate brand assets right now.' };
  }
}

export async function saveWorkspaceBrandAssetsEdits(
  workspaceId: string,
  payload: BrandAssetsPayload,
) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  if (!workspaceId) return { error: 'Workspace ID is required' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
    });
    if (!workspace) return { error: 'Workspace not found' };

    const previousPayload = ((workspace.audienceInsights as any)?.brandAssets as BrandAssetsPayload) || null;
    const normalized = normalizeManualAssetsPayload(payload, previousPayload);

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        audienceInsights: mergeBrandAssetsInAudienceInsights(workspace.audienceInsights, normalized),
      },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'BRAND_ASSETS_EDITED',
      detail: {
        assetCount: normalized.summary.asset_count,
      },
    });

    return { success: true, payload: normalized };
  } catch (error) {
    console.error('saveWorkspaceBrandAssetsEdits failed:', error);
    return { error: 'Could not save Brand Assets edits.' };
  }
}

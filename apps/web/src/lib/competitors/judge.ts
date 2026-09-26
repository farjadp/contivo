import { readTokenUsage } from './queries';
import type { BrandBrief } from './queries';
import { newEvidenceId } from './types';
import type {
  Candidate,
  CompetitorLabel,
  CompetitorType,
  EnrichedCandidate,
  EvidenceItem,
  JudgedCandidate,
} from './types';

export const MAX_ENRICHED = 20;

const ENRICH_CONCURRENCY = 5;
const JUDGE_BATCH_SIZE = 5;
const JUDGE_CONCURRENCY = 2;
const MAX_SITE_EVIDENCE_ITEMS = 3;

// ---------------------------------------------------------------------------
// collectWebsiteEvidence and its HTML helpers are COPIED (not moved) from
// `apps/web/src/app/actions/growth-competitors.ts` (around its
// `collectWebsiteEvidence` function). The brief for this task asked for a
// move, but `growth-competitors.ts` is a `'use server'` module with live
// callers in the current UI, and deleting a function it still uses would
// break the typecheck at this commit. Task 8 rewrites that file and deletes
// the originals then; until it does, this duplication is deliberate — the
// cheaper of two violations, not an oversight.
//
// This copy is extended beyond the original (see `collectWebsiteEvidence`
// below) to also surface each scanned page's `<title>` and the first
// `<html lang>` attribute found, which `enrichCandidates` needs and the
// original function's return shape didn't expose.
// ---------------------------------------------------------------------------

function normalizeDomain(value: string | null | undefined): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const withoutProtocol = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const domain = withoutProtocol.split('/')[0]?.toLowerCase().trim();
  return domain || null;
}

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
    .replace(/&gt;/gi, '>');
}

function extractSignalsFromHtml(html: string): string[] {
  const lines: string[] = [];

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) lines.push(sanitizeText(decodeHtmlEntities(title)));

  const description =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1] ||
    html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1];
  if (description) lines.push(sanitizeText(decodeHtmlEntities(description)));

  const regex = /<(h1|h2|h3|a|li|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    const text = sanitizeText(decodeHtmlEntities(String(match[2] || '').replace(/<[^>]+>/g, ' ')));
    if (text.length >= 10) lines.push(text);
    if (lines.length >= 240) break;
    match = regex.exec(html);
  }

  const unique = new Set<string>();
  const filtered: string[] = [];
  for (const line of lines) {
    const normalized = line.toLowerCase();
    if (!line || normalized.length < 8) continue;
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    filtered.push(line);
    if (filtered.length >= 160) break;
  }

  return filtered;
}

/** First `<title>` text on the page, decoded and whitespace-collapsed. */
export function extractTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? sanitizeText(decodeHtmlEntities(title)) : null;
}

/** The `<html lang="...">` attribute, lowercased, or null when absent. */
export function extractHtmlLangAttr(html: string): string | null {
  const lang = html.match(/<html[^>]*\blang=["']([^"']+)["']/i)?.[1];
  return lang ? lang.trim().toLowerCase() : null;
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

async function fetchHtmlForDomain(domain: string, path: string): Promise<{ url: string; html: string } | null> {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;

  const candidates = [`https://${normalizedDomain}${path}`, `http://${normalizedDomain}${path}`];
  for (const url of candidates) {
    const html = await fetchHtml(url);
    if (html) return { url, html };
  }

  return null;
}

type SiteEvidenceResult = {
  domain: string;
  pages: Array<{ url: string; title: string | null }>;
  evidence: string;
  htmlLang: string | null;
};

async function collectWebsiteEvidence(domain: string): Promise<SiteEvidenceResult> {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) {
    return { domain: '', pages: [], evidence: '', htmlLang: null };
  }

  const paths = ['/', '/about', '/services', '/solutions', '/products', '/pricing', '/blog'];
  const pages: Array<{ url: string; title: string | null }> = [];
  const evidenceLines: string[] = [];
  let htmlLang: string | null = null;

  for (const path of paths) {
    const response = await fetchHtmlForDomain(normalizedDomain, path);
    if (!response) continue;

    const signals = extractSignalsFromHtml(response.html);
    if (signals.length === 0) continue;

    pages.push({ url: response.url, title: extractTitle(response.html) });
    if (htmlLang === null) {
      htmlLang = extractHtmlLangAttr(response.html);
    }

    evidenceLines.push(`Page: ${response.url}`);
    evidenceLines.push(...signals.slice(0, 20));

    if (evidenceLines.length >= 140) break;
  }

  return {
    domain: normalizedDomain,
    pages,
    evidence: evidenceLines.slice(0, 140).join('\n'),
    htmlLang,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested without any network access)
// ---------------------------------------------------------------------------

/** Sort by `frequency` descending and take the top `max`. */
export function pickTopCandidates(candidates: Candidate[], max: number): Candidate[] {
  return [...candidates].sort((a, b) => b.frequency - a.frequency).slice(0, max);
}

/** Arabic-Unicode-block heuristic: U+0600–U+06FF, matching the brief's /[؀-ۿ]/. */
const ARABIC_BLOCK = /[؀-ۿ]/g;

/**
 * `<html lang>` wins when present (reduced to its primary subtag, e.g.
 * "fa-IR" -> "fa"). Otherwise fall back to the Arabic-block heuristic: 'fa'
 * when more than 30% of the evidence text's characters fall in the Arabic
 * Unicode block, else 'en'.
 */
export function detectPageLanguage(htmlLang: string | null, evidenceText: string): string {
  if (htmlLang) {
    return htmlLang.split(/[-_]/)[0].toLowerCase();
  }

  const totalLength = evidenceText.length;
  if (totalLength === 0) return 'en';

  const arabicLength = (evidenceText.match(ARABIC_BLOCK) ?? []).length;
  return arabicLength / totalLength > 0.3 ? 'fa' : 'en';
}

/**
 * Build one `EnrichedCandidate` from a candidate and its collected site
 * evidence, or `null` when the site was unreachable (no pages scanned) —
 * this is the replacement for the old DNS check: an unreachable candidate
 * has no evidence to judge, so it is dropped rather than guessed at.
 */
export function buildEnrichedCandidate(
  candidate: Candidate,
  site: Pick<SiteEvidenceResult, 'pages' | 'evidence' | 'htmlLang'>,
): EnrichedCandidate | null {
  if (site.pages.length === 0) return null;

  const pageLanguage = detectPageLanguage(site.htmlLang, site.evidence);
  const siteTitle = site.pages[0]?.title ?? null;

  const siteEvidenceItems: EvidenceItem[] = site.pages.slice(0, MAX_SITE_EVIDENCE_ITEMS).map((page) => ({
    id: newEvidenceId(),
    kind: 'site',
    url: page.url,
    title: page.title ?? undefined,
  }));

  return {
    ...candidate,
    evidence: [...candidate.evidence, ...siteEvidenceItems],
    siteTitle,
    siteEvidence: site.evidence,
    pageLanguage,
  };
}

export function normalizeLabels(value: unknown): CompetitorLabel[] {
  if (!Array.isArray(value)) return [];
  const labels: CompetitorLabel[] = [];
  for (const item of value) {
    if (item === 'SEO' || item === 'BUSINESS') labels.push(item);
  }
  return labels;
}

export function normalizeJudgedType(value: unknown): CompetitorType {
  if (value === 'INDIRECT') return 'INDIRECT';
  if (value === 'ASPIRATIONAL') return 'ASPIRATIONAL';
  return 'DIRECT';
}

/** Force `isCompetitor` to false when the model returned no labels at all. */
export function forceIsCompetitorFalseWhenLabelsEmpty(isCompetitor: boolean, labels: CompetitorLabel[]): boolean {
  return labels.length === 0 ? false : isCompetitor;
}

/** Run `tasks` with at most `concurrency` in flight at once. Mirrors ./search's runWithConcurrency, generalized over item/result type. */
async function runWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// enrichCandidates
// ---------------------------------------------------------------------------

export async function enrichCandidates(candidates: Candidate[]): Promise<EnrichedCandidate[]> {
  const top = pickTopCandidates(candidates, MAX_ENRICHED);

  const results = await runWithConcurrency(top, ENRICH_CONCURRENCY, async (candidate) => {
    const site = await collectWebsiteEvidence(candidate.domain);
    return buildEnrichedCandidate(candidate, site);
  });

  return results.filter((result): result is EnrichedCandidate => result !== null);
}

// ---------------------------------------------------------------------------
// judgeCandidates
// ---------------------------------------------------------------------------

/**
 * The judge's rules, reproduced verbatim from the task brief. These are the
 * quality gate of the whole feature: they guard against a model
 * confabulating a plausible-sounding justification (the "reason" rule) and
 * against live search's tendency to surface giants as if they were peers
 * (the scale rule). Do not paraphrase these — a reviewer must be able to
 * diff this string against the brief.
 */
const JUDGE_RULES = `You judge whether each candidate competes with the business described below.
Rules, applied strictly:
- Judge only from the evidence given. If the evidence does not show what the candidate sells, set isCompetitor false.
- "reason" must quote or reference something in that candidate's evidence. A reason that could be written without reading the evidence is invalid.
- Marketplaces, directories, review sites, news and blogs are not competitors unless they sell the same thing to the same buyer.
- Judge scale. If the candidate is far larger or far more established than the business, set scaleMatch false and type ASPIRATIONAL. Never DIRECT.
- "SEO" means it competes for the same searches. "BUSINESS" means it sells the same thing to the same buyer. Both can apply; at least one must, or isCompetitor is false.`;

/**
 * Confidence rubric, kept separate from `JUDGE_RULES` (which is reproduced
 * verbatim from the brief and must not be touched). Without this, the
 * `confidence` field is an unanchored float with no stated meaning — a live
 * run returned 1.0 for every candidate regardless of verdict, which makes
 * the number useless as the input to a keep-threshold or confidence bands.
 */
const CONFIDENCE_RUBRIC = `Score "confidence" using this rubric, applied strictly:
- Confidence describes how well the evidence pins down your isCompetitor call. It is not enthusiasm about the company, and a confident rejection is just as valid as a confident acceptance — a candidate you are sure is NOT a competitor also gets high confidence.
- Use 0.9 or higher only when the evidence explicitly and unambiguously shows the same product sold to the same buyer (or, for a rejection, unambiguously shows it is not).
- Use 0.6 to 0.8 when your call is a reasonable inference from what the site says, not a direct statement of it.
- Use below 0.6 when the evidence is thin, ambiguous, or leaves real doubt either way.
- 1.0 is not a default value. It should be rare. Do not give every candidate the same confidence — let the score actually vary with how certain the evidence makes you.`;

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          name: { type: 'string' },
          isCompetitor: { type: 'boolean' },
          labels: { type: 'array', items: { type: 'string', enum: ['SEO', 'BUSINESS'] } },
          type: { type: 'string', enum: ['DIRECT', 'INDIRECT', 'ASPIRATIONAL'] },
          scaleMatch: { type: 'boolean' },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description:
              'How well the evidence pins down the isCompetitor call, not enthusiasm about the company. 0.9+ only when the evidence explicitly and unambiguously settles it either way; 0.6-0.8 for a reasonable inference; below 0.6 when the evidence is thin or ambiguous. 1.0 is rare, never a default — vary the score with actual certainty.',
          },
          reason: { type: 'string' },
          positioning: { type: 'string' },
          keyFeatures: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: [
          'domain',
          'name',
          'isCompetitor',
          'labels',
          'type',
          'scaleMatch',
          'confidence',
          'reason',
          'positioning',
          'keyFeatures',
          'description',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
} as const;

function buildJudgePrompt(brief: BrandBrief, batch: EnrichedCandidate[]): string {
  const lines = [
    JUDGE_RULES,
    '',
    CONFIDENCE_RUBRIC,
    '',
    'Business being defended:',
    `- name: ${brief.companyName}`,
    `- summary: ${brief.summary}`,
    `- value proposition: ${brief.valueProposition}`,
    `- industry: ${brief.industry}`,
    `- audience: ${brief.audience}`,
    `- market: ${brief.market.country || 'unspecified'} / ${brief.market.language}`,
    '',
    'Judge each candidate below using only its own evidence. Return one entry per candidate in "results", keyed by its domain.',
    '',
  ];

  for (const candidate of batch) {
    lines.push(`Candidate domain: ${candidate.domain}`);
    lines.push(`Site title: ${candidate.siteTitle ?? '(none)'}`);
    lines.push(`Page language: ${candidate.pageLanguage ?? '(unknown)'}`);
    lines.push('Evidence:');
    lines.push(candidate.siteEvidence || '(no evidence text)');
    lines.push('');
  }

  return lines.join('\n');
}

type BatchOutcome = { judged: JudgedCandidate[]; tokens: number | null } | { error: string };

async function runOneBatch(
  brief: BrandBrief,
  batch: EnrichedCandidate[],
  apiKey: string,
  model: string,
): Promise<BatchOutcome> {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'competitor_judgments', strict: true, schema: JUDGE_SCHEMA },
        },
        messages: [
          {
            role: 'system',
            content: 'You are precise and evidence-based. Return only valid JSON matching the schema.',
          },
          { role: 'user', content: buildJudgePrompt(brief, batch) },
        ],
      }),
    });

    if (!res.ok) {
      return { error: `Judge batch failed: ${res.status} ${await res.text()}` };
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      return { error: 'Judge batch returned no content' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      // A response that will not parse is an error, not an approval — the
      // candidates in this batch are dropped, never defaulted to accepted.
      return { error: `Judge batch returned invalid JSON: ${(error as Error).message}` };
    }

    const rawResults = Array.isArray((parsed as Record<string, unknown>)?.results)
      ? ((parsed as Record<string, unknown>).results as unknown[])
      : null;
    if (!rawResults) {
      return { error: 'Judge batch response is missing a "results" array' };
    }

    const byDomain = new Map(batch.map((candidate) => [candidate.domain.toLowerCase(), candidate]));
    const judged: JudgedCandidate[] = [];

    for (const raw of rawResults) {
      const record = raw as Record<string, unknown>;
      const domain = typeof record.domain === 'string' ? record.domain.toLowerCase().trim() : '';
      const candidate = byDomain.get(domain);
      if (!candidate) continue; // unmatched result — never fabricate a candidate for it

      const labels = normalizeLabels(record.labels);
      const isCompetitor = forceIsCompetitorFalseWhenLabelsEmpty(Boolean(record.isCompetitor), labels);

      judged.push({
        ...candidate,
        name: typeof record.name === 'string' && record.name.trim() ? record.name.trim() : candidate.domain,
        isCompetitor,
        labels,
        type: normalizeJudgedType(record.type),
        scaleMatch: Boolean(record.scaleMatch),
        judgeConfidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence) ? record.confidence : 0,
        reason: typeof record.reason === 'string' ? record.reason : '',
        positioning: typeof record.positioning === 'string' ? record.positioning : null,
        keyFeatures: Array.isArray(record.keyFeatures)
          ? record.keyFeatures.filter((feature): feature is string => typeof feature === 'string')
          : [],
        description: typeof record.description === 'string' ? record.description : '',
      });
    }

    return { judged, tokens: readTokenUsage(data) };
  } catch (error) {
    return { error: `Judge batch threw: ${(error as Error).message}` };
  }
}

export async function judgeCandidates(
  brief: BrandBrief,
  candidates: EnrichedCandidate[],
): Promise<{ judged: JudgedCandidate[]; tokens: number | null }> {
  if (candidates.length === 0) return { judged: [], tokens: 0 };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set — cannot judge competitor candidates');
  }

  const model = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4.1';
  const batches = chunk(candidates, JUDGE_BATCH_SIZE);
  const outcomes = await runWithConcurrency(batches, JUDGE_CONCURRENCY, (batch) => runOneBatch(brief, batch, apiKey, model));

  const judged: JudgedCandidate[] = [];
  let tokenSum: number | null = null;
  let sawReadableUsage = false;

  for (const outcome of outcomes) {
    if ('error' in outcome) {
      // Per-batch isolation, following ./search's pattern: one bad batch
      // drops its candidates from the result rather than failing the run
      // or approving them by default. Logged because a judge batch costs
      // real money and real candidates — losing it silently would leave no
      // trace beyond a suspiciously low token count.
      console.error('Judge batch dropped:', outcome.error);
      continue;
    }
    judged.push(...outcome.judged);
    if (outcome.tokens != null) {
      sawReadableUsage = true;
      tokenSum = (tokenSum ?? 0) + outcome.tokens;
    }
  }

  const tokens = sawReadableUsage ? tokenSum : null;
  return { judged, tokens };
}

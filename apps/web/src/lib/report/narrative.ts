/**
 * narrative.ts — the only part of the report a model writes.
 *
 * It returns prose as JSON, never markup. The previous design asked the model
 * for a complete styled HTML document, which made every report a fresh
 * improvisation: layout, colours, chart geometry and page breaks were all
 * re-decided per run, and a malformed response meant no report at all.
 *
 * Here the model writes sentences. If it fails, the report still renders with
 * its figures, tables and charts intact — a report with data and no commentary
 * is worth more than an error message.
 */

import { runAiTask, type AiCallContext } from '@/lib/ai';
import {
  DEFAULT_CONTENT_LANGUAGE,
  languageInstructions,
  type ContentLanguage,
} from '@/lib/content-language';

/*
  Models come from the failover layer (task report_narrative): Gemini is the
  admin setting, like every other content task. This file used to read
  GEMINI_MODEL with a gemini-2.5-pro default, which Google retires on 1 Dec.
*/

export interface ReportNarrative {
  /** Two short paragraphs opening the report. */
  executiveSummary: string[];
  /** One reading per positioning matrix, keyed by the chart's own name. */
  chartReadings: Record<string, string>;
  /** What the competitors' keyword choices say about the market. */
  keywordInsight: string;
  /** Where this company can move, argued from the charts. */
  positioningOpportunity: string;
  recommendations: {
    immediate: string[];
    mediumTerm: string[];
    longTerm: string[];
  };
}

/** What renders when the model is unavailable — honest about being empty. */
export const EMPTY_NARRATIVE: ReportNarrative = {
  executiveSummary: [],
  chartReadings: {},
  keywordInsight: '',
  positioningOpportunity: '',
  recommendations: { immediate: [], mediumTerm: [], longTerm: [] },
};

function asStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

/**
 * Anything missing from the model's reply becomes empty rather than
 * `undefined`, which is how the old report printed the word "undefined" into
 * finished PDFs.
 */
function coerce(raw: unknown): ReportNarrative {
  const o = (raw ?? {}) as Record<string, any>;
  const recs = (o.recommendations ?? {}) as Record<string, any>;

  const readings: Record<string, string> = {};
  if (o.chartReadings && typeof o.chartReadings === 'object') {
    for (const [key, value] of Object.entries(o.chartReadings)) {
      if (typeof value === 'string' && value.trim()) readings[key] = value.trim();
    }
  }

  return {
    executiveSummary: asStringArray(o.executiveSummary, 3),
    chartReadings: readings,
    keywordInsight: typeof o.keywordInsight === 'string' ? o.keywordInsight.trim() : '',
    positioningOpportunity:
      typeof o.positioningOpportunity === 'string' ? o.positioningOpportunity.trim() : '',
    recommendations: {
      immediate: asStringArray(recs.immediate, 3),
      mediumTerm: asStringArray(recs.mediumTerm, 3),
      longTerm: asStringArray(recs.longTerm, 3),
    },
  };
}

export interface NarrativeInput {
  companyName: string;
  language?: ContentLanguage;
  brandSummary: any;
  matrices: { chartName: string; xAxis: string; yAxis: string; companies: any[] }[];
  keywords: any[];
  contentGaps: any[];
  offerings: any[];
}

function buildPrompt(input: NarrativeInput): string {
  const language = input.language ?? DEFAULT_CONTENT_LANGUAGE;
  const chartNames = input.matrices.map((m) => m.chartName);

  return `You are a strategy consultant writing the commentary for ${input.companyName}'s market intelligence report.

${languageInstructions(language)}

You are writing PROSE ONLY. The document, its layout, its charts and its tables
already exist and are rendered from the data below — do not describe them, do
not produce HTML or markdown, and do not repeat numbers the reader can already
see in a table. Your job is to say what the data MEANS.

=== BRAND ===
${JSON.stringify(input.brandSummary ?? {}, null, 2)}

=== POSITIONING MATRICES ===
${JSON.stringify(input.matrices, null, 2)}

=== COMPETITOR KEYWORDS ===
${JSON.stringify(input.keywords, null, 2)}

=== CONTENT GAPS ===
${JSON.stringify(input.contentGaps, null, 2)}

=== THIS COMPANY'S OFFERINGS ===
${JSON.stringify(input.offerings, null, 2)}

Return ONLY a JSON object with exactly this shape:

{
  "executiveSummary": ["paragraph", "paragraph"],
  "chartReadings": { ${chartNames.map((n) => `"${n}": "one short paragraph"`).join(', ')} },
  "keywordInsight": "one paragraph",
  "positioningOpportunity": "one paragraph",
  "recommendations": {
    "immediate": ["action", "action", "action"],
    "mediumTerm": ["action", "action", "action"],
    "longTerm": ["action", "action", "action"]
  }
}

RULES:
- Every recommendation must name something specific from the data above — a
  competitor, a gap, an axis, an offering. A sentence that would read the same
  for any company in any industry is a failure; "review competitor positioning
  and adjust messaging accordingly" is exactly what not to write.
- Each chartReadings key must be copied EXACTLY as given above.
- Say what is uncertain where it is uncertain. The competitor scores are
  estimates from public pages, not measurements.
- No headings, no bullets, no markdown inside the strings.
- Paragraphs are 2–4 sentences. Actions are one sentence each.`;
}

/**
 * Never throws: a report without commentary still ships. The caller is told
 * what happened through the returned `degraded` flag so the document can say
 * so rather than quietly looking thin.
 */
export async function generateNarrative(
  input: NarrativeInput,
  ctx?: AiCallContext,
): Promise<{ narrative: ReportNarrative; degraded: boolean }> {
  const prompt = buildPrompt(input);

  const result = await runAiTask(
    'report_narrative',
    {
      prompt,
      output: { kind: 'json_object' },
      // Long prose reply (spec §Timeouts: long drafts 120 s).
      timeoutMs: 120_000,
      maxTokens: 8192,
      temperature: 0.4,
    },
    ctx,
  );
  if (!result.ok) {
    console.error(
      `[report/narrative] AI ${result.kind} (first error: ${result.firstErrorClass}); rendering without commentary`,
    );
    return { narrative: EMPTY_NARRATIVE, degraded: true };
  }

  const narrative = coerce(result.json);
  const empty = narrative.executiveSummary.length === 0;
  return { narrative, degraded: empty };
}

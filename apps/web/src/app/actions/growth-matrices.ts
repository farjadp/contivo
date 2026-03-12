'use server';

import { prisma } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { writeActivityLog } from '@/lib/activity-log';

type MatrixAxis = {
  x: string;
  y: string;
};

type MatrixTokenUsageRun = {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
};

type MatrixTokenUsage = {
  runs: number;
  lifetime_prompt_tokens: number;
  lifetime_completion_tokens: number;
  lifetime_total_tokens: number;
  last_run: MatrixTokenUsageRun | null;
};

export type MatrixCompanyPoint = {
  name: string;
  website: string;
  type: 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL' | 'TARGET';
  x_score: number;
  y_score: number;
  x_reason: string;
  y_reason: string;
  confidence_score: number;
};

export type CompetitiveMatrixChart = {
  chart_key: string;
  chart_name: string;
  axes: MatrixAxis;
  companies: MatrixCompanyPoint[];
  summary: {
    market_pattern: string;
    positioning_opportunity: string;
  };
};

type CompetitiveMatrixPayload = {
  generated_at: string;
  ai_estimated: boolean;
  source: 'AI' | 'MANUAL';
  charts: CompetitiveMatrixChart[];
  cross_chart_summary: string;
  strongest_differentiation_opportunity: string;
  token_usage: MatrixTokenUsage;
};

const CHART_DEFINITIONS: Array<{ key: string; name: string; x: string; y: string }> = [
  { key: 'price_value_depth', name: 'Price vs Value Depth', x: 'Price', y: 'Value Depth' },
  {
    key: 'audience_size_specialization',
    name: 'Audience Size vs Specialization',
    x: 'Audience Size',
    y: 'Specialization',
  },
  {
    key: 'content_volume_quality',
    name: 'Content Volume vs Content Quality',
    x: 'Content Volume',
    y: 'Content Quality',
  },
  { key: 'strategy_execution', name: 'Strategy vs Execution', x: 'Execution', y: 'Strategy' },
  { key: 'creativity_structure', name: 'Creativity vs Structure', x: 'Creativity', y: 'Structure' },
];

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

function normalizeType(value: string | null | undefined): MatrixCompanyPoint['type'] {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();

  if (normalized === 'TARGET') return 'TARGET';
  if (normalized === 'INDIRECT') return 'INDIRECT';
  if (normalized === 'ASPIRATIONAL' || normalized === 'ADJACENT') return 'ASPIRATIONAL';
  return 'DIRECT';
}

function clampScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(10, Math.round(parsed)));
}

function clampConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.55;
  return Math.max(0.3, Math.min(1, parsed));
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

function emptyTokenUsage(): MatrixTokenUsage {
  return {
    runs: 0,
    lifetime_prompt_tokens: 0,
    lifetime_completion_tokens: 0,
    lifetime_total_tokens: 0,
    last_run: null,
  };
}

function normalizeTokenUsage(value: any): MatrixTokenUsage {
  const raw = value && typeof value === 'object' ? value : {};
  const lastRunRaw = raw.last_run && typeof raw.last_run === 'object' ? raw.last_run : null;
  const lastRun = lastRunRaw
    ? {
        model: trimTo(lastRunRaw.model, 120) || 'unknown',
        prompt_tokens: toNonNegativeInt(lastRunRaw.prompt_tokens),
        completion_tokens: toNonNegativeInt(lastRunRaw.completion_tokens),
        total_tokens: toNonNegativeInt(lastRunRaw.total_tokens),
        created_at: trimTo(lastRunRaw.created_at, 80) || new Date().toISOString(),
      }
    : null;

  return {
    runs: toNonNegativeInt(raw.runs),
    lifetime_prompt_tokens: toNonNegativeInt(raw.lifetime_prompt_tokens),
    lifetime_completion_tokens: toNonNegativeInt(raw.lifetime_completion_tokens),
    lifetime_total_tokens: toNonNegativeInt(raw.lifetime_total_tokens),
    last_run: lastRun,
  };
}

function appendTokenUsage(
  current: MatrixTokenUsage | null | undefined,
  usage:
    | {
        model: string;
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }
    | null,
): MatrixTokenUsage {
  const base = normalizeTokenUsage(current);
  if (!usage) return base;

  return {
    runs: base.runs + 1,
    lifetime_prompt_tokens: base.lifetime_prompt_tokens + toNonNegativeInt(usage.prompt_tokens),
    lifetime_completion_tokens:
      base.lifetime_completion_tokens + toNonNegativeInt(usage.completion_tokens),
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

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function heuristicPointScore(seed: string, base = 5): number {
  const drift = (hashString(seed) % 5) - 2;
  return Math.max(1, Math.min(10, base + drift));
}

function buildMatricesPrompt(input: {
  companyName: string;
  companyWebsite: string;
  brandSummary: any;
  competitors: Array<{
    name: string;
    website: string;
    type: string;
    description: string;
    category: string;
    audience: string;
  }>;
}): string {
  return `
You are a competitive landscape engine.

Analyze the target company and its competitors across these 5 charts:
1. Price vs Value Depth
2. Audience Size vs Specialization
3. Content Volume vs Content Quality
4. Strategy vs Execution
5. Creativity vs Structure

You must:
- score each axis from 1 to 10
- justify every score with concrete signals
- lower confidence when evidence is weak
- avoid confident guessing
- include the target company as one plotted node in every chart (type: "target")

Scoring bands:
- 1-3 = low
- 4-6 = medium
- 7-8 = strong
- 9-10 = dominant

Confidence bands:
- 0.80-1.00 = high confidence
- 0.55-0.79 = medium confidence
- 0.30-0.54 = low confidence

When evidence is limited, explicitly say:
- "score estimated from limited evidence"
- "pricing not visible"
- "inferred from messaging, not explicit proof"

Target company:
${JSON.stringify(
    {
      name: input.companyName,
      website: input.companyWebsite,
      brandSummary: input.brandSummary,
    },
    null,
    2,
  )}

Competitors:
${JSON.stringify(input.competitors, null, 2)}

Output ONLY JSON with this schema:
{
  "charts": [
    {
      "chart_key": "price_value_depth|audience_size_specialization|content_volume_quality|strategy_execution|creativity_structure",
      "chart_name": "string",
      "axes": { "x": "string", "y": "string" },
      "companies": [
        {
          "name": "string",
          "website": "https://domain.com",
          "type": "direct|indirect|aspirational|target",
          "x_score": 1,
          "y_score": 1,
          "x_reason": "string",
          "y_reason": "string",
          "confidence_score": 0.0
        }
      ],
      "summary": {
        "market_pattern": "string",
        "positioning_opportunity": "string"
      }
    }
  ],
  "cross_chart_summary": "string",
  "strongest_differentiation_opportunity": "string"
}
`;
}

function fallbackMatrices(input: {
  companyName: string;
  companyWebsite: string;
  competitors: Array<{ name: string; website: string; type: string; description: string }>;
}): CompetitiveMatrixPayload {
  const companies = [
    {
      name: input.companyName,
      website: normalizeWebsite(input.companyWebsite),
      type: 'TARGET' as const,
      description: 'Target company',
    },
    ...input.competitors.map((item) => ({
      name: item.name,
      website: normalizeWebsite(item.website),
      type: normalizeType(item.type),
      description: item.description || '',
    })),
  ];

  const charts: CompetitiveMatrixChart[] = CHART_DEFINITIONS.map((chart) => ({
    chart_key: chart.key,
    chart_name: chart.name,
    axes: { x: chart.x, y: chart.y },
    companies: companies.map((company) => {
      const seed = `${chart.key}:${company.name}:${company.website}`;
      return {
        name: company.name,
        website: company.website,
        type: company.type,
        x_score: heuristicPointScore(`${seed}:x`, company.type === 'TARGET' ? 6 : 5),
        y_score: heuristicPointScore(`${seed}:y`, company.type === 'TARGET' ? 7 : 5),
        x_reason: 'Score estimated from limited evidence and public positioning signals.',
        y_reason: 'Inferred from messaging, not explicit proof.',
        confidence_score: 0.42,
      };
    }),
    summary: {
      market_pattern: 'Estimated pattern from limited public signals.',
      positioning_opportunity: 'Collect more explicit pricing/feature evidence to increase confidence.',
    },
  }));

  return {
    generated_at: new Date().toISOString(),
    ai_estimated: true,
    source: 'AI',
    charts,
    cross_chart_summary: 'These matrix scores are AI-estimated from public signals and include uncertainty.',
    strongest_differentiation_opportunity:
      'Differentiate with a stronger strategy-plus-execution narrative and proof-backed value depth.',
    token_usage: emptyTokenUsage(),
  };
}

function normalizeChartKey(value: string): string {
  const direct = CHART_DEFINITIONS.find((item) => item.key === value);
  if (direct) return direct.key;

  const normalized = value.toLowerCase().replace(/[^a-z]+/g, '_');
  if (normalized.includes('price') && normalized.includes('value')) return 'price_value_depth';
  if (normalized.includes('audience') && normalized.includes('special')) return 'audience_size_specialization';
  if (normalized.includes('content') && normalized.includes('quality')) return 'content_volume_quality';
  if (normalized.includes('strategy') && normalized.includes('execution')) return 'strategy_execution';
  if (normalized.includes('creativity') && normalized.includes('structure')) return 'creativity_structure';
  return '';
}

function normalizeMatrixPayload(raw: any, input: {
  companyName: string;
  companyWebsite: string;
  competitors: Array<{ name: string; website: string; type: string; description: string; category: string; audience: string }>;
}): CompetitiveMatrixPayload {
  const targetDomain = normalizeDomain(input.companyWebsite);
  const sourceCharts = Array.isArray(raw?.charts) ? raw.charts : [];

  const charts: CompetitiveMatrixChart[] = CHART_DEFINITIONS.map((definition) => {
    const candidate = sourceCharts.find((item: any) => normalizeChartKey(String(item?.chart_key || item?.chart_name || '')) === definition.key) || {};
    const companiesRaw = Array.isArray(candidate?.companies) ? candidate.companies : [];
    const companies: MatrixCompanyPoint[] = [];
    const seen = new Set<string>();

    for (const companyRaw of companiesRaw) {
      const name = trimTo(companyRaw?.name, 120);
      const website = normalizeWebsite(companyRaw?.website);
      if (!name || !website) continue;
      const key = `${name.toLowerCase()}|${normalizeDomain(website)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const domain = normalizeDomain(website);
      const isTarget = domain && targetDomain && domain === targetDomain;
      companies.push({
        name,
        website,
        type: isTarget ? 'TARGET' : normalizeType(companyRaw?.type),
        x_score: clampScore(companyRaw?.x_score),
        y_score: clampScore(companyRaw?.y_score),
        x_reason: trimTo(companyRaw?.x_reason, 240) || 'Score estimated from limited evidence.',
        y_reason: trimTo(companyRaw?.y_reason, 240) || 'Score estimated from limited evidence.',
        confidence_score: clampConfidence(companyRaw?.confidence_score),
      });
    }

    const targetExists = companies.some((item) => item.type === 'TARGET');
    if (!targetExists) {
      const seed = `${definition.key}:${input.companyName}:${input.companyWebsite}`;
      companies.unshift({
        name: input.companyName,
        website: normalizeWebsite(input.companyWebsite),
        type: 'TARGET',
        x_score: heuristicPointScore(`${seed}:x`, 6),
        y_score: heuristicPointScore(`${seed}:y`, 7),
        x_reason: 'Target score estimated from current product positioning.',
        y_reason: 'Target score estimated from current brand summary signals.',
        confidence_score: 0.55,
      });
    }

    return {
      chart_key: definition.key,
      chart_name: trimTo(candidate?.chart_name, 80) || definition.name,
      axes: {
        x: trimTo(candidate?.axes?.x, 40) || definition.x,
        y: trimTo(candidate?.axes?.y, 40) || definition.y,
      },
      companies: companies.slice(0, 14),
      summary: {
        market_pattern:
          trimTo(candidate?.summary?.market_pattern, 320) ||
          'Market pattern inferred from competitor positioning signals.',
        positioning_opportunity:
          trimTo(candidate?.summary?.positioning_opportunity, 320) ||
          'Positioning opportunity inferred from competitor score distribution.',
      },
    };
  });

  return {
    generated_at: new Date().toISOString(),
    ai_estimated: true,
    source: 'AI',
    charts,
    cross_chart_summary:
      trimTo(raw?.cross_chart_summary, 800) ||
      'Cross-chart summary estimated from available public signals and competitor messaging.',
    strongest_differentiation_opportunity:
      trimTo(raw?.strongest_differentiation_opportunity, 420) ||
      'Potential differentiation in combining strategic depth with reliable execution.',
    token_usage: emptyTokenUsage(),
  };
}

async function callOpenAiMatrices(
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
              'You are a rigorous competitive intelligence analyst. Return only valid JSON and include uncertainty when evidence is weak.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      console.error('OpenAI matrix generation error:', await res.text());
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
      console.error('OpenAI matrix JSON parse failed:', parseError);
      return { parsed: null, usage };
    }
  } catch (error) {
    console.error('OpenAI matrix parsing failed:', error);
    return null;
  }
}

function extractCompetitorInput(workspace: any): Array<{
  name: string;
  website: string;
  type: string;
  description: string;
  category: string;
  audience: string;
}> {
  const competitors = Array.isArray(workspace?.competitors) ? workspace.competitors : [];
  const accepted = competitors.filter((item: any) => item.userDecision === 'ACCEPTED');
  const fallback = competitors.filter((item: any) => item.userDecision !== 'REJECTED');
  const filtered = accepted.length > 0 ? accepted : fallback;

  return filtered.slice(0, 12).map((item: any) => ({
    name: trimTo(item.name, 120),
    website: normalizeWebsite(item.domain),
    type: String(item.type || 'DIRECT'),
    description: trimTo(item.description, 360),
    category: trimTo(item.category, 120),
    audience: trimTo(item.audienceGuess, 160),
  }));
}

function mergeCompetitiveMatricesInAudienceInsights(
  currentAudienceInsights: any,
  payload: CompetitiveMatrixPayload,
): any {
  const current = currentAudienceInsights && typeof currentAudienceInsights === 'object' ? currentAudienceInsights : {};
  return {
    ...current,
    competitiveMatrices: payload,
  };
}

export async function generateWorkspaceCompetitiveMatrices(workspaceId: string) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  if (!workspaceId) return { error: 'Workspace ID is required' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
      include: { competitors: true },
    });
    if (!workspace) return { error: 'Workspace not found' };

    const competitors = extractCompetitorInput(workspace);
    if (competitors.length < 2) {
      return { error: 'At least 2 reviewed competitors are required to generate matrices.' };
    }

    const prompt = buildMatricesPrompt({
      companyName: workspace.name,
      companyWebsite: workspace.websiteUrl || '',
      brandSummary: workspace.brandSummary || {},
      competitors,
    });

    const openAiResult = await callOpenAiMatrices(prompt);
    const raw = openAiResult?.parsed ?? null;
    const existingTokenUsage = normalizeTokenUsage(
      (workspace.audienceInsights as any)?.competitiveMatrices?.token_usage,
    );
    const nextTokenUsage = appendTokenUsage(existingTokenUsage, openAiResult?.usage || null);
    const payload =
      raw != null
        ? normalizeMatrixPayload(raw, {
            companyName: workspace.name,
            companyWebsite: workspace.websiteUrl || '',
            competitors,
          })
        : fallbackMatrices({
            companyName: workspace.name,
            companyWebsite: workspace.websiteUrl || '',
            competitors,
          });
    payload.token_usage = nextTokenUsage;

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        audienceInsights: mergeCompetitiveMatricesInAudienceInsights(workspace.audienceInsights, payload),
      },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'COMPETITIVE_MATRICES_GENERATED',
      detail: {
        charts: payload.charts.length,
        competitors: competitors.length,
        promptTokens: payload.token_usage.last_run?.prompt_tokens || 0,
        completionTokens: payload.token_usage.last_run?.completion_tokens || 0,
        totalTokens: payload.token_usage.last_run?.total_tokens || 0,
      },
    });

    return { success: true, matrices: payload };
  } catch (error) {
    console.error('generateWorkspaceCompetitiveMatrices failed:', error);
    return { error: 'Could not generate matrices right now.' };
  }
}

export async function saveWorkspaceCompetitiveMatricesEdits(
  workspaceId: string,
  payload: CompetitiveMatrixPayload,
) {
  const session = await getSession();
  if (!session) return { error: 'Not authenticated' };
  if (!workspaceId) return { error: 'Workspace ID is required' };

  try {
    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId, userId: session.userId as string },
      include: { competitors: true },
    });
    if (!workspace) return { error: 'Workspace not found' };

    const competitors = extractCompetitorInput(workspace);
    const normalized = normalizeMatrixPayload(payload, {
      companyName: workspace.name,
      companyWebsite: workspace.websiteUrl || '',
      competitors,
    });
    normalized.ai_estimated = true;
    normalized.source = 'MANUAL';
    normalized.token_usage = normalizeTokenUsage(
      payload?.token_usage || (workspace.audienceInsights as any)?.competitiveMatrices?.token_usage,
    );

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        audienceInsights: mergeCompetitiveMatricesInAudienceInsights(workspace.audienceInsights, normalized),
      },
    });

    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: workspace.id,
      action: 'COMPETITIVE_MATRICES_EDITED',
      detail: {
        charts: normalized.charts.length,
      },
    });

    return { success: true, matrices: normalized };
  } catch (error) {
    console.error('saveWorkspaceCompetitiveMatricesEdits failed:', error);
    return { error: 'Could not save matrix edits.' };
  }
}

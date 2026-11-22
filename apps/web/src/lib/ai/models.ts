/**
 * Default model per provider and task (spec §Models + Decisions 1).
 *
 * OpenAI keeps today's sources exactly: web search OPENAI_SEARCH_MODEL
 * (gpt-6.2-sol); the tasks that lived in lib/gemini.ts use the admin
 * "OpenAI fallback model" setting; the rest OPENAI_DEFAULT_MODEL (gpt-4.1).
 * Claude: ANTHROPIC_MODEL_JUDGE (Opus 5.5) for judges/matrices/quality gate,
 * ANTHROPIC_MODEL (Sonnet 5.5) for everything else.
 * Gemini: the admin setting lib/gemini.ts reads today.
 */

import { warnIfRetiring } from './retirements';
import type { AiRequest, AiTask, ProviderId } from './types';

export const DEFAULT_OPENAI_MODEL = 'gpt-4.1';
/**
 * Competitor web search. gpt-5-mini shuts down 2026-12-11; gpt-6.2-sol won the
 * live eval (docs/evals/2026-11-22-openai-search-model.md): steady citations
 * in English and Persian, p50 12 s vs 34 s, about the same cost per query.
 */
export const DEFAULT_OPENAI_SEARCH_MODEL = 'gpt-6.2-sol';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_ANTHROPIC_JUDGE_MODEL = 'claude-opus-5-5';

/** Tasks that get the stronger Claude model (Farjad, 22 Nov). */
export const ANTHROPIC_JUDGE_TASKS: ReadonlySet<AiTask> = new Set<AiTask>([
  'competitor_judge',
  'matrix_propose_axes',
  'matrix_score_chart',
  'matrix_summarise',
  'quality_gate',
]);

/** Tasks that called lib/gemini.ts' callOpenAi, whose model is the admin setting. */
export const OPENAI_ADMIN_MODEL_TASKS: ReadonlySet<AiTask> = new Set<AiTask>([
  'website_analysis',
  'content_ideas',
  'content_draft',
  'instant_draft',
  'positioning',
  'serp_analysis',
  'legacy_competitors',
  'quality_gate',
  'humanize',
  'storylines',
  'narrative_change',
  'guide',
  'image_prompt',
]);

export type ModelResolver = (provider: ProviderId, task: AiTask) => Promise<string>;

type Env = Record<string, string | undefined>;

function envOr(env: Env, name: string, fallback: string): string {
  return env[name]?.trim() || fallback;
}

export function createModelResolver(
  env: Env = process.env,
  settings: {
    getGeminiModel: () => Promise<string>;
    getOpenAiFallbackModel: () => Promise<string>;
  } = {
    // Lazy so importing the layer does not pull Prisma into every test.
    getGeminiModel: async () => (await import('@/lib/app-settings')).getGeminiModel(),
    getOpenAiFallbackModel: async () => (await import('@/lib/app-settings')).getOpenAiFallbackModel(),
  },
): ModelResolver {
  return async (provider, task) => {
    switch (provider) {
      case 'openai':
        if (task === 'competitor_web_search') return envOr(env, 'OPENAI_SEARCH_MODEL', DEFAULT_OPENAI_SEARCH_MODEL);
        if (OPENAI_ADMIN_MODEL_TASKS.has(task)) return settings.getOpenAiFallbackModel();
        return envOr(env, 'OPENAI_DEFAULT_MODEL', DEFAULT_OPENAI_MODEL);
      case 'anthropic':
        return ANTHROPIC_JUDGE_TASKS.has(task)
          ? envOr(env, 'ANTHROPIC_MODEL_JUDGE', DEFAULT_ANTHROPIC_JUDGE_MODEL)
          : envOr(env, 'ANTHROPIC_MODEL', DEFAULT_ANTHROPIC_MODEL);
      case 'gemini':
        return settings.getGeminiModel();
    }
  };
}

export async function modelFor(
  resolver: ModelResolver,
  provider: ProviderId,
  task: AiTask,
  request: AiRequest,
): Promise<string> {
  const override = request.modelOverride?.[provider]?.trim();
  const model = override || (await resolver(provider, task));
  warnIfRetiring(model);
  return model;
}

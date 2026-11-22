/**
 * Ordered provider chain per task (spec §Chains, Decisions 2).
 *
 * Env overrides, no code deploy needed:
 *   AI_CHAIN_<TASK>=anthropic,openai   (e.g. AI_CHAIN_COMPETITOR_JUDGE)
 *   AI_PROVIDER_DISABLED=gemini        (comma list, removed from every chain)
 */

import { PROVIDER_IDS, type AiTask, type ProviderId } from './types';

const OPENAI_FIRST: ProviderId[] = ['openai', 'anthropic', 'gemini'];
const GEMINI_FIRST: ProviderId[] = ['gemini', 'openai', 'anthropic'];

export const DEFAULT_CHAINS: Record<AiTask, ProviderId[]> = {
  competitor_web_search: OPENAI_FIRST,
  competitor_queries: OPENAI_FIRST,
  competitor_judge: OPENAI_FIRST,
  matrix_propose_axes: OPENAI_FIRST,
  matrix_score_chart: OPENAI_FIRST,
  matrix_summarise: OPENAI_FIRST,
  brand_assets: OPENAI_FIRST,
  keywords: OPENAI_FIRST,
  offerings: OPENAI_FIRST,
  website_analysis: GEMINI_FIRST,
  content_ideas: GEMINI_FIRST,
  content_draft: GEMINI_FIRST,
  instant_draft: GEMINI_FIRST,
  positioning: GEMINI_FIRST,
  serp_analysis: GEMINI_FIRST,
  legacy_competitors: GEMINI_FIRST,
  quality_gate: GEMINI_FIRST,
  humanize: GEMINI_FIRST,
  storylines: GEMINI_FIRST,
  narrative_change: GEMINI_FIRST,
  guide: GEMINI_FIRST,
  image_prompt: GEMINI_FIRST,
  report_narrative: GEMINI_FIRST,
};

type Env = Record<string, string | undefined>;

const warnedBadEntries = new Set<string>();

function parseProviderList(raw: string | undefined, source: string): ProviderId[] {
  if (!raw?.trim()) return [];
  const out: ProviderId[] = [];
  for (const entry of raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if ((PROVIDER_IDS as readonly string[]).includes(entry)) {
      if (!out.includes(entry as ProviderId)) out.push(entry as ProviderId);
    } else if (!warnedBadEntries.has(`${source}:${entry}`)) {
      warnedBadEntries.add(`${source}:${entry}`);
      console.error(`[ai] ${source} names unknown provider "${entry}" — ignored`);
    }
  }
  return out;
}

export function chainEnvName(task: AiTask): string {
  return `AI_CHAIN_${task.toUpperCase()}`;
}

export function disabledProviders(env: Env = process.env): Set<ProviderId> {
  return new Set(parseProviderList(env.AI_PROVIDER_DISABLED, 'AI_PROVIDER_DISABLED'));
}

/** The chain for `task` after env override and the global kill switch. May be empty. */
export function resolveChain(task: AiTask, env: Env = process.env): ProviderId[] {
  const envName = chainEnvName(task);
  const override = parseProviderList(env[envName], envName);
  const base = override.length > 0 ? override : DEFAULT_CHAINS[task];
  const disabled = disabledProviders(env);
  return base.filter((provider) => !disabled.has(provider));
}

/**
 * The quality-gate judge, replayed exactly: same prompt builder, same parse,
 * same thresholds and veto rule as `evaluateDraft` in
 * src/lib/autopilot/quality-gate.ts. Only the AI step is replayed; the
 * deterministic checks (word count, leakage, duplicates) are not, because
 * they do not change with the provider.
 *
 * The prompt builder is imported, never copied: a copy would drift and the eval
 * would certify a prompt production no longer sends. Until quality-gate.ts
 * exports it, `loadGatePrompt` throws with the exact line contivo-cto must add.
 */

import { THRESHOLDS, type GateInput } from '@/lib/autopilot/quality-gate';
import { asContentLanguage } from '@/lib/content-language';
import { resolveWordCountPlatformKey } from '@/lib/content-word-count';

import type { Criterion, DatasetItem, JudgeOutcome } from './types';

/**
 * The system prompt `runJudge` sends today (quality-gate.ts, inside runJudge).
 * Used only while the module does not export JUDGE_SYSTEM_PROMPT; the run
 * report says which one was used.
 */
export const GATE_SYSTEM_PROMPT_COPY =
  'You are a strict brand editor. You reject anything you would not want published unattended on a real company account. Return ONLY valid JSON.';

export const REQUIRED_EXPORT_LINE =
  'quality-gate.ts: change `function buildJudgePrompt(` to `export function buildJudgePrompt(`';
export const OPTIONAL_EXPORT_LINE =
  'quality-gate.ts: hoist the runJudge system string to `export const JUDGE_SYSTEM_PROMPT = \'You are a strict brand editor. ...\';` and pass it to the call';

export class MissingGateExportError extends Error {
  constructor() {
    super(`buildJudgePrompt is not exported from quality-gate.ts. Needed: ${REQUIRED_EXPORT_LINE}`);
    this.name = 'MissingGateExportError';
  }
}

type BuildJudgePrompt = (input: GateInput, content: string, platform: string) => string;

export type GatePrompt = {
  build: (item: DatasetItem) => string;
  system: string;
  systemSource: 'export' | 'copy';
};

/** Takes the module as an argument so tests can pass a fake one. */
export function gatePromptFrom(mod: Record<string, unknown>): GatePrompt {
  const build = mod.buildJudgePrompt as BuildJudgePrompt | undefined;
  if (typeof build !== 'function') throw new MissingGateExportError();
  const exported = typeof mod.JUDGE_SYSTEM_PROMPT === 'string' ? (mod.JUDGE_SYSTEM_PROMPT as string) : null;
  return {
    build: (item) => {
      const input = toGateInput(item);
      return build(input, input.content.trim(), resolveWordCountPlatformKey(item.channel));
    },
    system: exported ?? GATE_SYSTEM_PROMPT_COPY,
    systemSource: exported ? 'export' : 'copy',
  };
}

export async function loadGatePrompt(): Promise<GatePrompt> {
  const mod = (await import('@/lib/autopilot/quality-gate')) as unknown as Record<string, unknown>;
  return gatePromptFrom(mod);
}

export function toGateInput(item: DatasetItem): GateInput {
  return {
    content: item.content,
    topic: item.topic,
    channel: item.channel,
    brandSummary: item.brandSummary,
    // The DB enum is upper-case ('EN' | 'FA'); the dataset stores lower-case.
    language: asContentLanguage(item.language.toUpperCase()),
    // No dataset item is storyline-bound (see dataset census); replaying one
    // without its storyline would score a different question.
    storyline: null,
  };
}

/** Same as gemini.ts `safeJsonParse` (not exported): fences stripped, nothing more lenient. */
export function parseGateJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Same as quality-gate.ts `clampScore`: unparseable is 0, i.e. a fail. */
function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, Math.round(n)));
}

/** The gate's decision for an unbound draft (runJudge + evaluateDraft). */
export function decide(raw: Record<string, unknown>): JudgeOutcome {
  const scores = {
    brandFit: clampScore(raw.brand_fit),
    factualSafety: clampScore(raw.factual_safety),
    clarity: clampScore(raw.clarity),
  };
  const below: Criterion[] = [];
  if (scores.brandFit < THRESHOLDS.brandFit) below.push('brand_fit');
  if (scores.factualSafety < THRESHOLDS.factualSafety) below.push('factual_safety');
  if (scores.clarity < THRESHOLDS.clarity) below.push('clarity');
  const vetoed = String(raw.verdict || '').toLowerCase() === 'reject';
  const approved = !vetoed && below.length === 0;
  const notes = Array.isArray(raw.notes) ? raw.notes.map((n) => String(n).slice(0, 300)).slice(0, 5) : [];
  return { approved, verdict: approved ? 'approve' : 'reject', scores, below, vetoed, notes };
}

export const CRITERION_THRESHOLD: Record<Criterion, number> = {
  brand_fit: THRESHOLDS.brandFit,
  factual_safety: THRESHOLDS.factualSafety,
  clarity: THRESHOLDS.clarity,
};

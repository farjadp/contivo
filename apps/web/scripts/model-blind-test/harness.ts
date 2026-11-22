/**
 * Runs every (brief × model) unit exactly once, with at most one retry of a
 * unit whose failure was a 429 or a 5xx. Budget-guarded before and during.
 */

import { estimateCostUsd } from '@/lib/ai-usage';
import { adjustWordCountForLanguage } from '@/lib/content-language';

import { KEY_ENV, type Candidate } from './config';
import { generateFinalPost, StepFailedError } from './pipeline';
import { makeRoute } from './route';
import type { Brief, CallLog, RunAiTask, UnitResult } from './types';

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * Rough per-unit token projection: one draft call and one humanize call (the
 * usual case), prompts at chars/4 of what the code actually sends, output at
 * 2 tokens per English word / 4 per Persian word, then x3 on output for
 * thinking (Opus 5.5 / Argon think by default and bill it as output). Biased
 * high on purpose; the measured figure is what gets reported.
 */
export function projectUnitTokens(brief: Brief): { promptTokens: number; completionTokens: number } {
  const brandChars = JSON.stringify(brief.brandSummary ?? {}).length;
  const words = adjustWordCountForLanguage(brief.wordCount.target, brief.language);
  const perWord = brief.language === 'FA' ? 4 : 2;
  const postTokens = words * perWord;
  const draftPrompt = Math.ceil((brandChars + (brief.storylineBlock?.length ?? 0) + brief.context.length + 3_500) / 4);
  const humanizePrompt = Math.ceil((brandChars + 4_500) / 4) + postTokens;
  return { promptTokens: draftPrompt + humanizePrompt, completionTokens: postTokens * 2 * 3 };
}

export function projectCostUsd(briefs: Brief[], candidates: readonly Candidate[], at: Date = new Date()) {
  const rows = candidates.map((c) => {
    let usd = 0;
    let unpriced = false;
    for (const b of briefs) {
      const t = projectUnitTokens(b);
      const cost = estimateCostUsd(c.model, { ...t, totalTokens: t.promptTokens + t.completionTokens }, at);
      // gemini-3.7-flash has no published price; Google routes it to 3.8 Flash.
      const fallback =
        cost ?? estimateCostUsd('gemini-3.8-flash', { ...t, totalTokens: t.promptTokens + t.completionTokens }, at);
      if (cost === null) unpriced = true;
      usd += fallback ?? 0;
    }
    return { slot: c.slot, usd, unpriced };
  });
  return { rows, totalUsd: rows.reduce((s, r) => s + r.usd, 0) };
}

// ---------------------------------------------------------------------------
// Output normalisation (applied identically to every model)
// ---------------------------------------------------------------------------

const PREAMBLE = /^(?:here(?:'s| is)[^\n]{0,120}:|sure[,!.][^\n]*|certainly[,!.][^\n]*|of course[,!.][^\n]*)\s*\n+/i;

/**
 * Strips wrappers that are not part of the post and would mark a vendor:
 * a leading "Here is…:" line, a whole-output code fence, surrounding
 * quotes, runs of blank lines. Never touches the body.
 */
export function normaliseOutput(raw: string): string {
  let text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n```$/i);
  if (fenced) text = fenced[1].trim();
  text = text.replace(PREAMBLE, '');
  if (/^"[\s\S]*"$/.test(text) && !text.slice(1, -1).includes('"')) text = text.slice(1, -1).trim();
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

const TELLS = /\b(claude|anthropic|openai|chatgpt|gpt-?\d|gemini|google ai|bard|as an ai|language model)\b/gi;

export function findVendorTells(text: string): string[] {
  return [...new Set((text.match(TELLS) ?? []).map((m) => m.toLowerCase()))];
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

/** Error classes worth exactly one more try: 429 and 5xx. Everything else is final. */
const RETRYABLE = /:(rate_limit|server|overloaded)$/;

export interface HarnessDeps {
  /** Sets the transport the mocked `@/lib/ai` runAiTask delegates to. */
  setRoute: (route: RunAiTask | null) => void;
  makeRoute?: typeof makeRoute;
  sleep?: (ms: number) => Promise<void>;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export { median };

async function attemptUnit(brief: Brief, candidate: Candidate, deps: HarnessDeps, calls: CallLog[]) {
  const route = (deps.makeRoute ?? makeRoute)(candidate, calls, { env: deps.env });
  deps.setRoute(route);
  const humanizeOk = () => {
    const last = [...calls].reverse().find((c) => c.task === 'humanize');
    return Boolean(last?.ok);
  };
  try {
    const post = await generateFinalPost(brief, humanizeOk);
    const failed = calls.find((c) => !c.ok);
    if (failed) throw new StepFailedError(failed.task === 'humanize' ? 'humanize' : 'content_draft', failed.error ?? 'failed');
    return { ok: true as const, post };
  } catch (error) {
    const lastError = [...calls].reverse().find((c) => !c.ok)?.error ?? null;
    return { ok: false as const, error: lastError ?? (error as Error).message };
  } finally {
    deps.setRoute(null);
  }
}

export async function runUnit(brief: Brief, candidate: Candidate, deps: HarnessDeps): Promise<UnitResult> {
  const env = deps.env ?? process.env;
  const base = {
    briefId: brief.id,
    slot: candidate.slot,
    provider: candidate.provider,
    requestedModel: candidate.model,
  };
  const empty = {
    text: null,
    draftText: null,
    humanizePasses: 0,
    resolvedModels: [] as string[],
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0 as number | null,
    latencyMs: 0,
    words: 0,
    possibleTells: [] as string[],
  };
  if (!env[KEY_ENV[candidate.provider]]?.trim()) {
    return { ...base, ...empty, ok: false, error: `not_run: ${KEY_ENV[candidate.provider]} not set`, attempts: 0, calls: [] };
  }

  const allCalls: CallLog[] = [];
  let attempts = 0;
  let outcome: Awaited<ReturnType<typeof attemptUnit>> | null = null;
  let lastAttemptCalls: CallLog[] = [];
  while (attempts < 2) {
    attempts += 1;
    const calls: CallLog[] = [];
    outcome = await attemptUnit(brief, candidate, deps, calls);
    allCalls.push(...calls);
    lastAttemptCalls = calls;
    if (outcome.ok || !RETRYABLE.test(outcome.error)) break;
    if (attempts < 2) {
      deps.log?.(`[blind] ${brief.id} × ${candidate.slot}: ${outcome.error}, retrying once`);
      await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(5_000);
    }
  }

  const okCalls = allCalls.filter((c) => c.ok);
  const promptTokens = okCalls.reduce((s, c) => s + (c.usage?.promptTokens ?? 0), 0);
  const completionTokens = okCalls.reduce((s, c) => s + (c.usage?.completionTokens ?? 0), 0);
  const costUsd = okCalls.some((c) => c.costUsd === null) ? null : okCalls.reduce((s, c) => s + (c.costUsd ?? 0), 0);
  const resolvedModels = [...new Set(okCalls.map((c) => c.model).filter((m): m is string => Boolean(m)))];
  // Latency of the last attempt only: a failed first attempt is not the model's speed.
  const latencyMs = lastAttemptCalls.reduce((s, c) => s + c.latencyMs, 0);

  if (!outcome?.ok) {
    return {
      ...base,
      ...empty,
      ok: false,
      error: outcome?.error ?? 'unknown',
      attempts,
      calls: allCalls,
      resolvedModels,
      promptTokens,
      completionTokens,
      costUsd,
      latencyMs,
    };
  }
  const text = normaliseOutput(outcome.post.text);
  return {
    ...base,
    ok: true,
    text,
    draftText: outcome.post.draftText,
    humanizePasses: outcome.post.humanizePasses,
    error: null,
    attempts,
    calls: allCalls,
    resolvedModels,
    promptTokens,
    completionTokens,
    costUsd,
    latencyMs,
    words: text.split(/\s+/).filter(Boolean).length,
    possibleTells: findVendorTells(text),
  };
}

export interface RunOptions {
  briefs: Brief[];
  candidates: readonly Candidate[];
  maxUsd: number;
  deps: HarnessDeps;
}

export class BudgetExceededError extends Error {}

export async function runBlindTest({ briefs, candidates, maxUsd, deps }: RunOptions) {
  const projection = projectCostUsd(briefs, candidates);
  if (projection.totalUsd > maxUsd) {
    throw new BudgetExceededError(
      `Projected $${projection.totalUsd.toFixed(2)} exceeds the $${maxUsd} cap; nothing was called.`,
    );
  }
  const results: UnitResult[] = [];
  let spent = 0;
  for (const brief of briefs) {
    for (const candidate of candidates) {
      if (spent > maxUsd) {
        results.push({
          briefId: brief.id,
          slot: candidate.slot,
          provider: candidate.provider,
          requestedModel: candidate.model,
          ok: false,
          text: null,
          draftText: null,
          humanizePasses: 0,
          error: `not_run: measured spend $${spent.toFixed(2)} passed the $${maxUsd} cap`,
          attempts: 0,
          calls: [],
          resolvedModels: [],
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          words: 0,
          possibleTells: [],
        });
        continue;
      }
      const r = await runUnit(brief, candidate, deps);
      spent += r.costUsd ?? 0;
      deps.log?.(
        `[blind] ${brief.id} × ${candidate.slot}: ${r.ok ? `ok ${r.words} words` : r.error} | $${r.costUsd?.toFixed(4) ?? 'unpriced'} | ${r.latencyMs} ms | ${r.resolvedModels.join(',')}`,
      );
      results.push(r);
    }
  }
  return { projection, results, spentUsd: spent };
}

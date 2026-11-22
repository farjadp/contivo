/**
 * Judge calibration runner. Replays every dataset draft through the gate's
 * judge on ONE forced provider and scores it against the reference labels.
 *
 * Entry point: eval.run.test.ts (vitest is the TS runner already in the repo,
 * and it resolves the `@/` alias). See docs/evals/judge-calibration.md for the
 * commands. Every provider call is paid; nothing runs unless EVAL_PROVIDER is set.
 */

import fs from 'node:fs';
import path from 'node:path';

import { estimateCostUsd } from '@/lib/ai-usage';

import { decide, loadGatePrompt, parseGateJson, type GatePrompt } from './judge';
import { summarise, type Summary } from './metrics';
import type { Dataset, ItemResult, JudgeTransport } from './types';

/** quality-gate judge timeout in the spec ("judge 90 s (existing)"). */
export const JUDGE_TIMEOUT_MS = 90_000;

export type EvalOptions = {
  transport: JudgeTransport;
  dataset: Dataset;
  repeats?: number;
  /** Restrict to these item ids (debugging one draft). */
  only?: string[];
  prompt?: GatePrompt;
  onResult?: (r: ItemResult) => void;
};

export type EvalReport = {
  ranAt: string;
  provider: string;
  models: string[];
  systemPromptSource: 'export' | 'copy';
  repeats: number;
  datasetBuiltAt: string;
  datasetCounts: Record<string, number>;
  summary: Summary;
  results: ItemResult[];
};

export function loadDataset(file = path.join(__dirname, 'dataset.json')): Dataset {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Dataset;
}

export async function runEval(opts: EvalOptions): Promise<EvalReport> {
  const prompt = opts.prompt ?? (await loadGatePrompt());
  const repeats = Math.max(1, opts.repeats ?? 1);
  const items = opts.dataset.items.filter((i) => !opts.only || opts.only.includes(i.id));
  const results: ItemResult[] = [];

  // Sequential on purpose: one provider, small set, and rate limits are part
  // of what a failover judge has to live with.
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const item of items) {
      const call = await opts.transport.call({
        system: prompt.system,
        prompt: prompt.build(item),
        timeoutMs: JUDGE_TIMEOUT_MS,
      });
      const base = {
        itemId: item.id,
        repeat,
        synthetic: item.synthetic,
        fabrication: item.expected.fabrication,
        expectedVerdict: item.expected.verdict,
        latencyMs: call.latencyMs,
      };
      let result: ItemResult;
      if (!call.ok) {
        result = { ...base, outcome: null, error: call.error, provider: null, model: null, usage: null, costUsd: null };
      } else {
        const raw =
          call.json && typeof call.json === 'object' && !Array.isArray(call.json)
            ? (call.json as Record<string, unknown>)
            : parseGateJson(call.text);
        result = {
          ...base,
          // Unparseable = the gate's own fail-closed path (`judge_unavailable`).
          outcome: raw ? decide(raw) : null,
          error: raw ? null : 'unparseable_json',
          provider: call.provider,
          model: call.model,
          usage: call.usage,
          costUsd: call.usage ? estimateCostUsd(call.model, call.usage) : null,
        };
      }
      results.push(result);
      opts.onResult?.(result);
    }
  }

  return {
    ranAt: new Date().toISOString(),
    provider: opts.transport.provider,
    models: [...new Set(results.map((r) => r.model).filter((m): m is string => Boolean(m)))],
    systemPromptSource: prompt.systemSource,
    repeats,
    datasetBuiltAt: opts.dataset.builtAt,
    datasetCounts: opts.dataset.counts,
    summary: summarise(items, results),
    results,
  };
}

export function formatReport(report: EvalReport): string {
  const s = report.summary;
  const pct = (x: number | null) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)} %`);
  const lines = [
    `Judge calibration — provider ${report.provider} (${report.models.join(', ') || 'no model answered'}), ${report.repeats} repeat(s)`,
    `System prompt: ${report.systemPromptSource === 'export' ? 'JUDGE_SYSTEM_PROMPT export' : 'local copy (quality-gate.ts does not export it)'}`,
    `Agreement: ${s.agreements}/${s.calls} = ${pct(s.agreement)} (95 % CI ${pct(s.agreementCi95.low)}–${pct(s.agreementCi95.high)})`,
    `  real drafts only: ${s.realOnly.agreements}/${s.realOnly.calls} = ${pct(s.realOnly.agreement)}`,
    `Errors (counted as disagreement): ${s.errors}${s.errorMessages.length ? ` — ${s.errorMessages.join('; ')}` : ''}`,
    `Fabrications approved: ${s.fabricationsAccepted.length}/${s.fabricationCalls}${s.fabricationsAccepted.map((f) => `\n  - ${f.itemId} (repeat ${f.repeat}) ${JSON.stringify(f.scores)}`).join('')}`,
    `Approve-labelled drafts rejected: ${s.controlsRejected.length}${s.controlsRejected.map((c) => `\n  - ${c.itemId} (repeat ${c.repeat}) below=[${c.below.join(',')}] veto=${c.vetoed}`).join('')}`,
    ...(report.repeats > 1 ? [`Decision flipped between repeats: ${s.flippedItems.length ? s.flippedItems.join(', ') : 'none'}`] : []),
    'Per criterion (vs reference scores at gate thresholds):',
    ...s.perCriterion.map(
      (c) =>
        `  ${c.criterion.padEnd(15)} pass/fail disagree ${c.passFailDisagreements}/${c.compared}, mean |Δscore| ${c.meanAbsScoreDiff === null ? 'n/a' : c.meanAbsScoreDiff.toFixed(2)}, expected-fail missed ${c.expectedFailMissed}/${c.expectedFailTotal}`,
    ),
    `Cost: ${s.cost.totalUsd === null ? `unknown (${s.cost.unpricedCalls} unpriced call(s); add the model to ai-usage.ts PRICES)` : `$${s.cost.totalUsd.toFixed(4)}`} — ${s.cost.promptTokens} in / ${s.cost.completionTokens} out tokens; p50 latency ${s.latencyMsP50 ?? 'n/a'} ms`,
    `PASS BAR: ${s.passBar.pass ? 'PASS — allowed to judge' : `FAIL — ${s.passBar.reasons.join('; ')}`}`,
  ];
  return lines.join('\n');
}

export function writeReport(report: EvalReport, dir = path.join(__dirname, 'results')): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${report.ranAt.replace(/[:.]/g, '-')}-${report.provider}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  return file;
}

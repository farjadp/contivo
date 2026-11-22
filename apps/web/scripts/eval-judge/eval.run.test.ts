/**
 * PAID. The calibration run itself. Skipped unless EVAL_PROVIDER is set.
 *
 *   cd apps/web
 *   EVAL_PROVIDER=anthropic EVAL_REPEATS=3 \
 *     pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
 *
 *   # before/after on one provider (EVAL_MODEL = modelOverride for that provider)
 *   EVAL_PROVIDER=openai EVAL_MODEL=gpt-4.1       pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
 *   EVAL_PROVIDER=openai EVAL_MODEL=gpt-6.2-astra pnpm exec vitest run --config scripts/eval-judge/vitest.config.ts eval.run
 *
 * Provider keys come from the environment the AI layer already reads
 * (OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY). The test fails when the
 * provider misses the pass bar, so a red run means "not allowed to judge".
 */

import { describe, expect, test } from 'vitest';

import { formatReport, loadDataset, runEval, writeReport } from './run';
import { layerTransport } from './transport';
import type { JudgeProvider } from './types';

const PROVIDERS: JudgeProvider[] = ['openai', 'anthropic', 'gemini'];
const provider = process.env.EVAL_PROVIDER as JudgeProvider | undefined;

describe.skipIf(!provider)('judge calibration (paid)', () => {
  test(`provider ${provider}`, async () => {
    if (!provider || !PROVIDERS.includes(provider)) {
      throw new Error(`EVAL_PROVIDER must be one of ${PROVIDERS.join(', ')}`);
    }
    const report = await runEval({
      // EVAL_MODEL pins the model (before/after on one provider); unset = the resolver's default.
      transport: layerTransport(provider, undefined, process.env.EVAL_MODEL?.trim() || undefined),
      dataset: loadDataset(),
      repeats: Number(process.env.EVAL_REPEATS || 1),
      only: process.env.EVAL_ONLY ? process.env.EVAL_ONLY.split(',') : undefined,
      onResult: (r) =>
        console.log(`[eval-judge] ${r.itemId}#${r.repeat}: ${r.outcome ? r.outcome.verdict : `error ${r.error}`}`),
    });
    const file = writeReport(report);
    console.log(`${formatReport(report)}\nReport: ${file}`);
    expect(report.summary.passBar.reasons).toEqual([]);
  });
});

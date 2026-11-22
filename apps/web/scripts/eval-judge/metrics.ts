/**
 * Scoring for the judge calibration eval. Pure functions, no I/O.
 *
 * Rules (docs/evals/judge-calibration.md §Pass bar):
 *   - Agreement = calls whose gate decision equals the reference verdict,
 *     over all calls. A failed or unparseable call counts as a DISAGREEMENT:
 *     a judge that cannot answer cannot judge.
 *   - A provider may judge only if agreement >= 85 % AND it accepted zero
 *     fabrications (synthetic or known real) on any repeat.
 */

import { CRITERION_THRESHOLD } from './judge';
import type { Criterion, DatasetItem, ItemResult } from './types';

export const AGREEMENT_BAR = 0.85;
const CRITERIA: Criterion[] = ['brand_fit', 'factual_safety', 'clarity'];
const SCORE_KEY = { brand_fit: 'brandFit', factual_safety: 'factualSafety', clarity: 'clarity' } as const;

/** Wilson score interval, 95 %. With n around 11, expect it to be wide. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

export type CriterionStats = {
  criterion: Criterion;
  /** Calls with a reference score for this criterion (real gate verdicts only). */
  compared: number;
  /** Pass/fail at the gate threshold differs from the reference. */
  passFailDisagreements: number;
  meanAbsScoreDiff: number | null;
  /** Items whose expected failing criterion is this one, and the call did NOT fail it. */
  expectedFailMissed: number;
  expectedFailTotal: number;
};

export type Summary = {
  calls: number;
  agreements: number;
  agreement: number;
  agreementCi95: { low: number; high: number };
  realOnly: { calls: number; agreements: number; agreement: number | null };
  errors: number;
  errorMessages: string[];
  fabricationCalls: number;
  fabricationsAccepted: Array<{ itemId: string; repeat: number; synthetic: boolean; scores: unknown }>;
  controlsRejected: Array<{ itemId: string; repeat: number; below: Criterion[]; vetoed: boolean }>;
  /** Items whose decision changed between repeats (only when repeats > 1). */
  flippedItems: string[];
  perCriterion: CriterionStats[];
  cost: { totalUsd: number | null; pricedCalls: number; unpricedCalls: number; promptTokens: number; completionTokens: number };
  latencyMsP50: number | null;
  passBar: { pass: boolean; reasons: string[] };
};

export function summarise(items: DatasetItem[], results: ItemResult[]): Summary {
  const byId = new Map(items.map((i) => [i.id, i]));
  const agrees = (r: ItemResult) => r.outcome !== null && r.outcome.verdict === r.expectedVerdict;

  const real = results.filter((r) => !r.synthetic);
  const agreements = results.filter(agrees).length;
  const errored = results.filter((r) => r.outcome === null);

  const fabricationCalls = results.filter((r) => r.fabrication);
  const fabricationsAccepted = fabricationCalls
    .filter((r) => r.outcome?.approved)
    .map((r) => ({ itemId: r.itemId, repeat: r.repeat, synthetic: r.synthetic, scores: r.outcome?.scores }));
  const controlsRejected = results
    .filter((r) => !r.fabrication && r.expectedVerdict === 'approve' && r.outcome && !r.outcome.approved)
    .map((r) => ({ itemId: r.itemId, repeat: r.repeat, below: r.outcome!.below, vetoed: r.outcome!.vetoed }));

  const decisionsById = new Map<string, Set<string>>();
  for (const r of results) {
    const set = decisionsById.get(r.itemId) ?? new Set<string>();
    set.add(r.outcome ? r.outcome.verdict : 'error');
    decisionsById.set(r.itemId, set);
  }
  const flippedItems = [...decisionsById].filter(([, s]) => s.size > 1).map(([id]) => id);

  const perCriterion: CriterionStats[] = CRITERIA.map((criterion) => {
    const key = SCORE_KEY[criterion];
    const threshold = CRITERION_THRESHOLD[criterion];
    let compared = 0;
    let disagreements = 0;
    let absSum = 0;
    let expectedFailTotal = 0;
    let expectedFailMissed = 0;
    for (const r of results) {
      const item = byId.get(r.itemId);
      if (!item) continue;
      const ref = item.reference.scores?.[key];
      if (typeof ref === 'number') {
        compared += 1;
        if (!r.outcome) {
          disagreements += 1;
        } else {
          const got = r.outcome.scores[key];
          if (ref >= threshold !== got >= threshold) disagreements += 1;
          absSum += Math.abs(ref - got);
        }
      }
      if (item.expected.failingCriterion === criterion) {
        expectedFailTotal += 1;
        if (!r.outcome || !r.outcome.below.includes(criterion)) expectedFailMissed += 1;
      }
    }
    const scored = results.filter((r) => r.outcome && typeof byId.get(r.itemId)?.reference.scores?.[key] === 'number').length;
    return {
      criterion,
      compared,
      passFailDisagreements: disagreements,
      meanAbsScoreDiff: scored ? absSum / scored : null,
      expectedFailMissed,
      expectedFailTotal,
    };
  });

  const priced = results.filter((r) => r.costUsd !== null);
  const withUsage = results.filter((r) => r.usage);
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);

  const agreement = results.length ? agreements / results.length : 0;
  const reasons: string[] = [];
  if (results.length === 0) reasons.push('no calls were made');
  if (agreement < AGREEMENT_BAR) reasons.push(`agreement ${(agreement * 100).toFixed(1)} % < ${AGREEMENT_BAR * 100} %`);
  if (fabricationsAccepted.length > 0) reasons.push(`${fabricationsAccepted.length} fabrication call(s) approved`);

  return {
    calls: results.length,
    agreements,
    agreement,
    agreementCi95: wilson(agreements, results.length),
    realOnly: {
      calls: real.length,
      agreements: real.filter(agrees).length,
      agreement: real.length ? real.filter(agrees).length / real.length : null,
    },
    errors: errored.length,
    errorMessages: [...new Set(errored.map((r) => r.error ?? 'unknown'))],
    fabricationCalls: fabricationCalls.length,
    fabricationsAccepted,
    controlsRejected,
    flippedItems,
    perCriterion,
    cost: {
      totalUsd: priced.length === results.length && results.length ? priced.reduce((s, r) => s + (r.costUsd ?? 0), 0) : null,
      pricedCalls: priced.length,
      unpricedCalls: results.length - priced.length,
      promptTokens: withUsage.reduce((s, r) => s + (r.usage?.promptTokens ?? 0), 0),
      completionTokens: withUsage.reduce((s, r) => s + (r.usage?.completionTokens ?? 0), 0),
    },
    latencyMsP50: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
    passBar: { pass: reasons.length === 0, reasons },
  };
}

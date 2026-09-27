import type { Certainty, ConfidenceBand } from './types';

/**
 * Turning the scorer's word into a number, and then adjusting it only by
 * things the scorer cannot talk its way into.
 *
 * The rule the whole file exists to keep: **a lower certainty can never
 * outrank a higher one.** Each certainty owns a band 0.09 wide, and every
 * bonus moves a score inside its own band and no further. So a `likely`
 * score with perfect corroboration (0.79) still sits below a bare `certain`
 * one (0.90), and nothing ever reaches 1.0 — a chart that claims total
 * confidence in anything is claiming more than this pipeline can know.
 */

/** The floor of each certainty's band. */
const CERTAINTY_FLOOR: Record<Certainty, number> = {
  certain: 0.9,
  likely: 0.7,
  unsure: 0.5,
};

/** How far a score may climb above its floor on corroboration alone. */
export const BAND_HEADROOM = 0.09;

/** A score with no evidence behind it is capped here however sure it sounds. */
export const ESTIMATED_CONFIDENCE_CAP = 0.5;

/** Distinct supporting evidence items beyond which more stops counting. */
export const EVIDENCE_SATURATION = 3;

/** Weights within the headroom. They must sum to 1. */
const WEIGHT_EVIDENCE = 0.6;
const WEIGHT_CORE_AGREEMENT = 0.4;

export function certaintyFloor(certainty: Certainty): number {
  return CERTAINTY_FLOOR[certainty] ?? CERTAINTY_FLOOR.unsure;
}

/** Accepts only the three words; anything else is treated as the weakest. */
export function normalizeCertainty(value: unknown): Certainty {
  return value === 'certain' || value === 'likely' ? value : 'unsure';
}

export type ScoreSignals = {
  certainty: Certainty;
  /** How many distinct evidence items the scorer cited for this axis. */
  evidenceCount: number;
  /**
   * Whether the two core charts agree about this company — both placing it in
   * the same third of their own axes. Agreement between charts scored in
   * separate calls is weak corroboration, but it is corroboration.
   */
  coreChartsAgree?: boolean;
};

/**
 * The confidence stored on a score.
 *
 * `evidenceCount === 0` means the scorer argued from nothing citable; the
 * score is kept (the chart would be misleading with a hole in it) but marked
 * estimated and capped, so it can never be presented as well-founded.
 */
export function finalConfidence(signals: ScoreSignals): number {
  const certainty = normalizeCertainty(signals.certainty);
  const evidenceCount = Math.max(0, Math.floor(signals.evidenceCount || 0));

  if (evidenceCount === 0) {
    return Math.min(certaintyFloor(certainty), ESTIMATED_CONFIDENCE_CAP);
  }

  const evidenceFraction = Math.min(evidenceCount, EVIDENCE_SATURATION) / EVIDENCE_SATURATION;
  const agreementFraction = signals.coreChartsAgree ? 1 : 0;
  const fraction = evidenceFraction * WEIGHT_EVIDENCE + agreementFraction * WEIGHT_CORE_AGREEMENT;

  const raw = certaintyFloor(certainty) + BAND_HEADROOM * fraction;
  // Two decimals: the stored number is shown as a word anyway, and a long
  // float invites a reader to believe in precision that isn't there.
  return Math.round(raw * 100) / 100;
}

/** True when a score carries no citable evidence. */
export function isEstimated(evidenceCount: number): boolean {
  return Math.max(0, Math.floor(evidenceCount || 0)) === 0;
}

/**
 * The word a person sees. Same thresholds as competitor discovery uses, so
 * "high" means the same thing in both surfaces.
 */
export function confidenceBand(confidence: number | null | undefined): ConfidenceBand {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return 'low';
  if (value >= 0.8) return 'high';
  if (value >= 0.6) return 'medium';
  return 'low';
}

/** Which third of a 1-10 axis a score falls in. Used for core-chart agreement. */
export function axisThird(score: number): 0 | 1 | 2 {
  const clamped = Math.max(1, Math.min(10, Math.round(Number(score) || 1)));
  if (clamped <= 4) return 0;
  if (clamped <= 7) return 1;
  return 2;
}

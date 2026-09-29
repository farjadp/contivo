/**
 * Shared vocabulary for the positioning matrices.
 *
 * See docs/superpowers/specs/2026-09-26-positioning-matrices-design.md.
 */

/** Where a plotted company sits relative to the workspace that owns the chart. */
export type CompanyType = 'TARGET' | 'DIRECT' | 'INDIRECT' | 'ASPIRATIONAL';

/** Core charts are the same in every workspace; market charts are chosen per workspace. */
export type ChartKind = 'CORE' | 'MARKET';

/**
 * How sure the scorer is, as a word.
 *
 * Deliberately not a number the model picks. Measured on 2026-09-26 in the
 * competitor-discovery pipeline, a model asked for a 0-1 confidence returned
 * ~1.0 for every candidate it was shown, including ones it went on to reject:
 * the field carried no information at all. A three-way choice it has to argue
 * for, mapped to a number in code, is the part a model cannot inflate.
 */
export type Certainty = 'certain' | 'likely' | 'unsure';

/** The word shown to a person. Never a percentage; see the spec, section 6. */
export type ConfidenceBand = 'high' | 'medium' | 'low';

/** A score's position on one chart, before overrides are applied. */
export type MatrixScore = {
  competitorId: string | null; // null = the workspace itself
  name: string;
  domain: string;
  type: CompanyType;
  xScore: number; // 1-10
  yScore: number; // 1-10
  confidence: number; // 0-1, derived in code from certainty
  estimated: boolean; // true when no evidence backed the score
};

/** A user's manual correction of one point on one chart. */
export type MatrixOverride = {
  chartKey: string;
  competitorId: string | null;
  xScore: number | null;
  yScore: number | null;
  note: string | null;
};

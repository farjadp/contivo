import { confidenceBand } from './scoring';

export type SelectionBasis = 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'NONE';

/** A `competitor_basis` value read back from a stored payload, or undefined when absent or unrecognised. */
export function parseStoredBasis(value: unknown): SelectionBasis | undefined {
  return value === 'ACCEPTED' || value === 'UNCONFIRMED_HIGH' || value === 'NONE' ? value : undefined;
}

/**
 * Where a competitor row came from, as far as evidence goes:
 *   - 'manual': the user added it by hand;
 *   - 'initialGuess': named by a model from a description of the business,
 *     with no search and no evidence. New rows carry
 *     `source: 'ONBOARDING_GUESS'` (see ONBOARDING_GUESS_SOURCE). Rows from
 *     before that marker existed carry `source: 'AI'` with no
 *     `discoveryRunId`: every row the evidence pipeline writes or updates
 *     sets `discoveryRunId`, so an AI row without one never went through it;
 *   - 'evidence': saved (or re-found) by a discovery run, with evidence.
 * A guess stays a guess (and `ONBOARDING_GUESS_SOURCE` stays on the row)
 * until a discovery run attaches evidence to it.
 */
export const ONBOARDING_GUESS_SOURCE = 'ONBOARDING_GUESS';

export type CompetitorOrigin = 'manual' | 'initialGuess' | 'evidence';

export function competitorOrigin(row: { source: string | null; discoveryRunId: string | null }): CompetitorOrigin {
  if (row.source === 'MANUAL') return 'manual';
  // A run that saved or re-found this row attached evidence to it, whatever
  // its origin was; only then does it stop being a guess.
  if (row.discoveryRunId) return 'evidence';
  return 'initialGuess';
}

export type CorroborationInput = {
  userDecision: string | null;
  confidence: number | null;
  sources?: string[] | null;
  evidence?: unknown; // EvidenceItem[] as stored; items may carry `query`
};

/**
 * Corroborated means the evidence carries citations from at least two
 * distinct `query` values, or the `sources` array holds more than one
 * source. Confidence is the model grading itself; the number of distinct
 * searches that surfaced a domain is a fact it cannot inflate. Malformed
 * `evidence` (not an array) never corroborates.
 */
export function isCorroborated(row: CorroborationInput): boolean {
  if (Array.isArray(row.sources) && row.sources.length > 1) return true;

  if (!Array.isArray(row.evidence)) return false;

  const queries = new Set<string>();
  for (const item of row.evidence) {
    if (item && typeof item === 'object' && typeof (item as { query?: unknown }).query === 'string') {
      const query = (item as { query: string }).query;
      if (query.length > 0) queries.add(query);
    }
  }
  return queries.size >= 2;
}

/**
 * What analysis is allowed to build on. Accepted competitors are the user's
 * own word. With none, Autopilot still has to run at 3am, so high-confidence
 * unreviewed candidates are allowed — but only when corroborated, and the
 * caller must label the output. A legacy row with no confidence never
 * qualifies.
 */
export function selectCompetitors<T extends CorroborationInput>(
  all: T[],
): { competitors: T[]; basis: SelectionBasis } {
  const accepted = all.filter((item) => item.userDecision === 'ACCEPTED');
  if (accepted.length > 0) return { competitors: accepted, basis: 'ACCEPTED' };

  const unconfirmed = all.filter(
    (item) =>
      item.userDecision !== 'REJECTED' &&
      confidenceBand(item.confidence) === 'high' &&
      isCorroborated(item),
  );
  if (unconfirmed.length > 0) return { competitors: unconfirmed, basis: 'UNCONFIRMED_HIGH' };

  return { competitors: [], basis: 'NONE' };
}

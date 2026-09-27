import { confidenceBand } from './scoring';

export type SelectionBasis = 'ACCEPTED' | 'UNCONFIRMED_HIGH' | 'NONE';

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

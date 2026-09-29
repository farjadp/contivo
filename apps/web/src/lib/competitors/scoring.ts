import type { JudgedCandidate, ScoredCandidate, TargetMarket } from './types';

export const KEEP_THRESHOLD = 0.6;
export const MAX_SAVED_PER_RUN = 10;
const HIGH_BAND = 0.8;

/**
 * The judge supplies the opinion; this adds only what can be counted:
 * how many distinct queries surfaced the domain, whether more than one
 * source found it, and whether the site speaks the market's language.
 */
export function scoreCandidate(candidate: JudgedCandidate, market: TargetMarket): number {
  let bonus = 0;

  // Appearing in several distinct queries is corroboration; past three it
  // says more about the query set than the candidate.
  bonus += Math.min(candidate.frequency - 1, 2) * 0.05;

  if (new Set(candidate.sources).size > 1) bonus += 0.1;

  if (candidate.pageLanguage && candidate.pageLanguage === market.language) bonus += 0.05;

  // The bonus closes a fraction of the remaining headroom rather than being
  // added flat. Added flat, a `likely` candidate with full corroboration
  // (0.7 + 0.25) outranks a `certain` one with none (0.9), and any `certain`
  // candidate with the slightest corroboration pins at exactly 1.0 — which is
  // what a live run produced, and it undoes the whole point of replacing the
  // model's self-graded float with a three-way certainty. Scaling by headroom
  // keeps the order the judge chose while still letting countable evidence
  // move a candidate within its band.
  const score = candidate.judgeConfidence + bonus * (1 - candidate.judgeConfidence);

  return Math.max(0, Math.min(1, score));
}

export function confidenceBand(value: number | null): 'high' | 'medium' | 'low' | 'unknown' {
  if (value == null) return 'unknown';
  if (value >= HIGH_BAND) return 'high';
  if (value >= KEEP_THRESHOLD) return 'medium';
  return 'low';
}

export function rankAndKeep(list: JudgedCandidate[], market: TargetMarket): ScoredCandidate[] {
  return list
    .filter((item) => item.isCompetitor)
    .map((item) => ({ ...item, finalConfidence: scoreCandidate(item, market) }))
    .filter((item) => item.finalConfidence >= KEEP_THRESHOLD)
    .sort((a, b) => b.finalConfidence - a.finalConfidence)
    .slice(0, MAX_SAVED_PER_RUN);
}

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
  let score = candidate.judgeConfidence;

  // Appearing in several distinct queries is corroboration; past three it
  // says more about the query set than the candidate.
  score += Math.min(candidate.frequency - 1, 2) * 0.05;

  if (new Set(candidate.sources).size > 1) score += 0.1;

  if (candidate.pageLanguage && candidate.pageLanguage === market.language) score += 0.05;

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

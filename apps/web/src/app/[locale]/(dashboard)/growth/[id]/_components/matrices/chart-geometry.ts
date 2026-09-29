import { axisThird } from '@/lib/matrices/scoring';

/**
 * Where things go on the plot, in percent of its width or height.
 *
 * Kept out of the component so the picture and the analysis cannot drift: the
 * white-space cell is drawn from the same thirds `axisThird` files scores
 * under, and the dots use the formula the chart always used.
 */

const MIN_SCORE = 1;
const MAX_SCORE = 10;
/** Padding kept clear at each end so a dot at 1 or 10 is not cut by the frame. */
const EDGE_PERCENT = 10;
const SPAN_PERCENT = 80;

export function scoreToPercent(score: number): number {
  const numeric = Number.isFinite(score) ? score : MIN_SCORE;
  const clamped = Math.max(MIN_SCORE, Math.min(MAX_SCORE, numeric));
  return EDGE_PERCENT + ((clamped - MIN_SCORE) / (MAX_SCORE - MIN_SCORE)) * SPAN_PERCENT;
}

/**
 * Highest whole score in each third, the same cut-offs `axisThird` uses
 * (1-4, 5-7, 8-10). Derived by asking `axisThird` rather than restating them.
 */
const LAST_SCORE_OF_BAND: Record<0 | 1 | 2, number> = (() => {
  const last: Record<0 | 1 | 2, number> = { 0: MIN_SCORE, 1: MIN_SCORE, 2: MIN_SCORE };
  for (let score = MIN_SCORE; score <= MAX_SCORE; score += 1) last[axisThird(score)] = score;
  return last;
})();

/** The plot position halfway between two neighbouring whole scores. */
function boundaryAfter(score: number): number {
  return (scoreToPercent(score) + scoreToPercent(score + 1)) / 2;
}

/**
 * One third of an axis as a start and a size along it. The three thirds tile
 * 0-100 with no gap, cut halfway between the last score of one third and the
 * first of the next, so every dot sits inside the cell it belongs to.
 */
export function bandRect(band: 0 | 1 | 2): { start: number; size: number } {
  const start = band === 0 ? 0 : boundaryAfter(LAST_SCORE_OF_BAND[(band - 1) as 0 | 1]);
  const end = band === 2 ? 100 : boundaryAfter(LAST_SCORE_OF_BAND[band]);
  return { start, size: end - start };
}

export type AxisEnds = {
  x: { low: string; high: string };
  y: { low: string; high: string };
};

export type CornerLabel = { x: string; y: string };

/** What each corner of the plot means: its horizontal end and its vertical end. */
export function cornerLabels(axis: AxisEnds): {
  topLeft: CornerLabel;
  topRight: CornerLabel;
  bottomLeft: CornerLabel;
  bottomRight: CornerLabel;
} {
  return {
    topLeft: { x: axis.x.low, y: axis.y.high },
    topRight: { x: axis.x.high, y: axis.y.high },
    bottomLeft: { x: axis.x.low, y: axis.y.low },
    bottomRight: { x: axis.x.high, y: axis.y.low },
  };
}

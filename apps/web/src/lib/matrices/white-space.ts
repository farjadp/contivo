import { axisThird } from './scoring';
import type { MatrixScore } from './types';

/**
 * Finding the open ground on a chart.
 *
 * The opportunity sentence under each chart used to be whatever the model
 * felt like saying. It is now computed here first, and the model is asked to
 * put *this* cell into words — so the sentence and the picture cannot
 * disagree, which they did whenever the model narrated a gap that had a
 * competitor sitting in it.
 *
 * The plane is the 1-10 square of both axes, cut into a 3x3 grid. A cell is
 * open when no rival sits near its centre, and it is *useful* when the target
 * could plausibly move there — so only the target's own cell and the eight
 * around it are considered. A gap on the far side of the chart is not an
 * opportunity, it is someone else's market.
 */

export type WhiteSpace = {
  xBand: 0 | 1 | 2;
  yBand: 0 | 1 | 2;
  /** Distance in score units from the cell's centre to the nearest rival. */
  nearestCompetitorDistance: number;
};

/** Centre of each third, in score units. */
const BAND_CENTRE: Record<0 | 1 | 2, number> = { 0: 2.5, 1: 6, 2: 9.5 };

/**
 * How far a cell's centre must be from every rival to count as open. Two score
 * units is a fifth of an axis: closer than that and the "gap" is inside a
 * rival's own scoring error.
 */
export const MIN_OPEN_DISTANCE = 2;

const BANDS: Array<0 | 1 | 2> = [0, 1, 2];

function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * Returns the most open cell the target could move into, or null when the
 * chart is crowded everywhere near it — which is itself a finding, and is
 * reported as "no clear gap" rather than invented.
 */
export function findWhiteSpace(scores: MatrixScore[]): WhiteSpace | null {
  const target = scores.find((score) => score.type === 'TARGET') ?? null;
  const rivals = scores.filter((score) => score.type !== 'TARGET');

  // With nobody to compare against, every cell is trivially "open" and the
  // answer would be meaningless.
  if (!target || rivals.length === 0) return null;

  const targetX = axisThird(target.xScore);
  const targetY = axisThird(target.yScore);

  let best: WhiteSpace | null = null;

  for (const xBand of BANDS) {
    for (const yBand of BANDS) {
      // Reachable means the target's cell or one adjacent to it.
      if (Math.abs(xBand - targetX) > 1 || Math.abs(yBand - targetY) > 1) continue;

      const cx = BAND_CENTRE[xBand];
      const cy = BAND_CENTRE[yBand];
      let nearest = Number.POSITIVE_INFINITY;
      for (const rival of rivals) {
        nearest = Math.min(nearest, distance(cx, cy, rival.xScore, rival.yScore));
      }

      if (nearest < MIN_OPEN_DISTANCE) continue;

      const candidate: WhiteSpace = {
        xBand,
        yBand,
        nearestCompetitorDistance: Math.round(nearest * 100) / 100,
      };

      if (best === null) {
        best = candidate;
        continue;
      }

      if (candidate.nearestCompetitorDistance > best.nearestCompetitorDistance) {
        best = candidate;
        continue;
      }

      // Ties go to the cell the target is already in: staying put and owning
      // the ground is a cheaper move than crossing the chart.
      if (candidate.nearestCompetitorDistance === best.nearestCompetitorDistance) {
        const candidateIsHome = candidate.xBand === targetX && candidate.yBand === targetY;
        const bestIsHome = best.xBand === targetX && best.yBand === targetY;
        if (candidateIsHome && !bestIsHome) best = candidate;
      }
    }
  }

  return best;
}

/** Plain words for a cell, so the prompt and the UI describe it the same way. */
export function describeBand(band: 0 | 1 | 2, lowLabel: string, highLabel: string): string {
  if (band === 0) return `low ${lowLabel}`;
  if (band === 2) return `high ${highLabel}`;
  return `middling ${highLabel}`;
}

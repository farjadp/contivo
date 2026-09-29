/**
 * Pure decisions behind the matrix run header and axes chooser, kept out of
 * the components so they can be unit-tested without a DOM. The components call
 * the actions in `@/app/actions/growth-matrices` and hand the results here.
 */

import type { MatrixStatus } from '@/app/actions/growth-matrices';
import type { StoredMarketAxis } from '@/lib/matrices/axes';

export const POLL_INTERVAL_MS = 3000;

/** Browser-side ceiling on how long one tab polls one run; the server reaps dead runs sooner. */
export const MAX_POLL_MS = 15 * 60 * 1000;

export const MATRIX_STAGE_ORDER = ['AXES', 'SCORE', 'SUMMARISE', 'SAVE'] as const;
export type MatrixStage = (typeof MATRIX_STAGE_ORDER)[number];

export const MAX_AXES_SELECTED = 3;

export function isMatrixRunActive(status: string | null | undefined): boolean {
  return status === 'PENDING' || status === 'RUNNING';
}

export function shouldKeepPolling(
  run: { status: string; startedAt: string } | null | undefined,
  nowMs: number,
): boolean {
  if (!run || !isMatrixRunActive(run.status)) return false;
  const started = Date.parse(run.startedAt);
  if (Number.isNaN(started)) return true;
  return nowMs - started < MAX_POLL_MS;
}

export function stageIndex(stage: string | null | undefined): number {
  return typeof stage === 'string' ? (MATRIX_STAGE_ORDER as readonly string[]).indexOf(stage) : -1;
}

/** What is missing before a run can start. Competitors come first: they are the larger gap. */
export function emptyStateReason(status: MatrixStatus): 'competitors' | 'brandSummary' | null {
  if (status.competitorCount <= 0) return 'competitors';
  if (!status.hasBrandSummary) return 'brandSummary';
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Which note the saved result needs. A blob without `run_id` predates the evidence rule. */
export function basisNotice(matrices: unknown): 'accepted' | 'unconfirmed' | 'legacy' {
  if (!isRecord(matrices)) return 'legacy';
  if (typeof matrices.run_id !== 'string' || matrices.run_id === '') return 'legacy';
  return matrices.competitor_basis === 'UNCONFIRMED_HIGH' ? 'unconfirmed' : 'accepted';
}

/** Whether the saved result has been flagged stale (a competitor changed after the run). */
export function isMatricesStale(matrices: unknown): boolean {
  return isRecord(matrices) && matrices.stale === true;
}

/** Adds or removes a key; a fourth selection is ignored. */
export function toggleAxis(selected: readonly string[], key: string): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= MAX_AXES_SELECTED) return [...selected];
  return [...selected, key];
}

export function canSubmitAxes(selected: readonly string[]): boolean {
  return selected.length >= 1 && selected.length <= MAX_AXES_SELECTED;
}

/** Renames both axis labels of one candidate; keys and low/high wording stay as proposed. */
export function renameAxis(
  axes: readonly StoredMarketAxis[],
  key: string,
  labels: { x: string; y: string },
): StoredMarketAxis[] {
  return axes.map((axis) =>
    axis.key === key
      ? { ...axis, x: { ...axis.x, label: labels.x }, y: { ...axis.y, label: labels.y } }
      : axis,
  );
}

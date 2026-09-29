/**
 * "The run's competitor set": which selected competitors a matrix run is
 * built from, and what a later read compares against to decide staleness.
 *
 * One helper for both, so the cap cannot drift. Before this, the snapshot was
 * capped at 12 but the staleness check compared against every selected
 * competitor, so a workspace with 13 read as stale forever. The order is fixed
 * here too (by id) rather than left to whatever order the database returned
 * the rows in, or the same 13 rows could yield a different 12 on each read.
 */

export const MAX_SNAPSHOT = 12;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The selected competitors a run is built on: at most 12, in a fixed order. */
export function snapshotCompetitors<T extends { id: string }>(selected: T[]): T[] {
  return [...selected].sort(byId).slice(0, MAX_SNAPSHOT);
}

/** The same rule for a list of ids, for callers that only hold ids. */
export function snapshotCompetitorIds(ids: string[]): string[] {
  return snapshotCompetitors(ids.map((id) => ({ id }))).map((row) => row.id);
}

/** Competitor ids out of a stored `MatrixRun.competitorSet`; anything malformed is skipped. */
export function parseRunCompetitorIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = (item as Record<string, unknown>).competitorId;
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

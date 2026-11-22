/**
 * roadmap.ts — what is being built, in the order it is meant to ship, and
 * what already has.
 *
 * Now / Next / Later carry no dates on purpose (Farjad, 22 Nov 2026): the
 * page says what comes next, not when. Shipped items carry the date the
 * change merged, taken from the repository's merged pull requests, and only
 * changes a customer would notice are listed.
 *
 * Copy: `roadmap.items.<id>` and `roadmap.shipped.<id>`.
 */

export type Horizon = 'now' | 'next' | 'later';

export const HORIZONS: readonly Horizon[] = ['now', 'next', 'later'];

export const PLANNED: Record<Horizon, readonly string[]> = {
  now: ['channels', 'billing'],
  next: ['monitoring', 'imageQuality', 'imageTemplate'],
  later: ['video', 'agency', 'networks', 'languages'],
};

/** Newest first. `date` is the merge date of the change (YYYY-MM-DD). */
export const SHIPPED: ReadonlyArray<{ id: string; date: string }> = [
  { id: 'ownPost', date: '2026-11-22' },
  { id: 'failover', date: '2026-11-22' },
  { id: 'security', date: '2026-11-22' },
  { id: 'tokens', date: '2026-11-21' },
  { id: 'italian', date: '2026-10-27' },
  { id: 'discovery', date: '2026-09-29' },
  { id: 'report', date: '2026-09-27' },
  { id: 'persian', date: '2026-09-24' },
];

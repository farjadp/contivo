/**
 * autopilot/schedule.ts
 *
 * Pure slot-picking for Autopilot. Given a policy's publish window and a set
 * of already-taken times, returns UTC instants inside the window on allowed
 * days, spread across the coming week. No I/O — easy to test.
 */

export type PublishWindow = {
  timezone: string;
  windowStartHour: number; // inclusive, local hour 0-23
  windowEndHour: number; // exclusive, local hour 1-24
  publishDays: number[]; // 0=Sun … 6=Sat, local
};

/** Minimum lead time so the scheduler cron has time to pick an item up. */
const MIN_LEAD_MS = 2 * 60 * 60 * 1000;
const LOOKAHEAD_DAYS = 14;

// ---------------------------------------------------------------------------
// Time-zone helpers (no external deps)
// ---------------------------------------------------------------------------

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function partsInZone(date: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24, // "24" can appear for midnight in some engines
    minute: Number(map.minute),
    weekday: WEEKDAYS.indexOf(map.weekday),
  };
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0);
  const truncated = new Date(date);
  truncated.setUTCSeconds(0, 0);
  return asUtc - truncated.getTime();
}

/** Converts a wall-clock time in `timeZone` to a UTC Date. */
export function zonedTimeToUtc(
  local: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): Date {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
  // Two passes handle DST transitions well enough for scheduling purposes.
  const offset1 = zoneOffsetMs(new Date(guess), timeZone);
  const offset2 = zoneOffsetMs(new Date(guess - offset1), timeZone);
  return new Date(guess - offset2);
}

/** Local calendar date `dayOffset` days after `now` in `timeZone`. */
function localDateAfter(now: Date, dayOffset: number, timeZone: string) {
  const p = partsInZone(now, timeZone);
  // Build a UTC date at local noon so day arithmetic never crosses DST edges.
  const noonUtc = Date.UTC(p.year, p.month - 1, p.day, 12, 0, 0, 0) + dayOffset * 86_400_000;
  const q = partsInZone(new Date(noonUtc), 'UTC');
  const weekday = new Date(noonUtc).getUTCDay();
  return { year: q.year, month: q.month, day: q.day, weekday };
}

// ---------------------------------------------------------------------------
// Slot picking
// ---------------------------------------------------------------------------

function sameLocalDay(a: Date, b: { year: number; month: number; day: number }, timeZone: string) {
  const p = partsInZone(a, timeZone);
  return p.year === b.year && p.month === b.month && p.day === b.day;
}

/**
 * Picks up to `count` publish instants inside the window.
 *
 * Strategy (v1, deterministic):
 *  - Candidate days = allowed publishDays in the next LOOKAHEAD_DAYS days.
 *  - Days that already have a taken slot are deprioritised (used only if
 *    there are not enough empty days).
 *  - Slots are spread evenly across the chosen days; the hour rotates
 *    through the window so consecutive posts don't all land at 09:00.
 */
export function pickPublishSlots(input: {
  now: Date;
  count: number;
  window: PublishWindow;
  taken: Date[];
}): Date[] {
  const { now, count, window, taken } = input;
  if (count <= 0) return [];

  const tz = window.timezone || 'America/Toronto';
  const startHour = clampHour(window.windowStartHour, 0, 23);
  const endHour = clampHour(window.windowEndHour, startHour + 1, 24);
  const allowedDays = new Set(
    (window.publishDays?.length ? window.publishDays : [1, 2, 3, 4, 5]).map((d) => ((d % 7) + 7) % 7),
  );
  const earliest = new Date(now.getTime() + MIN_LEAD_MS);

  type Day = { year: number; month: number; day: number; weekday: number; busy: boolean; offset: number };
  const days: Day[] = [];
  for (let offset = 0; offset < LOOKAHEAD_DAYS; offset++) {
    const d = localDateAfter(now, offset, tz);
    if (!allowedDays.has(d.weekday)) continue;
    // Skip days whose window has already closed (relative to earliest start).
    const windowEndUtc = zonedTimeToUtc({ ...d, hour: endHour - 1, minute: 59 }, tz);
    if (windowEndUtc.getTime() <= earliest.getTime()) continue;
    const busy = taken.some((t) => sameLocalDay(t, d, tz));
    days.push({ ...d, busy, offset });
  }
  if (days.length === 0) return [];

  // Prefer empty days, keep chronological order within each bucket.
  const empty = days.filter((d) => !d.busy);
  const busyDays = days.filter((d) => d.busy);
  const pool = [...empty, ...busyDays].sort((a, b) => a.offset - b.offset);
  const chosenDays: Day[] = [];
  const primary = empty.length >= count ? empty : pool;
  // Spread evenly across the first week's worth of candidates when possible.
  const horizon = primary.filter((d) => d.offset < 7);
  const source = horizon.length >= count ? horizon : primary;
  for (let i = 0; i < count && source.length > 0; i++) {
    const idx = Math.min(source.length - 1, Math.floor((i * source.length) / count));
    chosenDays.push(source[idx]);
  }

  const span = endHour - startHour;
  const slots: Date[] = [];
  chosenDays.forEach((d, i) => {
    // Rotate through the window: 0, +2h, +4h … wrapping, then :30 offsets.
    const hour = startHour + ((i * 2) % span);
    const minute = i % 2 === 0 ? 0 : 30;
    let candidate = zonedTimeToUtc({ ...d, hour, minute }, tz);
    if (candidate.getTime() < earliest.getTime()) {
      // Today, but that hour has passed — push to the next whole hour inside the window.
      const nowLocal = partsInZone(earliest, tz);
      const nextHour = Math.max(startHour, nowLocal.hour + 1);
      if (nextHour >= endHour) return; // window closed for today
      candidate = zonedTimeToUtc({ ...d, hour: nextHour, minute: 0 }, tz);
    }
    // Avoid exact collisions with taken or already-picked slots.
    while (
      taken.some((t) => Math.abs(t.getTime() - candidate.getTime()) < 30 * 60 * 1000) ||
      slots.some((t) => Math.abs(t.getTime() - candidate.getTime()) < 30 * 60 * 1000)
    ) {
      candidate = new Date(candidate.getTime() + 60 * 60 * 1000);
      const p = partsInZone(candidate, tz);
      if (p.hour >= endHour) return; // spilled out of window, drop this slot
    }
    slots.push(candidate);
  });

  return slots.sort((a, b) => a.getTime() - b.getTime());
}

function clampHour(value: number, min: number, max: number) {
  const n = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, n));
}

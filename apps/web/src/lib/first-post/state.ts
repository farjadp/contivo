/**
 * first-post/state.ts
 *
 * Derives the first-post read model (spec §3) from the run's own
 * `activity_logs` rows plus a few stored facts. Pure: no database, no clock
 * of its own. The run rows are the state; the real artifacts (charts,
 * keywords, the content item) are what is kept.
 *
 * Rules:
 * - Runs are ordered by their FIRST_POST_RUN_STARTED row. Step rows that name
 *   no started run are ignored.
 * - A content item that is publishing or published wins over everything: the
 *   draft pointer is the newest FIRST_POST_RUN_FINISHED whose item still
 *   exists (a key in `facts.items`).
 * - Otherwise the newest run decides: active → running, failed or silent for
 *   FIRST_POST_STALE_MS → failed, finished → draft (or confirm when no
 *   finished item exists any more).
 * - A run that was superseded without a terminal row died silently, so it
 *   counts as a timedOut failure of the step it was on.
 * - retriesLeft is 0 once the same step has failed more than
 *   FIRST_POST_RETRY_LIMIT times across runs.
 */

import { safePostUrl } from '@/lib/publish-outcome';

import {
  FIRST_POST_ERROR_KINDS,
  FIRST_POST_RETRY_LIMIT,
  FIRST_POST_RUN_FINISHED,
  FIRST_POST_RUN_STARTED,
  FIRST_POST_STALE_MS,
  FIRST_POST_STEPS,
  FIRST_POST_STEP_DONE,
  FIRST_POST_STEP_FAILED,
  FIRST_POST_STEP_SKIPPED,
  type FirstPostErrorKind,
  type FirstPostFacts,
  type FirstPostLogRow,
  type FirstPostState,
  type FirstPostStep,
  type StepResult,
  type StepSummary,
} from './types';

type Detail = Record<string, unknown>;

type ParsedRow = { action: string; runId: string; at: number; order: number; detail: Detail };

type RunOutcome =
  | { kind: 'active' }
  | { kind: 'finished'; contentItemId: string; approved: boolean }
  | { kind: 'failed'; step: FirstPostStep; errorKind: FirstPostErrorKind };

type Run = {
  runId: string;
  startedAt: number;
  done: StepResult[];
  current: FirstPostStep;
  outcome: RunOutcome;
};

/** Same-timestamp rows sort start → steps → finish, whatever order the loader used. */
const ACTION_RANK: Record<string, number> = {
  [FIRST_POST_RUN_STARTED]: 0,
  [FIRST_POST_STEP_DONE]: 1,
  [FIRST_POST_STEP_SKIPPED]: 1,
  [FIRST_POST_STEP_FAILED]: 2,
  [FIRST_POST_RUN_FINISHED]: 3,
};

const PUBLISHING_STATUSES = new Set(['SCHEDULED', 'PUBLISHING']);

function asDetail(value: unknown): Detail | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Detail) : null;
}

function toMs(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value: Date | string | null | undefined): string | null {
  const ms = toMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

function isStep(value: unknown): value is FirstPostStep {
  return typeof value === 'string' && (FIRST_POST_STEPS as readonly string[]).includes(value);
}

function errorKindOf(value: unknown): FirstPostErrorKind {
  return typeof value === 'string' && (FIRST_POST_ERROR_KINDS as readonly string[]).includes(value)
    ? (value as FirstPostErrorKind)
    : 'generic';
}

/** Only stored strings and finite numbers survive; anything else is dropped, never coerced. */
function summaryOf(value: unknown): StepSummary {
  const detail = asDetail(value);
  if (!detail) return {};
  const out: StepSummary = {};
  for (const [key, v] of Object.entries(detail)) {
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v;
  }
  return out;
}

function parseRows(rows: FirstPostLogRow[]): ParsedRow[] {
  const parsed: ParsedRow[] = [];
  rows.forEach((row, order) => {
    if (!(row.action in ACTION_RANK)) return;
    const at = toMs(row.createdAt);
    const detail = asDetail(row.detail) ?? {};
    if (at == null) return;
    const runId =
      typeof detail.runId === 'string' && detail.runId
        ? detail.runId
        : row.action === FIRST_POST_RUN_STARTED
          ? row.id
          : null;
    if (!runId) return;
    parsed.push({ action: row.action, runId, at, order, detail });
  });
  return parsed.sort((a, b) => a.at - b.at || ACTION_RANK[a.action] - ACTION_RANK[b.action] || a.order - b.order);
}

function buildRuns(rows: ParsedRow[], now: number): Run[] {
  const starts = rows.filter((r) => r.action === FIRST_POST_RUN_STARTED);
  const seen = new Set<string>();
  const ordered = starts.filter((r) => (seen.has(r.runId) ? false : (seen.add(r.runId), true)));

  return ordered.map((start, index) => {
    const own = rows.filter((r) => r.runId === start.runId && r.action !== FIRST_POST_RUN_STARTED);
    const results = new Map<FirstPostStep, StepResult>();
    let failure: ParsedRow | undefined;
    let finish: ParsedRow | undefined;
    let lastAt = start.at;

    for (const r of own) {
      lastAt = Math.max(lastAt, r.at);
      if ((r.action === FIRST_POST_STEP_DONE || r.action === FIRST_POST_STEP_SKIPPED) && isStep(r.detail.step)) {
        if (!results.has(r.detail.step)) {
          results.set(r.detail.step, {
            step: r.detail.step,
            summary: summaryOf(r.detail.summary),
            ...(r.action === FIRST_POST_STEP_SKIPPED ? { skipped: true as const } : {}),
          });
        }
      } else if (r.action === FIRST_POST_STEP_FAILED) {
        failure ??= r;
      } else if (r.action === FIRST_POST_RUN_FINISHED && typeof r.detail.contentItemId === 'string') {
        finish ??= r;
      }
    }

    const done = FIRST_POST_STEPS.filter((s) => results.has(s)).map((s) => results.get(s) as StepResult);
    const current = FIRST_POST_STEPS.find((s) => !results.has(s)) ?? 'draft';
    const isLatest = index === ordered.length - 1;

    let outcome: RunOutcome;
    if (finish) {
      outcome = {
        kind: 'finished',
        contentItemId: finish.detail.contentItemId as string,
        approved: finish.detail.approved === true,
      };
    } else if (failure) {
      outcome = {
        kind: 'failed',
        step: isStep(failure.detail.step) ? failure.detail.step : current,
        errorKind: errorKindOf(failure.detail.errorKind),
      };
    } else if (!isLatest || now - lastAt > FIRST_POST_STALE_MS) {
      // Superseded without a terminal row, or silent too long: a restart killed it.
      outcome = { kind: 'failed', step: current, errorKind: 'timedOut' };
    } else {
      outcome = { kind: 'active' };
    }

    return { runId: start.runId, startedAt: start.at, done, current, outcome };
  });
}

export function deriveFirstPostState(rows: FirstPostLogRow[], facts: FirstPostFacts, now: Date): FirstPostState {
  const runs = buildRuns(parseRows(rows), now.getTime());
  const confirm: FirstPostState = { phase: 'confirm', accepted: facts.accepted, suggestions: facts.suggestions };

  // The draft pointer: the newest finished run whose item still exists.
  let pointer: { contentItemId: string; approved: boolean } | null = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    const o = runs[i].outcome;
    if (o.kind === 'finished' && Object.prototype.hasOwnProperty.call(facts.items, o.contentItemId)) {
      pointer = { contentItemId: o.contentItemId, approved: o.approved };
      break;
    }
  }

  if (pointer) {
    const item = facts.items[pointer.contentItemId];
    if (PUBLISHING_STATUSES.has(item.status)) return { phase: 'publishing', contentItemId: pointer.contentItemId };
    if (item.status === 'PUBLISHED') {
      const job = facts.latestJobByItem[pointer.contentItemId];
      return {
        phase: 'published',
        contentItemId: pointer.contentItemId,
        url: safePostUrl(job?.externalPostUrl),
        publishedAtUtc: toIso(item.publishedAtUtc) ?? toIso(job?.publishedAtUtc),
      };
    }
  }

  const latest = runs[runs.length - 1];
  if (!latest) return confirm;

  const outcome = latest.outcome;
  if (outcome.kind === 'active') {
    return {
      phase: 'running',
      runId: latest.runId,
      done: latest.done,
      current: latest.current,
      startedAt: new Date(latest.startedAt).toISOString(),
    };
  }

  if (outcome.kind === 'failed') {
    const failuresOfStep = runs.filter((r) => r.outcome.kind === 'failed' && r.outcome.step === outcome.step).length;
    return {
      phase: 'failed',
      runId: latest.runId,
      done: latest.done,
      failed: outcome.step,
      errorKind: outcome.errorKind,
      retriesLeft: failuresOfStep > FIRST_POST_RETRY_LIMIT ? 0 : 1,
    };
  }

  if (!pointer) return confirm;
  return { phase: 'draft', contentItemId: pointer.contentItemId, approved: pointer.approved, linkedIn: facts.linkedIn };
}

/**
 * first-post/types.ts
 *
 * The contracts of "First post, Concept B" (spec
 * docs/superpowers/specs/2026-11-23-first-post-b-design.md §3, §5, §7).
 * Every task of the plan builds against these types, so changing one is a
 * cross-task change: say so in the hand-off.
 *
 * Pure types and constants only. No imports with side effects, so this file
 * is safe in server and client components alike.
 */

import type { CompetitorOrigin } from '@/lib/competitors/selection';
import type { EvidenceItem } from '@/lib/competitors/types';
import type { PublishRefusal } from '@/lib/first-post/publish-refusal';
import type { Msg } from '@/lib/workspace-journey';

/* ------------------------------------------------------------------ */
/* Run steps and state                                                 */
/* ------------------------------------------------------------------ */

/** The four steps of one first-post run, in run order. */
export const FIRST_POST_STEPS = ['matrices', 'keywords', 'idea', 'draft'] as const;
export type FirstPostStep = (typeof FIRST_POST_STEPS)[number];

/**
 * Why a step failed, as a closed list. Raw provider errors never reach the
 * client; anything that is not one of these is stored and read as `generic`.
 */
export const FIRST_POST_ERROR_KINDS = [
  'timedOut',
  'dispatch',
  'notEnoughEvidence',
  'notEnoughAxes',
  'aiUnavailable',
  'notEnoughCompetitorSignals',
  /** The company's own site could not be read, so there is no brand summary to build charts from. */
  'needsBrandSummary',
  'generic',
] as const;
export type FirstPostErrorKind = (typeof FIRST_POST_ERROR_KINDS)[number];

/**
 * What a finished step found, from stored data only (spec §3):
 * matrices `{ charts, competitors }`, keywords `{ competitors, gaps, topGap }`,
 * idea `{ topic }`, draft `{ words, approved }` (approved stored as 1 or 0,
 * because summary values are strings or numbers). A value that is not stored
 * is omitted, never invented.
 */
export type StepSummary = Record<string, string | number>;

export type StepResult = {
  step: FirstPostStep;
  summary: StepSummary;
  /** True when the run found the step already done (FIRST_POST_STEP_SKIPPED). */
  skipped?: true;
};

export type LinkedInState = { connected: false } | { connected: true; accountName: string };

/** The one read model that drives the first-post view and the bar (spec §3). */
export type FirstPostState =
  | { phase: 'confirm'; accepted: number; suggestions: number }
  | { phase: 'running'; runId: string; done: StepResult[]; current: FirstPostStep; startedAt: string }
  | {
      phase: 'failed';
      runId: string;
      done: StepResult[];
      failed: FirstPostStep;
      errorKind: FirstPostErrorKind;
      /** 1 = "Try again" is offered; 0 = the same step already failed twice: offer "Write my own instead". */
      retriesLeft: 0 | 1;
    }
  | { phase: 'draft'; contentItemId: string; approved: boolean; linkedIn: LinkedInState }
  | { phase: 'publishing'; contentItemId: string }
  | {
      phase: 'published';
      contentItemId: string;
      /** Already passed through safePostUrl: http(s) or null, never a raw provider value. */
      url: string | null;
      /** ISO string. */
      publishedAtUtc: string | null;
    };

export type FirstPostPhase = FirstPostState['phase'];

/* ------------------------------------------------------------------ */
/* Inputs of deriveFirstPostState (lib/first-post/state.ts)            */
/* ------------------------------------------------------------------ */

/**
 * One `activity_logs` row of the workspace whose action starts with
 * `FIRST_POST_` (the loader maps `created_at` to `createdAt`). `detail` is
 * the raw JSON column; the deriver validates every field it reads.
 */
export type FirstPostLogRow = {
  id: string;
  action: string;
  detail: unknown;
  createdAt: Date | string;
};

/** Content statuses as stored (Prisma enum ContentStatus). */
export type ContentStatusName =
  | 'DRAFT'
  | 'GENERATED'
  | 'EDITED'
  | 'READY'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'ARCHIVED';

export type FirstPostItemFact = { status: ContentStatusName | string; publishedAtUtc: Date | string | null };

export type FirstPostJobFact = {
  status: string;
  externalPostUrl: string | null;
  publishedAtUtc: Date | string | null;
};

export type FirstPostFacts = {
  /** Competitors with userDecision ACCEPTED. */
  accepted: number;
  /** Competitor rows the user can tick (not rejected). */
  suggestions: number;
  /**
   * The content items named by FIRST_POST_RUN_FINISHED rows that still exist
   * in this workspace, keyed by content item id. A missing key = deleted.
   */
  items: Record<string, FirstPostItemFact>;
  /** The newest publish job per content item id, when there is one. */
  latestJobByItem: Record<string, FirstPostJobFact>;
  linkedIn: LinkedInState;
};

/* ------------------------------------------------------------------ */
/* Run log: action names, ids, limits                                  */
/* ------------------------------------------------------------------ */

/** `activity_logs.action` values written by this feature (spec §7). */
export const FIRST_POST_RUN_STARTED = 'FIRST_POST_RUN_STARTED';
export const FIRST_POST_STEP_DONE = 'FIRST_POST_STEP_DONE';
export const FIRST_POST_STEP_SKIPPED = 'FIRST_POST_STEP_SKIPPED';
export const FIRST_POST_STEP_FAILED = 'FIRST_POST_STEP_FAILED';
export const FIRST_POST_RUN_FINISHED = 'FIRST_POST_RUN_FINISHED';
export const FIRST_POST_OTHER_ANGLE = 'FIRST_POST_OTHER_ANGLE';
export const FIRST_POST_DRAFT_EDITED = 'FIRST_POST_DRAFT_EDITED';
export const FIRST_POST_PUBLISH_REQUESTED = 'FIRST_POST_PUBLISH_REQUESTED';
export const FIRST_DRAFT_SEEN = 'FIRST_DRAFT_SEEN';
export const NEXT_STEP_CLICKED = 'NEXT_STEP_CLICKED';
export const CHANNEL_CONNECT_STARTED = 'CHANNEL_CONNECT_STARTED';
export const CHANNEL_CONNECTED = 'CHANNEL_CONNECTED';
export const STEP_VIEWED = 'STEP_VIEWED';

/** The rows deriveFirstPostState reads. The loader selects `action IN (...)` these. */
export const FIRST_POST_RUN_ACTIONS = [
  FIRST_POST_RUN_STARTED,
  FIRST_POST_STEP_DONE,
  FIRST_POST_STEP_SKIPPED,
  FIRST_POST_STEP_FAILED,
  FIRST_POST_RUN_FINISHED,
] as const;

/**
 * Detail shapes of the run rows, as runFirstPost writes them (spec §7).
 * The id of the FIRST_POST_RUN_STARTED row IS the run id.
 */
export type RunStartedDetail = { runId: string; attempt: number; accepted: number; kind?: 'start' | 'otherAngle' };
export type StepDoneDetail = { runId: string; step: FirstPostStep; ms: number; summary: StepSummary };
export type StepSkippedDetail = { runId: string; step: FirstPostStep; summary?: StepSummary };
export type StepFailedDetail = { runId: string; step: FirstPostStep; errorKind: FirstPostErrorKind };
export type RunFinishedDetail = { runId: string; contentItemId: string; approved: boolean };

/**
 * The deterministic run id, `fpr_<workspaceId>_<attempt>`. Two concurrent
 * starts compute the same id, so the second insert fails with P2002: that is
 * the lock (spec D5).
 */
export function firstPostRunId(workspaceId: string, attempt: number): string {
  if (!workspaceId) throw new Error('firstPostRunId: workspaceId is required');
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error('firstPostRunId: attempt must be an integer >= 1');
  return `fpr_${workspaceId}_${attempt}`;
}

/** A running run with no new row for this long is reported as failed `timedOut`. */
export const FIRST_POST_STALE_MS = 15 * 60 * 1000;
/** "Try again" offers per step: a second failure of the same step replaces it with "Write my own instead". */
export const FIRST_POST_RETRY_LIMIT = 1;
/** "Other angle" reruns per workspace (0 credits; spec §15 Q5). */
export const FIRST_POST_OTHER_ANGLE_LIMIT = 3;

/**
 * The closed list of `STEP_VIEWED.detail.tab` values. The workspace tabs are
 * the ones `resolveTab` allows (growth/[id]/page.tsx) plus `first-post`; the
 * last four are the non-workspace pages that log a view (spec §7).
 */
export const STEP_VIEW_TABS = [
  'pipeline',
  'ideation',
  'strategy',
  'progress',
  'matrices',
  'keywords',
  'offerings',
  'narrative',
  'calendar',
  'seo',
  'reports',
  'autopilot',
  'first-post',
  'onboarding',
  'new',
  'today',
  'connections',
] as const;
export type StepViewTab = (typeof STEP_VIEW_TABS)[number];

/* ------------------------------------------------------------------ */
/* The next-step bar (lib/next-step.ts, spec §5)                       */
/* ------------------------------------------------------------------ */

export const NEXT_STEP_IDS = [
  'addCompany',
  'confirmCompetitors',
  'writing',
  'runFailed',
  'readDraft',
  'draftBlocked',
  'connectLinkedIn',
  'publishNow',
  'publishing',
  'firstPostLive',
  'autopilot',
  'narrative',
  'journey',
  'writeOwn',
] as const;
export type NextStepId = (typeof NEXT_STEP_IDS)[number];

export const NEXT_STEP_SURFACES = ['workspace', 'today', 'connections', 'connected'] as const;
export type NextStepSurface = (typeof NEXT_STEP_SURFACES)[number];

/**
 * The bar's one button. Every `label` is a Msg whose key is relative to the
 * messages ROOT (e.g. `nextStep.publishNow.action`, or `journey.steps.market.action`
 * for the open-mode journey state), so the component resolves them with a
 * root translator: `getTranslations()` / `useTranslations()` with no namespace.
 */
export type NextStepAction =
  | { kind: 'link'; label: Msg; href: string; external?: true }
  /** getSocialConnectUrl('linkedin', workspaceId), after recordNextStepClick. */
  | { kind: 'connectLinkedIn'; label: Msg; workspaceId: string }
  /** publishNow(contentItemId), then show the first-post tab at `href`. */
  | { kind: 'publishNow'; label: Msg; contentItemId: string; href: string }
  /** startFirstPost(workspaceId) on the first-post tab itself (the view shows no second "Try again"). */
  | { kind: 'retryFirstPost'; label: Msg; workspaceId: string; href: string }
  /** firstPostOtherAngle(workspaceId) on the first-post tab itself. */
  | { kind: 'otherAngle'; label: Msg; workspaceId: string; href: string };

export type NextStep = {
  id: NextStepId;
  /** "n/4" on the guided first-post steps only. */
  counter?: { n: 1 | 2 | 3 | 4; total: 4 };
  /** Root-relative key, see NextStepAction. ≤ 20 words with the action label. */
  line: Msg;
  why?: Msg;
  /** Absent = no button (a wait state, or nothing to click). */
  action?: NextStepAction;
  /** A wait state: show progress, no button. */
  busy: boolean;
};

/* ------------------------------------------------------------------ */
/* What growth/[id]/page.tsx (T5) passes to FirstPostView (T4)         */
/* ------------------------------------------------------------------ */

export type FirstPostCompetitor = {
  id: string;
  name: string;
  domain: string | null;
  /** Stored value: 'ACCEPTED' | 'PENDING' | 'REJECTED' | null. Only ACCEPTED rows arrive ticked. */
  userDecision: string | null;
  /**
   * The raw stored evidence items (Competitor.evidence, validated to an array).
   * The one evidence line is picked by first-post-view-logic (T4) with
   * splitEvidence: the first source's host, or "AI guess" when there is none.
   */
  evidence: EvidenceItem[];
  /**
   * competitorOrigin of the row (Competitor.source = 'MANUAL' → 'manual';
   * a discoveryRunId → 'evidence'; else 'initialGuess'). A manual row shows
   * "Added by you" instead of its evidence line, on every load.
   */
  source: CompetitorOrigin;
};

export type FirstPostDraft = {
  id: string;
  /** The post text as it will be published (textForChannel already applied). */
  content: string;
  topic: string;
  /** Raw ContentItem.qualityVerdict JSON; QualityVerdictNotice reads it with readStoredVerdict. */
  qualityVerdict: unknown;
};

/** Stored facts for "Why this post" (spec §4.3). Missing = not stored; never invented. */
export type FirstPostWhyFacts = {
  matrixCharts: number;
  matricesReady: boolean;
  /** competitorKeywordsIntel.competitors.length */
  keywordCompetitors: number;
  /** competitorKeywordsIntel.content_gaps.length */
  gaps: number;
  /** content_gaps[0].topic, when stored. */
  topGap: string | null;
};

export type FirstPostViewProps = {
  workspaceId: string;
  state: FirstPostState;
  /** Not-rejected competitor rows, in display order. */
  competitors: FirstPostCompetitor[];
  linkedIn: LinkedInState;
  /** Present in the draft / publishing / published phases when the item still exists. */
  draft: FirstPostDraft | null;
  why: FirstPostWhyFacts;
  /** FIRST_POST_OTHER_ANGLE rows so far; the button hides at FIRST_POST_OTHER_ANGLE_LIMIT. */
  otherAnglesUsed: number;
  /** `?publish=`: why the bar's "Publish now" was refused, when it was. */
  publishRefusal?: PublishRefusal | null;
};

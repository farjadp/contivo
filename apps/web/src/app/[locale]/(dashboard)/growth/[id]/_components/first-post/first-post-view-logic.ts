/**
 * first-post-view-logic.ts
 *
 * The rules of the first-post view (spec first-post B §4), kept pure so they
 * are tested without a browser: which evidence line a competitor shows, what
 * starts ticked, when "Write my first post" is enabled, how often the view
 * polls, and the word budgets of each screen.
 */

import type { EvidenceItem } from '@/lib/competitors/types';
import {
  FIRST_POST_STEPS,
  type FirstPostCompetitor,
  type FirstPostState,
  type FirstPostStep,
  type StepResult,
} from '@/lib/first-post/types';
import { canStartConnectFlow, safePostUrl } from '@/lib/publish-outcome';

import { splitEvidence } from '../competitor-discovery-logic';

/* ------------------------------------------------------------------ */
/* Competitors                                                         */
/* ------------------------------------------------------------------ */

/** "Write my first post" needs this many ticked competitors; the server re-checks. */
export const MIN_COMPETITORS = 2;

export type EvidenceLine = { kind: 'source'; host: string } | { kind: 'aiGuess' };

/** The host of an http(s) URL without a leading www., or null. */
function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

/**
 * One line per competitor: the host of the first page that named it (a search
 * citation or result), or "AI guess" when nothing did. The competitor's own
 * pages are not evidence that it competes with you.
 */
export function evidenceLine(evidence: EvidenceItem[]): EvidenceLine {
  for (const source of splitEvidence(evidence).sources) {
    const host = hostOf(source.url);
    if (host) return { kind: 'source', host };
  }
  return { kind: 'aiGuess' };
}

export type CompetitorLine = { kind: 'manual' } | EvidenceLine;

/** A row the user added says "Added by you"; any other row shows its evidence line. */
export function competitorLine(c: Pick<FirstPostCompetitor, 'source' | 'evidence'>): CompetitorLine {
  if (c.source === 'manual') return { kind: 'manual' };
  return evidenceLine(c.evidence);
}

/** Nothing is ticked in advance except the user's own earlier ACCEPTED decisions. */
export function initialTicked(competitors: FirstPostCompetitor[]): Set<string> {
  return new Set(competitors.filter((c) => c.userDecision === 'ACCEPTED').map((c) => c.id));
}

export function addTicked(ticked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ticked);
  next.add(id);
  return next;
}

export function removeTicked(ticked: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(ticked);
  next.delete(id);
  return next;
}

/** Enabled at ≥ 2 ticks, and not while a tick is still being saved. */
export function canWriteFirstPost(tickedCount: number, savesInFlight: number): boolean {
  return tickedCount >= MIN_COMPETITORS && savesInFlight === 0;
}

/** Discovery found too few: lead with "Add the competitors you know". */
export function needsManualAdd(competitors: FirstPostCompetitor[]): boolean {
  return competitors.length < MIN_COMPETITORS;
}

/* ------------------------------------------------------------------ */
/* Polling                                                             */
/* ------------------------------------------------------------------ */

export const RUN_POLL_MS = 3000;
export const PUBLISH_FAST_POLL_MS = 3000;
export const PUBLISH_SLOW_POLL_MS = 15000;
/** The scheduler runs every minute; after 3 min the view says "still publishing" and slows down. */
export const PUBLISH_FAST_WINDOW_MS = 3 * 60 * 1000;

export function isPublishSlow(elapsedMs: number): boolean {
  return elapsedMs >= PUBLISH_FAST_WINDOW_MS;
}

export function publishPollDelay(elapsedMs: number): number {
  return isPublishSlow(elapsedMs) ? PUBLISH_SLOW_POLL_MS : PUBLISH_FAST_POLL_MS;
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

/** The live post link, only ever through safePostUrl (http(s) or null). */
export function publishedLink(url: string | null | undefined): string | null {
  return safePostUrl(url);
}

/** The OAuth platforms getSocialConnectUrl accepts. */
const OAUTH_PLATFORMS = ['linkedin', 'x', 'facebook', 'tiktok'] as const;
type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

const CHANNEL_PLATFORM: Record<string, string> = { linkedin: 'linkedin', twitter: 'x' };

export type ConnectFix = { kind: 'oauth'; platform: OAuthPlatform } | { kind: 'connections'; tab: 'social' | 'websites' };

/**
 * What the "connect to publish" button does for a refused publish: start the
 * provider's OAuth when the web can, otherwise open the right Connections tab.
 */
export function connectFix(platform: string | null | undefined, channel: string): ConnectFix {
  if (channel === 'blog' || platform === 'SITE') return { kind: 'connections', tab: 'websites' };
  const name = (platform || CHANNEL_PLATFORM[channel] || channel).toLowerCase();
  if ((OAUTH_PLATFORMS as readonly string[]).includes(name) && canStartConnectFlow(name)) {
    return { kind: 'oauth', platform: name as OAuthPlatform };
  }
  return { kind: 'connections', tab: 'social' };
}

/* ------------------------------------------------------------------ */
/* Run progress                                                        */
/* ------------------------------------------------------------------ */

export type RunRowStatus = 'done' | 'current' | 'failed' | 'pending';
export type RunRow = { step: FirstPostStep; status: RunRowStatus; result: StepResult | null };

/** The four rows, in run order, from a running or failed state. */
export function runRows(state: Extract<FirstPostState, { phase: 'running' | 'failed' }>): RunRow[] {
  const done = new Map(state.done.map((r) => [r.step, r]));
  const active = state.phase === 'running' ? state.current : state.failed;
  return FIRST_POST_STEPS.map((step) => {
    const result = done.get(step) ?? null;
    if (result) return { step, status: 'done', result };
    if (step === active) return { step, status: state.phase === 'running' ? 'current' : 'failed', result: null };
    return { step, status: 'pending', result: null };
  });
}

export type SummaryMessage = { key: string; values: Record<string, string | number> };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * The key under `tabsA.firstPost.progress.summary` and its values, built only
 * from what the run stored. Null = nothing to say (never an invented number).
 */
export function stepSummaryMessage(result: StepResult): SummaryMessage | null {
  const s = result.summary;
  switch (result.step) {
    case 'matrices':
      if (num(s.charts) && num(s.competitors)) return { key: 'matrices', values: { charts: s.charts, competitors: s.competitors } };
      if (num(s.charts)) return { key: 'matricesCharts', values: { charts: s.charts } };
      break;
    case 'keywords':
      if (num(s.gaps) && text(s.topGap)) return { key: 'keywordsTopGap', values: { gaps: s.gaps, topGap: s.topGap } };
      if (num(s.gaps)) return { key: 'keywords', values: { gaps: s.gaps } };
      break;
    case 'idea':
      if (text(s.topic)) return { key: 'idea', values: { topic: s.topic } };
      break;
    case 'draft':
      if (num(s.words)) return { key: 'draft', values: { words: s.words } };
      break;
  }
  return result.skipped ? { key: 'skipped', values: {} } : null;
}

/* ------------------------------------------------------------------ */
/* Word budgets (concepts.md §6, spec §4)                              */
/* ------------------------------------------------------------------ */

/** UI words per screen, the post text and per-competitor evidence lines excluded. */
export const WORD_BUDGETS = {
  confirm: 60,
  confirmFew: 60,
  progress: 60,
  failed: 60,
  draft: 40,
  why: 50,
  publish: 35,
  published: 30,
} as const;

/** The keys under `tabsA.firstPost` that one screen shows at once. */
export const SCREEN_KEYS: Record<keyof typeof WORD_BUDGETS, string[]> = {
  confirm: ['confirm.title', 'confirm.disclaimer', 'confirm.picked', 'confirm.start', 'confirm.add'],
  confirmFew: [
    'confirm.titleFew',
    'confirm.disclaimerFew',
    'confirm.addLabel',
    'confirm.addSubmit',
    'confirm.picked',
    'confirm.start',
    'confirm.writeOwn',
  ],
  progress: [
    'progress.title',
    'progress.lede',
    'progress.steps.matrices',
    'progress.steps.keywords',
    'progress.steps.idea',
    'progress.steps.draft',
    'progress.summary.matrices',
    'progress.summary.keywordsTopGap',
    'progress.summary.idea',
  ],
  failed: [
    'progress.title',
    'progress.steps.matrices',
    'progress.steps.keywords',
    'progress.steps.idea',
    'progress.steps.draft',
    'failed.line.keywords',
    'failed.reason.notEnoughCompetitorSignals',
    'failed.writeOwn',
    'failed.report',
  ],
  draft: ['draft.eyebrow', 'draft.preview', 'draft.edit', 'draft.otherAngle', 'draft.writeOwn'],
  why: [
    'why.title',
    'why.topGapTag',
    'why.topGap',
    'why.matrices',
    'why.matricesView',
    'why.keywords',
    'why.keywordsView',
    'why.aiTag',
    'why.aiWording',
  ],
  publish: ['publish.connectedAs', 'publish.whatHappens', 'publish.scheduleLater'],
  published: ['published.eyebrow', 'published.title', 'published.view', 'published.copy', 'published.open'],
};

/**
 * Words in a message as a reader sees them: each top-level ICU argument
 * (`{count, number}`, a whole `{n, plural, …}`) counts as one word.
 */
export function countWords(message: string): number {
  let out = '';
  let depth = 0;
  for (const ch of message) {
    if (ch === '{') {
      if (depth === 0) out += ' X ';
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0) {
      out += ch;
    }
  }
  return out
    .split(/\s+/)
    .filter((w) => w && /[\p{L}\p{N}X]/u.test(w)).length;
}

function lookup(messages: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages);
}

/** Total words of one screen in a full tabs-a catalogue. A missing key throws, so the test catches it. */
export function screenWords(catalogue: Record<string, unknown>, screen: keyof typeof WORD_BUDGETS): number {
  return SCREEN_KEYS[screen].reduce((sum, key) => {
    const value = lookup(catalogue, `tabsA.firstPost.${key}`);
    if (typeof value !== 'string') throw new Error(`tabsA.firstPost.${key} is missing`);
    return sum + countWords(value);
  }, 0);
}

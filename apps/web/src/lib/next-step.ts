/**
 * next-step.ts
 *
 * The one next-step bar (spec first-post B §5): a single line and at most
 * one button, the same on the workspace page, Today, Connections and the
 * `?connected=` landing. Pure; the caller loads the input
 * (lib/next-step-load.ts) and the component translates the Msgs.
 *
 * Every Msg key here is relative to the messages ROOT: `nextStep.*` keys
 * live in messages/<locale>/workspace.json under `nextStep`, and the
 * open-mode journey state reuses `journey.steps.*`. Resolve them with a
 * root translator (no namespace).
 *
 * The caller does not render the bar at all when the kill switch is on
 * (readKillSwitch() in lib/first-post/mode.ts, spec §10).
 */

import type { FirstPostState, FirstPostStep, NextStep, NextStepSurface } from '@/lib/first-post/types';
import { buildJourney, tabGate, type Msg, type WorkspaceFacts } from '@/lib/workspace-journey';

export type NextStepInput = {
  /** isGuidedMode for the signed-in user. */
  guided: boolean;
  /** The workspace in scope; null = the user has none. */
  facts: WorkspaceFacts | null;
  /** deriveFirstPostState for that workspace; null when not loaded. */
  firstPost: FirstPostState | null;
  surface: NextStepSurface;
  /** The workspace page is showing `?tab=first-post`. Only read on the workspace surfaces. */
  onFirstPostTab: boolean;
  /** "Try another angle" is still allowed (under FIRST_POST_OTHER_ANGLE_LIMIT). Absent = true. */
  otherAnglesLeft?: boolean;
};

const RUN_FAILED_STEPS: readonly FirstPostStep[] = ['matrices', 'keywords', 'idea', 'draft'];

/**
 * Every `nextStep.*` key buildNextStep can emit, plus the counter. T5 writes
 * exactly these in all five catalogues; next-step.test.ts checks the list
 * against the function and, once the catalogue exists, against en.
 *
 * `nextStep.counter` takes `{n, number}` and `{total, number}` (so fa gets
 * Persian digits). No other key takes a value.
 */
export const NEXT_STEP_MESSAGE_KEYS = [
  'nextStep.counter',
  'nextStep.addCompany.line',
  'nextStep.addCompany.action',
  'nextStep.confirmCompetitors.line',
  'nextStep.confirmCompetitors.why',
  'nextStep.confirmCompetitors.action',
  'nextStep.writing.line',
  ...RUN_FAILED_STEPS.map((s) => `nextStep.runFailed.line.${s}`),
  'nextStep.runFailed.action',
  'nextStep.runFailed.actionWriteOwn',
  'nextStep.runFailed.actionBrand',
  'nextStep.readDraft.line',
  'nextStep.readDraft.action',
  'nextStep.draftBlocked.line',
  'nextStep.draftBlocked.lineEdit',
  'nextStep.draftBlocked.action',
  'nextStep.connectLinkedIn.line',
  'nextStep.connectLinkedIn.why',
  'nextStep.connectLinkedIn.action',
  'nextStep.publishNow.line',
  'nextStep.publishNow.action',
  'nextStep.publishing.line',
  'nextStep.firstPostLive.line',
  'nextStep.firstPostLive.action',
  'nextStep.autopilot.line',
  'nextStep.autopilot.action',
  'nextStep.narrative.line',
  'nextStep.narrative.why',
  'nextStep.narrative.action',
] as const;

export type NextStepMessageKey = (typeof NEXT_STEP_MESSAGE_KEYS)[number];

const k = (key: NextStepMessageKey): Msg => ({ key });

/** A journey Msg (keyed under the `journey` namespace) made root-relative. */
const fromJourney = (m: Msg): Msg => ({ key: `journey.${m.key}`, ...(m.values ? { values: m.values } : {}) });

export function buildNextStep(input: NextStepInput): NextStep | null {
  const { facts, firstPost } = input;
  const onTab = input.onFirstPostTab && (input.surface === 'workspace' || input.surface === 'connected');

  // The live link outlives guided mode: the page that shows it is the first
  // render after the publish, when the user is no longer guided.
  if (firstPost?.phase === 'published' && onTab) {
    return {
      id: 'firstPostLive',
      line: k('nextStep.firstPostLive.line'),
      ...(firstPost.url
        ? { action: { kind: 'link' as const, label: k('nextStep.firstPostLive.action'), href: firstPost.url, external: true as const } }
        : {}),
      busy: false,
    };
  }

  if (input.guided) {
    if (!facts) {
      return {
        id: 'addCompany',
        line: k('nextStep.addCompany.line'),
        action: { kind: 'link', label: k('nextStep.addCompany.action'), href: '/growth/new' },
        busy: false,
      };
    }
    const ws = facts.workspaceId;
    const firstPostTab = `/growth/${ws}?tab=first-post`;
    const state: FirstPostState = firstPost ?? { phase: 'confirm', accepted: facts.acceptedCompetitors, suggestions: 0 };

    switch (state.phase) {
      case 'confirm':
        return {
          id: 'confirmCompetitors',
          counter: { n: 1, total: 4 },
          line: k('nextStep.confirmCompetitors.line'),
          why: k('nextStep.confirmCompetitors.why'),
          action: { kind: 'link', label: k('nextStep.confirmCompetitors.action'), href: firstPostTab },
          busy: false,
        };
      case 'running':
        return { id: 'writing', counter: { n: 2, total: 4 }, line: k('nextStep.writing.line'), busy: true };
      case 'failed':
        return {
          id: 'runFailed',
          counter: { n: 2, total: 4 },
          line: { key: `nextStep.runFailed.line.${state.failed}` },
          action:
            // Retrying cannot help when the site itself was unreadable: send them to Brand Memory.
            state.errorKind === 'needsBrandSummary'
              ? { kind: 'link', label: k('nextStep.runFailed.actionBrand'), href: `/growth/${ws}?tab=strategy` }
              : state.retriesLeft > 0
              ? onTab
                ? { kind: 'retryFirstPost', label: k('nextStep.runFailed.action'), workspaceId: ws, href: firstPostTab }
                : { kind: 'link', label: k('nextStep.runFailed.action'), href: firstPostTab }
              : {
                  kind: 'link',
                  label: k('nextStep.runFailed.actionWriteOwn'),
                  href: `/growth/${ws}?tab=pipeline&write=1`,
                },
          busy: false,
        };
      case 'draft':
        // A draft the gate held: the next step is the draft, not Connect or Publish (spec §4.3).
        if (!state.approved) {
          const anglesLeft = input.otherAnglesLeft !== false;
          if (onTab && !anglesLeft) {
            return { id: 'draftBlocked', counter: { n: 3, total: 4 }, line: k('nextStep.draftBlocked.lineEdit'), busy: false };
          }
          return {
            id: 'draftBlocked',
            counter: { n: 3, total: 4 },
            line: k(anglesLeft ? 'nextStep.draftBlocked.line' : 'nextStep.draftBlocked.lineEdit'),
            action: onTab
              ? { kind: 'otherAngle', label: k('nextStep.draftBlocked.action'), workspaceId: ws, href: firstPostTab }
              : {
                  kind: 'link',
                  label: k(anglesLeft ? 'nextStep.draftBlocked.action' : 'nextStep.readDraft.action'),
                  href: firstPostTab,
                },
            busy: false,
          };
        }
        if (state.linkedIn.connected) {
          return {
            id: 'publishNow',
            counter: { n: 4, total: 4 },
            line: k('nextStep.publishNow.line'),
            action: {
              kind: 'publishNow',
              label: k('nextStep.publishNow.action'),
              contentItemId: state.contentItemId,
              href: firstPostTab,
            },
            busy: false,
          };
        }
        if (onTab) {
          return {
            id: 'connectLinkedIn',
            counter: { n: 3, total: 4 },
            line: k('nextStep.connectLinkedIn.line'),
            why: k('nextStep.connectLinkedIn.why'),
            action: { kind: 'connectLinkedIn', label: k('nextStep.connectLinkedIn.action'), workspaceId: ws },
            busy: false,
          };
        }
        return {
          id: 'readDraft',
          counter: { n: 3, total: 4 },
          line: k('nextStep.readDraft.line'),
          action: { kind: 'link', label: k('nextStep.readDraft.action'), href: firstPostTab },
          busy: false,
        };
      case 'publishing':
        return { id: 'publishing', counter: { n: 4, total: 4 }, line: k('nextStep.publishing.line'), busy: true };
      case 'published':
        // Off the first-post tab: guided mode ends on this render, so fall through to open mode.
        break;
    }
  }

  // Open mode.
  if (!facts) return null;
  const ws = facts.workspaceId;
  const gates = tabGate(facts);

  if (!gates.autopilot && !facts.autopilotEnabled) {
    return {
      id: 'autopilot',
      line: k('nextStep.autopilot.line'),
      action: { kind: 'link', label: k('nextStep.autopilot.action'), href: `/growth/${ws}?tab=autopilot` },
      busy: false,
    };
  }

  // Narrative only when its own tab is open: pointing at a gated tab is the
  // dead end this bar exists to remove.
  if (facts.storylines === 0 && !gates.narrative) {
    return {
      id: 'narrative',
      line: k('nextStep.narrative.line'),
      why: k('nextStep.narrative.why'),
      action: { kind: 'link', label: k('nextStep.narrative.action'), href: `/growth/${ws}?tab=narrative` },
      busy: false,
    };
  }

  const next = buildJourney(facts).next;
  if (!next) return null;
  return {
    id: 'journey',
    line: fromJourney(next.title),
    why: fromJourney(next.why),
    action: { kind: 'link', label: fromJourney(next.action), href: next.href },
    busy: false,
  };
}

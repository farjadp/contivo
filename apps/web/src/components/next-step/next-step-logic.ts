/**
 * Pure helpers of the next-step bar: turning a NextStep (Msgs) into what the
 * server bar renders and hands to its client button (strings only, nothing
 * that cannot cross the server/client boundary).
 */

import type { NextStep, NextStepAction } from '@/lib/first-post/types';
import type { Msg } from '@/lib/workspace-journey';

import type { NextStepButtonAction } from './NextStepButton';

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The button's action without its label (the label is translated separately). */
export function toButtonAction(action: NextStepAction): NextStepButtonAction {
  switch (action.kind) {
    case 'link':
      return action.external ? { kind: 'link', href: action.href, external: true } : { kind: 'link', href: action.href };
    case 'connectLinkedIn':
      return { kind: 'connectLinkedIn', workspaceId: action.workspaceId };
    case 'publishNow':
      return { kind: 'publishNow', contentItemId: action.contentItemId, href: action.href };
  }
}

export type BarText = {
  counter: string | null;
  line: string;
  why: string | null;
  label: string | null;
};

/** Every word the bar shows, through a root translator (Msg keys are root-relative). */
export function barText(step: NextStep, t: Translate): BarText {
  const msg = (m: Msg) => t(m.key, m.values);
  return {
    counter: step.counter ? t('nextStep.counter', { n: step.counter.n, total: step.counter.total }) : null,
    line: msg(step.line),
    why: step.why ? msg(step.why) : null,
    label: step.action ? msg(step.action.label) : null,
  };
}

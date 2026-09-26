/**
 * workspace-loop.ts
 *
 * The workspace as six stages instead of eleven tabs in four groups:
 * Know → Watch → Think → Make → Ship → Learn.
 *
 * This module only regroups. It invents no readiness of its own: whether a
 * stage is done, next or locked is read from the journey and the tab gates in
 * workspace-journey.ts, so the rail, the setup guide and the dashboard still
 * cannot disagree about what the user should do next.
 */

import type { Journey, Msg, StepId, StepState } from './workspace-journey';

export type StageId = 'know' | 'watch' | 'think' | 'make' | 'ship' | 'learn';

export type StageState = 'done' | 'next' | 'open' | 'locked';

type StageDef = {
  id: StageId;
  /** Tabs in the order they appear under the stage; the first is its landing tab. */
  tabs: readonly string[];
  /** Setup steps that decide the stage's state. Empty = decided by gates alone. */
  steps: readonly StepId[];
};

export const STAGES: readonly StageDef[] = [
  { id: 'know', tabs: ['strategy', 'offerings'], steps: ['brand'] },
  { id: 'watch', tabs: ['matrices', 'keywords', 'seo'], steps: ['market', 'keywords'] },
  { id: 'think', tabs: ['narrative', 'ideation'], steps: ['narrative'] },
  { id: 'make', tabs: ['pipeline'], steps: [] },
  { id: 'ship', tabs: ['calendar', 'autopilot'], steps: ['channel', 'autopilot'] },
  { id: 'learn', tabs: ['reports', 'progress'], steps: [] },
];

export function stageForTab(tab: string): StageId {
  return STAGES.find((s) => s.tabs.includes(tab))?.id ?? 'make';
}

export type LoopStage = {
  id: StageId;
  /** 1-based, shown as "01". */
  order: number;
  state: StageState;
  /** Where the stage link goes: its first tab that exists for this workspace. */
  landingTab: string;
  tabs: string[];
};

function fromSteps(states: StepState[]): StageState | null {
  if (states.length === 0) return null;
  if (states.every((s) => s === 'done')) return 'done';
  if (states.includes('current')) return 'next';
  if (states.every((s) => s === 'locked' || s === 'done')) return 'locked';
  return 'open';
}

/**
 * @param availableTabs tabs that exist for this workspace (progress only
 *   appears once a report has been generated).
 * @param gates the result of tabGate(): a tab with an entry is locked.
 * @param hasContent whether anything has been drafted, scheduled or published.
 */
export function buildLoop(
  journey: Journey,
  gates: Record<string, Msg | undefined>,
  availableTabs: readonly string[],
  hasContent: boolean,
): LoopStage[] {
  const stepState = new Map(journey.steps.map((s) => [s.id, s.state]));

  return STAGES.map((def, i) => {
    const tabs = def.tabs.filter((t) => availableTabs.includes(t));
    const allGated = tabs.length > 0 && tabs.every((t) => Boolean(gates[t]));

    let state =
      fromSteps(def.steps.map((id) => stepState.get(id)).filter((s): s is StepState => Boolean(s))) ??
      (allGated ? 'locked' : 'open');

    // Make has no setup step: it is done once something has been produced.
    if (def.id === 'make' && hasContent) state = 'done';

    return {
      id: def.id,
      order: i + 1,
      state,
      landingTab: tabs.find((t) => !gates[t]) ?? tabs[0] ?? def.tabs[0],
      tabs,
    };
  });
}

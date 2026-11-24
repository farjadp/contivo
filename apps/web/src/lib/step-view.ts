/**
 * step-view.ts
 *
 * STEP_VIEWED for the pages outside the workspace (spec §7): /onboarding,
 * /growth/new, /dashboard (`today`) and /connections. Fire-and-forget like
 * the workspace page's own write: the caller does not await it, and a
 * failed log never fails a render.
 */

import { writeActivityLog } from '@/lib/activity-log';
import { STEP_VIEWED, STEP_VIEW_TABS, type StepViewTab } from '@/lib/first-post/types';

const TABS: ReadonlySet<string> = new Set(STEP_VIEW_TABS);

export function logStepView(userId: string, tab: StepViewTab, workspaceId?: string | null): void {
  try {
    if (!userId || typeof tab !== 'string' || !TABS.has(tab)) return;
    void writeActivityLog({
      userId,
      workspaceId: workspaceId ?? null,
      action: STEP_VIEWED,
      detail: { tab },
    }).catch((error: unknown) => console.error('logStepView failed:', error));
  } catch (error) {
    console.error('logStepView failed:', error);
  }
}

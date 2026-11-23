'use server';

// apps/web/src/app/actions/next-step.ts

import { getSession } from '@/lib/auth';
import { writeActivityLog } from '@/lib/activity-log';
import {
  NEXT_STEP_CLICKED,
  NEXT_STEP_IDS,
  NEXT_STEP_SURFACES,
  type NextStepId,
  type NextStepSurface,
} from '@/lib/first-post/types';

const STEP_IDS: ReadonlySet<string> = new Set(NEXT_STEP_IDS);
const SURFACES: ReadonlySet<string> = new Set(NEXT_STEP_SURFACES);

/**
 * NEXT_STEP_CLICKED { stepId, surface } (spec §7). Both values come from the
 * client, so both are checked against the closed lists; anything else, or no
 * session, is a silent no-op. A failed write never reaches the button.
 */
export async function recordNextStepClick(stepId: NextStepId, surface: NextStepSurface): Promise<void> {
  if (typeof stepId !== 'string' || typeof surface !== 'string') return;
  if (!STEP_IDS.has(stepId) || !SURFACES.has(surface)) return;

  try {
    const session = await getSession();
    if (!session?.userId) return;
    await writeActivityLog({
      userId: session.userId as string,
      workspaceId: null,
      action: NEXT_STEP_CLICKED,
      detail: { stepId, surface },
    });
  } catch (error) {
    console.error('recordNextStepClick failed:', error);
  }
}

/**
 * first-post/mode.ts
 *
 * Guided mode (spec D1): the user has no PUBLISHED content item in any
 * workspace AND no enabled autopilot policy. While it holds, the advanced
 * chrome is hidden and the workspace opens on the first-post view.
 *
 * Kill switch: FIRST_POST_GUIDED=off on contivo-web restores today's UI for
 * everyone. This file is the one place that reads it. Server-only: it reads
 * process.env and the database.
 */

import { prisma } from '@/lib/db';

export type GuidedModeInput = {
  publishedAnywhere: boolean;
  autopilotEnabledAnywhere: boolean;
  killSwitch: boolean;
};

export function isGuidedMode(input: GuidedModeInput): boolean {
  return !input.killSwitch && !input.publishedAnywhere && !input.autopilotEnabledAnywhere;
}

/** True when guided mode is switched off (FIRST_POST_GUIDED=off). */
export function readKillSwitch(): boolean {
  return process.env.FIRST_POST_GUIDED === 'off';
}

/**
 * Two counts. A database error is thrown, not read as either mode: guessing
 * "open" would show a new user the full chrome, guessing "guided" would hide
 * a publishing user's tools.
 */
export async function loadGuidedMode(userId: string): Promise<boolean> {
  const killSwitch = readKillSwitch();
  if (killSwitch) return false;
  const [published, autopilots] = await Promise.all([
    prisma.contentItem.count({ where: { userId, status: 'PUBLISHED' } }),
    // Through the workspace owner, not AutopilotPolicy.userId: the owner's
    // workspace is what the guided UI hides the Autopilot tab of.
    prisma.autopilotPolicy.count({ where: { enabled: true, workspace: { userId } } }),
  ]);
  return isGuidedMode({ publishedAnywhere: published > 0, autopilotEnabledAnywhere: autopilots > 0, killSwitch });
}

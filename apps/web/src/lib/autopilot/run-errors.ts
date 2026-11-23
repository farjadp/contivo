/**
 * autopilot/run-errors.ts — stable codes for the run outcomes the UI translates.
 *
 * The runner is called from a cron route with no request behind it, so it
 * cannot translate anything (see lib/action-errors.ts). It used to store an
 * English sentence in `AutopilotRun.error`, which the Autopilot tab rendered
 * verbatim, in Persian too. For the outcomes a customer is expected to act on,
 * it now stores one of these codes and the tab turns it into copy.
 *
 * Pure module: imported by the client tab as well as the runner.
 */

export const AUTOPILOT_RUN_ERROR = {
  /** The balance did not cover one post when the run started. */
  OUT_OF_CREDITS: 'OUT_OF_CREDITS',
  /** The balance ran out during the run, before anything was scheduled. */
  OUT_OF_CREDITS_MID_RUN: 'OUT_OF_CREDITS_MID_RUN',
  /**
   * Drafts were written but their picture failed, so they go out text only
   * (B19). Stored as `IMAGES_MISSING:<ImageCause>`, e.g.
   * `IMAGES_MISSING:IMAGE_MODEL_UNAVAILABLE`; the run log has one
   * `image_failed` step per draft.
   */
  IMAGES_MISSING: 'IMAGES_MISSING',
} as const;

/** The stored run error for drafts that lost their picture. */
export function imagesMissingError(cause: string): string {
  return `${AUTOPILOT_RUN_ERROR.IMAGES_MISSING}:${cause}`;
}

export type AutopilotRunErrorCode = (typeof AUTOPILOT_RUN_ERROR)[keyof typeof AUTOPILOT_RUN_ERROR];

const CODES = new Set<string>(Object.values(AUTOPILOT_RUN_ERROR));

/**
 * Sentences stored by builds before the codes existed. Those rows stay in the
 * run history, so they are read as the code they stand for.
 */
const LEGACY: Array<[RegExp, AutopilotRunErrorCode]> = [
  [/^Not enough credits to run:/, AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS],
  [/^Ran out of credits before anything could be scheduled\.?$/, AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS_MID_RUN],
  [/^Insufficient credits\. You have /, AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS_MID_RUN],
];

/** The code a stored run error stands for, or null when it should be shown as written. */
export function autopilotRunErrorCode(raw: string | null | undefined): AutopilotRunErrorCode | null {
  const text = raw?.trim();
  if (!text) return null;
  if (CODES.has(text)) return text as AutopilotRunErrorCode;
  if (text.startsWith(`${AUTOPILOT_RUN_ERROR.IMAGES_MISSING}:`)) return AUTOPILOT_RUN_ERROR.IMAGES_MISSING;
  for (const [pattern, code] of LEGACY) {
    if (pattern.test(text)) return code;
  }
  return null;
}

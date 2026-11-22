import { describe, expect, it } from 'vitest';

import { AUTOPILOT_RUN_ERROR, autopilotRunErrorCode } from './run-errors';

describe('autopilotRunErrorCode', () => {
  it('passes the stable codes through', () => {
    expect(autopilotRunErrorCode('OUT_OF_CREDITS')).toBe(AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS);
    expect(autopilotRunErrorCode('OUT_OF_CREDITS_MID_RUN')).toBe(AUTOPILOT_RUN_ERROR.OUT_OF_CREDITS_MID_RUN);
  });

  // Rows written before the codes existed hold English sentences. They must
  // read the same as new rows, in every locale.
  it('maps the legacy start-of-run sentence', () => {
    expect(autopilotRunErrorCode('Not enough credits to run: 3 left, 9 needed for one post.')).toBe('OUT_OF_CREDITS');
    expect(autopilotRunErrorCode('Not enough credits to run: 0 left, 9 needed for one post.')).toBe('OUT_OF_CREDITS');
  });

  it('maps the legacy mid-run sentence', () => {
    expect(autopilotRunErrorCode('Ran out of credits before anything could be scheduled.')).toBe(
      'OUT_OF_CREDITS_MID_RUN',
    );
  });

  it('maps the legacy InsufficientCreditsError message', () => {
    expect(autopilotRunErrorCode('Insufficient credits. You have 4 but this needs 7.')).toBe('OUT_OF_CREDITS_MID_RUN');
  });

  it('returns null for anything else so the raw text is shown', () => {
    expect(autopilotRunErrorCode('Queue already full for the coming week.')).toBeNull();
    expect(autopilotRunErrorCode('Nothing could be scheduled this run.')).toBeNull();
    expect(autopilotRunErrorCode('')).toBeNull();
    expect(autopilotRunErrorCode(null)).toBeNull();
    expect(autopilotRunErrorCode(undefined)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';

import en from '../../../messages/en/tabs-b.json';
import fa from '../../../messages/fa/tabs-b.json';
import it_ from '../../../messages/it/tabs-b.json';
import { AUTOPILOT_RUN_ERROR, autopilotRunErrorCode, imagesMissingError } from './run-errors';

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

  it('reads IMAGES_MISSING with its image cause as one code (B19)', () => {
    expect(autopilotRunErrorCode(imagesMissingError('IMAGE_MODEL_UNAVAILABLE'))).toBe('IMAGES_MISSING');
    expect(imagesMissingError('IMAGE_PROVIDER_OUT_OF_CREDIT')).toBe('IMAGES_MISSING:IMAGE_PROVIDER_OUT_OF_CREDIT');
  });

  it('returns null for anything else so the raw text is shown', () => {
    expect(autopilotRunErrorCode('Queue already full for the coming week.')).toBeNull();
    expect(autopilotRunErrorCode('Nothing could be scheduled this run.')).toBeNull();
    expect(autopilotRunErrorCode('')).toBeNull();
    expect(autopilotRunErrorCode(null)).toBeNull();
    expect(autopilotRunErrorCode(undefined)).toBeNull();
  });
});

describe('run error copy', () => {
  // The tab renders t(`runErrors.${code}`); a code without copy would print its key path.
  it.each([
    ['en', en],
    ['fa', fa],
    ['it', it_],
  ])('%s has a message for every code', (_locale, catalogue) => {
    const runErrors = (catalogue as { tabsB: { credits: { runErrors: Record<string, string> } } }).tabsB.credits
      .runErrors;
    for (const code of Object.values(AUTOPILOT_RUN_ERROR)) {
      expect(runErrors[code], code).toBeTruthy();
    }
  });

  it('Persian copy uses the ICU count, never a hardcoded digit', () => {
    const runErrors = fa.tabsB.credits.runErrors as Record<string, string>;
    for (const text of Object.values(runErrors)) expect(text).not.toMatch(/[0-9۰-۹]/);
  });
});

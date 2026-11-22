import { describe, expect, it } from 'vitest';

import {
  EXPIRY_WARNING_DAYS,
  LINKEDIN_RECONNECT_REQUIRED,
  effectiveConnectionStatus,
  isTokenExpired,
  runNeedsLinkedInReconnect,
} from './connection-health';

// LinkedIn (w_member_social) issues no refresh token: a sign-in lasts 60 days
// and then publishing fails. The stored status only changes after the first
// 401, so the web reads tokenExpiresAt itself. Fixed clock, no database.

const NOW = new Date('2026-11-22T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const linkedIn = (tokenExpiresAt: Date | string | null, status = 'CONNECTED') => ({
  platform: 'LINKEDIN',
  status,
  tokenExpiresAt,
});

describe('effectiveConnectionStatus', () => {
  it('a token that expired in the past is EXPIRED even though the row says CONNECTED', () => {
    expect(effectiveConnectionStatus(linkedIn(new Date('2026-10-17T03:51:00Z')), NOW)).toEqual({
      status: 'EXPIRED',
      daysLeft: null,
    });
  });

  it('expiring exactly now counts as expired', () => {
    expect(effectiveConnectionStatus(linkedIn(at(0)), NOW).status).toBe('EXPIRED');
  });

  it('1 ms left is EXPIRING_SOON with 1 day left', () => {
    expect(effectiveConnectionStatus(linkedIn(at(1)), NOW)).toEqual({ status: 'EXPIRING_SOON', daysLeft: 1 });
  });

  it('exactly 7 days left is EXPIRING_SOON with 7 days left', () => {
    expect(effectiveConnectionStatus(linkedIn(at(EXPIRY_WARNING_DAYS * DAY)), NOW)).toEqual({
      status: 'EXPIRING_SOON',
      daysLeft: 7,
    });
  });

  it('7 days + 1 ms left is plain CONNECTED', () => {
    expect(effectiveConnectionStatus(linkedIn(at(7 * DAY + 1)), NOW)).toEqual({ status: 'CONNECTED', daysLeft: null });
  });

  it('rounds partial days up: 2.5 days left reads as 3', () => {
    expect(effectiveConnectionStatus(linkedIn(at(2.5 * DAY)), NOW).daysLeft).toBe(3);
  });

  it('accepts an ISO string as it arrives from a server component', () => {
    expect(effectiveConnectionStatus(linkedIn(at(-1).toISOString()), NOW).status).toBe('EXPIRED');
  });

  it('no stored expiry keeps the stored status', () => {
    expect(effectiveConnectionStatus(linkedIn(null), NOW)).toEqual({ status: 'CONNECTED', daysLeft: null });
  });

  it('an unparseable expiry keeps the stored status rather than inventing one', () => {
    expect(effectiveConnectionStatus(linkedIn('not a date'), NOW).status).toBe('CONNECTED');
  });

  it.each(['EXPIRED', 'REVOKED', 'FAILED', 'PENDING_REAUTH'])('a %s row stays as stored whatever its expiry says', (status) => {
    expect(effectiveConnectionStatus(linkedIn(at(3 * DAY), status), NOW)).toEqual({ status, daysLeft: null });
    expect(effectiveConnectionStatus(linkedIn(at(-DAY), status), NOW)).toEqual({ status, daysLeft: null });
  });

  it('platforms that refresh their own tokens are left as stored (an X token lasts 2 hours by design)', () => {
    expect(
      effectiveConnectionStatus({ platform: 'X', status: 'CONNECTED', tokenExpiresAt: at(-DAY) }, NOW),
    ).toEqual({ status: 'CONNECTED', daysLeft: null });
  });

  it('platform matching is case-insensitive', () => {
    expect(
      effectiveConnectionStatus({ platform: 'linkedin', status: 'CONNECTED', tokenExpiresAt: at(-1) }, NOW).status,
    ).toBe('EXPIRED');
  });
});

describe('isTokenExpired', () => {
  it('is true only once a CONNECTED LinkedIn token has run out', () => {
    expect(isTokenExpired(linkedIn(at(0)), NOW)).toBe(true);
    expect(isTokenExpired(linkedIn(at(1)), NOW)).toBe(false);
    expect(isTokenExpired(linkedIn(null), NOW)).toBe(false);
  });
});

describe('runNeedsLinkedInReconnect', () => {
  it('reads the code from the run error (nothing else was publishable)', () => {
    expect(runNeedsLinkedInReconnect({ error: LINKEDIN_RECONNECT_REQUIRED, log: [] })).toBe(true);
  });

  it('reads the code from a channel_skipped log entry (other channels still ran)', () => {
    const log = [{ step: 'channel_skipped', channel: 'linkedin', code: LINKEDIN_RECONNECT_REQUIRED }];
    expect(runNeedsLinkedInReconnect({ error: null, log })).toBe(true);
  });

  it('legacy English notes and unrelated errors do not trigger it', () => {
    const log = [{ step: 'channel_skipped', channel: 'linkedin', reason: 'no connected default LINKEDIN account' }, null, 'x'];
    expect(runNeedsLinkedInReconnect({ error: 'No channel is publishable: …', log })).toBe(false);
  });
});

describe('codes', () => {
  it('the reconnect code is stable: it is stored in run rows and looked up as a message key', () => {
    expect(LINKEDIN_RECONNECT_REQUIRED).toBe('LINKEDIN_RECONNECT_REQUIRED');
  });
});

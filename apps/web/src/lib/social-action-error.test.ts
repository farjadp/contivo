import { describe, expect, it } from 'vitest';

import { socialActionDetail } from './social-action-error';

describe('socialActionDetail', () => {
  it('is null for a success', () => {
    expect(socialActionDetail({})).toBeNull();
  });

  it('localises by code', () => {
    expect(socialActionDetail({ error: 'Your session has expired.', code: 'session_expired' })).toEqual({
      kind: 'message',
      key: 'session_expired',
    });
    expect(socialActionDetail({ error: 'x', code: 'reconnect_unsupported' })).toEqual({
      kind: 'message',
      key: 'reconnect_unsupported',
    });
  });

  it("keeps the API's words for rejected and for results with no code", () => {
    expect(socialActionDetail({ error: 'isDefault must be a boolean', code: 'rejected' })).toEqual({
      kind: 'raw',
      text: 'isDefault must be a boolean',
    });
    expect(socialActionDetail({ error: 'Something odd' })).toEqual({ kind: 'raw', text: 'Something odd' });
    expect(socialActionDetail({ code: 'rejected' })).toEqual({ kind: 'message', key: 'rejected' });
  });

  it('a refusal reason is localised instead of the raw API text', () => {
    expect(
      socialActionDetail({ error: 'Job cmwr… has exceeded the maximum retry count (5).', code: 'rejected', reason: 'RETRY_LIMIT' }),
    ).toEqual({ kind: 'message', key: 'refusal.RETRY_LIMIT' });
    expect(socialActionDetail({ error: 'x', code: 'not_found', reason: 'JOB_NOT_FOUND' })).toEqual({
      kind: 'message',
      key: 'refusal.JOB_NOT_FOUND',
    });
  });
});

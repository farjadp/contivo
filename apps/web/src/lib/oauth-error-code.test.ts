import { describe, expect, it } from 'vitest';

import { OAUTH_ERROR_CODES } from '@/lib/oauth/errors';

import { oauthErrorCode } from './oauth-error-code';

describe('oauthErrorCode (whitelist for ?error=)', () => {
  it('accepts exactly the seven codes the callback emits', () => {
    expect([...OAUTH_ERROR_CODES].sort()).toEqual(
      [
        'cancelled',
        'email_in_use',
        'invalid_state',
        'no_verified_email',
        'provider_error',
        'rate_limited',
        'suspended',
      ].sort(),
    );
    for (const code of OAUTH_ERROR_CODES) expect(oauthErrorCode(code)).toBe(code);
  });

  it.each([
    undefined,
    null,
    '',
    'Cancelled',
    'cancelled ',
    ' cancelled',
    'cancelled\n',
    'access_denied',
    'facebook',
    '__proto__',
    'constructor',
    'toString',
    '<img src=x onerror=alert(1)>',
    ['cancelled'],
    ['cancelled', 'suspended'],
    42,
    {},
  ])('rejects %j', (raw) => {
    expect(oauthErrorCode(raw)).toBeNull();
  });
});

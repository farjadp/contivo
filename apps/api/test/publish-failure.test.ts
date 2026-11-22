/**
 * Every failure the publish core writes starts with a stable code so the web
 * can localise it instead of matching English sentences.
 * Run: pnpm --filter @contivo/api test
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { PUBLISH_FAILURE_CODES, formatFailure, parseFailure } from '@contivo/types';

describe('publish failure codes', () => {
  it('formats as "[CODE] detail"', () => {
    assert.equal(formatFailure('CONNECTION_EXPIRED', 'LinkedIn rejected the token.'), '[CONNECTION_EXPIRED] LinkedIn rejected the token.');
  });

  it('round-trips every code', () => {
    for (const code of PUBLISH_FAILURE_CODES) {
      assert.deepEqual(parseFailure(formatFailure(code, 'why')), { code, detail: 'why' });
    }
  });

  it('a legacy reason without a code parses to code null, detail intact', () => {
    assert.deepEqual(parseFailure('Something old went wrong'), { code: null, detail: 'Something old went wrong' });
  });

  it('an unknown bracketed code is not trusted', () => {
    assert.deepEqual(parseFailure('[MADE_UP] x'), { code: null, detail: '[MADE_UP] x' });
  });

  it('null / empty → code null, empty detail', () => {
    assert.deepEqual(parseFailure(null), { code: null, detail: '' });
    assert.deepEqual(parseFailure(undefined), { code: null, detail: '' });
  });

  it('does not double-prefix an already coded detail', () => {
    assert.equal(formatFailure('PLATFORM_ERROR', '[RATE_LIMITED] slow down'), '[RATE_LIMITED] slow down');
  });
});

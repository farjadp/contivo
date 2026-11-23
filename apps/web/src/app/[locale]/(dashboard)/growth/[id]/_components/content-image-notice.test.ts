import { describe, expect, it } from 'vitest';

import { imageNotice } from './content-image-notice';

describe('imageNotice', () => {
  it('a failed generation says text only and carries its reference', () => {
    expect(imageNotice({ ok: false, error: 'generation_failed', ref: 'CTV-7F3K' })).toEqual({ kind: 'failed', ref: 'CTV-7F3K' });
  });

  it('every failure maps to a notice: none is silent', () => {
    for (const error of ['not_found', 'locked', 'insufficient_credits', 'generation_failed', 'empty', 'too_large', 'wrong_type'] as const) {
      expect(imageNotice({ ok: false, error })).toBeTruthy();
    }
    expect(imageNotice({ ok: false, error: 'insufficient_credits', balance: 1, required: 3 })).toEqual({
      kind: 'credits',
      balance: 1,
      required: 3,
    });
  });
});

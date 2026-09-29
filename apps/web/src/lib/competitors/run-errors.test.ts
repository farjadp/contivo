import { describe, expect, it } from 'vitest';

import { classifyRunError, RUN_ERROR, withRunErrorCode } from './run-errors';

describe('classifyRunError', () => {
  it('maps blank or unrecognised text, including configuration errors, to generic', () => {
    expect(classifyRunError(' boom ')).toBe('generic');
    expect(classifyRunError('   ')).toBe('generic');
    expect(classifyRunError(null)).toBe('generic');
    expect(classifyRunError(undefined)).toBe('generic');
    // Configuration errors get the generic message, never their own text or kind.
    expect(classifyRunError('OPENAI_API_KEY is not set — cannot generate discovery queries')).toBe('generic');
    expect(classifyRunError('CRON_SECRET is not set')).toBe('generic');
  });

  it('maps the stable prefixes written by the pipeline', () => {
    expect(classifyRunError('TIMED_OUT')).toBe('timedOut');
    expect(classifyRunError('TIMED_OUT: ran past the reaper window')).toBe('timedOut');
    expect(classifyRunError('DISPATCH_FAILED: fetch failed (ECONNREFUSED)')).toBe('dispatch');
    expect(classifyRunError('JUDGE_UNAVAILABLE: Judge batch failed: 500 boom')).toBe('judgeOutage');
    expect(classifyRunError('SEARCH_UNAVAILABLE: Search query threw for "x": network blew up')).toBe(
      'searchUnavailable',
    );
  });

  it('maps a matrix run that had too few competitors with evidence to notEnoughEvidence', () => {
    expect(RUN_ERROR.NOT_ENOUGH_EVIDENCE).toBe('NOT_ENOUGH_EVIDENCE');
    expect(classifyRunError('NOT_ENOUGH_EVIDENCE')).toBe('notEnoughEvidence');
    expect(classifyRunError('NOT_ENOUGH_EVIDENCE: 1 of 9 competitors has site evidence')).toBe('notEnoughEvidence');
  });

  it('recognises a 429 anywhere in the message as rate limiting, even under another prefix', () => {
    expect(classifyRunError('JUDGE_UNAVAILABLE: Judge batch failed: 429 Rate limit reached')).toBe('rateLimited');
    expect(classifyRunError('SEARCH_UNAVAILABLE: Search query failed for "x": 429 Too Many Requests')).toBe(
      'rateLimited',
    );
    expect(classifyRunError('Search query failed for "x": 429 Too Many Requests')).toBe('rateLimited');
    expect(classifyRunError('upstream rate limit hit')).toBe('rateLimited');
  });

  it('withRunErrorCode prefixes a detail, or returns the bare code with nothing to add', () => {
    expect(withRunErrorCode(RUN_ERROR.TIMED_OUT, null)).toBe('TIMED_OUT');
    expect(withRunErrorCode(RUN_ERROR.TIMED_OUT, '  ')).toBe('TIMED_OUT');
    expect(withRunErrorCode(RUN_ERROR.DISPATCH_FAILED, 'fetch failed (ECONNREFUSED)')).toBe(
      'DISPATCH_FAILED: fetch failed (ECONNREFUSED)',
    );
  });
});

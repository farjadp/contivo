import { describe, expect, it } from 'vitest';

import {
  classifyRunError,
  describeAiFailure,
  isAiUnavailableFailure,
  RUN_ERROR,
  stageFailureError,
  withRunErrorCode,
  type AiFailureLike,
} from './run-errors';

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

function failure(overrides: Partial<AiFailureLike> = {}): AiFailureLike {
  return {
    kind: 'all_unavailable',
    firstErrorClass: 'billing',
    allRateLimited: false,
    attempts: [
      { provider: 'openai', errorClass: 'billing', status: 429 },
      { provider: 'anthropic', errorClass: 'not_configured' },
      { provider: 'gemini', errorClass: 'not_configured' },
    ],
    ...overrides,
  };
}

describe('AI_UNAVAILABLE', () => {
  it('has the exact code and kind the UI wires', () => {
    expect(RUN_ERROR.AI_UNAVAILABLE).toBe('AI_UNAVAILABLE');
    expect(classifyRunError('AI_UNAVAILABLE')).toBe('aiUnavailable');
    expect(classifyRunError('AI_UNAVAILABLE: Judge batch failed: all_unavailable (openai:billing:429)')).toBe(
      'aiUnavailable',
    );
  });

  it('beats the 429 regex: a stored billing 429 never maps to rateLimited', () => {
    expect(classifyRunError('AI_UNAVAILABLE: Search query failed for "x": all_unavailable (openai:billing:429)')).toBe(
      'aiUnavailable',
    );
    // Rows written on 22 Nov, before the code existed.
    expect(
      classifyRunError(
        'JUDGE_UNAVAILABLE: Judge batch failed: 429 {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota"}}',
      ),
    ).toBe('aiUnavailable');
    expect(classifyRunError('OpenAI query generation failed: 401 {"error":{"code":"invalid_api_key"}}')).toBe(
      'aiUnavailable',
    );
  });

  it('isAiUnavailableFailure: billing/auth/model_gone first, or all_unavailable without every attempt rate limited', () => {
    expect(isAiUnavailableFailure(failure())).toBe(true);
    expect(isAiUnavailableFailure(failure({ kind: 'bad_request', firstErrorClass: 'auth' }))).toBe(true);
    expect(isAiUnavailableFailure(failure({ kind: 'bad_request', firstErrorClass: 'model_gone' }))).toBe(true);
    expect(isAiUnavailableFailure(failure({ firstErrorClass: 'server' }))).toBe(true);
    expect(isAiUnavailableFailure(failure({ firstErrorClass: 'not_configured' }))).toBe(true);
    expect(isAiUnavailableFailure(failure({ firstErrorClass: 'rate_limit', allRateLimited: true }))).toBe(false);
    expect(isAiUnavailableFailure(failure({ kind: 'bad_request', firstErrorClass: 'bad_request' }))).toBe(false);
    expect(isAiUnavailableFailure(failure({ kind: 'refusal', firstErrorClass: 'refusal' }))).toBe(false);
  });

  it('describeAiFailure: billing -> aiUnavailable, all rate limited -> rateLimited, bad request -> neither', () => {
    const billing = describeAiFailure('Judge batch failed', failure());
    expect(billing).toBe(
      'AI_UNAVAILABLE: Judge batch failed: all_unavailable (openai:billing:429, anthropic:not_configured, gemini:not_configured)',
    );
    expect(classifyRunError(billing)).toBe('aiUnavailable');

    const limited = describeAiFailure(
      'Judge batch failed',
      failure({
        firstErrorClass: 'rate_limit',
        allRateLimited: true,
        attempts: [
          { provider: 'openai', errorClass: 'rate_limit', status: 429 },
          { provider: 'anthropic', errorClass: 'rate_limit', status: 429 },
        ],
      }),
    );
    expect(limited.startsWith('AI_UNAVAILABLE')).toBe(false);
    expect(classifyRunError(withRunErrorCode(RUN_ERROR.JUDGE_UNAVAILABLE, limited))).toBe('rateLimited');

    const bad = describeAiFailure(
      'Judge batch failed',
      failure({ kind: 'bad_request', firstErrorClass: 'bad_request', attempts: [{ provider: 'openai', errorClass: 'bad_request', status: 400 }] }),
    );
    expect(classifyRunError(withRunErrorCode(RUN_ERROR.JUDGE_UNAVAILABLE, bad))).toBe('judgeOutage');
  });

  it('stageFailureError keeps an AI_UNAVAILABLE detail as-is, else prefixes the stage code', () => {
    expect(stageFailureError(RUN_ERROR.JUDGE_UNAVAILABLE, ['Judge batch failed: 500', 'AI_UNAVAILABLE: x'])).toBe(
      'AI_UNAVAILABLE: x',
    );
    expect(stageFailureError(RUN_ERROR.SEARCH_UNAVAILABLE, ['Search query threw: boom'])).toBe(
      'SEARCH_UNAVAILABLE: Search query threw: boom',
    );
  });
});
